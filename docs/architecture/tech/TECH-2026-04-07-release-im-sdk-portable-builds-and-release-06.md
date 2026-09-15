> Migrated from `docs/step/2026-04-07-release-im-sdk-portable-builds-and-release-06.md` on 2026-06-24.
> Owner: SDKWork maintainers

# Release IM SDK Portable Builds And Release 06

## Objective

- Close the final `Verify release inputs` blocker that remained after `release-2026-04-07-05`.
- Keep local development on relative sibling SDK repositories while ensuring release automation uses pinned GitHub refs only.
- Record the clean-room debugging loop, the code changes, and the final verification evidence for the next release candidate.

## Problems Found

1. `release-2026-04-07-05` was documented as published even though the GitHub Actions release run failed and no successful GitHub Release publication was confirmed.
2. In a clean-room Agent Studio workspace, `pnpm sdk:prepare-shared` only built `@sdkwork/sdk-common` and `retired generic app SDK package`, leaving the IM TypeScript packages without `dist` type output even though `@sdkwork/core-pc-react` imports them during `pnpm lint`.
3. On Windows, `scripts/prepare-shared-sdk-packages.mjs` assumed `.pnpm` virtual-store directories always kept the full package name prefix, which breaks when pnpm's virtual store shortens long directory names.
4. Even after IM package roots were materialized, `sdkwork-ai/sdkwork-im-sdk` still failed in the clean-room release workspace because the TypeScript `composed` and `adapter-wukongim` packages invoked `vite` and `tsc` through hard-coded `../../../node_modules/*` paths.
5. The first Agent Studio pin update used an incorrect full Git SHA for the new IM SDK commit, which parity verification correctly rejected before release.

## Root Cause Evidence

### Clean-room reproduction

1. A fresh workspace clone under `<device-state-dir>\\claw-release-repro` reproduced the release-only failure path instead of relying on the existing multi-repo local environment.
2. Before any fixes, `pnpm sdk:prepare-shared` in that clean room failed on Windows because `resolveWorkspaceInstalledPackageRoot()` could not find `@typescript-eslint/eslint-plugin` once pnpm's virtual store shortened the `.pnpm` directory name.
3. After fixing that resolver, the same clean room advanced to the GitHub-matching failure: `pnpm lint` reported missing modules for:
   - `@sdkwork/im-sdk`
   - `@sdkwork/rtc-sdk`
4. Direct inspection showed those packages existed in the workspace, but their `package.json` files pointed `types` and runtime exports at `dist/*`, and those `dist` outputs were absent because `prepare:shared-sdk` had never built them.

### IM package portability evidence

1. After extending `prepare-shared-sdk-packages.mjs` to build the IM/RTC package chain, the next clean-room failure moved into the legacy realtime adapter package.
2. That package failed with a missing monorepo-local `vite` path, proving the build script depended on one specific repository directory layout instead of package-local tool resolution.
3. Updating the IM TypeScript package scripts to `vite build` and `tsc -p tsconfig.build.json --noEmit`, plus explicit `devDependencies`, made both packages build successfully in the Agent Studio workspace.
4. The portable IM SDK fix was committed and pushed to `sdkwork-ai/sdkwork-im-sdk` as `c71a0f115c08cb164d5a857cdac15ea6d3adc006`.

### Pin verification evidence

1. `node scripts/check-shared-sdk-release-parity.mjs` initially failed after the pin update because the first full SHA written into `config/shared-sdk-release-sources.json` was incorrect.
2. Resolving the exact remote commit with `git rev-parse HEAD` in the IM SDK repository yielded `c71a0f115c08cb164d5a857cdac15ea6d3adc006`.
3. After correcting the pin, shared SDK release parity passed for all six release-governed package roots.

## Changes Landed

### Agent Studio workspace

- Extended `scripts/prepare-shared-sdk-packages.mjs` to:
  - expose IM package roots in the shared SDK context
  - repair package-local dependency links for the IM packages
  - build `@sdkwork/im-sdk`
  - build `@sdkwork/rtc-sdk`
- Hardened `resolveWorkspaceInstalledPackageRoot()` so it can recover packages from shortened `.pnpm` virtual-store directory names.
- Added and updated regression coverage in:
  - `scripts/release-flow-contract.test.mjs`
  - `scripts/sdkwork-core-contract.test.ts`
- Updated `pnpm-lock.yaml` so the external IM workspace importers now record the new package-local `devDependencies`.
- Advanced the IM release pin in `config/shared-sdk-release-sources.json` to `c71a0f115c08cb164d5a857cdac15ea6d3adc006`.

### External IM SDK repository

- Updated `sdkwork-im-sdk-typescript/package.json` to use portable package-local build scripts plus explicit build `devDependencies`.
- Published the minimal fix on `main` with commit:
  - `c71a0f115c08cb164d5a857cdac15ea6d3adc006`

### Release documentation

- Corrected `release-2026-04-07-05` to a failed unpublished attempt.
- Added `release-2026-04-07-06` as the next carried-forward release candidate.
- Recorded this debugging and verification loop in `/docs/step`.

## Verification

Fresh commands run in this loop:

```bash
node scripts/release-flow-contract.test.mjs
node --experimental-strip-types scripts/sdkwork-core-contract.test.ts
node scripts/check-shared-sdk-release-parity.mjs
pnpm lint
pnpm check:desktop
pnpm check:server
pnpm build
pnpm build:server
pnpm docs:build
```

Observed result:

1. All release contract and shared SDK parity checks passed.
2. `pnpm lint` passed after the IM SDK pin and shared SDK preparation fixes.
3. `pnpm check:desktop` and `pnpm check:server` both passed.
4. `pnpm build`, `pnpm build:server`, and `pnpm docs:build` all passed.
5. A clean-room reproduction under `<device-state-dir>\\claw-release-repro` advanced past the original IM SDK failure and consumed the pinned IM SDK commit `c71a0f115c08cb164d5a857cdac15ea6d3adc006`.

## Status

- The release documentation is now consistent with the observed April 7 history.
- The next release candidate is `release-2026-04-07-06`.
- Remaining operational work: commit Agent Studio changes, push `main`, create the new release tag, and confirm the GitHub Release succeeds before marking `release-2026-04-07-06` as published.

