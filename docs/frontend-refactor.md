# Frontend Refactor Documentation

This document describes the multi-round frontend refactor plan to transform the admin-oriented UI into an Agent Workspace with warm-paper visual influence.

## Development Commands

All frontend commands are run from the project root:

```bash
# Start frontend development server (runs on port 3002)
npm run dev:web

# Build frontend for production
npm run build:web

# Run frontend tests
npm run test:web
```

## Three-Round Roadmap

The frontend refactor is executed in three distinct rounds, each with clear boundaries and objectives.

### Round 1 — Safe Visible Foundation

**Goal**: Make the product visibly become an Agent Workspace while preserving core behavior.

**Includes**:

- Baseline inventory and test snapshot
- Warm-paper-inspired CSS variables and scoped shell styles
- Minimal UI primitives used only by new Round 1 components
- AgentShell compatibility wrapper (preserves existing `AppShell`)
- Product navigation mapping: Chat / Workspace / Operations / Admin
- Default landing on Chat / Session Workspace
- SessionWorkspace wrapper around existing session console
- ComposerDock surface using existing send behavior and selectors
- Focused tests and Round 1 documentation

**Explicitly excludes**:

- Deep `SessionConsoleTab` hook extraction
- Full React Router migration
- Full Context Desk data integration
- Backend/API/database changes
- Copying openhanako fonts, images, textures, or brand assets

### Round 2 — Workspace Composition + Context Desk

**Goal**: Complete the information architecture and bring secondary product surfaces into the new shell.

**Includes**:

- Context Desk panel with approval, memory, run status, and tool activity cards
- Empty/error states where session-scoped APIs are missing
- Workspace / Operations / Admin container pages
- Secondary navigation for old tab surfaces
- Responsive drawer behavior for Context Desk and product navigation
- Additional integration tests and smoke tests

**Still excludes**:

- Deep SSE/timeline refactor unless Round 1 evidence proves stable
- Removing legacy tab compatibility

### Round 3 — Deep Refactor + Routing

**Goal**: Improve long-term maintainability and deep-linking after UI shell risk is retired.

**Includes**:

- Gradual `SessionConsoleTab` extraction into hooks and presentation components
- Full React Router routes: `/chat`, `/chat/:sessionId`, `/workspace/:tabId`, `/operations/:tabId`, `/admin/:tabId`
- Session URL synchronization with `session-console-selected-session` migration guard
- Playwright end-to-end coverage for chat, mobile, navigation, reload, and SSE degradation
- Legacy shell/navigation cleanup only after evidence-backed approval

## Round 1 Guardrails

Round 1 implementation adheres to strict guardrails to minimize regression risk:

### Must NOT Do

- **No deep `SessionConsoleTab` extraction**: The session console component contains complex SSE, timeline merge, command handling, optimistic messages, streaming draft, and mobile behavior. Deep refactoring is deferred to Round 3.

- **No full React Router migration**: While `react-router-dom` is installed, full routing implementation belongs in Round 3. Round 1 focuses on visible UI transformation.

- **No backend/API/database changes**: All refactoring stays within the frontend layer. No changes to API contracts, database schema, or backend services.

- **No openhanako asset copying**: The reference project `liliMozi/openhanako` serves as design inspiration only. No fonts, images, textures, icons, or brand-specific files are copied. Only warm-paper design tokens and principles are adapted.

- **No new npm dependencies**: Round 1 works within existing dependencies to minimize risk and review burden.

### Must Preserve

- **Existing test selectors**: All `data-testid` values used by tests must remain available. New components may add aliases, but old selectors cannot be removed or renamed.

- **localStorage keys**: The `session-console-selected-session` key must remain unchanged.

- **Chinese labels**: All existing Chinese UI labels are preserved unless an explicit product-label task is approved.

- **CSS approach**: Keep styling in plain CSS/CSS variables. No Tailwind or CSS-in-JS migration in Round 1.

- **Package manager**: Use `npm` exclusively because `package-lock.json` exists.

## Design Reference

