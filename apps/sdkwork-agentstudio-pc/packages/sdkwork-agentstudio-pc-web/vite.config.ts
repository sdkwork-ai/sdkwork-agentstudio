import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { createSdkworkCredentialEntryBootstrapVitePlugin } from '@sdkwork/iam-credential-entry/vite';
import {
  isSharedSdkSourceMode,
  resolvePnpmPackageDistEntry,
} from '../../scripts/shared-sdk-mode.mjs';
import { resolveCanonicalWorkspaceRootDir } from '../../scripts/workspace-root.mjs';
import {
  CLAW_VITE_DEDUPE_PACKAGES,
  createClawManualChunks,
  resolveClawModulePreloadDependencies,
} from '../../scripts/viteBuildOptimization.ts';
import {
  remapWorktreeWorkspaceImport,
  resolveWorkspacePackageAliases,
  shouldEnableWorktreeWorkspaceResolver,
  shouldAttemptWorkspaceResolverRemap,
} from '../../scripts/viteWorkspaceResolver.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function workspacePackageResolver(packagesRootDir: string) {
  const resolutionCache = new Map<string, string | null>();

  return {
    name: 'workspace-package-resolver',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (!shouldAttemptWorkspaceResolverRemap(source, importer, packagesRootDir)) {
        return null;
      }

      const cacheKey = `${source}\u0000${importer ?? ''}`;
      if (resolutionCache.has(cacheKey)) {
        return resolutionCache.get(cacheKey);
      }

      const resolved = remapWorktreeWorkspaceImport(source, importer, packagesRootDir);

      resolutionCache.set(cacheKey, resolved);
      return resolved;
    },
  };
}

