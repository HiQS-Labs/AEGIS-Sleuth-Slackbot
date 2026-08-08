#!/usr/bin/env node
'use strict';

// Read-only entity-linking diagnostics. This command replays event input into the p2 scorer and
// compares the resulting task associations with the current client-mapping-shaped overlay. It
// never imports a runtime writer and never writes a store; stdout is its only output channel.
//
// Usage:
//   node scripts/entity-linking-diagnostics.js --events-file events.jsonl \
//     --clients-file client-channel-mapping.json [--projects-file projects.json] \
//     [--overrides-file entity-overrides.json] [--threshold 0.60] [--task-id reminder-id]
//
// Overrides are replay data, not code. Each array is optional:
// {
//   "merges": [{ "from": { "type": "task", "id": "r-1" }, "to": { "type": "client", "id": "client-a" } }],
//   "splits": [{ "from": { "type": "task", "id": "r-2" }, "to": { "type": "client", "id": "client-b" } }],
//   "aliases": [{ "alias": "acme web", "target": { "type": "client", "id": "client-a" } }]
// }

const fs = require('node:fs');
const { FoldEntityProjectionInputs } = require('../src/entity-projection-inputs');
const { GenerateScoredCandidateEdges } = require('../src/entity-linking');
const { ENTITY_CLUSTER_CONFIDENCE_THRESHOLD } = require('../src/entity-read-model');

/**
 * @param {any} ArgValue
 * @returns {string|null}
 */
function GetStringOrNull(ArgValue) {
  return typeof ArgValue === 'string' && ArgValue.trim() ? ArgValue.trim() : null;
}

/**
 * @param {any} ArgValue
 * @returns {any[]}
 */
function GetArray(ArgValue) {
  return Array.isArray(ArgValue) ? ArgValue : [];
}

/**
 * @param {string} ArgLeft
 * @param {string} ArgRight
 * @returns {number}
 */
function CompareStrings(ArgLeft, ArgRight) {
  return ArgLeft < ArgRight ? -1 : ArgLeft > ArgRight ? 1 : 0;
}

/**
 * @param {any} ArgEndpoint
 * @returns {{ type: string, id: string }|null}
 */
function NormalizeEndpoint(ArgEndpoint) {
  const Type = GetStringOrNull(ArgEndpoint?.type);
  const Id = GetStringOrNull(ArgEndpoint?.id);
  return Type !== null && Id !== null ? { type: Type, id: Id } : null;
}

/**
 * @param {{ type: string, id: string }} ArgEndpoint
 * @returns {string}
 */
function GetEndpointKey(ArgEndpoint) {
  return `${ArgEndpoint.type}\u0000${ArgEndpoint.id}`;
}

/**
 * @param {any} ArgOverride
 * @returns {{ from: { type: string, id: string }, to: { type: string, id: string } }|null}
 */
function NormalizeAssociationOverride(ArgOverride) {
  const From = NormalizeEndpoint(ArgOverride?.from);
  const To = NormalizeEndpoint(ArgOverride?.to || ArgOverride?.target);
  return From !== null && To !== null ? { from: From, to: To } : null;
}

/**
 * Normalize the intentionally small, data-only override schema. Singular spellings are accepted
 * too, so an operator can add one correction without wrapping it in an array.
 * @param {any} ArgOverrides
 * @returns {{ merges: Array<any>, splits: Array<any>, aliases: Array<any> }}
 */
function NormalizeOverrides(ArgOverrides) {
  const Source = ArgOverrides && typeof ArgOverrides === 'object' && !Array.isArray(ArgOverrides) ? ArgOverrides : {};
  const GetEntries = (ArgPlural, ArgSingular) => [
    ...GetArray(Source[ArgPlural]),
    ...(Source[ArgSingular] === undefined ? [] : [Source[ArgSingular]]),
  ];
  const NormalizeAliases = GetEntries('aliases', 'alias').flatMap(ArgAlias => {
    const Alias = GetStringOrNull(ArgAlias?.alias || ArgAlias?.surfaceForm);
    const Target = NormalizeEndpoint(ArgAlias?.target || ArgAlias?.to);
    return Alias !== null && Target !== null ? [{ alias: Alias, target: Target }] : [];
  });
  return {
    merges: GetEntries('merges', 'merge').map(NormalizeAssociationOverride).filter(Boolean),
    splits: GetEntries('splits', 'split').map(NormalizeAssociationOverride).filter(Boolean),
    aliases: NormalizeAliases,
  };
}

