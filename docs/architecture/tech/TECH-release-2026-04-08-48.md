> Migrated from `docs/release/release-2026-04-08-48.md` on 2026-06-24.
> Owner: SDKWork maintainers

## Highlights

- Step 03 advanced `CP03-4` and preserved desktop startup-evidence descriptor loopback-only truth through the shared kernel/runtime contract.
- `Kernel Center` now shows the persisted startup descriptor loopback-only flag in addition to the previously published startup summary fields.
- Fresh targeted plus gate-level verification remained green.

## Attempt Outcome

- The loop repaired the next missing `CP03-4` shell-facing evidence link:
  - the raw desktop startup-evidence document already contained descriptor `loopbackOnly`
  - the desktop kernel publication summary dropped that descriptor exposure field before shell consumption
  - `Kernel Center` therefore lost whether the startup snapshot represented a loopback-only bind, even though the producer already persisted that fact
- Implemented the narrow repairs:
  - added `descriptorLoopbackOnly` to the desktop kernel startup-evidence summary contract
  - parsed and normalized that field in the desktop kernel service
  - extended the shared TypeScript runtime contract and `kernelCenterService` dashboard mapping
  - added the `Kernel Center` presentation row and locale copy for the new field
- Fresh verification:
  - `node --experimental-strip-types packages/sdkwork-agentstudio-pc-settings/src/kernelCenter.test.ts`
  - `node --experimental-strip-types packages/sdkwork-agentstudio-pc-settings/src/services/kernelCenterService.test.ts`
  - `cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml --target-dir <home>\.codex\memories\target-step03-cp034-startup-evidence-descriptor-loopback-red desktop_kernel_info_exposes_persisted_startup_evidence_summary`
  - `pnpm.cmd check:desktop-openclaw-runtime`
  - `pnpm.cmd check:desktop`

## Change Scope

- `packages/sdkwork-agentstudio-pc-desktop/src-tauri/src/framework/kernel.rs`
- `packages/sdkwork-agentstudio-pc-desktop/src-tauri/src/framework/services/kernel.rs`
- `packages/sdkwork-agentstudio-pc-desktop/src-tauri/src/commands/desktop_kernel.rs`
- `packages/sdkwork-agentstudio-pc-infrastructure/src/platform/contracts/runtime.ts`
- `packages/sdkwork-agentstudio-pc-settings/src/services/kernelCenterService.ts`
- `packages/sdkwork-agentstudio-pc-settings/src/services/kernelCenterService.test.ts`
- `packages/sdkwork-agentstudio-pc-settings/src/KernelCenter.tsx`
- `packages/sdkwork-agentstudio-pc-settings/src/kernelCenter.test.ts`
- `packages/sdkwork-agentstudio-pc-i18n/src/locales/en/settings.json`
- `packages/sdkwork-agentstudio-pc-i18n/src/locales/zh/settings.json`
- `docs/review/step-03-kernel-center-startup-evidence-descriptor-loopback-only-convergence-2026-04-08.md`
- `docs/架构/133-2026-04-08-desktop-startup-evidence-descriptor-loopback-owner.md`
- `docs/review/step-03-执行卡-2026-04-07.md`
- `docs/release/release-2026-04-08-48.md`
- `docs/release/releases.json`

## Verification Focus

- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-settings/src/kernelCenter.test.ts`
- `node --experimental-strip-types packages/sdkwork-agentstudio-pc-settings/src/services/kernelCenterService.test.ts`
- `cargo test --manifest-path packages/sdkwork-agentstudio-pc-desktop/src-tauri/Cargo.toml --target-dir <home>\.codex\memories\target-step03-cp034-startup-evidence-descriptor-loopback-red desktop_kernel_info_exposes_persisted_startup_evidence_summary`
- `pnpm.cmd check:desktop-openclaw-runtime`
- `pnpm.cmd check:desktop`

## Risks And Rollback

- The shell now depends on the published startup descriptor loopback-only field remaining aligned with the raw desktop startup-evidence producer.
- This loop intentionally keeps startup-evidence parsing inside the desktop kernel layer and does not broaden shell ownership.
- Rollback is limited to the startup-evidence publication contract, `Kernel Center` mapping/presentation, locale copy, and the corresponding document writebacks.

