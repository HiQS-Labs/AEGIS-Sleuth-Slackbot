'use strict';

const OPEN_REMINDER_STATES = new Set([
  'scheduled',
  'due',
  'overdue',
  'snoozed',
  'posting',
  'posted',
  'rescheduled',
  'failed',
]);
const TOP_CLIENT_LIMIT = 5;

/**
 * @typedef {{ name: string, count: number }} SnapshotClientCount
 */

/**
 * @typedef {{ openTotal: number, topClientsByOpen: SnapshotClientCount[] }} WorkspaceSnapshot
 */

/**
 * Build a deterministic workspace reminder snapshot from live reminder data.
 * @param {{
 *   activeReminders?: Array<{ State?: string|null, clientId?: string|null }>,
 *   resolveClientName?: ((ArgClientId: string) => string|null|undefined)|null,
 * }|null|undefined} ArgParams
 * @returns {WorkspaceSnapshot}
 */
function BuildWorkspaceSnapshot(ArgParams = {}) {
  const {
    activeReminders = [],
    resolveClientName = null,
  } = ArgParams ?? {};
  /** @type {(ArgClientId: string) => string|null|undefined} */
  const ResolveClientName = typeof resolveClientName === 'function'
    ? resolveClientName
    : () => null;

  const ReminderList = Array.isArray(activeReminders) ? activeReminders : [];
  const OpenReminders = ReminderList.filter((ArgReminder) => {
    const ReminderState = typeof ArgReminder?.State === 'string'
      ? ArgReminder.State.trim().toLowerCase()
      : '';
    return OPEN_REMINDER_STATES.has(ReminderState);
  });
  const ByClient = new Map();

  for(const Reminder of OpenReminders) {
    const ClientId = typeof Reminder?.clientId === 'string' ? Reminder.clientId.trim() : '';
    if(!ClientId) continue;

    const ClientName = ResolveClientName(ClientId);
    if(typeof ClientName !== 'string' || ClientName.trim().length === 0) continue;
    const NormalizedClientName = ClientName.trim();

    const ExistingCount = ByClient.get(NormalizedClientName) ?? 0;
    ByClient.set(NormalizedClientName, ExistingCount + 1);
  }

  const TopClientsByOpen = Array.from(ByClient.entries())
    .map(([Name, Count]) => ({ name: Name, count: Count }))
    .sort((ArgA, ArgB) => {
      if(ArgB.count !== ArgA.count) return ArgB.count - ArgA.count;
      return ArgA.name.localeCompare(ArgB.name);
    })
    .slice(0, TOP_CLIENT_LIMIT);

  return {
    openTotal: OpenReminders.length,
    topClientsByOpen: TopClientsByOpen,
  };
}

/**
 * Render snapshot fields as bounded context lines for prompt injection.
 * @param {WorkspaceSnapshot} ArgSnapshot
 * @returns {string[]}
 */
function RenderSnapshotContextLines(ArgSnapshot) {
  const ContextLines = [`open_total: ${ArgSnapshot.openTotal}`];

  if(Array.isArray(ArgSnapshot.topClientsByOpen) && ArgSnapshot.topClientsByOpen.length > 0) {
    const TopClientsLine = ArgSnapshot.topClientsByOpen
      .map(ArgClient => `${ArgClient.name} (${ArgClient.count})`)
      .join(', ');
    ContextLines.push(`top_clients_by_open: ${TopClientsLine}`);
  }

  return ContextLines;
}

module.exports = {
  BuildWorkspaceSnapshot,
  OPEN_REMINDER_STATES,
  RenderSnapshotContextLines,
  TOP_CLIENT_LIMIT,
};