/**
 * @param {any[]} ArgClients
 * @param {Array<{ alias: string, target: { type: string, id: string } }>} ArgAliases
 * @returns {any[]}
 */
function ApplyAliasOverrides(ArgClients, ArgAliases) {
  const AliasesByClient = new Map();
  for(const AliasOverride of ArgAliases) {
    if(AliasOverride.target.type !== 'client') continue;
    const Existing = AliasesByClient.get(AliasOverride.target.id) || [];
    Existing.push(AliasOverride.alias);
    AliasesByClient.set(AliasOverride.target.id, Existing);
  }
  return GetArray(ArgClients).map(ArgClient => {
    const ClientId = GetStringOrNull(ArgClient?.ClientID);
    const ExtraAliases = ClientId === null ? [] : AliasesByClient.get(ClientId) || [];
    return ExtraAliases.length === 0 ? { ...ArgClient } : {
      ...ArgClient,
      Aliases: [...GetArray(ArgClient.Aliases), ...ExtraAliases],
    };
  });
}

/**
 * @param {any} ArgEdge
 * @returns {string}
 */
function GetAssociationKey(ArgEdge) {
  return `${ArgEdge.edgeType}\u0000${ArgEdge.from.type}\u0000${ArgEdge.from.id}\u0000${ArgEdge.to.type}\u0000${ArgEdge.to.id}`;
}

/**
 * Apply forced associations and forced exclusions in memory. A split wins over a merge because a
 * deliberately recorded separation must never silently be rejoined by an older correction.
 * @param {any[]} ArgEdges
 * @param {{ merges: Array<any>, splits: Array<any> }} ArgOverrides
 * @returns {any[]}
 */
function ApplyAssociationOverrides(ArgEdges, ArgOverrides) {
  const SplitKeys = new Set(ArgOverrides.splits.map(ArgOverride => GetAssociationKey({
    edgeType: `${ArgOverride.from.type}_to_${ArgOverride.to.type}`,
    from: ArgOverride.from,
    to: ArgOverride.to,
  })));
  const EdgesByKey = new Map();
  for(const Edge of GetArray(ArgEdges)) {
    const Key = GetAssociationKey(Edge);
    if(!SplitKeys.has(Key)) EdgesByKey.set(Key, { ...Edge, override: null });
  }
  for(const Merge of ArgOverrides.merges) {
    const Edge = {
      edgeType: `${Merge.from.type}_to_${Merge.to.type}`,
      from: Merge.from,
      to: Merge.to,
      confidence: 1,
      provenance: { sourceEventIds: [], signals: [{ signal: 'human_override_merge', weight: 1 }] },
      override: 'merge',
    };
    const Key = GetAssociationKey(Edge);
    if(!SplitKeys.has(Key)) EdgesByKey.set(Key, Edge);
  }
  return [...EdgesByKey.values()].sort((ArgLeft, ArgRight) => CompareStrings(GetAssociationKey(ArgLeft), GetAssociationKey(ArgRight)));
}

/**
 * @param {any[]} ArgTasks
 * @param {any[]} ArgClients
 * @returns {any[]}
 */
