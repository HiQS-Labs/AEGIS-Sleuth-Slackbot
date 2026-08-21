'use strict';

const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const HandleAskCodeCommandAsync = require('../src/chat-commands/ask-code-command');

describe('ask-code remote RAG registry overlay', () => {
  const OriginalOverlay = process.env.REMOTE_RAG_PROJECTS_OVERLAY;

  afterEach(() => {
    HandleAskCodeCommandAsync.resetProjectsCache();
    if (OriginalOverlay === undefined) delete process.env.REMOTE_RAG_PROJECTS_OVERLAY;
    else process.env.REMOTE_RAG_PROJECTS_OVERLAY = OriginalOverlay;
  });

  test('overlay project keys win over the tracked template', () => {
    const Merged = HandleAskCodeCommandAsync.mergeRemoteRagConfig(
      {
        integration_version: '1.1',
        projects: {
          'client-b': {
            label: 'Client B',
            endpoint: 'https://rag.client-b.example.com/rag-agent/query',
            secretEnvVar: 'CLIENT_B_RAG_SECRET',
          },
        },
      },
      {
        projects: {
          ltvera: {
            label: 'LTVera',
            endpoint: 'https://app.ltvera.com/rag-agent/query',
            secretEnvVar: 'LTVERA_RAG_SECRET',
          },
          'client-b': {
            label: 'Client B overlay',
            endpoint: 'https://overlay.example.com/rag-agent/query',
            secretEnvVar: 'CLIENT_B_RAG_SECRET',
          },
        },
      }
    );

    expect(Merged.projects.ltvera.endpoint).toBe('https://app.ltvera.com/rag-agent/query');
    expect(Merged.projects['client-b'].label).toBe('Client B overlay');
    expect(Merged.integration_version).toBe('1.1');
  });

  test('missing overlay leaves the tracked template unchanged', () => {
    const Base = {
      integration_version: '1.1',
      projects: {
        'client-b': {
          label: 'Client B',
          endpoint: 'https://rag.client-b.example.com/rag-agent/query',
          secretEnvVar: 'CLIENT_B_RAG_SECRET',
        },
      },
    };
    const Merged = HandleAskCodeCommandAsync.mergeRemoteRagConfig(Base, null);
    expect(Merged.projects).toEqual(Base.projects);
    expect(Merged.projects).not.toBe(Base.projects);
  });

  test('loadProjects merges a filesystem overlay when present', async () => {
    const OverlayDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ask-code-overlay-'));
    const OverlayPath = path.join(OverlayDir, 'remote-rag-projects.overlay.json');
    await fs.writeFile(
      OverlayPath,
      JSON.stringify({
        projects: {
          ltvera: {
            label: 'LTVera',
            endpoint: 'https://app.ltvera.com/rag-agent/query',
            secretEnvVar: 'LTVERA_RAG_SECRET',
          },
        },
      })
    );

    process.env.REMOTE_RAG_PROJECTS_OVERLAY = OverlayPath;
    HandleAskCodeCommandAsync.resetProjectsCache();
    const Projects = await HandleAskCodeCommandAsync.loadProjects();

    expect(Projects.ltvera.secretEnvVar).toBe('LTVERA_RAG_SECRET');
    expect(Projects['client-b']).toBeDefined();

    await fs.rm(OverlayDir, { recursive: true, force: true });
  });
});
