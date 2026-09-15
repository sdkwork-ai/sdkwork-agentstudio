// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { InstanceWorkbenchAgent, InstanceWorkbenchFile } from '../types/index.ts';
import {
  buildWorkbenchFileTabPresentation,
  buildWorkbenchEditorModelPath,
  closeWorkbenchFileTab,
  createDefaultWorkbenchFileTabState,
  getInstanceVisibleWorkbenchFiles,
  getWorkbenchFileResolvedContent,
  buildWorkbenchFileContentStateKey,
  getAgentScopedWorkbenchFiles,
  openWorkbenchFileTab,
  reconcileWorkbenchFileTextState,
  reconcileWorkbenchFileTabs,
  shouldPersistWorkbenchFileDraftChange,
  shouldLoadWorkbenchFileContent,
} from './instanceFileWorkbench.ts';
import { buildOpenClawAgentFileId } from './openClawSupport.ts';

function runTest(name: string, fn: () => Promise<void> | void) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function createAgent(
  id: string,
  overrides: Partial<InstanceWorkbenchAgent> = {},
): InstanceWorkbenchAgent {
  return {
    agent: {
      id,
      name: id.toUpperCase(),
      description: `${id} agent`,
      avatar: id.slice(0, 1).toUpperCase(),
      systemPrompt: 'Do the work',
      creator: 'OpenClaw',
    },
    focusAreas: ['Automation'],
    automationFitScore: 80,
    workspace: `/workspace/${id}`,
    configSource: 'runtime',
    ...overrides,
  };
}

function createFile(
  id: string,
  path: string,
  overrides: Partial<InstanceWorkbenchFile> = {},
): InstanceWorkbenchFile {
  return {
    id,
    name: path.split('/').filter(Boolean).slice(-1)[0] || 'unknown.txt',
    path,
    category: 'artifact',
    language: 'plaintext',
    size: '1 KB',
    updatedAt: '2026-04-02T00:00:00.000Z',
    status: 'synced',
    description: 'Workbench file',
    content: '',
    isReadonly: false,
    ...overrides,
  };
}

await runTest(
  'getAgentScopedWorkbenchFiles keeps only the selected agent files and trims workspace prefixes',
  () => {
    const opsAgent = createAgent('ops');
    const files = [
      createFile('openclaw-agent-file:ops:AGENTS.md', '/workspace/ops/AGENTS.md'),
      createFile(
        'openclaw-agent-file:ops:logs%2Frun.log',
        '/workspace/ops/logs/run.log',
        { name: 'logs/run.log' },
      ),
      createFile('openclaw-agent-file:research:AGENTS.md', '/workspace/research/AGENTS.md'),
    ];

    const scopedFiles = getAgentScopedWorkbenchFiles(files, opsAgent);

    assert.deepEqual(
      scopedFiles.map((file) => file.id),
      ['openclaw-agent-file:ops:AGENTS.md', 'openclaw-agent-file:ops:logs%2Frun.log'],
    );
    assert.deepEqual(scopedFiles.map((file) => file.path), ['AGENTS.md', 'logs/run.log']);
  },
);

await runTest(
  'getAgentScopedWorkbenchFiles keeps backend-authored OpenClaw file ids attached after agent id normalization',
  () => {
    const researchAgent = createAgent('research-team', {
      agent: {
        id: 'research-team',
        name: 'Research Team',
        description: 'Research Team agent',
        avatar: 'R',
        systemPrompt: 'Do research',
        creator: 'OpenClaw',
      },
      workspace: 'C:/OpenClaw/.openclaw/workspace-research',
    });
    const files = [
      createFile(
        buildOpenClawAgentFileId('Research Team', 'AGENTS.md'),
        'C:/OpenClaw/.openclaw/workspace-research/AGENTS.md',
      ),
    ];

    const scopedFiles = getAgentScopedWorkbenchFiles(files, researchAgent);

    assert.deepEqual(
      scopedFiles.map((file) => file.id),
      [buildOpenClawAgentFileId('Research Team', 'AGENTS.md')],
    );
    assert.deepEqual(scopedFiles.map((file) => file.path), ['AGENTS.md']);
  },
);

