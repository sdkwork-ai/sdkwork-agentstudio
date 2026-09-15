// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstanceDetailSectionContent } from './InstanceDetailSectionContent.tsx';

function runTest(name: string, fn: () => void | Promise<void>) {
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

function createBaseProps() {
  return {
    activeSection: 'skills',
    workbench: {
      channels: [],
      skills: [],
      kernelConfig: null,
      sectionAvailability: {
        channels: {
          status: 'restricted',
          detail: 'Channel management is restricted.',
        },
      },
    } as any,
    detail: {
      instance: {
        runtimeKind: 'openclaw',
        isBuiltIn: true,
      },
    } as any,
    managementSummary: null,
    instanceId: 'instance-1',
    config: {
      port: 3456,
      corsOrigins: '*',
      sandbox: true,
      autoUpdate: false,
    } as any,
    selectedAgentId: null,
    isWorkbenchFilesLoading: false,
    canEditConfigChannels: false,
    configChannelWorkspaceItems: [],
    readonlyChannelWorkspaceItems: [],
    configFilePath: null,
    selectedConfigChannelId: null,
    configChannelDrafts: {},
    configChannelError: null,
    isSavingConfigChannel: false,
    agentSection: <div>agent-section</div>,
    tasksSection: <div>tasks-section</div>,
    llmProvidersSection: <div>provider-section</div>,
    memorySection: <div>memory-section</div>,
    toolsSection: <div>tools-section</div>,
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.fieldLabels.status') {
        return 'Runtime status';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.fieldLabels.source') {
        return 'Source';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.fieldLabels.scope') {
        return 'Scope';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.fieldLabels.missingRequirements') {
        return 'Missing requirements';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.unknownSource') {
        return 'Unknown source';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.status.enabled') {
        return 'Enabled';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.status.disabled') {
        return 'Disabled';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.status.blocked') {
        return 'Blocked';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.compatibility.compatible') {
        return 'Compatible';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.compatibility.attention') {
        return 'Needs attention';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.compatibility.blocked') {
        return 'Blocked';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.scope.workspace') {
        return 'Workspace';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.scope.managed') {
        return 'Shared';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.scope.bundled') {
        return 'Bundled';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.scope.unknown') {
        return 'External';
      }
      if (key === 'instances.detail.instanceWorkbench.skills.runtime.missingRequirementsValue') {
        return `Missing ${options?.count ?? 0} requirements`;
      }
      return key;
    },
    formatWorkbenchLabel: (value: string) => `label:${value}`,
    getCapabilityTone: (status: string) => `tone:${status}`,
    getRuntimeStatusTone: (status: string) => `runtime:${status}`,
    getManagementEntryTone: (tone: 'neutral' | 'success' | 'warning') => `entry:${tone}`,
    onOpenOfficialLink: () => undefined,
    onSelectedConfigChannelIdChange: () => undefined,
    onConfigChannelFieldChange: () => undefined,
    onSaveConfigChannel: () => undefined,
    onDeleteConfigChannelConfiguration: () => undefined,
    onToggleConfigChannel: () => undefined,
    onSelectedAgentIdChange: () => undefined,
    onReloadFiles: () => undefined,
    onReloadConfig: () => undefined,
  };
}

await runTest(
  'InstanceDetailSectionContent routes unavailable channel sections through the shared availability notice',
  () => {
    const markup = renderToStaticMarkup(
      <InstanceDetailSectionContent {...createBaseProps()} activeSection="channels" />,
    );

    assert.match(markup, /Channel management is restricted\./);
    assert.match(markup, /label:restricted/);
  },
);

await runTest(
  'InstanceDetailSectionContent renders the skills section when skills exist',
  () => {
    const markup = renderToStaticMarkup(
      <InstanceDetailSectionContent
        {...createBaseProps()}
        workbench={{
          channels: [],
          skills: [
            {
              id: 'skill-1',
              name: 'Review Helper',
              category: 'analysis',
              description: 'Helps review tasks.',
              version: '1.0.0',
              downloads: 42,
              rating: 4.8,
              author: 'SDKWork',
            },
          ],
          kernelConfig: null,
          sectionAvailability: {},
        } as any}
      />,
    );

    assert.match(markup, /data-slot="instance-detail-skills"/);
    assert.match(markup, /Review Helper/);
    assert.doesNotMatch(markup, /instances\.detail\.instanceWorkbench\.empty\.skills/);
  },
);

await runTest(
  'InstanceDetailSectionContent renders installed-skill runtime compatibility details for instance workbench skills',
  () => {
    const markup = renderToStaticMarkup(
      <InstanceDetailSectionContent
        {...createBaseProps()}
        workbench={{
          channels: [],
          skills: [
            {
              id: 'skill-1',
              name: 'Workflow Guard',
              category: 'Automation',
              description: 'Guards workflow execution.',
              version: '1.4.0',
              downloads: 42,
              rating: 4.8,
              author: 'SDKWork',
              instanceAsset: {
                source: 'managed',
                scope: 'managed',
                status: 'disabled',
                compatibility: 'attention',
                bundled: false,
                missingRequirementCount: 2,
              },
            },
          ],
          kernelConfig: null,
          sectionAvailability: {},
        } as any}
      />,
    );

    assert.match(markup, /Workflow Guard/);
    assert.match(markup, /Needs attention/);
    assert.match(markup, /Runtime status/);
    assert.match(markup, /Disabled/);
    assert.match(markup, /Source/);
    assert.match(markup, /managed/);
    assert.match(markup, /Scope/);
    assert.match(markup, /Shared/);
    assert.match(markup, /Missing requirements/);
    assert.match(markup, /Missing 2 requirements/);
  },
);

await runTest(
  'InstanceDetailSectionContent returns the prebuilt agents section node for the agents route',
  () => {
    const markup = renderToStaticMarkup(
      <InstanceDetailSectionContent {...createBaseProps()} activeSection="agents" />,
    );

    assert.match(markup, /agent-section/);
  },
);

await runTest(
  'InstanceDetailSectionContent opens the config workbench when kernelConfig exposes a config file without legacy path fields',
  () => {
    const markup = renderToStaticMarkup(
      <InstanceDetailSectionContent
        {...createBaseProps()}
        activeSection="config"
        workbench={{
          channels: [],
          skills: [],
          kernelConfig: {
            configFile: 'C:/Users/admin/.openclaw/openclaw.json',
            configRoot: 'C:/Users/admin/.openclaw',
            userRoot: 'C:/Users/admin',
            format: 'json',
            access: 'localFs',
            provenance: 'standardUserRoot',
            writable: true,
            resolved: true,
            schemaVersion: null,
          },
          sectionAvailability: {
            config: {
              status: 'ready',
              detail: 'Config workbench is ready.',
            },
          },
        } as any}
      />,
    );

    assert.match(markup, /label:loading/);
    assert.doesNotMatch(markup, /instances\.detail\.instanceWorkbench\.empty\.config/);
  },
);
