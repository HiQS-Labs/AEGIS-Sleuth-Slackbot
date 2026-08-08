#!/usr/bin/env node
'use strict';

// Shadow-diff harness for Phase 5.  It never changes a read source; it only
// reports how the event projection differs from the still-authoritative JSON/API
// artifacts supplied to it.

const fs = require('node:fs');
const path = require('node:path');
const {
  BuildProjectedRebalanceExport,
  FoldReminderReadModels,
} = require('../src/reminders-projection');

/**
 * @param {any} ArgValue
 * @returns {any}
 */
function Canonicalize(ArgValue) {
  if(Array.isArray(ArgValue)) return ArgValue.map(Canonicalize);
  if(!ArgValue || typeof ArgValue !== 'object') return ArgValue;
  const Result = {};
  for(const Key of Object.keys(ArgValue).sort()) Result[Key] = Canonicalize(ArgValue[Key]);
  return Result;
}

/**
 * @param {any} ArgValue
 * @returns {string}
 */
function SerializeCanonical(ArgValue) {
  return `${JSON.stringify(Canonicalize(ArgValue), null, 2)}\n`;
}

/**
 * Byte comparison is deliberately literal: callers may pass raw API bytes.
 * @param {string} ArgAuthoritative
 * @param {string} ArgProjection
 * @returns {{ equal: boolean, authoritativeBytes: number, projectionBytes: number }}
 */
function CompareBytes(ArgAuthoritative, ArgProjection) {
  return {
    equal: ArgAuthoritative === ArgProjection,
    authoritativeBytes: Buffer.byteLength(ArgAuthoritative),
    projectionBytes: Buffer.byteLength(ArgProjection),
  };
}

/**
 * Semantic comparison normalizes object-key order only.  Array ordering remains
 * meaningful until a surface explicitly proves otherwise.
 * @param {any} ArgAuthoritative
 * @param {any} ArgProjection
 * @returns {{ equal: boolean, authoritative: any, projection: any }}
 */
function CompareSemantics(ArgAuthoritative, ArgProjection) {
  const Authoritative = Canonicalize(ArgAuthoritative);
  const Projection = Canonicalize(ArgProjection);
  return {
    equal: JSON.stringify(Authoritative) === JSON.stringify(Projection),
    authoritative: Authoritative,
    projection: Projection,
  };
}

/**
 * @param {string} ArgPath
 * @param {boolean} ArgRequired
 * @returns {any|null}
 */
function ReadJsonFile(ArgPath, ArgRequired) {
  try {
    return JSON.parse(fs.readFileSync(ArgPath, 'utf8'));
  } catch(error) {
    if(!ArgRequired && error && error.code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * @param {string} ArgPath
 * @returns {string}
 */
function ReadJsonText(ArgPath) {
  return fs.readFileSync(ArgPath, 'utf8');
}

/**
 * Compare the three Phase 5 read surfaces.  `rebalance` is optional because it
 * must be captured from the current API separately; when absent the report says
 * so rather than inventing a parity result.
 * @param {{ workspace: string, events: any[], reminders: any[], completed: any[], rebalance?: any|null, remindersRaw?: string, completedRaw?: string, rebalanceRaw?: string }} ArgInput
 * @returns {object}
 */
function BuildParityReport(ArgInput) {
  const Folded = FoldReminderReadModels(ArgInput.events, { strict: false });
  const ProjectedRebalance = BuildProjectedRebalanceExport(Folded.reminders, ArgInput.workspace);
  const Surfaces = {
    reminders: { authoritative: ArgInput.reminders, authoritativeRaw: ArgInput.remindersRaw, projection: Folded.reminders },
    completed: { authoritative: ArgInput.completed, authoritativeRaw: ArgInput.completedRaw, projection: Folded.completed },
  };
  if(ArgInput.rebalance !== null && ArgInput.rebalance !== undefined) {
    Surfaces.rebalance = { authoritative: ArgInput.rebalance, authoritativeRaw: ArgInput.rebalanceRaw, projection: ProjectedRebalance };
  }

  const Report = { workspace: ArgInput.workspace, byteDiffs: {}, semanticDiffs: {}, missingSurfaces: [] };
  for(const [Name, Values] of Object.entries(Surfaces)) {
    Report.byteDiffs[Name] = CompareBytes(Values.authoritativeRaw || SerializeCanonical(Values.authoritative), SerializeCanonical(Values.projection));
    Report.semanticDiffs[Name] = CompareSemantics(Values.authoritative, Values.projection);
  }
  if(!Object.prototype.hasOwnProperty.call(Surfaces, 'rebalance')) Report.missingSurfaces.push('rebalance');
  Report.clean = Report.missingSurfaces.length === 0
    && Object.values(Report.byteDiffs).every(ArgDiff => ArgDiff.equal)
    && Object.values(Report.semanticDiffs).every(ArgDiff => ArgDiff.equal);
  return Report;
}

/**
 * @param {string[]} ArgArgv
 * @returns {{ workspace: string, events: string, reminders: string, completed: string, rebalance: string|null }}
 */
function ParseArgs(ArgArgv) {
  const Values = { workspace: '', events: '', reminders: '', completed: '', rebalance: null };
  for(let Index = 0; Index < ArgArgv.length; Index += 2) {
    const Name = ArgArgv[Index];
    const Value = ArgArgv[Index + 1];
    if(!Value || !Object.prototype.hasOwnProperty.call(Values, Name.slice(2))) {
      throw new Error('usage: projection-parity-harness --workspace <name> --events <file> --reminders <file> --completed <file> [--rebalance <api-json-file>]');
    }
    Values[Name.slice(2)] = Value;
  }
  if(!Values.workspace || !Values.events || !Values.reminders || !Values.completed) {
    throw new Error('workspace, events, reminders, and completed inputs are required');
  }
  return Values;
}

function Main() {
  const Options = ParseArgs(process.argv.slice(2));
  const EventsRaw = ReadJsonText(path.resolve(Options.events));
  const RemindersRaw = ReadJsonText(path.resolve(Options.reminders));
  const CompletedRaw = ReadJsonText(path.resolve(Options.completed));
  const RebalanceRaw = Options.rebalance ? ReadJsonText(path.resolve(Options.rebalance)) : null;
  const Report = BuildParityReport({
    workspace: Options.workspace,
    events: JSON.parse(EventsRaw),
    reminders: JSON.parse(RemindersRaw),
    completed: JSON.parse(CompletedRaw),
    rebalance: RebalanceRaw ? JSON.parse(RebalanceRaw) : null,
    remindersRaw: RemindersRaw,
    completedRaw: CompletedRaw,
    rebalanceRaw: RebalanceRaw || undefined,
  });
  process.stdout.write(`${JSON.stringify(Report, null, 2)}\n`);
  process.exitCode = Report.clean ? 0 : 1;
}

if(require.main === module) Main();

module.exports = {
  BuildParityReport,
  Canonicalize,
  CompareBytes,
  CompareSemantics,
  ReadJsonFile,
  SerializeCanonical,
};