function GetOverlayAssociations(ArgTasks, ArgClients) {
  const Associations = [];
  for(const Task of GetArray(ArgTasks)) {
    for(const Client of GetArray(ArgClients)) {
      const ClientId = GetStringOrNull(Client?.ClientID);
      if(ClientId === null) continue;
      const Channels = GetArray(Client.ChannelIDs);
      const Repositories = GetArray(Client.GitHubRepoPatterns)
        .filter(ArgPattern => typeof ArgPattern === 'string' && ArgPattern.trim())
        .map(ArgPattern => ArgPattern.toLowerCase());
      const ChannelMatch = typeof Task.sourceChannelId === 'string' && Channels.includes(Task.sourceChannelId);
      const RepositoryMatch = GetArray(Task.githubUrls).some(ArgUrl => typeof ArgUrl === 'string'
        && Repositories.some(ArgPattern => ArgUrl.toLowerCase().includes(ArgPattern)));
      if(!ChannelMatch && !RepositoryMatch) continue;
      Associations.push({
        edgeType: 'task_to_client',
        from: { type: 'task', id: Task.reminderId },
        to: { type: 'client', id: ClientId },
      });
      break; // src/client-mapping.js is ordered first-match-wins.
    }
  }
  return Associations.sort((ArgLeft, ArgRight) => CompareStrings(GetAssociationKey(ArgLeft), GetAssociationKey(ArgRight)));
}

/**
 * @param {any[]} ArgEdges
 * @param {number} ArgThreshold
 * @returns {any[]}
 */
function GetAcceptedAssociations(ArgEdges, ArgThreshold) {
  return GetArray(ArgEdges)
    .filter(ArgEdge => typeof ArgEdge.confidence === 'number' && ArgEdge.confidence >= ArgThreshold)
    .map(ArgEdge => ({
      edgeType: ArgEdge.edgeType,
      from: ArgEdge.from,
      to: ArgEdge.to,
      confidence: ArgEdge.confidence,
      provenance: ArgEdge.provenance,
      override: ArgEdge.override,
    }))
    .sort((ArgLeft, ArgRight) => CompareStrings(GetAssociationKey(ArgLeft), GetAssociationKey(ArgRight)));
}

/**
 * @param {any[]} ArgAssociations
 * @returns {Map<string, string[]>}
 */
function GetTargetsByTask(ArgAssociations) {
  const TargetsByTask = new Map();
  for(const Association of GetArray(ArgAssociations)) {
    if(Association.edgeType !== 'task_to_client') continue;
    const Targets = TargetsByTask.get(Association.from.id) || [];
    Targets.push(Association.to.id);
    TargetsByTask.set(Association.from.id, Targets);
  }
  for(const Targets of TargetsByTask.values()) Targets.sort(CompareStrings);
  return TargetsByTask;
}

/**
 * @param {any[]} ArgTasks
 * @param {any[]} ArgDerived
 * @param {any[]} ArgOverlay
 * @returns {{ agreements: any[], disagreements: any[], gaps: any[] }}
 */
function BuildShadowDiff(ArgTasks, ArgDerived, ArgOverlay) {
  const DerivedByTask = GetTargetsByTask(ArgDerived);
  const OverlayByTask = GetTargetsByTask(ArgOverlay);
  const TaskIds = [...new Set(GetArray(ArgTasks).map(ArgTask => ArgTask.reminderId).filter(Boolean))].sort(CompareStrings);
  const Agreements = [];
  const Disagreements = [];
  const Gaps = [];
  for(const TaskId of TaskIds) {
    const Derived = DerivedByTask.get(TaskId) || [];
    const Overlay = OverlayByTask.get(TaskId) || [];
    const Common = Derived.filter(ArgClientId => Overlay.includes(ArgClientId));
    if(Derived.length === 0 && Overlay.length === 0) {
      Gaps.push({ taskId: TaskId, kind: 'unlinked', derivedClientIds: [], overlayClientIds: [] });
    } else if(Common.length > 0 && Derived.length === Overlay.length) {
      Agreements.push({ taskId: TaskId, clientIds: Common });
    } else if(Derived.length > 0 && Overlay.length > 0) {
      Disagreements.push({ taskId: TaskId, derivedClientIds: Derived, overlayClientIds: Overlay });
    } else {
      Gaps.push({
        taskId: TaskId,
        kind: Derived.length > 0 ? 'derived_only' : 'overlay_only',
        derivedClientIds: Derived,
        overlayClientIds: Overlay,
      });
    }
  }
  return { agreements: Agreements, disagreements: Disagreements, gaps: Gaps };
}