await runTest(
  'getAgentScopedWorkbenchFiles keeps nested relative paths but normalizes the visible file name to the basename',
  () => {
    const opsAgent = createAgent('ops');
    const files = [
      createFile(
        'openclaw-agent-file:ops:prompts%2FREADME.md',
        '/workspace/ops/prompts/README.md',
        { name: 'prompts/README.md' },
      ),
      createFile(
        'openclaw-agent-file:ops:runbooks%2FREADME.md',
        '/workspace/ops/runbooks/README.md',
        { name: 'runbooks/README.md' },
      ),
    ];

    const scopedFiles = getAgentScopedWorkbenchFiles(files, opsAgent);

    assert.deepEqual(scopedFiles.map((file) => file.path), [
      'prompts/README.md',
      'runbooks/README.md',
    ]);
    assert.deepEqual(scopedFiles.map((file) => file.name), ['README.md', 'README.md']);
  },
);

await runTest(
  'getAgentScopedWorkbenchFiles preserves nested relative paths that are already workspace-relative',
  () => {
    const opsAgent = createAgent('ops');
    const files = [
      createFile(
        'openclaw-agent-file:ops:prompts%2FREADME.md',
        'prompts/README.md',
        { name: 'README.md' },
      ),
      createFile(
        'openclaw-agent-file:ops:runbooks%2FREADME.md',
        'runbooks/README.md',
        { name: 'README.md' },
      ),
    ];

    const scopedFiles = getAgentScopedWorkbenchFiles(files, opsAgent);

    assert.deepEqual(scopedFiles.map((file) => file.path), [
      'prompts/README.md',
      'runbooks/README.md',
    ]);
  },
);

await runTest(
  'getAgentScopedWorkbenchFiles trims Windows workspace prefixes without being tripped by drive-letter casing differences',
  () => {
    const opsAgent = createAgent('ops', {
      workspace: 'D:/Workspace/Ops',
      agentDir: 'D:/Workspace/Ops/.openclaw/agent',
    });
    const files = [
      createFile(
        'openclaw-agent-file:ops:prompts%2FREADME.md',
        'd:/workspace/ops/prompts/README.md',
        { name: 'README.md' },
      ),
      createFile(
        'openclaw-agent-file:ops:runbooks%2FREADME.md',
        'd:/workspace/ops/runbooks/README.md',
        { name: 'README.md' },
      ),
    ];

    const scopedFiles = getAgentScopedWorkbenchFiles(files, opsAgent);

    assert.deepEqual(scopedFiles.map((file) => file.path), [
      'prompts/README.md',
      'runbooks/README.md',
    ]);
    assert.deepEqual(scopedFiles.map((file) => file.name), ['README.md', 'README.md']);
  },
);

await runTest(
  'getAgentScopedWorkbenchFiles falls back to file names when a selected agent file path escapes the workspace root',
  () => {
    const opsAgent = createAgent('ops');
    const files = [
      createFile('openclaw-agent-file:ops:RUNBOOK.md', '/tmp/merged/ops/RUNBOOK.md'),
    ];

    const scopedFiles = getAgentScopedWorkbenchFiles(files, opsAgent);

    assert.equal(scopedFiles[0]?.path, 'RUNBOOK.md');
  },
);

await runTest(
  'getInstanceVisibleWorkbenchFiles falls back to all files when file snapshots exist before agent context is available',
  () => {
    const files = [
      createFile(
        buildOpenClawAgentFileId('Research Team', 'AGENTS.md'),
        'C:/OpenClaw/.openclaw/workspace-research/AGENTS.md',
      ),
      createFile(
        buildOpenClawAgentFileId('Research Team', 'logs/run.log'),
        'C:/OpenClaw/.openclaw/workspace-research/logs/run.log',
        { name: 'logs/run.log' },
      ),
    ];

    const visibleFiles = getInstanceVisibleWorkbenchFiles(files, null);

    assert.deepEqual(
      visibleFiles.map((file) => file.id),
      files.map((file) => file.id),
    );
    assert.deepEqual(
      visibleFiles.map((file) => file.path),
      files.map((file) => file.path),
    );
  },
);

await runTest('createDefaultWorkbenchFileTabState opens the first available file', () => {
  const files = [
    createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md'),
    createFile('openclaw-agent-file:ops:RUNBOOK.md', 'RUNBOOK.md'),
  ];

  const state = createDefaultWorkbenchFileTabState(files);

  assert.deepEqual(state, {
    openFileIds: ['openclaw-agent-file:ops:AGENTS.md'],
    activeFileId: 'openclaw-agent-file:ops:AGENTS.md',
  });
});

