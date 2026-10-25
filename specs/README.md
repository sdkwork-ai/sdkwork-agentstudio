# Agent Studio Component Specs

This directory is the local standards index for `agent-studio`.

Root SDKWork standards remain authoritative. Local component specs can narrow or document this component, but they must not contradict [the root standards](../../sdkwork-specs/README.md).

## Component

| Field | Value |
| --- | --- |
| Name | `agent-studio` |
| Type | `app` |
| Root | `agent-studio` |
| Domain | `system` |
| Capability | `component` |
| Languages | `typescript` |
| Status | `ACTIVE` |

## Contract Manifest

- [component.spec.json](./component.spec.json) is the machine-readable component contract.
- Consumers should integrate through public exports, runtime entrypoints, SDK clients, or adapters declared in the manifest.
- Generated SDK language outputs are represented at their SDK family root instead of duplicating local specs in generated folders.

## Canonical Specs

| Spec | Applies Because |
| --- | --- |
| [APP_MANIFEST_SPEC.md](../../sdkwork-specs/APP_MANIFEST_SPEC.md) | agent.app.config.json application registration rules. |
| [APPLICATION_SPEC.md](../../sdkwork-specs/APPLICATION_SPEC.md) | Application shell and module composition. |
| [APP_SDK_INTEGRATION_SPEC.md](../../sdkwork-specs/APP_SDK_INTEGRATION_SPEC.md) | App SDK composition, appbase IAM runtime, and dependency SDK boundary rules. |
| [COMPONENT_SPEC.md](../../sdkwork-specs/COMPONENT_SPEC.md) | Local component specs directory and manifest rules. |
| [CONFIG_SPEC.md](../../sdkwork-specs/CONFIG_SPEC.md) | Runtime configuration, environment, SDK bootstrap, and feature flag rules. |
| [DEPLOYMENT_SPEC.md](../../sdkwork-specs/DEPLOYMENT_SPEC.md) | SaaS/private/local runtime parity and deployment rules. |
| [DOCUMENTATION_SPEC.md](../../sdkwork-specs/DOCUMENTATION_SPEC.md) | Module README, examples, ADR, changelog, and runbook rules. |
| [DOMAIN_SPEC.md](../../sdkwork-specs/DOMAIN_SPEC.md) | Canonical domain ownership and naming. |
| [FRONTEND_SPEC.md](../../sdkwork-specs/FRONTEND_SPEC.md) | UI, service, SDK, accessibility, and frontend runtime rules. |
| [GOVERNANCE_SPEC.md](../../sdkwork-specs/GOVERNANCE_SPEC.md) | Standard ownership, exception, compatibility, and migration rules. |
| [I18N_SPEC.md](../../sdkwork-specs/I18N_SPEC.md) | User-facing language, locale, message catalog, and fallback rules. |
| [MODULE_SPEC.md](../../sdkwork-specs/MODULE_SPEC.md) | Reusable package contract and dependency direction. |
| [README.md](../../sdkwork-specs/README.md) | SDKWork root standards entrypoint. |
| [SDK_SPEC.md](../../sdkwork-specs/SDK_SPEC.md) | SDK generation and SDK integration rules. |
| [TEST_SPEC.md](../../sdkwork-specs/TEST_SPEC.md) | Contract, frontend, SDK, security, parity, and documentation verification rules. |
| [CODE_STYLE_SPEC.md](../../sdkwork-specs/CODE_STYLE_SPEC.md) | Authored source structure and generated code boundaries. |
| [NAMING_SPEC.md](../../sdkwork-specs/NAMING_SPEC.md) | Canonical SDKWork naming rules. |
| [TYPESCRIPT_CODE_SPEC.md](../../sdkwork-specs/TYPESCRIPT_CODE_SPEC.md) | TypeScript and Node package rules. |

## Public Exports

- Public exports are not declared in the package manifest.

## Dependency SDK Clients

- `@sdkwork/iam-app-sdk` from `../sdkwork-iam/sdks/sdkwork-iam-app-sdk/sdkwork-iam-app-sdk-typescript/generated/server-openapi`.
- `@sdkwork/drive-app-sdk` from `../sdkwork-drive/sdks/sdkwork-drive-app-sdk/sdkwork-drive-app-sdk-typescript`.
- `@sdkwork/messaging-app-sdk` from `../sdkwork-messaging/sdks/sdkwork-messaging-app-sdk/sdkwork-messaging-app-sdk-typescript/generated/server-openapi`.
- `@sdkwork/local-api-proxy` from `../sdkwork-local-router/packages/pc-react/intelligence/sdkwork-local-api-proxy`.

## Local Architecture Narrowing Rules

These rules narrow global SDKWork standards for this application root. They must not contradict `../sdkwork-specs/`.

### Package Layering

This is a `pnpm` workspace rooted at `apps/sdkwork-agentstudio-pc/packages/*`. Dependency flow: `web/desktop → shell → feature → (core + infrastructure + types + ui)`.

- `sdkwork-agentstudio-pc-web`: browser host (Vite, routing, providers, platform bootstrap).
- `sdkwork-agentstudio-pc-desktop`: Tauri desktop host (native commands, platform adapters, runtime entry).
- `sdkwork-agentstudio-pc-shell`: application shell (layout, router, providers).
- `sdkwork-agentstudio-pc-types`: shared entities and types.
- `sdkwork-agentstudio-pc-infrastructure`: HTTP/config/platform adapters.
- `sdkwork-agentstudio-pc-core`: shared services, hooks, stores, SDK client wiring.
- `sdkwork-agentstudio-pc-i18n`: locale bootstrap.
- `sdkwork-agentstudio-pc-ui`: reusable UI components.
- Feature packages (`sdkwork-agentstudio-pc-chat`, `sdkwork-agentstudio-pc-settings`, etc.): keep `src/components`, `src/pages`, and `src/services` as minimum boundaries.

Cross-package APIs must be consumed from the package root only. Do not import from package-internal subpaths. Business `services`, `stores`, or `hooks` must not live inside `sdkwork-agentstudio-pc-web/src` or `sdkwork-agentstudio-pc-desktop/src`.

### Coding Conventions

TypeScript and React function components with hooks. 2-space indentation, semicolons, grouped imports. Components/pages use `PascalCase.tsx`; services/utilities use `camelCase.ts`; Zustand hooks use `useXStore.ts`. Internal workspace packages are scoped as `@sdkwork/agentstudio-pc-xxx` in kebab-case.

### Testing

Logic-heavy tests are colocated with source as `*.test.ts` or `*.test.tsx`. Run `pnpm lint` and `pnpm build` before PR. New behavior requires a focused test or clear manual verification note. Authority: `../sdkwork-specs/TEST_SPEC.md`.

### Commit Guidelines

Conventional Commits (`feat:`, `docs:`, etc.). Each commit scoped to one package or architectural concern. PRs include summary, affected packages, verification commands, and linked issues.

### Security

Never commit secrets. Start from `.env.example`. `GEMINI_API_KEY` is required for AI endpoints. `SDKWORK_ACCESS_TOKEN` is optional for protected API bootstrap. Document every new environment variable. Authority: `../sdkwork-specs/SECURITY_SPEC.md`, `../sdkwork-specs/ENVIRONMENT_SPEC.md`.

## Local Extension Specs

- No local extension specs are declared yet.

## Verification

- `pnpm --filter @sdkwork/agentstudio-workspace build`
