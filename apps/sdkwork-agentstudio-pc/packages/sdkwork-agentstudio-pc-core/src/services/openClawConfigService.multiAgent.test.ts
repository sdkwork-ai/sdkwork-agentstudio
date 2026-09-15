// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { PlatformAPI } from '@sdkwork/agentstudio-pc-infrastructure';

async function runTest(name: string, callback: () => Promise<void> | void) {
  try {
    await callback();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function createPlatformBridgeStub(overrides: Partial<PlatformAPI> = {}): PlatformAPI {
  return {
    getPlatform: () => 'desktop',
    getDeviceId: async () => 'test-device',
    setStorage: async () => {},
    getStorage: async () => null,
    copy: async () => {},
    openExternal: async () => {},
    supportsNativeScreenshot: () => false,
    captureScreenshot: async () => null,
    fetchRemoteUrl: async (url) => ({
      url,
      bytes: new Uint8Array(),
    }),
    selectFile: async () => [],
    saveFile: async () => {},
    minimizeWindow: async () => {},
    maximizeWindow: async () => {},
    restoreWindow: async () => {},
    isWindowMaximized: async () => false,
    subscribeWindowMaximized: async () => async () => {},
    closeWindow: async () => {},
    listDirectory: async () => [],
    pathExists: async () => false,
    pathExistsForUserTooling: async () => false,
    getPathInfo: async (path) => ({
      path,
      name: path.split(/[\\/]/).pop() || path,
      kind: 'missing',
      size: null,
      extension: null,
      exists: false,
      lastModifiedMs: null,
    }),
    createDirectory: async () => {},
    removePath: async () => {},
    copyPath: async () => {},
    movePath: async () => {},
    readBinaryFile: async () => new Uint8Array(),
    writeBinaryFile: async () => {},
    readFile: async () => {
      throw new Error('readFile stub not configured');
    },
    readFileForUserTooling: async () => {
      throw new Error('readFileForUserTooling stub not configured');
    },
    writeFile: async () => {},
    ...overrides,
  };
}

await runTest(
  'openClawConfigService resolves agent install paths from standard roots before the config entry exists',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const fileContent = `{
  agents: {
    defaults: {
      workspace: "D:/OpenClaw/workspace",
      agentDir: "D:/OpenClaw/agents",
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
      }),
    });

    try {
      const researchPlan = await openClawConfigService.resolveAgentPaths({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        agentId: 'Research Crew',
      });
      const mainPlan = await openClawConfigService.resolveAgentPaths({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        agentId: 'main',
      });

      assert.equal(researchPlan.id, 'research-crew');
      assert.equal(researchPlan.workspace, 'D:/OpenClaw/.openclaw/workspace-research-crew');
      assert.equal(researchPlan.agentDir, 'D:/OpenClaw/.openclaw/agents/research-crew/agent');
      assert.equal(mainPlan.id, 'main');
      assert.equal(mainPlan.workspace, 'D:/OpenClaw/.openclaw/workspace');
      assert.equal(mainPlan.agentDir, 'D:/OpenClaw/.openclaw/agents/main/agent');
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);
await runTest(
  'openClawConfigService configures multi-agent support by restoring main as coordinator, merging allowlists, and preserving user overrides',
  async () => {
    const { configurePlatformBridge, getPlatformBridge } = await import('@sdkwork/agentstudio-pc-infrastructure');
    const { openClawConfigService } = await import('./openClawConfigService.ts');

    const originalBridge = getPlatformBridge();
    const writes: Array<{ path: string; content: string }> = [];
    let fileContent = `{
  models: {
    providers: {},
  },
  agents: {
    defaults: {
      workspace: "D:/OpenClaw/workspace",
      subagents: {
        maxSpawnDepth: 3,
      },
    },
    list: [
      {
        id: "research",
        name: "Research",
        default: true,
      },
    ],
  },
  tools: {
    sessions: {
      visibility: "tree",
    },
    agentToAgent: {
      enabled: false,
      allow: ["legacy"],
    },
  },
}`;

    configurePlatformBridge({
      platform: createPlatformBridgeStub({
        readFile: async () => fileContent,
        writeFile: async (path, content) => {
          fileContent = content;
          writes.push({ path, content });
        },
      }),
    });

    try {
      const snapshot = await openClawConfigService.configureMultiAgentSupport({
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        coordinatorAgentId: 'main',
        allowAgentIds: ['research', 'ops'],
        subagentDefaults: {
          maxConcurrent: 4,
          maxSpawnDepth: 2,
          maxChildrenPerAgent: 5,
        },
        sessionsVisibility: 'all',
      });

      const main = snapshot.agentSnapshots.find((agent) => agent.id === 'main');
      const research = snapshot.agentSnapshots.find((agent) => agent.id === 'research');

      assert.equal(writes.length > 0, true);
      assert.equal(main?.isDefault, true);
      assert.equal(research?.isDefault, false);
      assert.equal(snapshot.root.tools && JSON.stringify(snapshot.root.tools).includes('"enabled":true'), true);
      assert.equal(
        snapshot.root.tools &&
          typeof snapshot.root.tools === 'object' &&
          !Array.isArray(snapshot.root.tools) &&
          JSON.stringify((snapshot.root.tools as Record<string, unknown>).agentToAgent).includes('legacy'),
        true,
      );
      assert.equal(
        snapshot.root.tools &&
          typeof snapshot.root.tools === 'object' &&
          !Array.isArray(snapshot.root.tools) &&
          JSON.stringify((snapshot.root.tools as Record<string, unknown>).agentToAgent).includes('research'),
        true,
      );
      assert.equal(
        snapshot.root.tools &&
          typeof snapshot.root.tools === 'object' &&
          !Array.isArray(snapshot.root.tools) &&
          JSON.stringify((snapshot.root.tools as Record<string, unknown>).agentToAgent).includes('ops'),
        true,
      );
      assert.equal(
        snapshot.root.tools &&
          typeof snapshot.root.tools === 'object' &&
          !Array.isArray(snapshot.root.tools) &&
          JSON.stringify((snapshot.root.tools as Record<string, unknown>).sessions).includes('"tree"'),
        true,
      );
      assert.equal(
        snapshot.root.agents &&
          typeof snapshot.root.agents === 'object' &&
          !Array.isArray(snapshot.root.agents) &&
          JSON.stringify((snapshot.root.agents as Record<string, unknown>).defaults).includes('"maxConcurrent":4'),
        true,
      );
      assert.equal(
        snapshot.root.agents &&
          typeof snapshot.root.agents === 'object' &&
          !Array.isArray(snapshot.root.agents) &&
          JSON.stringify((snapshot.root.agents as Record<string, unknown>).defaults).includes('"maxSpawnDepth":3'),
        true,
      );
      assert.equal(
        snapshot.root.agents &&
          typeof snapshot.root.agents === 'object' &&
          !Array.isArray(snapshot.root.agents) &&
          JSON.stringify((snapshot.root.agents as Record<string, unknown>).defaults).includes('"maxChildrenPerAgent":5'),
        true,
      );
      assert.equal(
        snapshot.root.agents &&
          typeof snapshot.root.agents === 'object' &&
          !Array.isArray(snapshot.root.agents) &&
          JSON.stringify((snapshot.root.agents as Record<string, unknown>).defaults).includes('"workspace"'),
        false,
      );
      assert.match(fileContent, /subagents/);
      assert.match(fileContent, /allowAgents/);
    } finally {
      configurePlatformBridge(originalBridge);
    }
  },
);