The warm-paper visual direction is inspired by the [openhanako](https://github.com/liliMozi/openhanako) project, specifically the warm-paper theme tokens. Key principles:

- **Palette**: Warm, muted tones inspired by paper and ink
- **Typography**: System fonts only, no custom font files
- **Effects**: CSS-only visual effects, no texture overlays or video backgrounds
- **Approach**: Adapt design tokens and principles, never copy assets

## Current Architecture

The frontend is built with:

- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite
- **Styling**: Plain CSS with CSS variables
- **Testing**: Vitest + Testing Library for unit tests, Playwright for e2e
- **Navigation**: `activeTab`/switch rendering in `App.tsx` (React Router migration planned for Round 3)

The current UI is admin/sidebar oriented. Round 1 transforms this into an Agent Workspace while maintaining backward compatibility with existing features and tests.

## Evidence and Progress

Implementation progress and baseline evidence is tracked in:

- `.omo/evidence/round1-baseline.md` — Baseline command/test/selector/navigation inventory
- `.omo/evidence/task-*.txt` — Per-task verification evidence

The detailed implementation plan lives in `.omo/plans/frontend-refactor-round1.md` (read-only, maintained by the orchestrator).

---

## Round 1 Completion Summary

**Status:** COMPLETE (2026-06-07)

### Final Verification Results

| Command             | Status | Details                           |
| ------------------- | ------ | --------------------------------- |
| `npm run build:web` | PASS   | 94 modules, 119.47 kB CSS, 1.84s  |
| `npm run test:web`  | PASS   | 60 test files, 1042 tests, 95.37s |

### Round 1 Deliverables

**Layout Architecture:**

- `AgentShell` (web/src/layout/AgentShell.tsx) subsumes the planned `LeftRail` functionality
- AgentShell provides: product navigation bar, shell layout, sidebar, topbar, content area
- No separate LeftRail component needed — AgentShell handles all layout concerns

**Design Tokens:**

- 35+ warm-paper CSS custom properties added to `web/src/styles.css`
- Namespaced with `--warm-paper-` prefix
- No external assets (fonts, images, textures)

**UI Primitives:**

- `web/src/components/ui/Button.tsx` + tests (12 tests)
- `web/src/components/ui/Card.tsx` + tests (9 tests)
- `web/src/components/ui/Badge.tsx`
- `web/src/components/ui/TextArea.tsx`
- `web/src/components/ui/EmptyState.tsx` (re-exported)
- `web/src/components/ui/index.ts` (barrel exports)

**Product Navigation:**

- `web/src/navigation/product-navigation.ts` — TabId to ProductSection mapping
- Four sections: Chat, Workspace, Operations, Admin
- 14 tests verifying complete coverage

**AgentShell:**

- `web/src/layout/AgentShell.tsx` + tests (23 tests)
- Product navigation bar with four sections
- Backward compatibility: `data-testid="app-shell"` preserved
- New selectors: `agent-shell`, `center-stage`, `product-nav`

**SessionWorkspace:**

- `web/src/features/session/SessionWorkspace.tsx` + tests (9 tests)
- Lightweight wrapper around SessionConsoleTab
- Default landing changed from dashboard to session-console
- All existing selectors preserved

**ComposerDock:**

- `web/src/components/ComposerDock.tsx` + tests (22 tests)
- Textarea-based message input
- Enter sends, Shift+Enter creates newline
- Empty message blocking
- Preserves `session-message-input` and `session-send-button` selectors

### Selector Compatibility

All baseline selectors preserved:

- `data-testid="app-shell"` — Preserved in AgentShell for backward compatibility
- `data-testid="session-message-input"` — Preserved in ComposerDock
- `data-testid="session-send-button"` — Preserved in ComposerDock
- All 20 legacy tab test IDs — Preserved in navigation-config.ts

New selectors properly namespaced:

- `data-testid="agent-shell"` — AgentShell root
- `data-testid="center-stage"` — Main content area
- `data-testid="product-nav"` — Product navigation bar
- `data-testid="product-nav-{section}"` — Individual section buttons
- `data-testid="session-workspace"` — SessionWorkspace wrapper

### Known Issues

**Baseline (Not Round 1 Regressions):**

- `act()` warnings in tests (existing, not new)
- React Router future flag warnings (existing, not new)
- Test timeout on constrained CI environments (not code issue)

**Round 1 New Issues:** None

### Guardrail Compliance

All guardrails satisfied:

- No deep SessionConsoleTab extraction
- No full React Router migration
- No backend/API/database changes
- No openhanako asset copying
- No new npm dependencies
- All existing test selectors preserved
- `session-console-selected-session` localStorage key preserved
- Chinese labels preserved
- Plain CSS with CSS variables (no Tailwind/CSS-in-JS)
- npm package manager used exclusively

---

## Remaining Scope

### Round 2 — Workspace Composition + Context Desk

**Status:** NOT STARTED

**Scope:**

- Context Desk panel with approval, memory, run status, and tool activity cards
- Empty/error states where session-scoped APIs are missing
- Workspace / Operations / Admin container pages
- Secondary navigation for old tab surfaces
- Responsive drawer behavior for Context Desk and product navigation
- Additional integration tests and smoke tests

**Still Excludes:**

- Deep SSE/timeline refactor
- Removing legacy tab compatibility

### Round 3 — Deep Refactor + Routing

**Status:** NOT STARTED

**Scope:**

- Gradual SessionConsoleTab extraction into hooks and presentation components
- Full React Router routes: `/chat`, `/chat/:sessionId`, `/workspace/:tabId`, `/operations/:tabId`, `/admin/:tabId`
- Session URL synchronization with `session-console-selected-session` migration guard
- Playwright end-to-end coverage for chat, mobile, navigation, reload, and SSE degradation
- Legacy shell/navigation cleanup only after evidence-backed approval

---

## Test Coverage

**Baseline:** Unknown (tests timed out)
**Round 1 Final:** 60 test files, 1042 tests PASS

**New Test Files:**

- `src/layout/AgentShell.test.tsx` (23 tests)
- `src/features/session/SessionWorkspace.test.tsx` (9 tests)
- `src/components/ComposerDock.test.tsx` (22 tests)
- `src/navigation/product-navigation.test.ts` (14 tests)
- `src/components/ui/Button.test.tsx` (12 tests)
- `src/components/ui/Card.test.tsx` (9 tests)

**Total New Tests:** 89 tests
