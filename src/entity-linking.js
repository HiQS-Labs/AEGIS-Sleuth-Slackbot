'use strict';

// This is deliberately a read-model primitive. Callers supply normalized task records from
// entity-projection-inputs, project candidates, and the client-mapping-shaped client records;
// it neither reads mutable stores nor assigns canonical identities.

const SIGNAL_WEIGHTS = Object.freeze({
  normalized_text_match: 0.30,
  repo_match: 0.32,
  channel_match: 0.22,
  participant_overlap: 0.14,
  historical_cooccurrence: 0.10,
  prior_accepted_alias: 0.48,
});

/**
 * @param {any} ArgValue
 * @returns {string|null}
 */
function GetStringOrNull(ArgValue) {
  return typeof ArgValue === 'string' && ArgValue.trim() ? ArgValue.trim() : null;
}

/**
 * @param {any} ArgValue
 * @returns {string[]}
 */
function GetUniqueStrings(ArgValue) {
  const Values = Array.isArray(ArgValue) ? ArgValue : [ArgValue];
  const Seen = new Set();
  const Result = [];
  for(const Value of Values) {
    const StringValue = GetStringOrNull(Value);
    if(StringValue === null || Seen.has(StringValue)) continue;
    Seen.add(StringValue);
    Result.push(StringValue);
  }
  return Result;
}

/**
 * @param {any} ArgValue
 * @returns {string}
 */
