// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import type { InstanceConfigWorkbenchSection } from './instanceConfigWorkbench.ts';
import {
  buildInstanceConfigOverviewMetrics,
  groupInstanceConfigSectionsByCategory,
} from './instanceConfigWorkbenchPresentation.ts';

function runTest(name: string, callback: () => void | Promise<void>) {
  return Promise.resolve()
    .then(callback)
    .then(() => {
      console.log(`ok - ${name}`);
    })
    .catch((error) => {
      console.error(`not ok - ${name}`);
      throw error;
    });
}

function createSection(
  key: string,
  label: string,
  category: InstanceConfigWorkbenchSection['category'],
): InstanceConfigWorkbenchSection {
  return {
    key,
    label,
    title: label,
    description: `${label} section`,
    category,
    kind: 'object',
    entryCount: 1,
    fieldNames: [],
    formattedValue: '{}',
    preview: '{}',
    isKnownSection: category !== 'other',
  };
}

await runTest(
  'groupInstanceConfigSectionsByCategory keeps control-ui order and category entry points stable',
  () => {
    const grouped = groupInstanceConfigSectionsByCategory([
      createSection('customSection', 'Custom Section', 'other'),
      createSection('models', 'Models', 'ai'),
      createSection('env', 'Environment', 'core'),
      createSection('plugins', 'Plugins', 'automation'),
      createSection('ui', 'UI', 'appearance'),
    ]);

    assert.deepEqual(
      grouped.map((entry) => ({
        id: entry.id,
        sectionCount: entry.sectionCount,
        firstSectionKey: entry.firstSection?.key ?? null,
      })),
      [
        { id: 'core', sectionCount: 1, firstSectionKey: 'env' },
        { id: 'ai', sectionCount: 1, firstSectionKey: 'models' },
        { id: 'automation', sectionCount: 1, firstSectionKey: 'plugins' },
        { id: 'appearance', sectionCount: 1, firstSectionKey: 'ui' },
        { id: 'other', sectionCount: 1, firstSectionKey: 'customSection' },
      ],
    );
  },
);

await runTest(
  'buildInstanceConfigOverviewMetrics keeps the root overview summary stable for config mode',
  () => {
    const metrics = buildInstanceConfigOverviewMetrics({
      document: {
        configFile: 'D:/OpenClaw/.openclaw/openclaw.json',
        isWritable: true,
        defaultAgentId: 'main',
        defaultModelRef: 'openai/gpt-5.4',
        sessionsVisibility: 'tree',
        providerCount: 2,
        agentCount: 3,
        channelCount: 4,
        sectionCount: 5,
        customSectionCount: 1,
        rawLineCount: 320,
      },
      configSections: [
        createSection('env', 'Environment', 'core'),
        createSection('customSection', 'Custom Section', 'other'),
      ],
      structuredEditorCoverage: 'Partial',
      schemaVersionLabel: '2026.4.3',
      schemaGeneratedAtLabel: 'Apr 3, 2026, 10:00',
    });

    assert.deepEqual(metrics, [
      { id: 'configFile', value: 'D:/OpenClaw/.openclaw/openclaw.json' },
      { id: 'defaultAgent', value: 'main' },
      { id: 'defaultModel', value: 'openai/gpt-5.4' },
      { id: 'sessions', value: 'tree' },
      { id: 'providers', value: '2' },
      { id: 'agents', value: '3' },
      { id: 'channels', value: '4' },
      { id: 'sections', value: '2' },
      { id: 'customSections', value: '1' },
      { id: 'formCoverage', value: 'Partial' },
      { id: 'schemaVersion', value: '2026.4.3' },
      { id: 'schemaGenerated', value: 'Apr 3, 2026, 10:00' },
      { id: 'rawLines', value: '320' },
      { id: 'writable', value: 'Yes' },
    ]);
  },
);
