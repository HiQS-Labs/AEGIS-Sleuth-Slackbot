'use strict';

const {
  ComputeAssigneeConventionProposal,
  ComputeCadenceConventionProposal,
  ZonedWeekdayHour,
} = require('../src/learned-conventions');

/**
 * Build a completion record. `completedMs` defaults are spaced so ordering is deterministic.
 * @param {object} ArgOverrides
 * @returns {import('../src/completion-store').CompletionRecord}
 */
function MakeCompletion(ArgOverrides) {
  return {
    reminderId: ArgOverrides.reminderId || `rem_${Math.random().toString(36).slice(2)}`,
    summary: ArgOverrides.summary ?? 'task',
    assigneeID: ArgOverrides.assigneeID ?? null,
    sourceChannelID: ArgOverrides.sourceChannelID ?? null,
    dueDate: ArgOverrides.dueDate ?? null,
    completedMs: ArgOverrides.completedMs ?? 0,
    clientId: ArgOverrides.clientId ?? 'client-a',
  };
}

/** N completions for a client, all assigned to `assigneeID`, distinct reminderIds/timestamps. */
function AssignedRun(ArgCount, ArgAssigneeID, ArgClientId, ArgStartMs) {
  const Out = [];
  for(let I = 0; I < ArgCount; I++) {
    Out.push(MakeCompletion({
      reminderId: `${ArgClientId}_${ArgAssigneeID}_${I}`,
      assigneeID: ArgAssigneeID,
      clientId: ArgClientId,
      completedMs: (ArgStartMs || 1_000_000) + I * 60_000,
    }));
  }
  return Out;
}

describe('ComputeAssigneeConventionProposal', () => {
  test('proposes the dominant assignee above threshold with citing evidence', () => {
    // 9 of last 10 Client A completions are Mike; current default is unset.
    const Completions = [
      ...AssignedRun(9, 'U_MIKE', 'client-a', 1_000_000),
      ...AssignedRun(1, 'U_OTHER', 'client-a', 2_000_000),
    ];
    const Result = ComputeAssigneeConventionProposal(Completions, {
      clientId: 'client-a',
      currentDefaultAssigneeID: '',
    });
    expect(Result.propose).toBe(true);
    expect(Result.assigneeID).toBe('U_MIKE');
    expect(Result.count).toBe(9);
    expect(Result.total).toBe(10);
    expect(Result.reminderIds).toHaveLength(9);
  });

  test('below-threshold concentration (6/10) proposes nothing', () => {
    const Completions = [
      ...AssignedRun(6, 'U_MIKE', 'client-a', 1_000_000),
      ...AssignedRun(4, 'U_OTHER', 'client-a', 2_000_000),
    ];
    const Result = ComputeAssigneeConventionProposal(Completions, {
      clientId: 'client-a',
      currentDefaultAssigneeID: '',
    });
    expect(Result.propose).toBe(false);
  });

  test('does not propose when the dominant assignee already equals the current default', () => {
    const Completions = AssignedRun(10, 'U_MIKE', 'client-a', 1_000_000);
    const Result = ComputeAssigneeConventionProposal(Completions, {
      clientId: 'client-a',
      currentDefaultAssigneeID: 'U_MIKE',
    });
    expect(Result.propose).toBe(false);
  });

  test('does not propose below the minimum sample size', () => {
    const Completions = AssignedRun(5, 'U_MIKE', 'client-a', 1_000_000);
    const Result = ComputeAssigneeConventionProposal(Completions, {
      clientId: 'client-a',
      currentDefaultAssigneeID: '',
    });
    expect(Result.propose).toBe(false);
  });

  test('unassigned completions dilute concentration (7 assigned + 3 null of 10 → no proposal at 0.8)', () => {
    const Completions = [
      ...AssignedRun(7, 'U_MIKE', 'client-a', 1_000_000),
      MakeCompletion({ reminderId: 'n1', assigneeID: null, clientId: 'client-a', completedMs: 2_000_001 }),
      MakeCompletion({ reminderId: 'n2', assigneeID: null, clientId: 'client-a', completedMs: 2_000_002 }),
      MakeCompletion({ reminderId: 'n3', assigneeID: null, clientId: 'client-a', completedMs: 2_000_003 }),
    ];
    const Result = ComputeAssigneeConventionProposal(Completions, {
      clientId: 'client-a',
      currentDefaultAssigneeID: '',
    });
    expect(Result.propose).toBe(false);
  });

  test('ignores completions from other clients', () => {
    const Completions = [
      ...AssignedRun(10, 'U_MIKE', 'client-a', 1_000_000),
      ...AssignedRun(10, 'U_JANE', 'acme', 1_000_000),
    ];
    const Result = ComputeAssigneeConventionProposal(Completions, {
      clientId: 'acme',
      currentDefaultAssigneeID: '',
    });
    expect(Result.propose).toBe(true);
    expect(Result.assigneeID).toBe('U_JANE');
  });
});

