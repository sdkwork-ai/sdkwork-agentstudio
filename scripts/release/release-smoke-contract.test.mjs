// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const rootDir = path.resolve(import.meta.dirname, '..', '..');

test('release smoke contract resolves report paths and persists normalized smoke evidence', async () => {
  const contractPath = path.join(rootDir, 'scripts', 'release', 'release-smoke-contract.mjs');
  const contract = await import(pathToFileURL(contractPath).href);

  assert.equal(typeof contract.RELEASE_SMOKE_REPORT_FILENAME, 'string');
  assert.equal(typeof contract.resolveReleaseSmokeReportPath, 'function');
  assert.equal(typeof contract.writeReleaseSmokeReport, 'function');
  assert.equal(typeof contract.readReleaseSmokeReport, 'function');

  assert.equal(
    contract.resolveReleaseSmokeReportPath({
      releaseAssetsDir: 'D:/synthetic/release-assets',
      family: 'web',
      platform: 'web',
      arch: 'any',
    }).replaceAll('\\', '/'),
    'D:/synthetic/release-assets/web/release-smoke-report.json',
  );
  assert.equal(
    contract.resolveReleaseSmokeReportPath({
      releaseAssetsDir: 'D:/synthetic/release-assets',
      family: 'server',
      platform: 'linux',
      arch: 'x64',
    }).replaceAll('\\', '/'),
    'D:/synthetic/release-assets/server/linux/x64/release-smoke-report.json',
  );
  assert.equal(
    contract.resolveReleaseSmokeReportPath({
      releaseAssetsDir: 'D:/synthetic/release-assets',
      family: 'container',
      platform: 'linux',
      arch: 'arm64',
      accelerator: 'cpu',
    }).replaceAll('\\', '/'),
    'D:/synthetic/release-assets/container/linux/arm64/cpu/release-smoke-report.json',
  );
  assert.equal(
    contract.resolveReleaseSmokeReportPath({
      releaseAssetsDir: 'D:/synthetic/release-assets',
      family: 'kubernetes',
      platform: 'linux',
      arch: 'x64',
      accelerator: 'nvidia-cuda',
    }).replaceAll('\\', '/'),
    'D:/synthetic/release-assets/kubernetes/linux/x64/nvidia-cuda/release-smoke-report.json',
  );

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-smoke-contract-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    const result = contract.writeReleaseSmokeReport({
      releaseAssetsDir,
      family: 'server',
      platform: 'linux',
      arch: 'x64',
      target: 'x86_64-unknown-linux-gnu',
      smokeKind: 'bundle-runtime',
      status: 'passed',
      manifestPath: path.join(releaseAssetsDir, 'server', 'linux', 'x64', 'release-asset-manifest.json'),
      artifactRelativePaths: [
        'server/linux/x64/agent-studio-server-release-local-linux-x64.tar.gz',
      ],
      launcherRelativePath: 'bin/agentstudio-server',
      runtimeBaseUrl: 'http://127.0.0.1:19797',
      checks: [
        {
          id: 'health-ready',
          status: 'passed',
          detail: '/claw/health/ready returned 200',
        },
      ],
    });

    assert.equal(existsSync(result.reportPath), true);
    const report = JSON.parse(readFileSync(result.reportPath, 'utf8'));
    assert.equal(report.family, 'server');
    assert.equal(report.platform, 'linux');
    assert.equal(report.arch, 'x64');
    assert.equal(report.smokeKind, 'bundle-runtime');
    assert.equal(report.status, 'passed');
    assert.deepEqual(report.checks, [
      {
        id: 'health-ready',
        status: 'passed',
        detail: '/claw/health/ready returned 200',
      },
    ]);

    assert.deepEqual(contract.readReleaseSmokeReport(result.reportPath), report);

    const webResult = contract.writeReleaseSmokeReport({
      releaseAssetsDir,
      family: 'web',
      platform: 'web',
      arch: 'any',
      smokeKind: 'web-archive-content',
      status: 'passed',
      manifestPath: path.join(releaseAssetsDir, 'web', 'release-asset-manifest.json'),
      artifactRelativePaths: [
        'agent-studio-web-assets-release-local.tar.gz',
      ],
      checks: [
        {
          id: 'web-index',
          status: 'passed',
          detail: 'web/dist/index.html is present in the archive',
        },
      ],
    });
    const webReport = JSON.parse(readFileSync(webResult.reportPath, 'utf8'));
    assert.equal(webReport.family, 'web');
    assert.equal(webReport.platform, 'web');
    assert.equal(webReport.arch, 'any');
    assert.equal(webReport.smokeKind, 'web-archive-content');
    assert.deepEqual(webReport.artifactRelativePaths, [
      'agent-studio-web-assets-release-local.tar.gz',
    ]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release smoke contract rejects unsafe artifact and launcher paths before writing reports', async () => {
  const contractPath = path.join(rootDir, 'scripts', 'release', 'release-smoke-contract.mjs');
  const contract = await import(pathToFileURL(contractPath).href);

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-smoke-paths-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    assert.throws(
      () => contract.writeReleaseSmokeReport({
        releaseAssetsDir,
        family: 'server',
        platform: 'linux',
        arch: 'x64',
        smokeKind: 'bundle-runtime',
        status: 'passed',
        artifactRelativePaths: [
          '../server/linux/x64/agent-studio-server-release-local-linux-x64.tar.gz',
        ],
        launcherRelativePath: 'bin/agentstudio-server',
      }),
      /unsafe release smoke artifact path/,
    );

    assert.throws(
      () => contract.writeReleaseSmokeReport({
        releaseAssetsDir,
        family: 'server',
        platform: 'linux',
        arch: 'x64',
        smokeKind: 'bundle-runtime',
        status: 'passed',
        artifactRelativePaths: [
          'server/linux/x64/agent-studio-server-release-local-linux-x64.tar.gz',
        ],
        launcherRelativePath: '../bin/agentstudio-server',
      }),
      /unsafe release smoke launcher path/,
    );

    assert.throws(
      () => contract.writeReleaseSmokeReport({
        releaseAssetsDir,
        family: 'container',
        platform: 'linux',
        arch: 'x64',
        accelerator: 'cpu',
        smokeKind: 'live-deployment',
        status: 'passed',
        artifactRelativePaths: [
          'container/linux/x64/cpu/agent-studio-container-bundle-release-local-linux-x64-cpu.tar.gz',
        ],
        launcherRelativePath: './deployments/docker/docker-compose.yml',
      }),
      /non-canonical release smoke launcher path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
