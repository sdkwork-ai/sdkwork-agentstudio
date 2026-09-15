// WORKSPACE-PATH:allow-fixture: fixtures name a foreign checkout root, drive, or home directory to exercise path handling, so the literal is the value under assertion rather than a binding this build resolves
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import {
  createStoredZipArchive,
  createTarGzArchive,
} from '../test-support/archive-fixtures.mjs';

const rootDir = path.resolve(import.meta.dirname, '..', '..');
const minimalReleaseProfile = Object.freeze({
  id: 'agent-studio',
  release: Object.freeze({
    manifestFileName: 'release-manifest.json',
    manifestChecksumFileName: 'release-manifest.json.sha256.txt',
    attestationEvidenceFileName: 'release-attestations.json',
    attestationPredicateType: 'https://slsa.dev/provenance/v1',
    attestationSignerWorkflowPath: '.github/workflows/release-reusable.yml',
    enableArtifactAttestations: true,
    globalChecksumsFileName: 'SHA256SUMS.txt',
  }),
  desktop: Object.freeze({
    matrix: Object.freeze([]),
  }),
  server: Object.freeze({
    matrix: Object.freeze([]),
  }),
  container: Object.freeze({
    matrix: Object.freeze([]),
  }),
  kubernetes: Object.freeze({
    matrix: Object.freeze([]),
  }),
});
const desktopOnlyReleaseProfile = Object.freeze({
  ...minimalReleaseProfile,
  desktop: Object.freeze({
    matrix: Object.freeze([
      Object.freeze({
        platform: 'windows',
        arch: 'x64',
        bundles: Object.freeze(['nsis']),
      }),
    ]),
  }),
});
const macosDesktopOnlyReleaseProfile = Object.freeze({
  ...minimalReleaseProfile,
  desktop: Object.freeze({
    matrix: Object.freeze([
      Object.freeze({
        platform: 'macos',
        arch: 'arm64',
        bundles: Object.freeze(['app', 'dmg']),
      }),
    ]),
  }),
});

function resolveMinimalReleaseProfile(profileId = 'agent-studio') {
  assert.equal(profileId, 'agent-studio');
  return minimalReleaseProfile;
}

function resolveDesktopOnlyReleaseProfile(profileId = 'agent-studio') {
  assert.equal(profileId, 'agent-studio');
  return desktopOnlyReleaseProfile;
}

function resolveMacosDesktopOnlyReleaseProfile(profileId = 'agent-studio') {
  assert.equal(profileId, 'agent-studio');
  return macosDesktopOnlyReleaseProfile;
}

function resolveReleaseProfileWithChecksumFileName(checksumFileName) {
  return (profileId = 'agent-studio') => ({
    ...minimalReleaseProfile,
    id: profileId,
    release: {
      ...minimalReleaseProfile.release,
      globalChecksumsFileName: checksumFileName,
    },
  });
}

function resolveReleaseProfileWithManifestChecksumFileName(manifestChecksumFileName) {
  return (profileId = 'agent-studio') => ({
    ...minimalReleaseProfile,
    id: profileId,
    release: {
      ...minimalReleaseProfile.release,
      manifestChecksumFileName,
    },
  });
}