/**
 * @param {any[]} ArgEdges
 * @param {number} ArgThreshold
 * @returns {any[]}
 */
function BuildLowConfidenceQueue(ArgEdges, ArgThreshold) {
  return GetArray(ArgEdges)
    .filter(ArgEdge => typeof ArgEdge.confidence === 'number' && ArgEdge.confidence < ArgThreshold)
    .map(ArgEdge => ({
      edgeType: ArgEdge.edgeType,
      from: ArgEdge.from,
      to: ArgEdge.to,
      confidence: ArgEdge.confidence,
      distanceToThreshold: Number((ArgThreshold - ArgEdge.confidence).toFixed(6)),
      signals: ArgEdge.provenance?.signals || [],
    }))
    .sort((ArgLeft, ArgRight) => ArgLeft.distanceToThreshold - ArgRight.distanceToThreshold
      || ArgRight.confidence - ArgLeft.confidence
      || CompareStrings(GetAssociationKey(ArgLeft), GetAssociationKey(ArgRight)));
}

/**
 * @param {any[]} ArgEdges
 * @param {string|null} ArgTaskId
 * @param {number} ArgThreshold
 * @returns {any[]}
 */
function BuildTraces(ArgEdges, ArgTaskId, ArgThreshold) {
  if(ArgTaskId === null) return [];
  return GetArray(ArgEdges)
    .filter(ArgEdge => ArgEdge.from?.type === 'task' && ArgEdge.from.id === ArgTaskId)
    .map(ArgEdge => ({
      edgeType: ArgEdge.edgeType,
      from: ArgEdge.from,
      to: ArgEdge.to,
      confidence: ArgEdge.confidence,
      accepted: ArgEdge.confidence >= ArgThreshold,
      override: ArgEdge.override,
      signals: ArgEdge.provenance?.signals || [],
      sourceEventIds: ArgEdge.provenance?.sourceEventIds || [],
    }))
    .sort((ArgLeft, ArgRight) => CompareStrings(GetAssociationKey(ArgLeft), GetAssociationKey(ArgRight)));
}

/**
 * Replay event history into a deterministic, non-authoritative diagnostic report.
 * @param {any[]} ArgEvents
 * @param {{ clients?: any[], projects?: any[], overrides?: any, threshold?: number, taskId?: string }} [ArgOptions]
 * @returns {any}
 */
function BuildEntityLinkingDiagnostics(ArgEvents, ArgOptions = {}) {
  const Threshold = typeof ArgOptions.threshold === 'number' && Number.isFinite(ArgOptions.threshold)
    && ArgOptions.threshold >= 0 && ArgOptions.threshold <= 1
    ? ArgOptions.threshold
    : ENTITY_CLUSTER_CONFIDENCE_THRESHOLD;
  const Overrides = NormalizeOverrides(ArgOptions.overrides);
  const Tasks = FoldEntityProjectionInputs(GetArray(ArgEvents));
  const Clients = ApplyAliasOverrides(GetArray(ArgOptions.clients), Overrides.aliases);
  const CandidateEdges = GenerateScoredCandidateEdges(Tasks, GetArray(ArgOptions.projects), Clients);
  const AppliedEdges = ApplyAssociationOverrides(CandidateEdges, Overrides);
  const DerivedAssociations = GetAcceptedAssociations(AppliedEdges, Threshold);
  const OverlayAssociations = GetOverlayAssociations(Tasks, GetArray(ArgOptions.clients));
  const ShadowDiff = BuildShadowDiff(Tasks, DerivedAssociations, OverlayAssociations);
  return {
    threshold: Threshold,
    taskCount: Tasks.length,
    candidateCount: CandidateEdges.length,
    derivedAssociations: DerivedAssociations,
    overlayAssociations: OverlayAssociations,
    shadowDiff: ShadowDiff,
    highConfidenceDisagreements: ShadowDiff.disagreements,
    lowConfidenceQueue: BuildLowConfidenceQueue(CandidateEdges, Threshold),
    traces: BuildTraces(AppliedEdges, GetStringOrNull(ArgOptions.taskId), Threshold),
    appliedOverrides: Overrides,
  };
}

