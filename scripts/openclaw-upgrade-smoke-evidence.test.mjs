// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..');

test('desktop openclaw runtime check includes upgrade smoke evidence contract', () => {
  const packageJson = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

  assert.match(
    packageJson.scripts['check:desktop-openclaw-runtime'],
    /node scripts\/openclaw-upgrade-smoke-evidence\.test\.mjs/,
    'check:desktop-openclaw-runtime must execute the upgrade smoke evidence test',
  );
});

test('upgrade smoke evidence summarizes installer and packaged launch smoke', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'openclaw-upgrade-smoke-evidence.mjs');
  const evidence = await import(pathToFileURL(modulePath).href);

  assert.equal(typeof evidence.buildOpenClawUpgradeSmokeEvidence, 'function');

  const result = await evidence.buildOpenClawUpgradeSmokeEvidence({
    workspaceRootDir: 'D:/synthetic/workspace',
    releaseAssetsDir: 'D:/synthetic/workspace/artifacts/release',
    platform: 'windows',
    arch: 'x64',
    target: 'x86_64-pc-windows-msvc',
    smokeDesktopInstallersFn: async (options) => {
      assert.equal(options.platform, 'windows');
      assert.equal(options.arch, 'x64');
      assert.equal(options.target, 'x86_64-pc-windows-msvc');
      return {
        reportPath: 'D:/synthetic/workspace/artifacts/release/desktop/windows/x64/desktop-installer-smoke-report.json',
        report: {
          status: 'passed',
          checks: [{ id: 'installers', status: 'passed' }],
        },
      };
    },
    smokeDesktopPackagedLaunchFn: async (options) => {
      assert.equal(options.platform, 'windows');
      assert.equal(options.arch, 'x64');
      assert.equal(options.target, 'x86_64-pc-windows-msvc');
      return {
        capturedEvidencePath: 'D:/synthetic/workspace/artifacts/release/desktop/windows/x64/diagnostics/desktop-startup-evidence.json',
        smokeResult: {
          reportPath: 'D:/synthetic/workspace/artifacts/release/desktop/windows/x64/desktop-startup-smoke-report.json',
          report: {
            status: 'passed',
            phase: 'shell-mounted',
            localAiProxyRuntime: {
              lifecycle: 'running',
              messageCaptureEnabled: true,
              observabilityDbPath: 'D:/synthetic/workspace/.sdkwork/store/local-ai-proxy-observability.sqlite3',
              snapshotPath: 'D:/synthetic/workspace/.sdkwork/state/local-ai-proxy.snapshot.json',
              logPath: 'D:/synthetic/workspace/.sdkwork/logs/local-ai-proxy.log',
            },
          },
        },
      };
    },
  });

  assert.equal(result.smokeReady, true);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.packagedLaunchSmokeSummary, {
    reportPath: 'D:/synthetic/workspace/artifacts/release/desktop/windows/x64/desktop-startup-smoke-report.json',
    status: 'passed',
    phase: 'shell-mounted',
    localAiProxyRuntime: {
      lifecycle: 'running',
      messageCaptureEnabled: true,
      observabilityDbPath: 'D:/synthetic/workspace/.sdkwork/store/local-ai-proxy-observability.sqlite3',
      snapshotPath: 'D:/synthetic/workspace/.sdkwork/state/local-ai-proxy.snapshot.json',
      logPath: 'D:/synthetic/workspace/.sdkwork/logs/local-ai-proxy.log',
    },
  });
  assert.deepEqual(
    result.phases.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: 'installer-smoke', status: 'passed' },
      { id: 'packaged-launch-smoke', status: 'passed' },
      { id: 'smoke-readiness', status: 'passed' },
    ],
  );
});

test('upgrade smoke evidence turns packaged launch failures into smoke blockers', async () => {
  const modulePath = path.join(rootDir, 'scripts', 'openclaw-upgrade-smoke-evidence.mjs');
  const evidence = await import(pathToFileURL(modulePath).href);

  const result = await evidence.buildOpenClawUpgradeSmokeEvidence({
    workspaceRootDir: 'D:/synthetic/workspace',
    releaseAssetsDir: 'D:/synthetic/workspace/artifacts/release',
    platform: 'windows',
    arch: 'x64',
    smokeDesktopInstallersFn: async () => ({
      reportPath: 'D:/synthetic/workspace/artifacts/release/desktop/windows/x64/desktop-installer-smoke-report.json',
      report: {
        status: 'passed',
      },
    }),
    smokeDesktopPackagedLaunchFn: async () => {
      throw new Error('Desktop packaged launch smoke could not reach shell-mounted readiness.');
    },
  });

  assert.equal(result.smokeReady, false);
  assert.match(
    result.blockers.join('\n'),
    /Desktop packaged launch smoke could not reach shell-mounted readiness\./,
  );
  assert.deepEqual(
    result.phases.map((entry) => ({ id: entry.id, status: entry.status })),
    [
      { id: 'installer-smoke', status: 'passed' },
      { id: 'packaged-launch-smoke', status: 'failed' },
      { id: 'smoke-readiness', status: 'failed' },
    ],
  );
});