export default defineConfig(({ mode }) => {
  const useSharedSdkSourceMode = isSharedSdkSourceMode(process.env);
  // Allow pnpm workspace-linked SDK packages that live above apps/agent-studio.
  const workspaceRootDir = path.resolve(__dirname, '../..');
  const canonicalWorkspaceRootDir = resolveCanonicalWorkspaceRootDir(workspaceRootDir);
  const env = loadEnv(mode, workspaceRootDir, '');
  const bootstrapAccessToken = env.SDKWORK_ACCESS_TOKEN ?? process.env.SDKWORK_ACCESS_TOKEN;
  const monorepoRoot = path.resolve(canonicalWorkspaceRootDir, '../..');
  const packagesRootDir = path.resolve(__dirname, '../../packages');
  const workspacePackageAliases = resolveWorkspacePackageAliases(packagesRootDir);
  const enableWorktreeWorkspaceResolver = shouldEnableWorktreeWorkspaceResolver(
    workspaceRootDir,
    process.env,
  );
  const sharedAppbaseAppSdkSourceEntry = path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-iam/sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript/src/index.ts',
  );
  const sharedMessagingAppSdkSourceEntry = path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-messaging/sdks/sdkwork-messaging-app-sdk/sdkwork-messaging-app-sdk-typescript/src/index.ts',
  );
  const sharedSdkCommonSourceEntry = path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-sdk-commons/sdkwork-sdk-common-typescript/src/index.ts',
  );
  const sharedAppbaseAppSdkDistEntry = resolvePnpmPackageDistEntry('@sdkwork/iam-app-sdk', workspaceRootDir) ?? path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-iam/sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript/src/index.ts',
  );
  const sharedMessagingAppSdkDistEntry = resolvePnpmPackageDistEntry('@sdkwork/messaging-app-sdk', workspaceRootDir) ?? path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-messaging/sdks/sdkwork-messaging-app-sdk/sdkwork-messaging-app-sdk-typescript/src/index.ts',
  );
  const sharedSdkCommonDistEntry = resolvePnpmPackageDistEntry('@sdkwork/sdk-common', workspaceRootDir) ?? path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-sdk-commons/sdkwork-sdk-common-typescript/dist/index.js',
  );
  const sdkworkAuthRuntimePcReactEntry = path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-iam/apps/sdkwork-iam-pc/packages/sdkwork-auth-runtime-pc-react/src/index.ts',
  );
  const sdkworkAuthPcReactAuthServiceEntry = path.resolve(
    canonicalWorkspaceRootDir,
    '../sdkwork-iam/apps/sdkwork-iam-pc/packages/sdkwork-auth-pc-react/src/auth-service.ts',
  );
  const sdkworkAuthPcReactShimEntry = path.resolve(
    __dirname,
    './shims/sdkworkAuthPcReact.ts',
  );
  const sdkworkUserPcReactShimEntry = path.resolve(
    __dirname,
    './shims/sdkworkUserPcReact.ts',
  );
  const sharedAppbaseAppSdkChunkEntry = useSharedSdkSourceMode
    ? sharedAppbaseAppSdkSourceEntry
    : sharedAppbaseAppSdkDistEntry;
  const sharedMessagingAppSdkChunkEntry = useSharedSdkSourceMode
    ? sharedMessagingAppSdkSourceEntry
    : sharedMessagingAppSdkDistEntry;
  const sharedSdkCommonChunkEntry = useSharedSdkSourceMode
    ? sharedSdkCommonSourceEntry
    : sharedSdkCommonDistEntry;

  return {
    envDir: workspaceRootDir,
    plugins: [
      // The bootstrap credential reaches the renderer only through the shared IAM
      // plugin (dev-server HTML injection as
      // `globalThis.__SDKWORK_CREDENTIAL_ENTRY_BOOTSTRAP_ACCESS_TOKEN__`).
      // `define['process.env.SDKWORK_ACCESS_TOKEN']` is NOT a valid handoff
      // (IAM_CREDENTIAL_ENTRY_SPEC.md section 4/5).
      createSdkworkCredentialEntryBootstrapVitePlugin({
        accessToken: bootstrapAccessToken,
        environment: resolveViteEnvironment(mode, process.env),
      }),
      ...(enableWorktreeWorkspaceResolver
        ? [workspacePackageResolver(packagesRootDir)]
        : []),
      react(),
      tailwindcss(),
    ],
    resolve: {
      dedupe: [...CLAW_VITE_DEDUPE_PACKAGES],
      alias: [
        { find: '@sdkwork/auth-runtime-pc-react', replacement: sdkworkAuthRuntimePcReactEntry },
        { find: '@sdkwork/auth-pc-react/auth-service', replacement: sdkworkAuthPcReactAuthServiceEntry },
        { find: /^@sdkwork\/auth-pc-react$/, replacement: sdkworkAuthPcReactShimEntry },
        { find: /^@sdkwork\/user-pc-react$/, replacement: sdkworkUserPcReactShimEntry },
        { find: '@', replacement: path.resolve(__dirname, '.') },
        ...workspacePackageAliases,
        ...(useSharedSdkSourceMode
          ? [
              { find: '@sdkwork/iam-app-sdk', replacement: sharedAppbaseAppSdkSourceEntry },
              { find: '@sdkwork/messaging-app-sdk', replacement: sharedMessagingAppSdkSourceEntry },
              { find: '@sdkwork/sdk-common', replacement: sharedSdkCommonSourceEntry },
            ]
          : [
              { find: '@sdkwork/iam-app-sdk', replacement: sharedAppbaseAppSdkDistEntry },
              { find: '@sdkwork/messaging-app-sdk', replacement: sharedMessagingAppSdkDistEntry },
              { find: '@sdkwork/sdk-common', replacement: sharedSdkCommonDistEntry },
            ]),
      ],
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      fs: {
        allow: [monorepoRoot],
      },
    },
    build: {
      modulePreload: {
        resolveDependencies: (_filename, deps, context) =>
          resolveClawModulePreloadDependencies(deps, context),
      },
      rollupOptions: {
        output: {
          manualChunks: createClawManualChunks({
            appbaseAppSdkEntry: sharedAppbaseAppSdkChunkEntry,
            messagingAppSdkEntry: sharedMessagingAppSdkChunkEntry,
            sdkCommonEntry: sharedSdkCommonChunkEntry,
          }),
        },
      },
    },
  };
});
