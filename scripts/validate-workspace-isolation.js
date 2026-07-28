'use strict';

/**
 * CI guard for the #384 tenant-isolation bug class: per-workspace state resolved from a
 * global/module-level singleton, or a primary command route registered outside a module's
 * RegisterCommandRoutes() body. Mirrors scripts/validate-fsm-invariants.js — scan src/**\/*.js,
 * match narrow patterns, honor an inline allowlist pragma, report file:line, exit non-zero on any
 * violation.
 *
 * Shape 1 — global-singleton state resolution. Flags `global.__sleuth<name>.<property>` reads, the
 * pattern that let #384 ship (resolving a per-workspace SlackApp from a shared global array).
 * Reviewed exceptions carry an inline `// ISOLATION-OK: <reason>` pragma, mirroring
 * `// FSM-BACKFILL-OK`.
 *
 * Shape 2 — primary route registered outside RegisterCommandRoutes. Flags a
 * `Something.Register({ ... })` call for a primary (non-delegating) handler when it is not
 * lexically inside a method named RegisterCommandRoutes. Alias delegation — a Handle that forwards
 * to `BaseRoute.Handle(...)`, as in src/catalog-regex-aliases.js — is allowed.
 * src/catalog-regex-aliases.js itself is exempt from Shape 2: dynamically registering
 * non-compile-time routes is that module's documented job, and its one primary registration (the
 * legacy ask-reminders bootstrap) is a reviewed carve-out already guarded by the Shape 1 pragma.
 */

const fs = require('fs');
const path = require('path');

