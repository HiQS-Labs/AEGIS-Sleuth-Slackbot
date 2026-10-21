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
    ...Matches(File, /\.(?:replace|match|indexOf)\((?:\/Key task|['"][^'"]*Key task)/),
    ...Matches(File, /const \w+ = ['"][^'"]*Key task/),
  ]);
}

function DisplaySources() {
  const File = 'src/reminder-display-selection.js';
  const Index = Lines(File).findIndex(Line => Line.includes("source: 'verbatim'"));
  if(Index < 0) return [];
  const SourceDefinition = Lines(File)[Index].match(/source:\s*([^,}]+)/)?.[1] || '';
  return [...SourceDefinition.matchAll(/'([^']+)'/g)].map(Match => `${File}:${Index + 1}:${Match[1]}`);
}

function Main() {
  const Counters = {
    llm_extraction_specs: Matches('src/reminders-ai-pipeline.js', /^const \w+DecisionSpec = Object\.freeze\(/),
    key_task_reparse_sites: KeyTaskReparseSites(),
    routing_thresholds: Matches('src/reminders-ai-pipeline.js', /^  static (?:[A-Z_]*THRESHOLD|BURIED_TASK_[A-Z_]+) =/),
    display_sources: DisplaySources(),
    context_markers: Matches('src/reminder-context-resolution.js', /^const [A-Z_]*HEADER =/),
  };
  const Baseline = JSON.parse(fs.readFileSync(BaselinePath, 'utf8'));
  const Failures = [];
  for(const [Name, Locations] of Object.entries(Counters)) {
    const Previous = Baseline.counters[Name].count;
    if(Locations.length > Previous) Failures.push(`${Name} grew ${Previous} -> ${Locations.length}: ${Locations.join(', ')}`);
    if(Locations.length < Previous && !Update) Failures.push(`${Name} shrank ${Previous} -> ${Locations.length}; run --update-baseline in this deletion PR.`);
    if(Update && Locations.length > Previous) Failures.push(`${Name} cannot raise its baseline (${Previous} -> ${Locations.length}).`);
    if(Update && Locations.length < Previous) {
      Baseline.counters[Name].count = Locations.length;
      Baseline.counters[Name].locations = Locations;
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
