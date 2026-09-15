// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';

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

let skillWorkbenchSupportModule:
  | typeof import('./openClawSkillWorkbenchSupport.ts')
  | undefined;

try {
  skillWorkbenchSupportModule = await import('./openClawSkillWorkbenchSupport.ts');
} catch {
  skillWorkbenchSupportModule = undefined;
}

await runTest(
  'openClawSkillWorkbenchSupport exposes shared skill shaping helpers',
  () => {
    assert.ok(skillWorkbenchSupportModule, 'Expected openClawSkillWorkbenchSupport.ts to exist');
    assert.equal(typeof skillWorkbenchSupportModule?.inferSkillCategory, 'function');
    assert.equal(typeof skillWorkbenchSupportModule?.buildOpenClawSkills, 'function');
  },
);

await runTest(
  'inferSkillCategory groups skill content into stable workbench categories',
  () => {
    assert.equal(
      skillWorkbenchSupportModule?.inferSkillCategory(
        'Browser Inspector',
        'Inspect web pages and browser state.',
      ),
      'Integration',
    );
    assert.equal(
      skillWorkbenchSupportModule?.inferSkillCategory(
        'Image Composer',
        'Generate image and audio assets.',
      ),
      'Media',
    );
    assert.equal(
      skillWorkbenchSupportModule?.inferSkillCategory(
        'Ops Automation',
        'Runs cron-based automation flows.',
      ),
      'Automation',
    );
    assert.equal(
      skillWorkbenchSupportModule?.inferSkillCategory(
        'Patch Bot',
        'Writes code and git patches.',
      ),
      'Code',
    );
    assert.equal(
      skillWorkbenchSupportModule?.inferSkillCategory(
        'General Assistant',
        'Helps with everyday tasks.',
      ),
      'General',
    );
  },
);

await runTest(
  'buildOpenClawSkills shapes status entries with readme fallback summaries and stable metadata defaults',
  () => {
    const skills = skillWorkbenchSupportModule?.buildOpenClawSkills({
      entries: [
        {
          id: 'browser-inspector',
          readme: '# Browser Inspector\n\nInspect browser and web page state for automation.',
          version: '1.2.0',
        },
        {
          name: 'Patch Runner',
          description: 'Apply code patches across a repo.',
          author: 'SDKWork',
          size: '18 KB',
          updatedAt: '2026-04-09T00:00:00.000Z',
        },
        'skip-me',
      ],
    } as any);

    assert.equal(skills?.length, 2);

    assert.equal(skills?.[0]?.id, 'browser-inspector');
    assert.equal(skills?.[0]?.name, 'browser-inspector');
    assert.ok(skills?.[0]?.description.includes('Inspect browser'));
    assert.equal(skills?.[0]?.author, 'OpenClaw');
    assert.equal(skills?.[0]?.category, 'Integration');
    assert.equal(skills?.[0]?.version, '1.2.0');
    assert.equal(skills?.[0]?.downloads, 1);
    assert.equal(skills?.[0]?.rating, 5);

    assert.equal(skills?.[1]?.id, 'Patch Runner');
    assert.equal(skills?.[1]?.name, 'Patch Runner');
    assert.equal(skills?.[1]?.description, 'Apply code patches across a repo.');
    assert.equal(skills?.[1]?.author, 'SDKWork');
    assert.equal(skills?.[1]?.category, 'Code');
    assert.equal(skills?.[1]?.size, '18 KB');
    assert.equal(skills?.[1]?.updatedAt, '2026-04-09T00:00:00.000Z');
  },
);

await runTest(
  'buildOpenClawSkills preserves installed-skill runtime metadata for instance detail workbench snapshots',
  () => {
    const skills = skillWorkbenchSupportModule?.buildOpenClawSkills({
      workspace: 'D:/OpenClaw/workspace/default',
      entries: [
        {
          id: 'workflow-guard',
          name: 'Workflow Guard',
          description: 'Guards workflow execution.',
          source: 'managed',
          bundled: false,
          disabled: true,
          eligible: true,
          blockedByAllowlist: false,
          filePath: 'D:/OpenClaw/.openclaw/skills/workflow-guard/SKILL.md',
          baseDir: 'D:/OpenClaw/.openclaw/skills/workflow-guard',
          missing: {
            bins: [],
            anyBins: ['node'],
            env: [],
            config: [],
          },
        },
        {
          id: 'workspace-browser',
          name: 'Workspace Browser',
          description: 'Inspects browser state from the default workspace.',
          source: 'workspace',
          bundled: false,
          disabled: false,
          eligible: true,
          blockedByAllowlist: false,
          filePath: 'D:/OpenClaw/workspace/default/skills/workspace-browser/SKILL.md',
          baseDir: 'D:/OpenClaw/workspace/default/skills/workspace-browser',
          missing: {
            bins: [],
            anyBins: [],
            env: [],
            config: [],
          },
        },
        {
          id: 'bundled-guardian',
          name: 'Bundled Guardian',
          description: 'Protects the bundled runtime surface.',
          source: 'bundled',
          bundled: true,
          disabled: false,
          eligible: false,
          blockedByAllowlist: true,
          missing: {
            bins: [],
            anyBins: [],
            env: ['OPENCLAW_TOKEN'],
            config: [],
          },
        },
      ],
    } as any);

    assert.deepEqual(
      skills?.map((skill) => ({
        id: skill.id,
        instanceAsset: skill.instanceAsset,
      })),
      [
        {
          id: 'workflow-guard',
          instanceAsset: {
            source: 'managed',
            scope: 'managed',
            status: 'disabled',
            compatibility: 'attention',
            bundled: false,
            filePath: 'D:/OpenClaw/.openclaw/skills/workflow-guard/SKILL.md',
            baseDir: 'D:/OpenClaw/.openclaw/skills/workflow-guard',
            missingRequirementCount: 1,
          },
        },
        {
          id: 'workspace-browser',
          instanceAsset: {
            source: 'workspace',
            scope: 'workspace',
            status: 'enabled',
            compatibility: 'compatible',
            bundled: false,
            filePath: 'D:/OpenClaw/workspace/default/skills/workspace-browser/SKILL.md',
            baseDir: 'D:/OpenClaw/workspace/default/skills/workspace-browser',
            missingRequirementCount: 0,
          },
        },
        {
          id: 'bundled-guardian',
          instanceAsset: {
            source: 'bundled',
            scope: 'bundled',
            status: 'blocked',
            compatibility: 'blocked',
            bundled: true,
            missingRequirementCount: 1,
          },
        },
      ],
    );
  },
);

await runTest(
  'buildOpenClawSkills infers workspace scope from canonical embedded workspace paths when the gateway omits workspace metadata',
  () => {
    const skills = skillWorkbenchSupportModule?.buildOpenClawSkills({
      entries: [
        {
          id: 'workspace-browser',
          name: 'Workspace Browser',
          description: 'Inspects browser state from the embedded workspace.',
          source: 'local',
          bundled: false,
          disabled: false,
          eligible: true,
          blockedByAllowlist: false,
          filePath: 'D:/OpenClaw/.openclaw/workspace/skills/workspace-browser/SKILL.md',
          baseDir: 'D:/OpenClaw/.openclaw/workspace/skills/workspace-browser',
          missing: {
            bins: [],
            anyBins: [],
            env: [],
            config: [],
          },
        },
      ],
    } as any);

    assert.equal(skills?.[0]?.instanceAsset?.scope, 'workspace');
    assert.equal(
      skills?.[0]?.instanceAsset?.baseDir,
      'D:/OpenClaw/.openclaw/workspace/skills/workspace-browser',
    );
  },
);
