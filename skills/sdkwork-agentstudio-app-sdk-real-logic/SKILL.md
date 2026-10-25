---
name: agent-studio-app-sdk-real-logic
description: Guides Agent Studio onto SDKWork v3 app SDK composition. Use when integrating or repairing remote business modules so they consume declared dependency SDKs or typed product client ports instead of infrastructure raw HTTP.
---

# Agent Studio App SDK Real Logic

## Overview

Drive `apps/agent-studio` to the current remote-business path:

`host / feature package / store -> core service -> declared dependency SDK or typed product app client port -> approved runtime/composed client`

Keep Tauri, filesystem, process, and device work on native boundaries. Route remote business capability through declared dependency SDKs such as appbase, drive, and messaging, or through explicit product ports backed by the runtime app client. If a product SDK family is introduced later, close the application-root SDK family contract first, regenerate through the standard generator, then return and delete the temporary port gap.

Treat every round as a recursive closure loop: self-review the touched app or client code, decide whether the next fix belongs in app or frontend code, backend or service code, or generator inputs, regenerate the SDK when contracts move, then review again until no higher-value gap remains.

## Progressive Loading

- Start with this file only.
- Load `references/architecture-map.md` only when boundary ownership or wrapper placement is unclear.
- Load `../../../SDK_INTEGRATION_STANDARD.md` only when client lifecycle, env keys, or token rules matter.
- Load `../../prompt/execute.md` or `../../AGENTS.md` only when app workflow or scripts are unclear.
- Load `references/verification.md` only before claiming the round is complete.

## Hard Rules

- Use `agent.app.config.json`, `specs/component.spec.json`, and application-root `sdks/` as the contract source for remote business capability.
- Consume appbase, drive, messaging, and local-router through their declared dependency SDKs or host adapters.
- When Agent Studio lacks a product SDK family for a remote method, expose a narrow typed product port and require runtime/composed client injection instead of inventing transport code.
- If the shared wrapper is incomplete, finish it in the approved core layer before editing feature packages.
- Keep Tauri, local files, shell commands, and device adapters out of the app SDK path.
- Replace `@sdkwork/agentstudio-pc-infrastructure` business HTTP with the wrapper path. Do not add raw `fetch`, generic HTTP helpers, manual auth headers, mock branches, or app-local SDK forks.
- Never hand-edit generated SDK output. Fix backend or generator inputs, then regenerate.
- Any table, column, index, migration, or embedded DB schema change requires user confirmation first.

## Default Loop

1. Classify the target as remote-business, local-native, or mixed.
2. Audit for raw HTTP, duplicated DTO mapping, manual headers, mock branches, or stale infrastructure shortcuts.
3. Verify the declared dependency SDK export, typed product port, or approved composed wrapper surface.
4. If the method exists, refactor to the standard wrapper path and delete the bypass.
5. If the method is missing from an owned product SDK family, close the gap in the application-root contract and backend modules, regenerate the SDK, then finish the app integration.
6. If gap closure needs any schema change, stop and ask the user before touching DB structure.
7. Self-review the touched path. If a better next fix still belongs in app or frontend code, backend or service code, generator inputs, or adjacent cleanup, keep iterating instead of stopping at the first pass.
8. Run verification, then rescan adjacent packages and one extra global pass.

## Red Flags

- `@sdkwork/agentstudio-pc-infrastructure` business HTTP for app APIs
- raw `fetch(`, `axios.`, or generic HTTP helpers
- manual `Authorization` or `Access-Token` assignment
- app-local SDK forks, DTO shims, or unapproved schema edits

## Completion Bar

- Remote business modules use declared dependency SDKs, typed product ports, or generated product SDKs.
- Local-only features still stay on the correct native boundary.
- No raw HTTP, manual header, mock bypass, or temporary fallback remains.
- Missing contracts are closed in backend/OpenAPI/generator inputs, and no schema change happened without approval.
- Relevant package checks, builds, and host verification pass.