function resolveReleaseProfileWithAttestationEvidenceFileName(attestationEvidenceFileName) {
  return (profileId = 'agent-studio') => ({
    ...minimalReleaseProfile,
    id: profileId,
    release: {
      ...minimalReleaseProfile.release,
      attestationEvidenceFileName,
    },
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function writeReleaseManifestChecksumSidecar(releaseAssetsDir) {
  const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
  writeFileSync(
    path.join(releaseAssetsDir, 'release-manifest.json.sha256.txt'),
    `${fileSha256(manifestPath)}  release-manifest.json\n`,
    'utf8',
  );
}

function writeManualReleaseMetadataFixture({
  releaseAssetsDir,
  checksumFileName = 'SHA256SUMS.txt',
} = {}) {
  const releaseNotesRelativePath = 'release-notes.md';
  const releaseNotesPath = path.join(releaseAssetsDir, releaseNotesRelativePath);
  if (!existsSync(releaseNotesPath)) {
    writeFileSync(releaseNotesPath, '# Agent Studio Release\n\nRelease notes.\n', 'utf8');
  }
  const releaseNotesSha256 = fileSha256(releaseNotesPath);
  const checksumPath = path.join(releaseAssetsDir, checksumFileName);
  const checksumContent = existsSync(checksumPath)
    ? readFileSync(checksumPath, 'utf8').replace(/\s*$/, '\n')
    : '';
  if (!checksumContent.includes(`  ${releaseNotesRelativePath}\n`)) {
    writeFileSync(
      checksumPath,
      `${checksumContent}${releaseNotesSha256}  ${releaseNotesRelativePath}\n`,
      'utf8',
    );
  }

  return {
    kind: 'release-notes',
    purpose: 'github-release-body',
    relativePath: releaseNotesRelativePath,
    sha256: releaseNotesSha256,
    size: statSync(releaseNotesPath).size,
    required: true,
  };
}

function writeManualAttestationEvidenceFixture({
  releaseAssetsDir,
  entries,
  repository = 'sdkwork-ai/agent-studio',
  releaseTag = 'release-2026-04-12-01',
  predicateType = 'https://slsa.dev/provenance/v1',
  signerWorkflow = '.github/workflows/release-reusable.yml',
} = {}) {
  const sourceRef = `refs/tags/${releaseTag}`;
  const signerWorkflowIdentity = `${repository}/${signerWorkflow}`;
  writeFileSync(
    path.join(releaseAssetsDir, 'release-attestations.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      repository,
      releaseTag,
      sourceRef,
      generatedAt: '2026-04-12T01:02:03.000Z',
      predicateType,
      signerWorkflow,
      signerWorkflowIdentity,
      artifacts: entries.map((entry) => ({
        kind: entry.kind ?? 'artifact',
        relativePath: entry.relativePath,
        sha256: entry.sha256,
        repository,
        releaseTag,
        sourceRef,
        predicateType,
        signerWorkflow,
        signerWorkflowIdentity,
        verified: true,
        verificationCommand: `gh attestation verify ${entry.relativePath} -R ${repository} --source-ref ${sourceRef} --predicate-type ${predicateType} --signer-workflow ${signerWorkflowIdentity} --format json`,
        verifiedAt: '2026-04-12T01:02:03.000Z',
      })),
    }, null, 2)}\n`,
    'utf8',
  );
}

function completeManualReleaseManifest({
  releaseAssetsDir,
  checksumFileName = 'SHA256SUMS.txt',
  attestationEntries,
} = {}) {
  const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const releaseMetadata = [
    writeManualReleaseMetadataFixture({
      releaseAssetsDir,
      checksumFileName,
    }),
  ];
  manifest.releaseMetadata = releaseMetadata;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeManualAttestationEvidenceFixture({
    releaseAssetsDir,
    entries: attestationEntries ?? [
      ...(Array.isArray(manifest.artifacts) ? manifest.artifacts.map((artifact) => ({
        kind: 'artifact',
        relativePath: artifact.relativePath,
        sha256: artifact.sha256,
      })) : []),
      ...releaseMetadata.map((entry) => ({
        kind: 'release-metadata',
        relativePath: entry.relativePath,
        sha256: entry.sha256,
      })),
    ],
  });
  writeReleaseManifestChecksumSidecar(releaseAssetsDir);
  return manifest;
}

function writeAttestationEvidenceFixture({
  releaseAssetsDir,
  artifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz',
  artifactSha256 = '',
  releaseMetadata = [],
  repository = 'sdkwork-ai/agent-studio',
  releaseTag = 'release-2026-04-12-01',
  sourceRef = `refs/tags/${releaseTag}`,
  predicateType = 'https://slsa.dev/provenance/v1',
  signerWorkflow = '.github/workflows/release-reusable.yml',
  signerWorkflowIdentity = `${repository}/${signerWorkflow}`,
} = {}) {
  writeFileSync(
    path.join(releaseAssetsDir, 'release-attestations.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      repository,
      releaseTag,
      generatedAt: '2026-04-12T01:02:03.000Z',
      predicateType,
      signerWorkflow,
      signerWorkflowIdentity,
      artifacts: [
        {
          kind: 'artifact',
          relativePath: artifactRelativePath,
          sha256: artifactSha256,
          repository,
          releaseTag,
          sourceRef,
          predicateType,
          signerWorkflow,
          signerWorkflowIdentity,
          verified: true,
          verificationCommand: `gh attestation verify ${artifactRelativePath} -R ${repository} --source-ref ${sourceRef} --predicate-type ${predicateType} --signer-workflow ${signerWorkflowIdentity} --format json`,
          verifiedAt: '2026-04-12T01:02:03.000Z',
        },
        ...releaseMetadata.map((entry) => ({
          kind: 'release-metadata',
          relativePath: entry.relativePath,
          sha256: entry.sha256,
          repository,
          releaseTag,
          sourceRef,
          predicateType,
          signerWorkflow,
          signerWorkflowIdentity,
          verified: true,
          verificationCommand: `gh attestation verify ${entry.relativePath} -R ${repository} --source-ref ${sourceRef} --predicate-type ${predicateType} --signer-workflow ${signerWorkflowIdentity} --format json`,
          verifiedAt: '2026-04-12T01:02:03.000Z',
        })),
      ],
    }, null, 2)}\n`,
    'utf8',
  );
}

function fileEvidenceMetadata(filePath, prefix) {
  return {
    [`${prefix}Sha256`]: fileSha256(filePath),
    [`${prefix}Size`]: statSync(filePath).size,
  };
}

function commonSmokeEvidenceMetadata({
  reportPath,
  manifestPath,
}) {
  return {
    ...fileEvidenceMetadata(reportPath, 'report'),
    ...fileEvidenceMetadata(manifestPath, 'manifest'),
  };
}

function buildReleaseNotesMetadata(releaseAssetsDir, content = '# Agent Studio Release\n\nRelease notes.\n') {
  const relativePath = 'release-notes.md';
  const filePath = path.join(releaseAssetsDir, relativePath);
  writeFileSync(filePath, content, 'utf8');
  return {
    kind: 'release-notes',
    purpose: 'github-release-body',
    relativePath,
    sha256: fileSha256(filePath),
    size: statSync(filePath).size,
    required: true,
  };
}

function buildWebArchiveSmokeMetadata(artifactRelativePath) {
  return {
    reportRelativePath: 'web/release-smoke-report.json',
    manifestRelativePath: 'web/release-asset-manifest.json',
    verifiedAt: '2026-04-12T01:02:03.000Z',
    target: '',
    smokeKind: 'web-archive-content',
    status: 'passed',
    artifactRelativePaths: [artifactRelativePath],
    checks: [
      {
        id: 'artifact-checksum',
        status: 'passed',
        detail: 'archive checksum matches manifest and sidecar metadata',
      },
      {
        id: 'web-index',
        status: 'passed',
        detail: 'web/dist/index.html is present in the archive',
      },
      {
        id: 'web-assets',
        status: 'passed',
        detail: 'web/dist/assets contains browser assets',
      },
      {
        id: 'docs-index',
        status: 'passed',
        detail: 'docs/dist/index.html is present in the archive',
      },
      {
        id: 'docs-404',
        status: 'passed',
        detail: 'docs/dist/404.html is present',
      },
      {
        id: 'docs-search-index',
        status: 'passed',
        detail: 'docs/dist/search-index.json is present and parseable',
      },
      {
        id: 'public-doc-boundary',
        status: 'passed',
        detail: 'docs/dist excludes internal-only documentation directories',
      },
    ],
  };
}

function createWebReleaseArchiveFixture({
  bundleRoot = 'agent-studio-web-assets-release-2026-04-12-01',
  extraEntries = [],
} = {}) {
  return createTarGzArchive([
    {
      name: `${bundleRoot}/web/dist/index.html`,
      content: '<html><body><div id="root"></div><script src="/assets/index.js"></script></body></html>\n',
    },
    {
      name: `${bundleRoot}/web/dist/assets/index.js`,
      content: 'console.log("Agent Studio");\n',
    },
    {
      name: `${bundleRoot}/docs/dist/index.html`,
      content: '<html><body>Docs</body></html>\n',
    },
    {
      name: `${bundleRoot}/docs/dist/404.html`,
      content: '<html><body>Not found</body></html>\n',
    },
    {
      name: `${bundleRoot}/docs/dist/search-index.json`,
      content: `${JSON.stringify([
        {
          title: 'Getting Started',
          url: '/guide/getting-started',
          text: 'Start with Agent Studio',
        },
      ])}\n`,
    },
    ...extraEntries,
  ]);
}

function buildMacosDesktopInstallerSmokeReport({
  manifestPath,
  artifactRelativePaths,
} = {}) {
  return {
    platform: 'macos',
    arch: 'arm64',
    target: 'aarch64-apple-darwin',
    manifestPath,
    verifiedAt: '2026-04-12T01:02:03.000Z',
    installableArtifactRelativePaths: artifactRelativePaths,
    requiredCompanionArtifactRelativePaths: [
      'desktop/macos/arm64/Claw.Studio_0.1.0_arm64.app.zip',
    ],
    installPlanSummaries: [
      {
        relativePath: 'desktop/macos/arm64/Claw.Studio_0.1.0_arm64.app.zip',
        format: 'app',
        platform: 'macos',
        stepCount: 2,
      },
      {
        relativePath: 'desktop/macos/arm64/Claw.Studio_0.1.0_arm64.dmg',
        format: 'dmg',
        platform: 'macos',
        stepCount: 3,
      },
    ],
    checks: [],
  };
}

function buildMacosDesktopStartupSmokeChecks() {
  return [
    {
      id: 'startup-status',
      status: 'passed',
      detail: 'desktop startup evidence recorded a passed launch',
    },
    {
      id: 'startup-phase',
      status: 'passed',
      detail: 'desktop startup evidence recorded shell-mounted phase',
    },
    {
      id: 'runtime-readiness',
      status: 'passed',
      detail: 'desktop startup evidence preserved ready runtime invariants',
    },
    {
      id: 'built-in-instance',
      status: 'passed',
      detail: 'desktop startup evidence preserved the built-in OpenClaw instance projection',
    },
    {
      id: 'gateway-websocket',
      status: 'passed',
      detail: 'desktop startup evidence proved the OpenClaw gateway websocket was dialable',
    },
    {
      id: 'local-ai-proxy-runtime',
      status: 'passed',
      detail: 'desktop startup evidence preserved local ai proxy runtime lifecycle and artifact paths',
    },
  ];
}

function buildMacosDesktopStartupSmokeReport({
  manifestPath,
  capturedEvidenceRelativePath,
  artifactRelativePaths,
} = {}) {
  return {
    platform: 'macos',
    arch: 'arm64',
    target: 'aarch64-apple-darwin',
    status: 'passed',
    phase: 'shell-mounted',
    verifiedAt: '2026-04-12T01:02:03.000Z',
    manifestPath,
    capturedEvidenceRelativePath,
    packageProfileId: 'openclaw-only',
    includedKernelIds: ['openclaw'],
    defaultEnabledKernelIds: ['openclaw'],
    descriptorBrowserBaseUrl: 'http://127.0.0.1:19797',
    builtInInstanceId: 'managed-openclaw-primary',
    builtInInstanceStatus: 'online',
    localAiProxyRuntime: {
      lifecycle: 'running',
      messageCaptureEnabled: true,
      observabilityDbPath: '/Users/test/Library/Application Support/Agent Studio/store/local-ai-proxy-observability.sqlite3',
      snapshotPath: '/Users/test/Library/Application Support/Agent Studio/state/local-ai-proxy.snapshot.json',
      logPath: '/Users/test/Library/Logs/Agent Studio/local-ai-proxy.log',
    },
    artifactRelativePaths,
    checks: buildMacosDesktopStartupSmokeChecks(),
  };
}

function writeReadyReleaseFixture({
  releaseAssetsDir,
  profileId = 'agent-studio',
  releaseCoverage = {
    status: 'complete',
    allowPartialRelease: false,
    requiredTargets: ['web/web/any'],
    presentTargets: ['web/web/any'],
    missingTargets: [],
  },
  checksumFileName = 'SHA256SUMS.txt',
  artifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz',
  artifactContent = createWebReleaseArchiveFixture(),
} = {}) {
  const artifactPath = path.join(releaseAssetsDir, artifactRelativePath);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, artifactContent);
  const smokeManifestPath = path.join(releaseAssetsDir, 'web', 'release-asset-manifest.json');
  const smokeReportPath = path.join(releaseAssetsDir, 'web', 'release-smoke-report.json');
  const smokeMetadata = buildWebArchiveSmokeMetadata(artifactRelativePath);
  writeFileSync(
    smokeReportPath,
    `${JSON.stringify({
      family: 'web',
      platform: 'web',
      arch: 'any',
      target: smokeMetadata.target,
      smokeKind: smokeMetadata.smokeKind,
      status: smokeMetadata.status,
      verifiedAt: smokeMetadata.verifiedAt,
      manifestPath: smokeManifestPath,
      artifactRelativePaths: smokeMetadata.artifactRelativePaths,
      checks: smokeMetadata.checks,
    }, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    smokeManifestPath,
    '{}\n',
    'utf8',
  );
  Object.assign(
    smokeMetadata,
    commonSmokeEvidenceMetadata({
      reportPath: smokeReportPath,
      manifestPath: smokeManifestPath,
    }),
  );

  const artifactSha256 = fileSha256(artifactPath);
  const artifactSize = statSync(artifactPath).size;
  const releaseMetadata = [buildReleaseNotesMetadata(releaseAssetsDir)];
  writeFileSync(
    path.join(releaseAssetsDir, checksumFileName),
    [
      `${artifactSha256}  ${artifactRelativePath}`,
      ...releaseMetadata.map((entry) => `${entry.sha256}  ${entry.relativePath}`),
    ].join('\n') + '\n',
    'utf8',
  );
  writeFileSync(
    path.join(releaseAssetsDir, 'release-manifest.json'),
    `${JSON.stringify({
      profileId,
      productName: 'Agent Studio',
      releaseTag: 'release-2026-04-12-01',
      repository: 'sdkwork-ai/agent-studio',
      generatedAt: '2026-04-12T01:02:03.000Z',
      checksumFileName,
      releaseCoverage,
      releaseMetadata,
      artifacts: [
        {
          family: 'web',
          platform: 'web',
          arch: 'any',
          kind: 'archive',
          relativePath: artifactRelativePath,
          sha256: artifactSha256,
          size: artifactSize,
          webArchiveSmoke: smokeMetadata,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  writeAttestationEvidenceFixture({
    releaseAssetsDir,
    artifactRelativePath,
    artifactSha256,
    releaseMetadata,
  });
  writeReleaseManifestChecksumSidecar(releaseAssetsDir);
}

test('release readiness assertion accepts only complete finalized manifests with checksum-backed artifacts', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  assert.equal(existsSync(readinessPath), true, 'missing scripts/release/assert-release-readiness.mjs');

  const readiness = await import(pathToFileURL(readinessPath).href);
  assert.equal(typeof readiness.parseArgs, 'function');
  assert.equal(typeof readiness.assertReleaseReadiness, 'function');
  assert.throws(
    () => readiness.parseArgs(['--release-assets-dir']),
    /Missing value for --release-assets-dir/,
  );

  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });

    const result = readiness.assertReleaseReadiness({
      releaseAssetsDir,
      resolveReleaseProfileFn: resolveMinimalReleaseProfile,
    });

    assert.equal(result.releaseAssetsDir, releaseAssetsDir);
    assert.equal(result.manifestPath, path.join(releaseAssetsDir, 'release-manifest.json'));
    assert.equal(result.checksumPath, path.join(releaseAssetsDir, 'SHA256SUMS.txt'));
    assert.equal(result.artifactCount, 1);
    assert.equal(result.releaseMetadataCount, 1);
    assert.equal(result.requiredTargetCount, 1);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects release files that are not declared by the finalized manifest', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-unlisted-file-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    writeFileSync(path.join(releaseAssetsDir, 'untracked-debug.log'), 'debug output\n', 'utf8');

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release assets directory contains files not declared by release-manifest\.json: untracked-debug\.log/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects symlinked release entries that are not declared by the finalized manifest', async (t) => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-unlisted-symlink-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });

    try {
      symlinkSync(
        path.join(releaseAssetsDir, 'release-notes.md'),
        path.join(releaseAssetsDir, 'release-notes-link.md'),
        'file',
      );
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('current platform does not allow creating file symlinks');
        return;
      }
      throw error;
    }

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release assets directory contains unsupported filesystem entries not declared by release-manifest\.json: release-notes-link\.md/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects smoke metadata that references missing evidence files', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-smoke-evidence-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    rmSync(path.join(releaseAssetsDir, 'web', 'release-smoke-report.json'), { force: true });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest webArchiveSmoke metadata for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz references missing reportRelativePath: web\/release-smoke-report\.json/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects missing or drifted release metadata', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-release-metadata-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete manifest.releaseMetadata;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest is missing required releaseMetadata entry for release-notes\.md/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    rmSync(path.join(releaseAssetsDir, 'release-notes.md'), { force: true });
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Missing release metadata file: release-notes\.md/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    writeFileSync(path.join(releaseAssetsDir, 'release-notes.md'), '# Drifted notes\n', 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release metadata checksum mismatch for release-notes\.md/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects smoke metadata evidence paths that are not files', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-smoke-evidence-type-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    rmSync(path.join(releaseAssetsDir, 'web', 'release-asset-manifest.json'), { force: true });
    mkdirSync(path.join(releaseAssetsDir, 'web', 'release-asset-manifest.json'), { recursive: true });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest webArchiveSmoke metadata for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz references a non-file manifestRelativePath: web\/release-asset-manifest\.json/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects smoke metadata that drifts from referenced smoke reports', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-smoke-drift-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    const reportPath = path.join(releaseAssetsDir, 'web', 'release-smoke-report.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    writeFileSync(
      reportPath,
      `${JSON.stringify({ ...report, status: 'failed' }, null, 2)}\n`,
      'utf8',
    );
    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[0].webArchiveSmoke.reportSha256 = fileSha256(reportPath);
    manifest.artifacts[0].webArchiveSmoke.reportSize = statSync(reportPath).size;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest webArchiveSmoke metadata for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz does not match report status: expected passed, received failed/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects smoke evidence files whose hashes drift from finalized metadata', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-smoke-evidence-hash-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    const reportPath = path.join(releaseAssetsDir, 'web', 'release-smoke-report.json');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    writeFileSync(
      reportPath,
      `${JSON.stringify({ ...report, tamperedButFieldEquivalent: true }, null, 2)}\n`,
      'utf8',
    );

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest webArchiveSmoke metadata for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz reportSha256 mismatch/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects smoke metadata that omits evidence hash and size bindings', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-smoke-evidence-binding-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete manifest.artifacts[0].webArchiveSmoke.reportSha256;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest webArchiveSmoke metadata for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz is missing reportSha256/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifestWithoutSize = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete manifestWithoutSize.artifacts[0].webArchiveSmoke.manifestSize;
    writeFileSync(manifestPath, `${JSON.stringify(manifestWithoutSize, null, 2)}\n`, 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest webArchiveSmoke metadata for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz is missing manifestSize/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects missing or drifted release manifest checksum sidecars', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-manifest-sidecar-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    rmSync(path.join(releaseAssetsDir, 'release-manifest.json.sha256.txt'), { force: true });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Missing finalized release manifest checksum sidecar/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json.sha256.txt'),
      `${'0'.repeat(64)}  release-manifest.json\n`,
      'utf8',
    );
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest checksum sidecar mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ ...manifest, tamperedButParseable: true }, null, 2)}\n`,
      'utf8',
    );
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest checksum sidecar mismatch/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects missing or malformed attestation evidence when artifact attestations are enabled', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-attestation-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    rmSync(path.join(releaseAssetsDir, 'release-attestations.json'), { force: true });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Missing release attestation evidence/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    writeFileSync(
      path.join(releaseAssetsDir, 'release-attestations.json'),
      '{not-json',
      'utf8',
    );
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Unable to parse release attestation evidence/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    rmSync(path.join(releaseAssetsDir, 'release-attestations.json'), { force: true });
    mkdirSync(path.join(releaseAssetsDir, 'release-attestations.json'), { recursive: true });
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence is not a file/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects attestation evidence that does not bind every artifact to the manifest digest and release source', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-attestation-binding-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const evidencePath = path.join(releaseAssetsDir, 'release-attestations.json');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.artifacts = [];
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence is missing artifact verification for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const wrongDigestEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    wrongDigestEvidence.artifacts[0].sha256 = '0'.repeat(64);
    wrongDigestEvidence.artifacts[0].repository = 'sdkwork-ai/agent-studio';
    wrongDigestEvidence.artifacts[0].sourceRef = 'refs/tags/release-2026-04-12-01';
    wrongDigestEvidence.artifacts[0].predicateType = 'https://slsa.dev/provenance/v1';
    writeFileSync(evidencePath, `${JSON.stringify(wrongDigestEvidence, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence digest mismatch for web\/agent-studio-web-assets-release-2026-04-12-01\.tar\.gz/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const wrongRepositoryEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    wrongRepositoryEvidence.repository = 'Other-Owner/other-repo';
    wrongRepositoryEvidence.artifacts[0].repository = 'Other-Owner/other-repo';
    writeFileSync(evidencePath, `${JSON.stringify(wrongRepositoryEvidence, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence repository mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const unverifiedEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    unverifiedEvidence.artifacts[0].verified = false;
    writeFileSync(evidencePath, `${JSON.stringify(unverifiedEvidence, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence must be verified/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const wrongSourceEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    wrongSourceEvidence.artifacts[0].sourceRef = 'refs/heads/main';
    writeFileSync(evidencePath, `${JSON.stringify(wrongSourceEvidence, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence source ref mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const wrongPredicateEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    wrongPredicateEvidence.predicateType = 'https://example.com/not-slsa';
    wrongPredicateEvidence.artifacts[0].predicateType = 'https://example.com/not-slsa';
    writeFileSync(evidencePath, `${JSON.stringify(wrongPredicateEvidence, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence predicate type mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const wrongSignerIdentityEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    wrongSignerIdentityEvidence.signerWorkflowIdentity = 'Other-Owner/other-repo/.github/workflows/release-reusable.yml';
    wrongSignerIdentityEvidence.artifacts[0].signerWorkflowIdentity = 'Other-Owner/other-repo/.github/workflows/release-reusable.yml';
    writeFileSync(evidencePath, `${JSON.stringify(wrongSignerIdentityEvidence, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence signer workflow identity mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const missingSignerFlagEvidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    missingSignerFlagEvidence.artifacts[0].verificationCommand = missingSignerFlagEvidence.artifacts[0].verificationCommand.replace(
      ' --signer-workflow sdkwork-ai/agent-studio/.github/workflows/release-reusable.yml',
      '',
    );
    writeFileSync(evidencePath, `${JSON.stringify(missingSignerFlagEvidence, null, 2)}\n`, 'utf8');
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /must record signer workflow enforcement/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects attestation evidence that does not bind release metadata', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-metadata-attestation-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const evidencePath = path.join(releaseAssetsDir, 'release-attestations.json');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });
    const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
    evidence.artifacts = evidence.artifacts.filter(
      (entry) => entry.relativePath !== 'release-notes.md',
    );
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release attestation evidence is missing verification for release-notes\.md/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects attestation evidence file names that resolve outside the release assets directory', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-attestation-name-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        profileId: 'agent-studio',
        resolveReleaseProfileFn: resolveReleaseProfileWithAttestationEvidenceFileName('../release-attestations.json'),
      }),
      /Invalid release attestation evidence file name/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects missing, malformed, partial, or explicitly partial finalized manifests', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-reject-'));

  try {
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir: path.join(tempRoot, 'missing-assets'),
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Missing release assets directory/,
    );

    const releaseAssetsDir = path.join(tempRoot, 'release-assets');
    mkdirSync(releaseAssetsDir, { recursive: true });
    assert.throws(
      () => readiness.assertReleaseReadiness({ releaseAssetsDir }),
      /Missing finalized release manifest/,
    );

    writeFileSync(path.join(releaseAssetsDir, 'release-manifest.json'), '{not-json', 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Unable to parse finalized release manifest/,
    );

    rmSync(releaseAssetsDir, { recursive: true, force: true });
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({
      releaseAssetsDir,
      releaseCoverage: {
        status: 'partial',
        allowPartialRelease: true,
        requiredTargets: ['web/web/any'],
        presentTargets: [],
        missingTargets: ['web/web/any'],
      },
    });
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest is not publish-ready/,
    );

    writeReadyReleaseFixture({
      releaseAssetsDir,
      releaseCoverage: {
        status: 'complete',
        allowPartialRelease: true,
        requiredTargets: ['web/web/any'],
        presentTargets: ['web/web/any'],
        missingTargets: [],
      },
    });
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /was finalized with --allow-partial-release/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects checksum and artifact drift in finalized manifests', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-checksum-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });

    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      `${'0'.repeat(64)}  web/agent-studio-web-assets-release-2026-04-12-01.tar.gz\n`,
      'utf8',
    );
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Checksum manifest mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[0].sha256 = 'f'.repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Artifact checksum mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    rmSync(
      path.join(releaseAssetsDir, 'web', 'agent-studio-web-assets-release-2026-04-12-01.tar.gz'),
      { force: true },
    );
    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Missing release artifact/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion verifies present targets from artifact metadata', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-coverage-artifacts-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const artifactRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';
  const artifactContent = 'desktop-installer';
  const artifactSha256 = sha256(artifactContent);

  try {
    mkdirSync(path.join(releaseAssetsDir, 'desktop', 'windows', 'x64'), { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, artifactRelativePath),
      artifactContent,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      `${artifactSha256}  ${artifactRelativePath}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: 'SHA256SUMS.txt',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: ['desktop/windows/x64/nsis', 'web/web/any'],
          presentTargets: ['desktop/windows/x64/nsis', 'web/web/any'],
          missingTargets: [],
        },
        artifacts: [
          {
            family: 'desktop',
            platform: 'windows',
            arch: 'x64',
            kind: 'archive',
            relativePath: artifactRelativePath,
            sha256: artifactSha256,
            size: Buffer.byteLength(artifactContent),
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    completeManualReleaseManifest({
      releaseAssetsDir,
      checksumFileName: 'SHA256SUMS.txt',
      attestationEntries: [
        {
          kind: 'artifact',
          relativePath: artifactRelativePath,
          sha256: artifactSha256,
        },
      ],
    });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveDesktopOnlyReleaseProfile,
      }),
      /Release manifest artifact coverage does not match releaseCoverage.presentTargets/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects artifacts outside the active release profile', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-extra-artifacts-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const webArtifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz';
  const desktopArtifactRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';
  const webArtifactContent = 'web-assets';
  const desktopArtifactContent = 'desktop-installer';
  const webArtifactSha256 = sha256(webArtifactContent);
  const desktopArtifactSha256 = sha256(desktopArtifactContent);

  try {
    mkdirSync(path.join(releaseAssetsDir, 'web'), { recursive: true });
    mkdirSync(path.join(releaseAssetsDir, 'desktop', 'windows', 'x64'), { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, webArtifactRelativePath),
      webArtifactContent,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, desktopArtifactRelativePath),
      desktopArtifactContent,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      [
        `${webArtifactSha256}  ${webArtifactRelativePath}`,
        `${desktopArtifactSha256}  ${desktopArtifactRelativePath}`,
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: 'SHA256SUMS.txt',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: ['web/web/any'],
          presentTargets: ['web/web/any'],
          missingTargets: [],
        },
        artifacts: [
          {
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            relativePath: webArtifactRelativePath,
            sha256: webArtifactSha256,
            size: Buffer.byteLength(webArtifactContent),
          },
          {
            family: 'desktop',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            relativePath: desktopArtifactRelativePath,
            sha256: desktopArtifactSha256,
            size: Buffer.byteLength(desktopArtifactContent),
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    completeManualReleaseManifest({ releaseAssetsDir });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest contains artifacts outside the active release profile/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects duplicate artifacts for the same release target', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-duplicate-target-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const firstArtifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz';
  const secondArtifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-02.tar.gz';
  const firstArtifactContent = 'web-assets-one';
  const secondArtifactContent = 'web-assets-two';
  const firstArtifactSha256 = sha256(firstArtifactContent);
  const secondArtifactSha256 = sha256(secondArtifactContent);

  try {
    mkdirSync(path.join(releaseAssetsDir, 'web'), { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, firstArtifactRelativePath),
      firstArtifactContent,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, secondArtifactRelativePath),
      secondArtifactContent,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      [
        `${firstArtifactSha256}  ${firstArtifactRelativePath}`,
        `${secondArtifactSha256}  ${secondArtifactRelativePath}`,
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: 'SHA256SUMS.txt',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: ['web/web/any'],
          presentTargets: ['web/web/any'],
          missingTargets: [],
        },
        artifacts: [
          {
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            relativePath: firstArtifactRelativePath,
            sha256: firstArtifactSha256,
            size: Buffer.byteLength(firstArtifactContent),
          },
          {
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            relativePath: secondArtifactRelativePath,
            sha256: secondArtifactSha256,
            size: Buffer.byteLength(secondArtifactContent),
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    completeManualReleaseManifest({ releaseAssetsDir });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest contains multiple artifacts for the same release target/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion hashes artifacts in fixed-size chunks', () => {
  const readinessSource = readFileSync(
    path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs'),
    'utf8',
  );

  assert.match(
    readinessSource,
    /function computeSha256\(filePath\)[\s\S]*openSync[\s\S]*readSync[\s\S]*closeSync/,
    'release readiness must hash large artifacts with bounded memory usage',
  );
  assert.doesNotMatch(
    readinessSource,
    /createHash\('sha256'\)\.update\(readFileSync\(filePath\)\)/,
    'release readiness must not read whole release artifacts into memory for hashing',
  );
});

test('release readiness assertion rejects unsafe artifact paths on every host platform', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-paths-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    const artifactContent = 'unsafe-artifact';
    const unsafeArtifactRelativePath = 'C:/absolute/windows/path.tar.gz';
    const artifactSha256 = sha256(artifactContent);
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      `${artifactSha256}  web/agent-studio-web-assets-release-2026-04-12-01.tar.gz\n`,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: 'SHA256SUMS.txt',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: ['web/web/any'],
          presentTargets: ['web/web/any'],
          missingTargets: [],
        },
        artifacts: [
          {
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            relativePath: unsafeArtifactRelativePath,
            sha256: artifactSha256,
            size: artifactContent.length,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /unsafe artifact path/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[0].relativePath = '../escape.tar.gz';
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /unsafe artifact path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion requires canonical relative artifact paths in manifests and checksums', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-canonical-paths-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    const artifactContent = 'web-assets';
    const artifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz';
    const artifactSha256 = sha256(artifactContent);
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      `${artifactSha256}  ${artifactRelativePath}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: 'SHA256SUMS.txt',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: ['web/web/any'],
          presentTargets: ['web/web/any'],
          missingTargets: [],
        },
        artifacts: [
          {
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            relativePath: `./${artifactRelativePath}`,
            sha256: artifactSha256,
            size: artifactContent.length,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /non-canonical artifact path/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const artifact = manifest.artifacts[0];
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      `${artifact.sha256}  ./web/agent-studio-web-assets-release-2026-04-12-01.tar.gz\n`,
      'utf8',
    );

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /non-canonical checksum manifest artifact path/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects manifests for the wrong release profile or checksum contract', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-profile-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({
      releaseAssetsDir,
      profileId: 'another-profile',
    });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        profileId: 'agent-studio',
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest profile mismatch/,
    );

    writeReadyReleaseFixture({
      releaseAssetsDir,
      checksumFileName: 'checksums.txt',
    });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        profileId: 'agent-studio',
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest checksum file mismatch/,
    );

    writeReadyReleaseFixture({ releaseAssetsDir });
    const manifestPath = path.join(releaseAssetsDir, 'release-manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    delete manifest.checksumFileName;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        profileId: 'agent-studio',
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Release manifest checksum file mismatch/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects checksum file names that resolve outside the release assets directory', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-checksum-name-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    const artifactContent = 'web-assets';
    const artifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz';
    const artifactSha256 = sha256(artifactContent);
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: '..',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: ['web/web/any'],
          presentTargets: ['web/web/any'],
          missingTargets: [],
        },
        artifacts: [
          {
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            relativePath: artifactRelativePath,
            sha256: artifactSha256,
            size: artifactContent.length,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeReleaseManifestChecksumSidecar(releaseAssetsDir);

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        profileId: 'agent-studio',
        resolveReleaseProfileFn: resolveReleaseProfileWithChecksumFileName('..'),
      }),
      /Invalid release checksum file name/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects manifest checksum sidecar names that resolve outside the release assets directory', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-manifest-checksum-name-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({ releaseAssetsDir });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        profileId: 'agent-studio',
        resolveReleaseProfileFn: resolveReleaseProfileWithManifestChecksumFileName('../release-manifest.json.sha256.txt'),
      }),
      /Invalid release manifest checksum sidecar file name/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects finalized desktop manifests without required smoke metadata', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-desktop-smoke-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const desktopArtifactRelativePath = 'desktop/windows/x64/Claw.Studio_0.1.0_x64-setup.exe';
  const webArtifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz';
  const desktopArtifactContent = 'desktop-installer';
  const webArtifactContent = createWebReleaseArchiveFixture();
  const desktopArtifactSha256 = sha256(desktopArtifactContent);
  const webArtifactSha256 = createHash('sha256').update(webArtifactContent).digest('hex');

  try {
    mkdirSync(path.join(releaseAssetsDir, 'desktop', 'windows', 'x64'), { recursive: true });
    mkdirSync(path.join(releaseAssetsDir, 'web'), { recursive: true });
    writeFileSync(
      path.join(releaseAssetsDir, desktopArtifactRelativePath),
      desktopArtifactContent,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, webArtifactRelativePath),
      webArtifactContent,
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      [
        `${desktopArtifactSha256}  ${desktopArtifactRelativePath}`,
        `${webArtifactSha256}  ${webArtifactRelativePath}`,
        '',
      ].join('\n'),
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'desktop', 'windows', 'x64', 'installer-smoke-report.json'),
      `${JSON.stringify({
        platform: 'windows',
        arch: 'x64',
        target: 'x86_64-pc-windows-msvc',
        manifestPath: path.join(
          releaseAssetsDir,
          'desktop',
          'windows',
          'x64',
          'release-asset-manifest.json',
        ),
        verifiedAt: '2026-04-12T01:02:03.000Z',
        installableArtifactRelativePaths: [desktopArtifactRelativePath],
        requiredCompanionArtifactRelativePaths: [],
        installPlanSummaries: [
          {
            relativePath: desktopArtifactRelativePath,
            format: 'nsis',
            platform: 'windows',
            stepCount: 3,
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'desktop', 'windows', 'x64', 'release-asset-manifest.json'),
      '{}\n',
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'web', 'release-smoke-report.json'),
      '{}\n',
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'web', 'release-asset-manifest.json'),
      '{}\n',
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: 'SHA256SUMS.txt',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: ['desktop/windows/x64/nsis', 'web/web/any'],
          presentTargets: ['desktop/windows/x64/nsis', 'web/web/any'],
          missingTargets: [],
        },
        artifacts: [
          {
            family: 'desktop',
            platform: 'windows',
            arch: 'x64',
            kind: 'installer',
            relativePath: desktopArtifactRelativePath,
            sha256: desktopArtifactSha256,
            size: Buffer.byteLength(desktopArtifactContent),
            desktopInstallerSmoke: {
              reportRelativePath: 'desktop/windows/x64/installer-smoke-report.json',
              manifestRelativePath: 'desktop/windows/x64/release-asset-manifest.json',
              ...commonSmokeEvidenceMetadata({
                reportPath: path.join(
                  releaseAssetsDir,
                  'desktop',
                  'windows',
                  'x64',
                  'installer-smoke-report.json',
                ),
                manifestPath: path.join(
                  releaseAssetsDir,
                  'desktop',
                  'windows',
                  'x64',
                  'release-asset-manifest.json',
                ),
              }),
              verifiedAt: '2026-04-12T01:02:03.000Z',
              target: 'x86_64-pc-windows-msvc',
              installableArtifactRelativePaths: [desktopArtifactRelativePath],
              requiredCompanionArtifactRelativePaths: [],
              installPlanSummaries: [
                {
                  relativePath: desktopArtifactRelativePath,
                  format: 'nsis',
                  platform: 'windows',
                  stepCount: 3,
                },
              ],
            },
          },
          {
            family: 'web',
            platform: 'web',
            arch: 'any',
            kind: 'archive',
            relativePath: webArtifactRelativePath,
            sha256: webArtifactSha256,
            size: webArtifactContent.length,
            webArchiveSmoke: {
              ...buildWebArchiveSmokeMetadata(webArtifactRelativePath),
            },
          },
        ],
      }, null, 2)}\n`,
      'utf8',
    );
    completeManualReleaseManifest({ releaseAssetsDir });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveDesktopOnlyReleaseProfile,
      }),
      /Release manifest desktop artifact is missing desktopStartupSmoke/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects unsafe finalized macOS app archive companion entries', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-macos-app-archive-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');
  const desktopDir = path.join(releaseAssetsDir, 'desktop', 'macos', 'arm64');
  const webDir = path.join(releaseAssetsDir, 'web');
  const appArtifactRelativePath = 'desktop/macos/arm64/Claw.Studio_0.1.0_arm64.app.zip';
  const dmgArtifactRelativePath = 'desktop/macos/arm64/Claw.Studio_0.1.0_arm64.dmg';
  const webArtifactRelativePath = 'web/agent-studio-web-assets-release-2026-04-12-01.tar.gz';
  const smokeManifestRelativePath = 'desktop/macos/arm64/release-asset-manifest.json';
  const installerSmokeReportRelativePath = 'desktop/macos/arm64/installer-smoke-report.json';
  const startupSmokeReportRelativePath = 'desktop/macos/arm64/desktop-startup-smoke-report.json';
  const capturedEvidenceRelativePath = 'desktop/macos/arm64/diagnostics/desktop-startup-evidence.json';

  try {
    mkdirSync(desktopDir, { recursive: true });
    mkdirSync(webDir, { recursive: true });
    mkdirSync(path.join(desktopDir, 'diagnostics'), { recursive: true });
    const appArchive = createStoredZipArchive([
      {
        name: 'Agent Studio.app/Contents/MacOS/agent-studio',
        content: 'binary\n',
      },
      {
        name: 'Agent Studio.app/Contents/MacOS/agent-studio-link',
        content: 'agent-studio',
        externalAttributes: 0o120777 << 16,
      },
    ]);
    writeFileSync(path.join(releaseAssetsDir, appArtifactRelativePath), appArchive);
    writeFileSync(path.join(releaseAssetsDir, dmgArtifactRelativePath), 'dmg-image\n', 'utf8');
    writeFileSync(path.join(releaseAssetsDir, webArtifactRelativePath), 'web-assets\n', 'utf8');

    const desktopSmokeManifestPath = path.join(releaseAssetsDir, smokeManifestRelativePath);
    const installerSmokeReportPath = path.join(releaseAssetsDir, installerSmokeReportRelativePath);
    const startupSmokeReportPath = path.join(releaseAssetsDir, startupSmokeReportRelativePath);
    const capturedEvidencePath = path.join(releaseAssetsDir, capturedEvidenceRelativePath);
    const desktopArtifactRelativePaths = [
      appArtifactRelativePath,
      dmgArtifactRelativePath,
    ];
    const installerSmokeReport = buildMacosDesktopInstallerSmokeReport({
      manifestPath: desktopSmokeManifestPath,
      artifactRelativePaths: desktopArtifactRelativePaths,
    });
    const startupSmokeReport = buildMacosDesktopStartupSmokeReport({
      manifestPath: desktopSmokeManifestPath,
      capturedEvidenceRelativePath,
      artifactRelativePaths: desktopArtifactRelativePaths,
    });
    writeFileSync(desktopSmokeManifestPath, '{}\n', 'utf8');
    writeFileSync(installerSmokeReportPath, `${JSON.stringify(installerSmokeReport, null, 2)}\n`, 'utf8');
    writeFileSync(startupSmokeReportPath, `${JSON.stringify(startupSmokeReport, null, 2)}\n`, 'utf8');
    writeFileSync(
      capturedEvidencePath,
      `${JSON.stringify({
        version: 2,
        status: 'passed',
        phase: 'shell-mounted',
        recordedAt: '2026-04-12T01:02:03.000Z',
      }, null, 2)}\n`,
      'utf8',
    );

    const webSmokeManifestPath = path.join(webDir, 'release-asset-manifest.json');
    const webSmokeReportPath = path.join(webDir, 'release-smoke-report.json');
    const webSmokeMetadata = buildWebArchiveSmokeMetadata(webArtifactRelativePath);
    writeFileSync(webSmokeManifestPath, '{}\n', 'utf8');
    writeFileSync(
      webSmokeReportPath,
      `${JSON.stringify({
        family: 'web',
        platform: 'web',
        arch: 'any',
        target: webSmokeMetadata.target,
        smokeKind: webSmokeMetadata.smokeKind,
        status: webSmokeMetadata.status,
        verifiedAt: webSmokeMetadata.verifiedAt,
        manifestPath: webSmokeManifestPath,
        artifactRelativePaths: webSmokeMetadata.artifactRelativePaths,
        checks: webSmokeMetadata.checks,
      }, null, 2)}\n`,
      'utf8',
    );
    Object.assign(
      webSmokeMetadata,
      commonSmokeEvidenceMetadata({
        reportPath: webSmokeReportPath,
        manifestPath: webSmokeManifestPath,
      }),
    );

    const desktopInstallerSmoke = {
      reportRelativePath: installerSmokeReportRelativePath,
      manifestRelativePath: smokeManifestRelativePath,
      ...commonSmokeEvidenceMetadata({
        reportPath: installerSmokeReportPath,
        manifestPath: desktopSmokeManifestPath,
      }),
      verifiedAt: installerSmokeReport.verifiedAt,
      target: installerSmokeReport.target,
      installableArtifactRelativePaths: installerSmokeReport.installableArtifactRelativePaths,
      requiredCompanionArtifactRelativePaths: installerSmokeReport.requiredCompanionArtifactRelativePaths,
      installPlanSummaries: installerSmokeReport.installPlanSummaries,
      checks: installerSmokeReport.checks,
    };
    const desktopStartupSmoke = {
      reportRelativePath: startupSmokeReportRelativePath,
      manifestRelativePath: smokeManifestRelativePath,
      capturedEvidenceRelativePath,
      ...commonSmokeEvidenceMetadata({
        reportPath: startupSmokeReportPath,
        manifestPath: desktopSmokeManifestPath,
      }),
      ...fileEvidenceMetadata(capturedEvidencePath, 'capturedEvidence'),
      verifiedAt: startupSmokeReport.verifiedAt,
      target: startupSmokeReport.target,
      status: startupSmokeReport.status,
      phase: startupSmokeReport.phase,
      packageProfileId: startupSmokeReport.packageProfileId,
      includedKernelIds: startupSmokeReport.includedKernelIds,
      defaultEnabledKernelIds: startupSmokeReport.defaultEnabledKernelIds,
      descriptorBrowserBaseUrl: startupSmokeReport.descriptorBrowserBaseUrl,
      builtInInstanceId: startupSmokeReport.builtInInstanceId,
      builtInInstanceStatus: startupSmokeReport.builtInInstanceStatus,
      localAiProxyRuntime: startupSmokeReport.localAiProxyRuntime,
      artifactRelativePaths: startupSmokeReport.artifactRelativePaths,
      checks: startupSmokeReport.checks,
    };
    const appArtifactSha256 = fileSha256(path.join(releaseAssetsDir, appArtifactRelativePath));
    const dmgArtifactSha256 = fileSha256(path.join(releaseAssetsDir, dmgArtifactRelativePath));
    const webArtifactSha256 = fileSha256(path.join(releaseAssetsDir, webArtifactRelativePath));
    const artifacts = [
      {
        family: 'desktop',
        platform: 'macos',
        arch: 'arm64',
        kind: 'archive',
        relativePath: appArtifactRelativePath,
        sha256: appArtifactSha256,
        size: statSync(path.join(releaseAssetsDir, appArtifactRelativePath)).size,
        desktopInstallerSmoke,
        desktopStartupSmoke,
      },
      {
        family: 'desktop',
        platform: 'macos',
        arch: 'arm64',
        kind: 'dmg',
        relativePath: dmgArtifactRelativePath,
        sha256: dmgArtifactSha256,
        size: statSync(path.join(releaseAssetsDir, dmgArtifactRelativePath)).size,
        desktopInstallerSmoke,
        desktopStartupSmoke,
      },
      {
        family: 'web',
        platform: 'web',
        arch: 'any',
        kind: 'archive',
        relativePath: webArtifactRelativePath,
        sha256: webArtifactSha256,
        size: statSync(path.join(releaseAssetsDir, webArtifactRelativePath)).size,
        webArchiveSmoke: webSmokeMetadata,
      },
    ];
    writeFileSync(
      path.join(releaseAssetsDir, 'SHA256SUMS.txt'),
      artifacts.map((artifact) => `${artifact.sha256}  ${artifact.relativePath}`).join('\n') + '\n',
      'utf8',
    );
    writeFileSync(
      path.join(releaseAssetsDir, 'release-manifest.json'),
      `${JSON.stringify({
        profileId: 'agent-studio',
        productName: 'Agent Studio',
        releaseTag: 'release-2026-04-12-01',
        repository: 'sdkwork-ai/agent-studio',
        generatedAt: '2026-04-12T01:02:03.000Z',
        checksumFileName: 'SHA256SUMS.txt',
        releaseCoverage: {
          status: 'complete',
          allowPartialRelease: false,
          requiredTargets: [
            'desktop/macos/arm64/app',
            'desktop/macos/arm64/dmg',
            'web/web/any',
          ],
          presentTargets: [
            'desktop/macos/arm64/app',
            'desktop/macos/arm64/dmg',
            'web/web/any',
          ],
          missingTargets: [],
        },
        artifacts,
      }, null, 2)}\n`,
      'utf8',
    );
    completeManualReleaseManifest({ releaseAssetsDir });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMacosDesktopOnlyReleaseProfile,
      }),
      /Finalized macOS desktop app companion archive contains unsupported archive entry type/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion rejects unsafe finalized web archive entries', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-web-archive-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({
      releaseAssetsDir,
      artifactContent: createWebReleaseArchiveFixture({
        extraEntries: [
          {
            name: 'agent-studio-web-assets-release-2026-04-12-01/web/dist/assets/index-link.js',
            content: 'index.js',
            type: '2',
          },
        ],
      }),
    });

    assert.throws(
      () => readiness.assertReleaseReadiness({
        releaseAssetsDir,
        resolveReleaseProfileFn: resolveMinimalReleaseProfile,
      }),
      /Finalized web archive contains unsupported archive entry type/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('release readiness assertion verifies coverage against the release profile, not the manifest self-claim', async () => {
  const readinessPath = path.join(rootDir, 'scripts', 'release', 'assert-release-readiness.mjs');
  const readiness = await import(pathToFileURL(readinessPath).href);
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'claw-release-ready-profile-coverage-'));
  const releaseAssetsDir = path.join(tempRoot, 'release-assets');

  try {
    mkdirSync(releaseAssetsDir, { recursive: true });
    writeReadyReleaseFixture({
      releaseAssetsDir,
      releaseCoverage: {
        status: 'complete',
        allowPartialRelease: false,
        requiredTargets: ['web/web/any'],
        presentTargets: ['web/web/any'],
        missingTargets: [],
      },
    });

    assert.throws(
      () => readiness.assertReleaseReadiness({ releaseAssetsDir, profileId: 'agent-studio' }),
      /Release manifest coverage does not match profile/,
    );
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
