# Task 12: docs/ + final hardening — Document configuration/security and run full targeted gates

## Status: COMPLETE (verified 2026-06-27)

---

## What Was Done

### 1. docs/features/browser-handoff.md (pre-existing, verified complete)

The file already existed with 287 lines covering all required sections:

- **Feature overview** (lines 1-16): Ownership state machine, SSE frame streaming, CloakBrowser integration
- **Enabling/disabling** (lines 34-78): Prerequisites, env vars (`CLOAKBROWSER_HEADLESS`, `CLOAKBROWSER_PROXY`, etc.), graceful fallback when binary absent
- **Security considerations** (lines 180-202): Local-only default, no raw CDP exposure, input validation (normalized 0..1 coordinates), lease isolation, no cross-session data leakage
- **Screenshot privacy** (lines 104-112): No frame data persisted to DB/logs/timeline by default, in-memory only, released on session close
- **Resource limits** (lines 82-100): Max 5 sessions, 5 min idle timeout, 1280x720 viewport, JPEG quality 50, ~81ms capture, ~8KB per frame
- **Known limitations** (lines 235-252): 8 documented limitations

### 2. docs/deployment/env-reference.md (pre-existing, verified complete)

The CloakBrowser section already existed (lines 989-1113) with all 7 env vars documented:

| Variable | Default | Status |
|----------|---------|--------|
| `CLOAKBROWSER_HEADLESS` | `true` | Documented |
| `CLOAKBROWSER_PROXY` | — | Documented |
| `CLOAKBROWSER_HUMANIZE` | `false` | Documented |
| `CLOAKBROWSER_GEOIP` | `false` | Documented |
| `CLOAKBROWSER_TIMEZONE` | — | Documented |
| `CLOAKBROWSER_LOCALE` | — | Documented |
| `CLOAKBROWSER_ARGS` | — | Documented |

Also includes: resource limits table (lines 1093-1106), performance reference (lines 1107-1111), quick reference table entry (lines 1211-1223), cross-link to feature docs (line 1112).

### 3. README.md (pre-existing, verified consistent)

The "Visual Browser Handoff" section (lines 566-613) already existed and is consistent with feature docs:

- How it works (ownership state machine, SSE streaming)
- Quick setup (install command, env var)
- Key security properties (local-only, no CDP, no persistence, session isolation, lease-based input)
- Resource limits table
- Link to full docs

---

## Verification Gates (2026-06-27)

| Gate | Command | Result | Notes |
|------|---------|--------|-------|
| Backend typecheck | `npm run typecheck` | PRE-EXISTING ERRORS ONLY | All errors in `mcp-servers/minimax-document-mcp/` (pptxgenjs, jszip, exceljs modules not found). Zero errors in `src/` or browser-handoff code. |
| Frontend typecheck | `npm --prefix web run typecheck` | **PASS** | Clean, zero errors |
| Frontend tests | `npm --prefix web test` | **111/113 files pass, 2292/2303 tests pass** | 2 pre-existing failures: `AgentShell.test.tsx` (3), `ContextDeskPanel.test.tsx` (8). All 36 BrowserHandoffPanel tests pass. |
| Frontend build | `npm run build:web` | **PASS** | Built in 7.01s, 157 modules, no errors |

### Pre-existing Failures (unrelated to browser handoff)

- `src/layout/AgentShell.test.tsx`: 3 failures in "Context Desk Integration" tests
- `src/features/context/ContextDeskPanel.test.tsx`: 8 failures in rendering tests
- `mcp-servers/minimax-document-mcp/`: TypeScript errors for missing npm modules (pptxgenjs, jszip, exceljs)

### Browser Handoff Tests: ALL PASS

- `src/components/__tests__/BrowserHandoffPanel.test.tsx`: **36 tests passed** (coordinate scaling, keyboard focus, SSE frame subscription, scroll input, cleanup)

---

## Security Properties Documented

- No raw CDP (Chrome DevTools Protocol) exposure
- Local-only by default (headless on same machine as API)
- No debug port exposed, no remote DevTools connection
- Screenshot frames: in-memory only, streamed over SSE, discarded after
- Each session gets isolated BrowserContext (cookies, storage, cache)
- Coordinates normalized to 0..1, out-of-range rejected
- Lease-based input control with automatic TTL expiry (60s)

---

## No Code Changes Required

This was a docs-only task. All documentation (env-reference.md CloakBrowser section, README.md Visual Browser Handoff section, docs/features/browser-handoff.md) was already complete and consistent from prior tasks. Verification gates confirm no regressions.

---

## Commit

Message: `docs(browser): document visual handoff setup and security`
