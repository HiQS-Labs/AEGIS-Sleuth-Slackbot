'use strict';

// Structural ratchet for the named #250 reminder-pipeline inventory. See #79 and #250.
const fs = require('fs');
const path = require('path');

const Root = path.join(__dirname, '..');
const BaselinePath = path.join(__dirname, 'reminder-pipeline-baseline.json');
const Update = process.argv.includes('--update-baseline');

function Lines(ArgFile) {
  return fs.readFileSync(path.join(Root, ArgFile), 'utf8').split('\n');
}

function Matches(ArgFile, ArgPattern) {
  return Lines(ArgFile).flatMap((Line, Index) => ArgPattern.test(Line) ? [`${ArgFile}:${Index + 1}`] : []);
}

function ExecutableMatches(ArgFile, ArgPattern) {
  let InBlockComment = false;
  return Lines(ArgFile).flatMap((Line, Index) => {
    const Trimmed = Line.trim();
    if(InBlockComment) {
      if(Trimmed.includes('*/')) InBlockComment = false;
      return [];
    }
    if(Trimmed.startsWith('/*')) {
      if(!Trimmed.includes('*/')) InBlockComment = true;
      return [];
    }
    if(Trimmed.startsWith('//') || Trimmed.startsWith('*')) return [];
    return ArgPattern.test(Line) ? [`${ArgFile}:${Index + 1}`] : [];
  });
}

function SourceFiles(ArgDirectory = 'src') {
  const AbsoluteDirectory = path.join(Root, ArgDirectory);
  return fs.readdirSync(AbsoluteDirectory, {withFileTypes: true}).flatMap(Entry => {
    const RelativePath = path.join(ArgDirectory, Entry.name);
    if(Entry.isDirectory()) return SourceFiles(RelativePath);
    return Entry.name.endsWith('.js') ? [RelativePath] : [];
  });
}

function KeyTaskReparseSites() {
  return SourceFiles().flatMap(File => [
    // `Key task` anywhere inside the regex or string operand (`.match(/\n\nKey task\(s\):/)`).
    ...ExecutableMatches(File, /\.(?:replace|match|indexOf)\((?:\/(?:[^/\\\n]|\\.)*Key task|['"][^'"]*Key task)/),
    ...ExecutableMatches(File, /const \w+ = ['"][^'"]*Key task/),
  ]);
}

function DisplaySources() {
  const File = 'src/reminder-display-selection.js';
  const FileLines = Lines(File);
  // the selector's declared return union, found by its shape rather than by any one member, so
  // deleting a source (the planned `verbatim` removal) still counts the rest.
  const Index = FileLines.findIndex(Line => /@returns\s+\{\{[^}]*?\bsource:\s*'/.test(Line));
  if(Index < 0) throw new Error(`${File}: no @returns declaring a 'source' union; update DisplaySources().`);
  // the union may continue onto JSDoc continuation lines (`\n * |'new-source'`).
  const SourceDefinition = FileLines.slice(Index).join('\n').match(/\bsource:\s*((?:'[^']+'|[\s*|])+)/)[1];
  return [...SourceDefinition.matchAll(/'([^']+)'/g)].map(Match => `${File}:${Index + 1}:${Match[1]}`);
}

function Main() {
  const Counters = {
    llm_extraction_specs: Matches('src/reminders-ai-pipeline.js', /^\s*const \w+DecisionSpec = Object\.freeze\(/),
    key_task_reparse_sites: KeyTaskReparseSites(),
    routing_thresholds: Matches('src/reminders-ai-pipeline.js', /^  static (?:[A-Z_]*THRESHOLD|BURIED_TASK_[A-Z_]+) =/),
    display_sources: DisplaySources(),
    context_markers: Matches('src/reminder-context-resolution.js', /^const [A-Z_]*HEADER =/),
  };
  const Baseline = JSON.parse(fs.readFileSync(BaselinePath, 'utf8'));
  const Failures = [];
  for(const [Name, Locations] of Object.entries(Counters)) {
    const Previous = Baseline.counters[Name].count;
    // a baseline count above its `initial` value needs an increase record of its own (GH-261): an
    // edited `count` alone is refused, and each record names its reason and issue.
    const Increases = Baseline.counters[Name].increases || [];
    if(!Number.isInteger(Baseline.counters[Name].initial)) Failures.push(`${Name} baseline needs an integer "initial" count.`);
    const Ceiling = Math.max(Baseline.counters[Name].initial, ...Increases.map(Increase => Increase.to));
    if(Previous > Ceiling) Failures.push(`${Name} baseline count ${Previous} exceeds its approved ceiling ${Ceiling}; add an "increases" record with a reason and issue.`);
    for(const Increase of Increases) {
      if(!Number.isInteger(Increase.to) || !String(Increase.reason || '').trim() || !/^#\d+$/.test(String(Increase.issue || ''))) {
        Failures.push(`${Name} increase record ${JSON.stringify(Increase)} needs an integer "to", a "reason" and an "issue" like "#123".`);
      }
    }
    if(Locations.length > Previous) Failures.push(`${Name} grew ${Previous} -> ${Locations.length}: ${Locations.join(', ')}`);
    if(Locations.length < Previous && !Update) Failures.push(`${Name} shrank ${Previous} -> ${Locations.length}; run --update-baseline in this deletion PR.`);
    if(Update && Locations.length > Previous) Failures.push(`${Name} cannot raise its baseline (${Previous} -> ${Locations.length}).`);
    if(Update && Locations.length <= Previous) {
      Baseline.counters[Name].count = Locations.length;
      Baseline.counters[Name].locations = Locations;
      // a deletion retires approvals above the new count, so regrowth needs a fresh record.
      Baseline.counters[Name].initial = Math.min(Baseline.counters[Name].initial, Locations.length);
      Baseline.counters[Name].increases = Increases.filter(Increase => Increase.to <= Locations.length);
    }
  }
  if(Failures.length) {
    console.error('reminder-pipeline ratchet violations (#79 / #250):');
    Failures.forEach(Failure => console.error(`  ${Failure}`));
    process.exit(1);
  }
  if(Update) fs.writeFileSync(BaselinePath, `${JSON.stringify(Baseline, null, 2)}\n`);
  console.log(`reminder-pipeline ratchet: clean (${Object.entries(Counters).map(([Name, Locations]) => `${Name}=${Locations.length}`).join(', ')}).`);
}

Main();
