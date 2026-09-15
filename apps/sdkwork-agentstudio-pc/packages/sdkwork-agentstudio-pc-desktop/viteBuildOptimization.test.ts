// WORKSPACE-PATH:allow-fixture - this file is a test fixture that simulates a foreign
// checkout root, so the sdkwork-<name> segment below is the value under assertion rather
// than a binding to a real sibling checkout. PORTABILITY_SPEC.md section 5.2 governs it.
import assert from 'node:assert/strict';

import {
  DESKTOP_DEDUPE_PACKAGES,
  createDesktopManualChunks,
  resolveDesktopModulePreloadDependencies,
} from './viteBuildOptimization.ts';

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

runTest('desktop build optimization keeps core shared runtime in stable chunks', () => {
  const manualChunks = createDesktopManualChunks({
    appbaseAppSdkEntry: 'C:/repo/shared-appbase-sdk/index.ts',
    messagingAppSdkEntry: 'C:/repo/shared-messaging-sdk/index.ts',
    sdkCommonEntry: 'C:/repo/shared-sdk-common/index.ts',
  });

  assert.equal(
    manualChunks(
      'C:/repo/apps/agent-studio/packages/sdkwork-agentstudio-pc-infrastructure/src/platform/registry.ts',
    ),
    'claw-infrastructure',
  );
  assert.equal(
    manualChunks(
      'C:/repo/apps/agent-studio/packages/sdkwork-agentstudio-pc-infrastructure/src/platform/webStudio.ts',
    ),
    'claw-platform-web-studio',
  );
  assert.equal(
    manualChunks(
      'C:/repo/apps/agent-studio/packages/sdkwork-agentstudio-pc-i18n/src/index.ts',
    ),
    'claw-i18n-runtime',
  );
  assert.equal(
    manualChunks(
      'C:/repo/apps/agent-studio/packages/sdkwork-agentstudio-pc-i18n/src/locales/en/index.ts',
    ),
    'claw-i18n-en',
  );
  assert.equal(
    manualChunks(
      'C:/repo/apps/agent-studio/packages/sdkwork-agentstudio-pc-i18n/src/locales/zh/index.ts',
    ),
    'claw-i18n-zh',
  );
  assert.equal(
    manualChunks('C:/repo/shared-appbase-sdk/index.ts'),
    'sdkwork-iam-app-sdk',
  );
  assert.equal(
    manualChunks('C:/repo/shared-messaging-sdk/api/client.ts'),
    'sdkwork-messaging-app-sdk',
  );
  assert.equal(
    manualChunks('C:/repo/shared-sdk-common/http/index.ts'),
    'sdkwork-sdk-common',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/react-dom/client.js'),
    'react-vendor',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/react-router-dom/dist/index.js'),
    'app-router',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/@tanstack/react-query/build/modern/index.js'),
    'app-state',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/@radix-ui/react-dialog/dist/index.js'),
    'app-ui',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/@tiptap/core/dist/index.js'),
    'community-editor',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/react-markdown/index.js'),
    'markdown-runtime',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/react-syntax-highlighter/dist/esm/prism-light.js'),
    'markdown-runtime',
  );
  assert.equal(
    manualChunks('C:/repo/node_modules/lodash-es/lodash.js'),
    undefined,
  );
});

runTest('desktop build optimization filters heavy optional chunks from html module preload', () => {
  const resolved = resolveDesktopModulePreloadDependencies(
    [
      'assets/react-vendor.js',
      'assets/app-router.js',
      'assets/community-editor.js',
      'assets/markdown-runtime.js',
      'assets/feature-chat.js',
    ],
    { hostType: 'html' },
  );

  assert.deepEqual(
    resolved,
    ['assets/react-vendor.js', 'assets/app-router.js', 'assets/feature-chat.js'],
  );
  assert.deepEqual(
    resolveDesktopModulePreloadDependencies(['assets/community-editor.js'], {
      hostType: 'js',
    }),
    ['assets/community-editor.js'],
  );
});

runTest('desktop build optimization exposes dedupe packages for shared singleton dependencies', () => {
  assert.deepEqual(DESKTOP_DEDUPE_PACKAGES, [
    'react',
    'react-dom',
    'buffer',
    'base64-js',
    'ieee754',
    'wukongimjssdk',
    'bignumber.js',
    'crypto-js',
    'curve25519-js',
    'md5-typescript',
    '@sdkwork/agentstudio-pc-infrastructure',
    '@sdkwork/agentstudio-pc-i18n',
    '@sdkwork/sdk-common',
  ]);
});
