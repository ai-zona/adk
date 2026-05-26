# @aizona/contracts-workspace-architect

Day-0 contracts substrate for the Workspace Architect feature
(spec: `docs/superpowers/specs/2026-04-25-conversational-workspace-architect.md`).

## Why this exists

The Workspace Architect feature ships as 9 parallel implementation
streams (A–I). Without a frozen contracts package, each stream would
re-derive types and accidentally drift. This package is the single
source of truth that every stream imports.

## What's inside

| Module | Purpose | Owner stream |
|---|---|---|
| `prisma/workspace-architect.prisma` | Draft Prisma schema additions | Stream A copies + applies |
| `src/manifest/types.ts` | WorkspaceManifest TypeScript types | C, D, G consume |
| `src/manifest/zod.ts` | WorkspaceManifest Zod validators | C, D consume |
| `src/events/ws.ts` | WebSocket broadcast event types | E, G consume |
| `src/events/hydrator.ts` | Hydrator step events + budgets | C emits, E broadcasts |
| `src/ipc/protocol.ts` | Sandbox runner ↔ host IPC types | B owns both sides |
| `src/capabilities/identifiers.ts` | Canonical capability IDs | All streams |
| `src/rpc/workspace-architect.ts` | Architect router signatures | D implements |
| `src/rpc/workspace-channel.ts` | Channel router signatures | E implements |
| `src/rpc/workspace-entitlement.ts` | Entitlement router signatures | F implements |

## Versioning policy

- This package is `0.1.0`. Backward-incompatible changes during the
  feature build phase bump the patch version; streams pull the new
  patch and fix any drift.
- Once shipped to production, contracts are append-only. Adding a new
  field to a Zod schema with `.optional()` is allowed; removing or
  renaming a field requires a new versioned module path.
- The `apiVersion: "aizona.dev/v1"` literal in the manifest is the
  outer wire-protocol version; bump to `v2` only with a coordinated
  hydrator migration.

## How streams consume

Streams import via the deep paths declared in `package.json` `exports`:

```ts
import { workspaceManifestSchema, type WorkspaceManifest } from "@aizona/contracts-workspace-architect/manifest";
import { ipcMessageSchema } from "@aizona/contracts-workspace-architect/ipc";
import { CAPABILITY_IDS } from "@aizona/contracts-workspace-architect/capabilities";
```

The flat `from "@aizona/contracts-workspace-architect"` import is the
public re-export for convenience.

## Adding a contract

1. Open this README and the spec.
2. Decide which module the new type belongs in.
3. Write the type + Zod (if it crosses a trust boundary) + a test.
4. Bump `package.json` `version` patch.
5. Notify the orchestrator on the stream channel that the contract
   amendment landed; orchestrator re-runs the validator on every
   in-progress stream PR.

## Validator integration

The `code-reviewer` validator agent runs after each wave and checks:
- Every stream PR's public exports match the contracts package
  exactly (no surprise drift in field names, optional flags, types).
- No stream has imported a deep path that doesn't exist.
- No stream has duplicated a type defined here.

If validator finds drift, the stream PR is rejected; the stream owner
either updates the stream or files a contracts amendment.
