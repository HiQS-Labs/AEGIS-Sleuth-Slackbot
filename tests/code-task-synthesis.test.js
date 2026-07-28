'use strict';

const Synthesis = require('../src/code-task-synthesis');

describe('code-task-synthesis — helpers', () => {
  test('Slugify produces filename/branch-safe kebab-case', () => {
    expect(Synthesis.Slugify('Add Retry to GitHub Sync!')).toBe('add-retry-to-github-sync');
    expect(Synthesis.Slugify('   ')).toBe('task');
  });

  test('UtcCompact formats to seconds with Z', () => {
    expect(Synthesis.UtcCompact(new Date('2026-06-20T20:30:45Z'))).toBe('20260620T203045Z');
  });

  test('metadata header round-trips through the parser', () => {
    const Header = Synthesis.BuildMetadataHeader({ 'task-id': 'T1', channel: 'C9', 'thread-ts': '1.2', empty: '' });
    expect(Header).toContain('task-id="T1"');
    expect(Header).not.toContain('empty=');
    const Parsed = Synthesis.ParseMetadataHeader(`${Header}\n# body`);
    expect(Parsed['task-id']).toBe('T1');
    expect(Parsed.channel).toBe('C9');
    expect(Parsed['thread-ts']).toBe('1.2');
  });

  test('ParseMetadataHeader returns {} when absent', () => {
    expect(Synthesis.ParseMetadataHeader('# no header here')).toEqual({});
  });

  test('NormalizeSpec coerces missing fields and arrays without inventing content', () => {
    const Spec = Synthesis.NormalizeSpec({ title: 'X', confidence: 0.5 }, 'NeochromeTeam/sleuth-app');
    expect(Spec.title).toBe('X');
    expect(Spec.target_repo).toBe('NeochromeTeam/sleuth-app');
    expect(Spec.target_branch).toMatch(/^code-task\//);
    expect(Spec.acceptance_criteria).toEqual([]);
    expect(Spec.open_questions).toEqual([]);
    expect(Spec.confidence).toBe(0.5);
  });

  test('BuildTaskId is deterministic for a fixed clock + input', () => {
    const Spec = { title: 'Add retry', instructions: 'do it' };
    const Now = new Date('2026-06-20T20:30:45Z');
    const A = Synthesis.BuildTaskId(Spec, { channel: 'C9', threadTs: '1.2' }, Now);
    const B = Synthesis.BuildTaskId(Spec, { channel: 'C9', threadTs: '1.2' }, Now);
    expect(A).toBe(B);
    expect(A).toMatch(/^20260620T203045Z__add-retry__[0-9a-f]{8}$/);
  });
});

describe('code-task-synthesis — rendering', () => {
  const Spec = {
    title: 'Add retry to sync',
    summary: 'Wrap fetch in retry.',
    target_repo: 'NeochromeTeam/sleuth-app',
    target_branch: 'code-task/add-retry',
    instructions: 'In src/github-sync-module.js add a 3-attempt retry.',
    acceptance_criteria: ['npm test passes'],
    affected_areas: ['src/github-sync-module.js'],
    open_questions: ['Which backoff base?'],
    confidence: 0.7,
  };

  test('RenderTaskMarkdown embeds a parseable header carrying the Slack origin', () => {
    const Md = Synthesis.RenderTaskMarkdown(Spec, { taskId: 'T1', channel: 'C9', threadTs: '1.2', user: 'U1', triggerMode: 'desktop' });
    expect(Md).toContain('# Add retry to sync');
    expect(Md).toContain('## Open questions');
    const Meta = Synthesis.ParseMetadataHeader(Md);
    expect(Meta['task-id']).toBe('T1');
    expect(Meta.channel).toBe('C9');
    expect(Meta['thread-ts']).toBe('1.2');
    expect(Meta.repo).toBe('NeochromeTeam/sleuth-app');
    expect(Meta.branch).toBe('code-task/add-retry');
  });

  test('BuildRemotePrompt includes the branch/repo PR directive and criteria', () => {
    const Prompt = Synthesis.BuildRemotePrompt(Spec);
    expect(Prompt).toContain('In src/github-sync-module.js add a 3-attempt retry.');
    expect(Prompt).toContain('code-task/add-retry');
    expect(Prompt).toContain('NeochromeTeam/sleuth-app');
    expect(Prompt).toContain('Do not push to main or development');
    expect(Prompt).toContain('npm test passes');
  });
});

describe('code-task-synthesis — SynthesizeTaskSpecAsync', () => {
  test('calls WorkspaceAI with a claude model and normalizes the result', async () => {
    const WorkspaceAI = {
      ProcessMessageWithJsonResponseAsync: jest.fn().mockResolvedValue({
        title: 'Do thing', summary: 's', target_repo: 'NeochromeTeam/sleuth-app',
        target_branch: 'code-task/do-thing', instructions: 'i',
        acceptance_criteria: ['c'], affected_areas: [], open_questions: [], confidence: 0.9,
      }),
    };
    const Spec = await Synthesis.SynthesizeTaskSpecAsync(WorkspaceAI, 'try making changes to X');
    expect(WorkspaceAI.ProcessMessageWithJsonResponseAsync).toHaveBeenCalledTimes(1);
    const Args = WorkspaceAI.ProcessMessageWithJsonResponseAsync.mock.calls[0];
    expect(Args[0]).toBe('try making changes to X');         // request text
    expect(typeof Args[1]).toBe('string');                    // instructions loaded from disk
    expect(Args[2]).toHaveProperty('name', 'code_task_spec'); // schema envelope
    expect(Args[3]).toMatch(/^claude-/);                      // synthesis model is Claude
    expect(Spec.title).toBe('Do thing');
    expect(Spec.confidence).toBe(0.9);
  });

  test('rejects an empty request', async () => {
    await expect(Synthesis.SynthesizeTaskSpecAsync({}, '   ')).rejects.toThrow(/empty request/);
  });
});
