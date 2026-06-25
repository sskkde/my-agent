# Workdir Architecture

This document explains how user session workdirs work internally: storage schema, path resolution, and how workdir context flows through the system.

## Overview

Each user gets isolated, managed file storage. The model can read/write files inside the selected workdir without approval. Shell execution still requires approval. Arbitrary host paths are not supported.

## Storage Tables

Two tables back the workdir feature (migration `022_create_workdir_tables.sql`):

### `work_directories`

Stores user-owned workdir records.

```sql
CREATE TABLE work_directories (
  id TEXT PRIMARY KEY,           -- UUID
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,            -- Human-readable name (e.g., "default")
  path TEXT NOT NULL,            -- Absolute filesystem path
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,               -- Soft-delete marker (null = active)
  metadata TEXT                  -- JSON metadata (reserved)
);

CREATE INDEX idx_work_directories_user ON work_directories(tenant_id, user_id);
CREATE INDEX idx_work_directories_deleted ON work_directories(tenant_id, user_id, deleted_at);
```

- Scoped by `(tenant_id, user_id)`. Cross-user queries return nothing.
- Soft-delete: `deleted_at` is null for active records, ISO string for deleted.
- `path` is the absolute filesystem path. API responses never expose raw paths to the model.

### `session_workdir_state`

Maps sessions to their active workdir.

```sql
CREATE TABLE session_workdir_state (
  tenant_id TEXT NOT NULL DEFAULT 'org_default',
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  active_work_dir_id TEXT NOT NULL REFERENCES work_directories(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, user_id, session_id)
);
```

- Composite PK: one active workdir per (tenant, user, session).
- `getActive` uses INNER JOIN to `work_directories` so deleted workdirs are automatically excluded.
- `setActive` uses ON CONFLICT upsert for idempotent updates.
- Ownership is validated before writing: the workdir must exist, belong to the user, and not be soft-deleted.

## Path Resolver (`src/workdirs/workdir-paths.ts`)

Pure path primitives. No tool execution logic lives here.

### Root Resolution

`getWorkdirRoot()` resolves the canonical workdir root:

1. Check `WORKDIR_ROOT` env var (trimmed, non-empty)
2. Fall back to `./data/workdirs` relative to cwd
3. Create directory if missing (idempotent `mkdirSync`)
4. Canonicalize via `realpathSync`
5. Cache the result

The cache is reset in tests via `resetWorkdirRootCache()`.

### Path Construction

`buildWorkdirPath(root, userId, workdirId)` produces `<root>/<userId>/<workdirId>`.

Both IDs are sanitized before construction:
- Max 128 characters
- Alphanumeric, hyphens, underscores only
- Must start/end with alphanumeric
- No path traversal (`..`, `/`, `\`), null bytes, or absolute paths

### Safety Checks

`validateWorkdirPath(candidate, root)` runs four checks in order:

1. Reject raw `..` segments
2. Resolve and verify the canonical path is inside root
3. If path is a symlink, verify target is also inside root
4. Check depth does not exceed `WORKDIR_MAX_DEPTH` (3 from root)

Returns a discriminated union: `{ ok: true, canonicalPath, relativePath }` or `{ ok: false, error: { code, message } }`.

`isWithinWorkdir(candidate, root)` is a simpler boolean check used by the permission engine's carve-out logic.

### Quota Constants

Defined here but enforced by the service layer:

| Constant | Value |
|----------|-------|
| `WORKDIR_QUOTA_BYTES` | 1 GiB (1,073,741,824 bytes) |
| `WORKDIR_MAX_NAME_LENGTH` | 128 characters |
| `WORKDIR_MAX_DEPTH` | 3 (root/user/workdir) |

## Workdir Service (`src/workdirs/workdir-service.ts`)

Orchestrates store operations and filesystem mutations.

### Key Behaviors

- **Idempotent default creation**: `createDefaultWorkdir(userId)` returns existing default if present, creates one if not.
- **DB-first, filesystem-second**: Creates DB row, then attempts `mkdir`. On mkdir failure, soft-deletes the DB row and throws typed error. This prevents orphaned active rows without filesystem backing.
- **Soft-delete is DB-only**: `softDeleteWorkdir` marks the DB row but never deletes physical files.
- **Quota pre-check**: Validates path depth before any disk mutation.

### Quota Config

```typescript
interface WorkdirQuotaConfig {
  maxBytes: number   // Default: 1 GiB
  maxFiles: number   // Default: 100,000
  maxDepth: number   // Default: 10
}
```

### Local User Handling

`local-user` is treated as a single deterministic user ID. No special branching; just consistent identity resolution.

## Context Threading

The workdir context flows through six layers to reach tool handlers:

```
Gateway → Processor → ForegroundAgent → Kernel → Dispatcher → ToolExecutor
```

### Layer-by-Layer

1. **Gateway** (`assembleHydratedState`): Looks up active workdir for the session. If none exists, creates a default via `workdirService.createDefaultWorkdir()`, then sets it as active. Result stored in `HydratedSessionState.activeWorkdir`.

2. **Processor**: Extracts `workDirRoot`, `workDirId`, `workDirName` from hydrated state into `ForegroundTurnInput`.

3. **ForegroundAgent**: Receives turn input, forwards `workDirRoot` and `workDirId` into `KernelRunInput`. Also adds workdir name to `ContextBundle` as a pinned system note so the model knows which workdir it's operating in.

4. **Kernel**: Passes `workDirRoot` and `workDirId` through to `ToolDispatchRequest`.

5. **Dispatcher/Adapter**: Extracts workdir fields from the dispatch request payload into `ToolExecutionRequest`.

6. **ToolExecutor**: Receives `workDirRoot` and `workDirId` in `ToolExecutionContext`. Passes them to tool handlers.

### Context Bundle (Model Visibility)

The model sees only the workdir **name** (not the path, not the ID, not other users' directories). This is injected as a pinned `system_note` with `constraint` semantic type:

```
You are working in the "default" workdir.
```

The name is safe to show. Paths and IDs are internal implementation details.

### Permission Carve-Out

The permission engine has a carve-out for file-tree tools inside the active workdir:

- Insertion point: after `hard_deny` and restricted mode checks, before existing grants and approval flow
- For `file_read`, `file_write`, `file_edit`, `file_glob`, `file_grep`, `file_apply_patch`: if the resource path is inside `workDirRoot`, auto-allow without approval
- `exec`, `code_execution`, and other execution tools are **not** carved out; they follow the standard approval flow

### Subagent Inheritance

Subagents inherit the parent's workdir context through `ContextBundle`. The subagent adapter reads `workDirRoot` and `workDirId` from the bundle and threads them into the subagent's kernel run.

## Security Boundaries

- Path traversal (`../`) rejected at the path resolver level
- Symlink escape detection (target must also be inside root)
- Cross-user isolation enforced by `(tenant_id, user_id)` scoping in all store queries
- Raw absolute paths never exposed in API responses or model context
- No sandbox: tools run in the same environment as the agent. The workdir feature scopes file operations, not execution.
