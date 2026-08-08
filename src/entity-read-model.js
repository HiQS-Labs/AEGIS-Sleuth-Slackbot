'use strict';

const crypto = require('crypto');

// 0.60 requires more than one weak p2 signal and leaves uncertain links visible without merging identities.
const ENTITY_CLUSTER_CONFIDENCE_THRESHOLD = 0.60;

/**
 * @param {any} ArgValue
 * @returns {string|null}
 */
function GetStringOrNull(ArgValue) {
  return typeof ArgValue === 'string' && ArgValue.trim() ? ArgValue.trim() : null;
}

/**
 * @param {string} ArgLeft
 * @param {string} ArgRight
 * @returns {number}
 */
function CompareStrings(ArgLeft, ArgRight) {
  if(ArgLeft < ArgRight) return -1;
  if(ArgLeft > ArgRight) return 1;
  return 0;
}

/**
 * @param {any} ArgValue
 * @returns {string}
 */
function NormalizeSurfaceForm(ArgValue) {
  return typeof ArgValue === 'string'
    ? ArgValue.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    : '';
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
 * @param {any} ArgEntity
 * @returns {string|null}
 */
function GetEntityId(ArgEntity) {
  return GetStringOrNull(ArgEntity?.id)
    || GetStringOrNull(ArgEntity?.entityId)
    || GetStringOrNull(ArgEntity?.projectId)
    || GetStringOrNull(ArgEntity?.ProjectID)
    || GetStringOrNull(ArgEntity?.clientId)
    || GetStringOrNull(ArgEntity?.ClientID)
    || GetStringOrNull(ArgEntity?.reminderId);
}

/**
 * @param {any} ArgEntity
 * @returns {string|null}
 */
function GetEntityType(ArgEntity) {
  return GetStringOrNull(ArgEntity?.type) || GetStringOrNull(ArgEntity?.entityType) || GetStringOrNull(ArgEntity?.kind);
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetSurfaceForms(ArgEntity) {
  return GetUniqueStrings([
    ArgEntity?.surfaceForm,
    ArgEntity?.name,
    ArgEntity?.normalizedName,
    ArgEntity?.projectName,
    ArgEntity?.ProjectName,
    ArgEntity?.clientName,
    ArgEntity?.ClientName,
    ...(Array.isArray(ArgEntity?.aliases) ? ArgEntity.aliases : []),
    ...(Array.isArray(ArgEntity?.Aliases) ? ArgEntity.Aliases : []),
  ]);
}

/**
 * @param {any} ArgEntity
 * @returns {string[]}
 */
function GetEventIds(ArgEntity) {
  return GetUniqueStrings([
    ArgEntity?.sourceEventId,
    ...(Array.isArray(ArgEntity?.sourceEventIds) ? ArgEntity.sourceEventIds : []),
  ]).sort(CompareStrings);
}

/**
 * @param {any} ArgEntity
 * @returns {{ type: string, id: string }|null}
 */
function GetEndpoint(ArgEntity) {
  const Type = GetEntityType(ArgEntity);
  const Id = GetEntityId(ArgEntity);
  return Type !== null && Id !== null ? { type: Type, id: Id } : null;
}

/**
 * @param {{ type: string, id: string }} ArgEndpoint
 * @returns {string}
 */
function GetNodeKey(ArgEndpoint) {
  return `${ArgEndpoint.type}\u0000${ArgEndpoint.id}`;
}

/**
 * @param {any} ArgEdge
 * @returns {number|null}
 */
function GetConfidence(ArgEdge) {
  return typeof ArgEdge?.confidence === 'number'
    && Number.isFinite(ArgEdge.confidence)
    && ArgEdge.confidence >= 0
    && ArgEdge.confidence <= 1
    ? ArgEdge.confidence
    : null;
}

/**
 * @param {any} ArgEdge
 * @returns {{ edgeType: string|null, from: { type: string, id: string }, to: { type: string, id: string }, confidence: number, provenance: { sourceEventIds: string[], signals: Array<{ signal: string, weight: number }> } }|null}
 */
function NormalizeEdge(ArgEdge) {
  const From = GetEndpoint(ArgEdge?.from);
  const To = GetEndpoint(ArgEdge?.to);
  const Confidence = GetConfidence(ArgEdge);
  if(From === null || To === null || Confidence === null) return null;

  const Signals = Array.isArray(ArgEdge?.provenance?.signals)
    ? ArgEdge.provenance.signals
      .filter(ArgSignal => GetStringOrNull(ArgSignal?.signal) !== null && typeof ArgSignal?.weight === 'number' && Number.isFinite(ArgSignal.weight))
      .map(ArgSignal => ({ signal: ArgSignal.signal.trim(), weight: ArgSignal.weight }))
      .sort((ArgLeft, ArgRight) => CompareStrings(ArgLeft.signal, ArgRight.signal) || ArgLeft.weight - ArgRight.weight)
    : [];

  return {
    edgeType: GetStringOrNull(ArgEdge?.edgeType),
    from: From,
    to: To,
    confidence: Confidence,
    provenance: {
      sourceEventIds: GetEventIds(ArgEdge?.provenance),
      signals: Signals,
    },
  };
}

/**
 * @param {ReturnType<typeof NormalizeEdge>} ArgEdge
 * @returns {string}
 */
function GetEdgeKey(ArgEdge) {
  return JSON.stringify(ArgEdge);
}

/**
 * @param {Map<string, { endpoint: { type: string, id: string }, surfaceForms: Map<string, { normalizedSurfaceForm: string, surfaceForm: string }> }>} ArgNodes
 * @param {any} ArgEntity
 * @returns {string|null}
 */
function AddNode(ArgNodes, ArgEntity) {
  const Endpoint = GetEndpoint(ArgEntity);
  if(Endpoint === null) return null;
  const Key = GetNodeKey(Endpoint);
  const Node = ArgNodes.get(Key) || { endpoint: Endpoint, surfaceForms: new Map() };
  for(const SurfaceForm of GetSurfaceForms(ArgEntity)) {
    const NormalizedSurfaceForm = NormalizeSurfaceForm(SurfaceForm);
    if(!NormalizedSurfaceForm) continue;
    const SurfaceFormKey = `${NormalizedSurfaceForm}\u0000${SurfaceForm}`;
    Node.surfaceForms.set(SurfaceFormKey, { normalizedSurfaceForm: NormalizedSurfaceForm, surfaceForm: SurfaceForm });
  }
  ArgNodes.set(Key, Node);
  return Key;
}

/**
 * @param {Map<string, string>} ArgParents
 * @param {string} ArgKey
 * @returns {string}
 */
function FindRoot(ArgParents, ArgKey) {
  const Parent = ArgParents.get(ArgKey) || ArgKey;
  if(Parent === ArgKey) return ArgKey;
  const Root = FindRoot(ArgParents, Parent);
  ArgParents.set(ArgKey, Root);
  return Root;
}

/**
 * @param {Map<string, string>} ArgParents
 * @param {string} ArgLeft
 * @param {string} ArgRight
 * @returns {void}
 */
function UnionNodes(ArgParents, ArgLeft, ArgRight) {
  const LeftRoot = FindRoot(ArgParents, ArgLeft);
  const RightRoot = FindRoot(ArgParents, ArgRight);
  if(LeftRoot === RightRoot) return;
  if(CompareStrings(LeftRoot, RightRoot) < 0) ArgParents.set(RightRoot, LeftRoot);
  else ArgParents.set(LeftRoot, RightRoot);
}

/**
 * @param {Array<{ type: string, id: string }>} ArgMembers
 * @returns {string}
 */
function GetCanonicalId(ArgMembers) {
  const Content = ArgMembers.map(ArgMember => `${ArgMember.type}\u0000${ArgMember.id}`).join('\u0001');
  return `entity-${crypto.createHash('sha256').update(Content).digest('hex').slice(0, 20)}`;
}

/**
 * Fold scored p2 candidate edges into a workspace-safe, deterministic entity read model. Every
 * endpoint remains visible, while only edges at the threshold can join components.
 * @param {any[]} ArgEdges p2 GenerateScoredCandidateEdges output.
 * @param {any[]} [ArgEntities] Optional standalone entities to retain as singleton clusters.
 * @returns {{ threshold: number, clusters: any[], aliasTable: any[] }}
 */
function BuildEntityReadModel(ArgEdges, ArgEntities = []) {
  const Nodes = new Map();
  const EdgesByKey = new Map();
  const Edges = Array.isArray(ArgEdges) ? ArgEdges : [];
  const Entities = Array.isArray(ArgEntities) ? ArgEntities : [];

  for(const Entity of Entities) AddNode(Nodes, Entity);
  for(const Edge of Edges) {
    const NormalizedEdge = NormalizeEdge(Edge);
    if(NormalizedEdge === null) continue;
    AddNode(Nodes, Edge.from);
    AddNode(Nodes, Edge.to);
    EdgesByKey.set(GetEdgeKey(NormalizedEdge), NormalizedEdge);
  }

  const Parents = new Map([...Nodes.keys()].map(ArgKey => [ArgKey, ArgKey]));
  const AcceptedEdges = [...EdgesByKey.values()]
    .filter(ArgEdge => ArgEdge.confidence >= ENTITY_CLUSTER_CONFIDENCE_THRESHOLD)
    .sort((ArgLeft, ArgRight) => CompareStrings(GetEdgeKey(ArgLeft), GetEdgeKey(ArgRight)));
  for(const Edge of AcceptedEdges) UnionNodes(Parents, GetNodeKey(Edge.from), GetNodeKey(Edge.to));

  /** @type {Map<string, string[]>} */
  const MembersByRoot = new Map();
  for(const Key of Nodes.keys()) {
    const Root = FindRoot(Parents, Key);
    const Members = MembersByRoot.get(Root) || [];
    Members.push(Key);
    MembersByRoot.set(Root, Members);
  }

  const ClusterEdges = new Map();
  for(const Edge of AcceptedEdges) {
    const Root = FindRoot(Parents, GetNodeKey(Edge.from));
    const Members = ClusterEdges.get(Root) || [];
    Members.push(Edge);
    ClusterEdges.set(Root, Members);
  }

  const Clusters = [...MembersByRoot.values()].map(ArgMemberKeys => {
    const MemberKeys = ArgMemberKeys.sort(CompareStrings);
    const Members = MemberKeys.map(ArgKey => Nodes.get(ArgKey).endpoint);
    const CanonicalId = GetCanonicalId(Members);
    const ProvenanceEdges = (ClusterEdges.get(FindRoot(Parents, MemberKeys[0])) || [])
      .sort((ArgLeft, ArgRight) => CompareStrings(GetEdgeKey(ArgLeft), GetEdgeKey(ArgRight)));
    const MemberConfidence = new Map(MemberKeys.map(ArgKey => [ArgKey, null]));
    for(const Edge of ProvenanceEdges) {
      for(const Key of [GetNodeKey(Edge.from), GetNodeKey(Edge.to)]) {
        const Existing = MemberConfidence.get(Key);
        MemberConfidence.set(Key, Existing === null ? Edge.confidence : Math.max(Existing, Edge.confidence));
      }
    }

    const AliasesBySurfaceForm = new Map();
    for(const Key of MemberKeys) {
      const Node = Nodes.get(Key);
      for(const [AliasKey, Alias] of Node.surfaceForms) {
        const Existing = AliasesBySurfaceForm.get(AliasKey);
        const Confidence = MemberConfidence.get(Key);
        if(Existing === undefined || (Confidence || -1) > (Existing.confidence || -1)) {
          AliasesBySurfaceForm.set(AliasKey, { ...Alias, canonicalId: CanonicalId, confidence: Confidence });
        }
      }
    }

    return {
      canonicalId: CanonicalId,
      members: Members,
      aliases: [...AliasesBySurfaceForm.values()].sort((ArgLeft, ArgRight) => CompareStrings(ArgLeft.normalizedSurfaceForm, ArgRight.normalizedSurfaceForm) || CompareStrings(ArgLeft.surfaceForm, ArgRight.surfaceForm)),
      provenance: {
        edges: ProvenanceEdges,
        eventIds: [...new Set(ProvenanceEdges.flatMap(ArgEdge => ArgEdge.provenance.sourceEventIds))].sort(CompareStrings),
      },
    };
  }).sort((ArgLeft, ArgRight) => CompareStrings(ArgLeft.canonicalId, ArgRight.canonicalId));

  return {
    threshold: ENTITY_CLUSTER_CONFIDENCE_THRESHOLD,
    clusters: Clusters,
    aliasTable: Clusters.flatMap(ArgCluster => ArgCluster.aliases)
      .sort((ArgLeft, ArgRight) => CompareStrings(ArgLeft.normalizedSurfaceForm, ArgRight.normalizedSurfaceForm) || CompareStrings(ArgLeft.canonicalId, ArgRight.canonicalId)),
  };
}

module.exports = {
  BuildEntityReadModel,
  ENTITY_CLUSTER_CONFIDENCE_THRESHOLD,
};