/**
 * @param {string} ArgPath
 * @param {any} ArgIo
 * @returns {any}
 */
function ReadJsonInputSync(ArgPath, ArgIo) {
  return JSON.parse(ArgIo.readFileSync(ArgPath, 'utf8'));
}

/**
 * @param {string} ArgPath
 * @param {any} ArgIo
 * @returns {any[]}
 */
function ReadEventsInputSync(ArgPath, ArgIo) {
  const Raw = ArgIo.readFileSync(ArgPath, 'utf8').trim();
  if(!Raw) return [];
  if(Raw.startsWith('[')) return GetArray(JSON.parse(Raw));
  return Raw.split(/\r?\n/).filter(Boolean).map(ArgLine => JSON.parse(ArgLine));
}

/**
 * @param {string[]} ArgArgs
 * @returns {{ eventsFile: string|null, clientsFile: string|null, projectsFile: string|null, overridesFile: string|null, threshold: number|undefined, taskId: string|null }}
 */
function ParseArgs(ArgArgs) {
  const Options = { eventsFile: null, clientsFile: null, projectsFile: null, overridesFile: null, threshold: undefined, taskId: null };
  for(let Index = 0; Index < ArgArgs.length; Index += 1) {
    const Value = ArgArgs[Index + 1];
    switch(ArgArgs[Index]) {
      case '--events-file': Options.eventsFile = Value || null; Index += 1; break;
      case '--clients-file': Options.clientsFile = Value || null; Index += 1; break;
      case '--projects-file': Options.projectsFile = Value || null; Index += 1; break;
      case '--overrides-file': Options.overridesFile = Value || null; Index += 1; break;
      case '--threshold': Options.threshold = Number(Value); Index += 1; break;
      case '--task-id': Options.taskId = Value || null; Index += 1; break;
    }
  }
  return Options;
}

/**
 * @param {string[]} ArgArgs
 * @param {{ readFileSync: typeof fs.readFileSync, write?: (ArgText: string) => void }} [ArgIo]
 * @returns {any}
 */
function RunCLI(ArgArgs, ArgIo = fs) {
  const Options = ParseArgs(ArgArgs);
  if(Options.eventsFile === null || Options.clientsFile === null) {
    throw new Error('Usage: --events-file <events.jsonl> --clients-file <client-mapping.json> [--projects-file <projects.json>] [--overrides-file <overrides.json>] [--threshold <0..1>] [--task-id <reminder-id>]');
  }
  const ClientsInput = ReadJsonInputSync(Options.clientsFile, ArgIo);
  const ProjectsInput = Options.projectsFile === null ? [] : ReadJsonInputSync(Options.projectsFile, ArgIo);
  const Overrides = Options.overridesFile === null ? {} : ReadJsonInputSync(Options.overridesFile, ArgIo);
  const Report = BuildEntityLinkingDiagnostics(ReadEventsInputSync(Options.eventsFile, ArgIo), {
    clients: GetArray(ClientsInput.clients || ClientsInput),
    projects: GetArray(ProjectsInput.projects || ProjectsInput),
    overrides: Overrides,
    threshold: Options.threshold,
    taskId: Options.taskId || undefined,
  });
  if(typeof ArgIo.write === 'function') ArgIo.write(`${JSON.stringify(Report, null, 2)}\n`);
  else process.stdout.write(`${JSON.stringify(Report, null, 2)}\n`);
  return Report;
}

module.exports = {
  ApplyAssociationOverrides,
  BuildEntityLinkingDiagnostics,
  BuildShadowDiff,
  NormalizeOverrides,
  RunCLI,
};

if(require.main === module) {
  try {
    RunCLI(process.argv.slice(2));
  } catch(error) {
    process.stderr.write(`entity-linking-diagnostics error: ${error.message}\n`);
    process.exitCode = 1;
  }
}