describe('ComputeCadenceConventionProposal', () => {
  // 2026-07-05 is a Sunday. 21:00 America/Los_Angeles (PDT, UTC-7) = 2026-07-06T04:00:00Z.
  const SundayNinePmPtMs = Date.parse('2026-07-06T04:00:00Z');
  const OneWeekMs = 7 * 24 * 60 * 60 * 1000;

  /** N completions all landing ~Sunday 21:00 PT across consecutive weeks. */
  function SundayRun(ArgCount, ArgClientId) {
    const Out = [];
    for(let I = 0; I < ArgCount; I++) {
      Out.push(MakeCompletion({
        reminderId: `${ArgClientId}_sun_${I}`,
        assigneeID: 'U_MIKE',
        clientId: ArgClientId,
        completedMs: SundayNinePmPtMs + I * OneWeekMs,
      }));
    }
    return Out;
  }

  test('ZonedWeekdayHour reports Sunday 21:00 PT for the fixture instant', () => {
    const { weekday, hour } = ZonedWeekdayHour(SundayNinePmPtMs, 'America/Los_Angeles');
    expect(weekday).toBe('Sunday');
    expect(hour).toBe(21);
  });

  test('proposes a cadence window when completions cluster on one weekday and none is set', () => {
    const Result = ComputeCadenceConventionProposal(SundayRun(10, 'client-a'), {
      clientId: 'client-a',
      currentDeadlineConvention: '',
    });
    expect(Result.propose).toBe(true);
    expect(Result.weekday).toBe('Sunday');
    expect(Result.hourApprox).toBe(21);
    expect(Result.total).toBe(10);
  });

  test('never overwrites an operator-set DeadlineConvention', () => {
    const Result = ComputeCadenceConventionProposal(SundayRun(10, 'client-a'), {
      clientId: 'client-a',
      currentDeadlineConvention: 'Sunday 21:00 America/Los_Angeles deploy',
    });
    expect(Result.propose).toBe(false);
  });

  test('no proposal when the weekday is not concentrated enough', () => {
    // 5 Sundays + 5 spread across other days → dominant weekday below 0.6.
    const Scattered = [
      ...SundayRun(5, 'client-a'),
      MakeCompletion({ reminderId: 'a', clientId: 'client-a', completedMs: Date.parse('2026-07-07T18:00:00Z') }), // Tue
      MakeCompletion({ reminderId: 'b', clientId: 'client-a', completedMs: Date.parse('2026-07-08T18:00:00Z') }), // Wed
      MakeCompletion({ reminderId: 'c', clientId: 'client-a', completedMs: Date.parse('2026-07-09T18:00:00Z') }), // Thu
      MakeCompletion({ reminderId: 'd', clientId: 'client-a', completedMs: Date.parse('2026-07-10T18:00:00Z') }), // Fri
      MakeCompletion({ reminderId: 'e', clientId: 'client-a', completedMs: Date.parse('2026-07-11T18:00:00Z') }), // Sat
    ];
    const Result = ComputeCadenceConventionProposal(Scattered, {
      clientId: 'client-a',
      currentDeadlineConvention: '',
    });
    expect(Result.propose).toBe(false);
  });
});