await runTest('openWorkbenchFileTab appends a file once and marks it active', () => {
  const files = [
    createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md'),
    createFile('openclaw-agent-file:ops:RUNBOOK.md', 'RUNBOOK.md'),
  ];

  const initial = createDefaultWorkbenchFileTabState(files);
  const opened = openWorkbenchFileTab(files, initial, 'openclaw-agent-file:ops:RUNBOOK.md');
  const reopened = openWorkbenchFileTab(files, opened, 'openclaw-agent-file:ops:RUNBOOK.md');

  assert.deepEqual(opened, {
    openFileIds: [
      'openclaw-agent-file:ops:AGENTS.md',
      'openclaw-agent-file:ops:RUNBOOK.md',
    ],
    activeFileId: 'openclaw-agent-file:ops:RUNBOOK.md',
  });
  assert.deepEqual(reopened, opened);
});

await runTest('reconcileWorkbenchFileTabs removes tabs that are no longer visible for the agent', () => {
  const files = [createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md')];

  const state = reconcileWorkbenchFileTabs(
    files,
    {
      openFileIds: [
        'openclaw-agent-file:ops:AGENTS.md',
        'openclaw-agent-file:ops:RUNBOOK.md',
      ],
      activeFileId: 'openclaw-agent-file:ops:RUNBOOK.md',
    },
  );

  assert.deepEqual(state, {
    openFileIds: ['openclaw-agent-file:ops:AGENTS.md'],
    activeFileId: 'openclaw-agent-file:ops:AGENTS.md',
  });
});

await runTest('closeWorkbenchFileTab activates the adjacent tab and allows the final tab to close', () => {
  const files = [
    createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md'),
    createFile('openclaw-agent-file:ops:RUNBOOK.md', 'RUNBOOK.md'),
  ];

  const state = {
    openFileIds: [
      'openclaw-agent-file:ops:AGENTS.md',
      'openclaw-agent-file:ops:RUNBOOK.md',
    ],
    activeFileId: 'openclaw-agent-file:ops:RUNBOOK.md',
  };

  const closedActive = closeWorkbenchFileTab(files, state, 'openclaw-agent-file:ops:RUNBOOK.md');
  const closedLast = closeWorkbenchFileTab(
    files,
    closedActive,
    'openclaw-agent-file:ops:AGENTS.md',
  );

  assert.deepEqual(closedActive, {
    openFileIds: ['openclaw-agent-file:ops:AGENTS.md'],
    activeFileId: 'openclaw-agent-file:ops:AGENTS.md',
  });
  assert.deepEqual(closedLast, {
    openFileIds: [],
    activeFileId: null,
  });
});

await runTest(
  'reconcileWorkbenchFileTextState keeps only visible file entries while preserving surviving content',
  () => {
    const files = [
      createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md'),
      createFile('openclaw-agent-file:ops:prompts%2FREADME.md', 'prompts/README.md'),
    ];

    const nextState = reconcileWorkbenchFileTextState(files, {
      'openclaw-agent-file:ops:AGENTS.md': 'agent instructions',
      'openclaw-agent-file:ops:prompts%2FREADME.md': 'prompt draft',
      'openclaw-agent-file:ops:stale.log': 'stale',
    });

    assert.deepEqual(nextState, {
      'openclaw-agent-file:ops:AGENTS.md': 'agent instructions',
      'openclaw-agent-file:ops:prompts%2FREADME.md': 'prompt draft',
    });
  },
);

await runTest(
  'buildWorkbenchEditorModelPath stays stable per file and differs for files that share a basename',
  () => {
    const promptReadme = createFile(
      'openclaw-agent-file:ops:prompts%2FREADME.md',
      'prompts/README.md',
    );
    const runbookReadme = createFile(
      'openclaw-agent-file:ops:runbooks%2FREADME.md',
      'runbooks/README.md',
    );

    const promptPath = buildWorkbenchEditorModelPath(promptReadme);
    const runbookPath = buildWorkbenchEditorModelPath(runbookReadme);

    assert.equal(promptPath, buildWorkbenchEditorModelPath(promptReadme));
    assert.notEqual(promptPath, runbookPath);
    assert.match(promptPath, /^workbench-file:\/\//);
    assert.match(runbookPath, /^workbench-file:\/\//);
  },
);

await runTest(
  'shouldLoadWorkbenchFileContent keeps fetching remote OpenClaw file bodies until cached by file id',
  () => {
    const file = createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md', {
      content: '# stale list payload',
    });

    assert.equal(
      shouldLoadWorkbenchFileContent({
        file,
        loadedFileContents: {},
        runtimeKind: 'openclaw',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      true,
    );
    assert.equal(
      shouldLoadWorkbenchFileContent({
        file,
        loadedFileContents: {
          'openclaw-agent-file:ops:AGENTS.md': '# actual fetched body',
        },
        runtimeKind: 'openclaw',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      false,
    );
  },
);

await runTest(
  'workbench file content cache keys include instance and scope to isolate reused file ids',
  () => {
    const file = createFile('/workspace/main/openclaw.json', '/workspace/main/openclaw.json');
    const firstKey = buildWorkbenchFileContentStateKey({
      instanceId: 'instance-a',
      scopeKey: 'agent:main',
      file,
    });
    const secondKey = buildWorkbenchFileContentStateKey({
      instanceId: 'instance-b',
      scopeKey: 'agent:main',
      file,
    });
    const scopedSiblingKey = buildWorkbenchFileContentStateKey({
      instanceId: 'instance-a',
      scopeKey: 'agent:research',
      file,
    });

    assert.equal(firstKey, 'instance-a\u001fagent:main\u001f/workspace/main/openclaw.json');
    assert.notEqual(firstKey, secondKey);
    assert.notEqual(firstKey, scopedSiblingKey);
    assert.equal(
      shouldLoadWorkbenchFileContent({
        file,
        loadedFileContents: {
          [secondKey]: '# other instance body',
        },
        contentStateKey: firstKey,
        runtimeKind: 'openclaw',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      true,
    );
    assert.equal(
      getWorkbenchFileResolvedContent({
        file,
        loadedFileContents: {
          [secondKey]: '# other instance body',
          [firstKey]: '# current scoped body',
        },
        contentStateKey: firstKey,
        runtimeKind: 'openclaw',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      '# current scoped body',
    );
  },
);

await runTest(
  'shouldLoadWorkbenchFileContent also keeps fetching remote gateway-backed file bodies when the kernel id is not OpenClaw',
  () => {
    const file = createFile('custom-agent-file:ops:AGENTS.md', 'AGENTS.md', {
      content: '# stale list payload',
    });

    assert.equal(
      shouldLoadWorkbenchFileContent({
        file,
        loadedFileContents: {},
        runtimeKind: 'custom',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      true,
    );
  },
);

await runTest(
  'getWorkbenchFileResolvedContent hides remote OpenClaw list content until the real file body is loaded',
  () => {
    const file = createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md', {
      content: '# stale list payload',
    });

    assert.equal(
      getWorkbenchFileResolvedContent({
        file,
        loadedFileContents: {},
        runtimeKind: 'openclaw',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      '',
    );
    assert.equal(
      getWorkbenchFileResolvedContent({
        file,
        loadedFileContents: {
          'openclaw-agent-file:ops:AGENTS.md': '# actual fetched body',
        },
        runtimeKind: 'openclaw',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      '# actual fetched body',
    );
  },
);

await runTest(
  'getWorkbenchFileResolvedContent also hides remote gateway-backed list content when the kernel id is not OpenClaw',
  () => {
    const file = createFile('custom-agent-file:ops:AGENTS.md', 'AGENTS.md', {
      content: '# stale list payload',
    });

    assert.equal(
      getWorkbenchFileResolvedContent({
        file,
        loadedFileContents: {},
        runtimeKind: 'custom',
        transportKind: 'openclawGatewayWs',
        isBuiltIn: false,
      }),
      '',
    );
  },
);

await runTest(
  'buildWorkbenchFileTabPresentation keeps tabs to a single-line title and moves full path into the tooltip',
  () => {
    const file = createFile(
      'openclaw-agent-file:ops:runbooks%2FREADME.md',
      'runbooks/README.md',
      {
        name: 'README.md',
      },
    );

    assert.deepEqual(buildWorkbenchFileTabPresentation(file), {
      id: 'openclaw-agent-file:ops:runbooks%2FREADME.md',
      title: 'README.md',
      tooltip: 'runbooks/README.md',
      subtitle: undefined,
    });
  },
);

await runTest(
  'shouldPersistWorkbenchFileDraftChange ignores programmatic flush events and files without stable ids',
  () => {
    const stableFile = createFile('openclaw-agent-file:ops:AGENTS.md', 'AGENTS.md');
    const emptyIdFile = createFile('', 'AGENTS.md');

    assert.equal(
      shouldPersistWorkbenchFileDraftChange({
        file: stableFile,
        isFlush: false,
      }),
      true,
    );
    assert.equal(
      shouldPersistWorkbenchFileDraftChange({
        file: stableFile,
        isFlush: true,
      }),
      false,
    );
    assert.equal(
      shouldPersistWorkbenchFileDraftChange({
        file: emptyIdFile,
        isFlush: false,
      }),
      false,
    );
  },
);