function NormalizeText(ArgValue) {
  if(typeof ArgValue !== 'string') return '';
  return ArgValue.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/**
 * @param {string} ArgText
 * @returns {string[]}
 */
function GetPhraseKeys(ArgText) {
  const Words = NormalizeText(ArgText).split(' ').filter(Boolean);
  const Keys = new Set();
  for(let Start = 0; Start < Words.length; Start += 1) {
    for(let End = Start + 1; End <= Words.length; End += 1) {
      Keys.add(Words.slice(Start, End).join(' '));
    }
  }
  return [...Keys];
}

/**
 * @param {any} ArgValue
 * @returns {string[]}
 */
function GetRepositoryKeys(ArgValue) {
  const Value = GetStringOrNull(ArgValue);
  if(Value === null) return [];
  const Match = Value.match(/github\.com\/([^/]+\/[^/#?]+)/i);
  const Repository = (Match ? Match[1] : Value).replace(/\/+$/, '').toLowerCase();
  const Parts = Repository.split('/').filter(Boolean);
  return [...new Set([Repository, ...Parts].map(NormalizeText).filter(Boolean))];
}

/**
 * @param {any} ArgEntity
 * @returns {string|null}
 */
function GetEntityId(ArgEntity) {
  return GetStringOrNull(ArgEntity?.reminderId)
    || GetStringOrNull(ArgEntity?.projectId)
    || GetStringOrNull(ArgEntity?.ProjectID)
    || GetStringOrNull(ArgEntity?.clientId)
    || GetStringOrNull(ArgEntity?.ClientID)
    || GetStringOrNull(ArgEntity?.id);
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetAliases(ArgEntity) {
  return GetUniqueStrings([
    ArgEntity?.normalizedName,
    ArgEntity?.name,
    ArgEntity?.projectName,
    ArgEntity?.ProjectName,
    ArgEntity?.clientName,
    ArgEntity?.ClientName,
    ...(Array.isArray(ArgEntity?.aliases) ? ArgEntity.aliases : []),
    ...(Array.isArray(ArgEntity?.Aliases) ? ArgEntity.Aliases : []),
  ]).map(NormalizeText).filter(Boolean);
}

/**
 * @param {any} ArgEntity
 * @returns {string}
 */
function GetMatchingText(ArgEntity) {
  return NormalizeText(
    ArgEntity?.normalizedText
    || ArgEntity?.normalizedName
    || ArgEntity?.name
    || ArgEntity?.projectName
    || ArgEntity?.ProjectName
    || ArgEntity?.clientName
    || ArgEntity?.ClientName
    || ''
  );
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetAcceptedAliases(ArgEntity) {
  return GetUniqueStrings([
    ...(Array.isArray(ArgEntity?.acceptedAliases) ? ArgEntity.acceptedAliases : []),
    ...(Array.isArray(ArgEntity?.AcceptedAliases) ? ArgEntity.AcceptedAliases : []),
  ]).map(NormalizeText).filter(Boolean);
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetChannels(ArgEntity) {
  return GetUniqueStrings([
    ArgEntity?.sourceChannelId,
    ArgEntity?.targetChannelId,
    ...(Array.isArray(ArgEntity?.channelIds) ? ArgEntity.channelIds : []),
    ...(Array.isArray(ArgEntity?.ChannelIDs) ? ArgEntity.ChannelIDs : []),
  ]);
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetRepositories(ArgEntity) {
  const Values = [
    ...(Array.isArray(ArgEntity?.githubRepositoryIds) ? ArgEntity.githubRepositoryIds : []),
    ...(Array.isArray(ArgEntity?.githubUrls) ? ArgEntity.githubUrls : []),
    ...(Array.isArray(ArgEntity?.githubRepositoryPatterns) ? ArgEntity.githubRepositoryPatterns : []),
    ...(Array.isArray(ArgEntity?.GitHubRepoPatterns) ? ArgEntity.GitHubRepoPatterns : []),
  ];
  return [...new Set(Values.flatMap(GetRepositoryKeys))];
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetParticipants(ArgEntity) {
  return GetUniqueStrings([
    ArgEntity?.originalSenderId,
    ...(Array.isArray(ArgEntity?.assigneeIds) ? ArgEntity.assigneeIds : []),
    ...(Array.isArray(ArgEntity?.participantIds) ? ArgEntity.participantIds : []),
  ]);
}

/**
 * @param {any} ArgEntity
 * @returns {string|null}
 */
function GetTimeBucket(ArgEntity) {
  const Value = GetStringOrNull(ArgEntity?.createdAt) || GetStringOrNull(ArgEntity?.occurredAt);
  if(Value === null) return null;
  const DateValue = new Date(Value);
  if(Number.isNaN(DateValue.getTime())) return null;
  return DateValue.toISOString().slice(0, 10);
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetSourceEventIds(ArgEntity) {
  return GetUniqueStrings([
    ArgEntity?.sourceEventId,
    ...(Array.isArray(ArgEntity?.sourceEventIds) ? ArgEntity.sourceEventIds : []),
  ]).sort();
}

/**
 * @param {string} ArgText
 * @param {string} ArgPhrase
 * @returns {boolean}
 */
function HasPhrase(ArgText, ArgPhrase) {
  return ` ${ArgText} `.includes(` ${ArgPhrase} `);
}

/**
 * @param {string[]} ArgLeft
 * @param {string[]} ArgRight
 * @returns {boolean}
 */
function HasOverlap(ArgLeft, ArgRight) {
  const Right = new Set(ArgRight);
  return ArgLeft.some(ArgValue => Right.has(ArgValue));
}

/**
 * Add target entities to a cheap-signal blocking index. Index construction is linear in the
 * candidates; edge construction below only examines targets reached by an indexed signal.
 * @param {Map<string, Set<any>>} ArgIndex
 * @param {string} ArgKind
 * @param {string[]} ArgKeys
 * @param {any} ArgEntity
 * @returns {void}
 */
function AddToIndex(ArgIndex, ArgKind, ArgKeys, ArgEntity) {
  for(const Key of ArgKeys) {
    if(!Key) continue;
    const CompositeKey = `${ArgKind}\u0000${Key}`;
    const Matches = ArgIndex.get(CompositeKey) || new Set();
    Matches.add(ArgEntity);
    ArgIndex.set(CompositeKey, Matches);
  }
}

/**
 * @param {any[]} ArgTargets
 * @returns {Map<string, Set<any>>}
 */
function BuildBlockingIndex(ArgTargets) {
  const Index = new Map();
  for(const Target of ArgTargets) {
    AddToIndex(Index, 'alias', GetAliases(Target), Target);
    AddToIndex(Index, 'accepted_alias', GetAcceptedAliases(Target), Target);
    AddToIndex(Index, 'repo', GetRepositories(Target), Target);
    AddToIndex(Index, 'channel', GetChannels(Target), Target);
    AddToIndex(Index, 'participant', GetParticipants(Target), Target);
    const TimeBucket = GetTimeBucket(Target);
    if(TimeBucket) AddToIndex(Index, 'time', [TimeBucket], Target);
  }
  return Index;
}

/**
 * @param {Map<string, Set<any>>} ArgIndex
 * @param {any} ArgSource
 * @returns {any[]}
 */
function FindBlockedTargets(ArgIndex, ArgSource) {
  const Candidates = new Set();
  const MatchingText = GetMatchingText(ArgSource);
  const KeysByKind = [
    ['alias', GetPhraseKeys(MatchingText)],
    ['accepted_alias', GetPhraseKeys(MatchingText)],
    ['repo', GetRepositories(ArgSource)],
    ['channel', GetChannels(ArgSource)],
    ['participant', GetParticipants(ArgSource)],
    ['time', GetTimeBucket(ArgSource) ? [GetTimeBucket(ArgSource)] : []],
  ];
  for(const [Kind, Keys] of KeysByKind) {
    for(const Key of Keys) {
      const Matches = ArgIndex.get(`${Kind}\u0000${Key}`);
      if(Matches) for(const Match of Matches) Candidates.add(Match);
    }
  }
  return [...Candidates].sort((ArgLeft, ArgRight) => String(GetEntityId(ArgLeft)).localeCompare(String(GetEntityId(ArgRight))));
}

/**
 * @param {any} ArgSource
 * @param {any} ArgTarget
 * @returns {Array<{ signal: string, weight: number }>}
 */
function CollectSignals(ArgSource, ArgTarget) {
  const Text = GetMatchingText(ArgSource);
  /** @type {Array<{ signal: string, weight: number }> } */
  const Signals = [];
  if(GetAliases(ArgTarget).some(ArgAlias => HasPhrase(Text, ArgAlias))) {
    Signals.push({ signal: 'normalized_text_match', weight: SIGNAL_WEIGHTS.normalized_text_match });
  }
  if(HasOverlap(GetRepositories(ArgSource), GetRepositories(ArgTarget))) {
    Signals.push({ signal: 'repo_match', weight: SIGNAL_WEIGHTS.repo_match });
  }
  if(HasOverlap(GetChannels(ArgSource), GetChannels(ArgTarget))) {
    Signals.push({ signal: 'channel_match', weight: SIGNAL_WEIGHTS.channel_match });
  }
  if(HasOverlap(GetParticipants(ArgSource), GetParticipants(ArgTarget))) {
    Signals.push({ signal: 'participant_overlap', weight: SIGNAL_WEIGHTS.participant_overlap });
  }
  const SourceTime = GetTimeBucket(ArgSource);
  if(SourceTime !== null && SourceTime === GetTimeBucket(ArgTarget)) {
    Signals.push({ signal: 'historical_cooccurrence', weight: SIGNAL_WEIGHTS.historical_cooccurrence });
  }
  if(GetAcceptedAliases(ArgTarget).some(ArgAlias => HasPhrase(Text, ArgAlias))) {
    Signals.push({ signal: 'prior_accepted_alias', weight: SIGNAL_WEIGHTS.prior_accepted_alias });
  }
  return Signals;
}

/**
 * Independent evidence combines without allowing several weak signals to overflow one. This keeps
 * the confidence in [0, 1] and leaves every contribution available for future threshold tuning.
 * @param {Array<{ signal: string, weight: number }>} ArgSignals
 * @returns {number}
 */
function GetConfidence(ArgSignals) {
  const Confidence = 1 - ArgSignals.reduce((ArgRemaining, ArgSignal) => ArgRemaining * (1 - ArgSignal.weight), 1);
  return Number(Confidence.toFixed(6));
}

/**
 * @param {any[]} ArgSources
 * @param {any[]} ArgTargets
 * @param {'task_to_project'|'task_to_client'|'project_to_client'} ArgType
 * @param {'task'|'project'} ArgSourceType
 * @param {'project'|'client'} ArgTargetType
 * @returns {Array<any>}
 */
function BuildEdges(ArgSources, ArgTargets, ArgType, ArgSourceType, ArgTargetType) {
  const Targets = ArgTargets.filter(ArgEntity => GetEntityId(ArgEntity) !== null);
  const Index = BuildBlockingIndex(Targets);
  const Edges = [];
  const Sources = ArgSources.filter(ArgEntity => GetEntityId(ArgEntity) !== null)
    .sort((ArgLeft, ArgRight) => String(GetEntityId(ArgLeft)).localeCompare(String(GetEntityId(ArgRight))));

  for(const Source of Sources) {
    const SourceEventIds = GetSourceEventIds(Source);
    // Provenance requires an originating event. An entity with no event is not a defensible edge.
    if(SourceEventIds.length === 0) continue;
    for(const Target of FindBlockedTargets(Index, Source)) {
      const Signals = CollectSignals(Source, Target);
      if(Signals.length === 0) continue;
      Edges.push({
        edgeType: ArgType,
        from: { type: ArgSourceType, id: GetEntityId(Source) },
        to: { type: ArgTargetType, id: GetEntityId(Target) },
        confidence: GetConfidence(Signals),
        provenance: { sourceEventIds: SourceEventIds, signals: Signals },
      });
    }
  }
  return Edges;
}

/**
 * Generate candidate edges with deterministic blocking and explainable scores. Project candidates
 * may be supplied from a prior replay or curated map; client candidates accept the existing
 * client-mapping.js shape (`ClientID`, `Aliases`, `ChannelIDs`, `GitHubRepoPatterns`) directly.
 * @param {any[]} ArgTasks Normalized p1 EntityProjectionInput records.
 * @param {any[]} ArgProjects Project candidates with projectId plus optional aliases/signals.
 * @param {any[]} ArgClients Operator-managed client-mapping-shaped records.
 * @returns {Array<any>}
 */
function GenerateScoredCandidateEdges(ArgTasks, ArgProjects, ArgClients) {
  const Tasks = Array.isArray(ArgTasks) ? ArgTasks : [];
  const Projects = Array.isArray(ArgProjects) ? ArgProjects : [];
  const Clients = Array.isArray(ArgClients) ? ArgClients : [];
  const Edges = [
    ...BuildEdges(Tasks, Projects, 'task_to_project', 'task', 'project'),
    ...BuildEdges(Tasks, Clients, 'task_to_client', 'task', 'client'),
    ...BuildEdges(Projects, Clients, 'project_to_client', 'project', 'client'),
  ];
  return Edges.sort((ArgLeft, ArgRight) => [
    ArgLeft.edgeType.localeCompare(ArgRight.edgeType),
    ArgLeft.from.id.localeCompare(ArgRight.from.id),
    ArgLeft.to.id.localeCompare(ArgRight.to.id),
  ].find(ArgValue => ArgValue !== 0) || 0);
}

module.exports = {
  GenerateScoredCandidateEdges,
  SIGNAL_WEIGHTS,
};