const SrcRoot = path.join(__dirname, '..', 'src');
const RepoRoot = path.join(__dirname, '..');
const IsolationPragma = 'ISOLATION-OK';
const GlobalSingletonPattern = /global\.__sleuth\w*\s*\.\s*\w+/;
const RegisterCallPattern = /\.Register\(\{/;
const MethodHeaderPattern = /^\s*(?:async\s+)?(?:function\s+)?(?:static\s+)?#?([A-Za-z_]\w*)\s*\([^)]*\)\s*\{\s*$/;
const Shape2ExemptFiles = new Set(['catalog-regex-aliases.js']);
// Control-flow keywords shaped like `keyword(...) {` (for/if/while/switch/catch/...) satisfy
// MethodHeaderPattern's generic identifier-call-brace shape too. Left unfiltered, a loop/conditional
// nested directly inside a real method (e.g. a `for` loop inside RegisterCommandRoutes) gets pushed
// onto the label stack as if it were its OWN method named "for", which then shadows the real
// enclosing method name for anything nested inside it — a false "outside RegisterCommandRoutes" flag.
const ControlFlowKeywords = new Set(['if', 'for', 'while', 'switch', 'catch', 'do', 'else', 'with', 'try']);

/**
 * Recursively collect .js file paths under a directory.
 * @param {string} ArgDir Directory to walk.
 * @returns {string[]} Absolute file paths.
 */
function CollectJsFiles(ArgDir) {
  const Results = [];
  for(const Entry of fs.readdirSync(ArgDir, { withFileTypes: true })) {
    const FullPath = path.join(ArgDir, Entry.name);
    if(Entry.isDirectory()) Results.push(...CollectJsFiles(FullPath));
    else if(Entry.isFile() && Entry.name.endsWith('.js')) Results.push(FullPath);
  }
  return Results;
}

/**
 * Scan a file's lines for Shape 1 violations (global-singleton state resolution).
 * @param {string} ArgRelPath File path used for reporting.
 * @param {string[]} ArgLines File content split on newlines.
 * @returns {string[]} Violation strings shaped "path:line: message".
 */
function FindGlobalSingletonViolations(ArgRelPath, ArgLines) {
  const Violations = [];
  ArgLines.forEach((Line, Index) => {
    if(!GlobalSingletonPattern.test(Line)) return;
    if(Line.includes(IsolationPragma)) return;
    Violations.push(
      `${ArgRelPath}:${Index + 1}: per-workspace state resolved via a global singleton read ` +
      `("${Line.trim()}"). pass the owning SlackApp/module in explicitly, or add ` +
      `"// ${IsolationPragma}: <reason>" if this is a reviewed exception.`
    );
  });
  return Violations;
}

/**
 * Compute, for every line, the stack of enclosing method-header labels (or null for unlabeled
 * blocks) active immediately BEFORE that line's own braces are processed — ie the lexical context
 * the line's own content (such as a `.Register(` call) is written in.
 * @param {string[]} ArgLines File content split on newlines.
 * @returns {Array<Array<string|null>>} Per-line label-stack snapshots.
 */
function ComputeLabelStackPerLine(ArgLines) {
  const Snapshots = [];
  const Stack = [];
  for(const Line of ArgLines) {
    Snapshots.push(Stack.slice());
    const HeaderMatch = Line.match(MethodHeaderPattern);
    let PendingLabel = (HeaderMatch && !ControlFlowKeywords.has(HeaderMatch[1])) ? HeaderMatch[1] : null;
    for(const Ch of Line) {
      if(Ch === '{') {
        Stack.push(PendingLabel);
        PendingLabel = null;
      } else if(Ch === '}') {
        Stack.pop();
      }
    }
  }
  return Snapshots;
}

/**
 * Scan a file's lines for Shape 2 violations (primary route registered outside
 * RegisterCommandRoutes).
 * @param {string} ArgRelPath File path used for reporting.
 * @param {string} ArgFileName Base file name, used for the Shape 2 file exemption.
 * @param {string[]} ArgLines File content split on newlines.
 * @returns {string[]} Violation strings shaped "path:line: message".
 */
function FindStrayRouteRegistrations(ArgRelPath, ArgFileName, ArgLines) {
  if(Shape2ExemptFiles.has(ArgFileName)) return [];

  const Violations = [];
  const LabelStacks = ComputeLabelStackPerLine(ArgLines);

  ArgLines.forEach((Line, Index) => {
    if(!RegisterCallPattern.test(Line)) return;
    if(Line.includes(IsolationPragma)) return;

    const EnclosingLabel = [...LabelStacks[Index]].reverse().find(Label => Label);
    if(EnclosingLabel === 'RegisterCommandRoutes') return;

    // look ahead a bounded window for alias delegation before flagging it as a violation.
    const LookaheadWindow = ArgLines.slice(Index, Index + 20).join('\n');
    if(/BaseRoute\.Handle\(/.test(LookaheadWindow)) return;

    Violations.push(
      `${ArgRelPath}:${Index + 1}: primary route registered outside RegisterCommandRoutes ` +
      `("${Line.trim()}"). register primary routes inside a RegisterCommandRoutes method, or ` +
      `delegate via BaseRoute.Handle(...) for alias registration.`
    );
  });

  return Violations;
}

/**
 * Run the full workspace-isolation guard over src/**\/*.js.
 * @returns {string[]} All violation strings found; empty when clean.
 */
function RunWorkspaceIsolationValidation() {
  const Violations = [];
  for(const FilePath of CollectJsFiles(SrcRoot)) {
    const RelPath = path.relative(RepoRoot, FilePath);
    const Lines = fs.readFileSync(FilePath, 'utf8').split('\n');
    Violations.push(...FindGlobalSingletonViolations(RelPath, Lines));
    Violations.push(...FindStrayRouteRegistrations(RelPath, path.basename(FilePath), Lines));
  }
  return Violations;
}

if(require.main === module) {
  const Violations = RunWorkspaceIsolationValidation();
  if(Violations.length > 0) {
    console.error('workspace isolation violations found:\n');
    Violations.forEach(Violation => console.error(`  ${Violation}`));
    console.error(
      `\n${Violations.length} violation(s). see AGENTS.md ` +
      '"Never resolve per-workspace state through module-level globals or singletons."'
    );
    process.exit(1);
  }
  console.log('workspace isolation guard: clean.');
}

module.exports = {
  RunWorkspaceIsolationValidation,
  FindGlobalSingletonViolations,
  FindStrayRouteRegistrations,
  ComputeLabelStackPerLine,
};
