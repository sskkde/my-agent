# Warm-Paper Design System

## Overview

Warm-Paper is a paper-inspired design system for the Agent Platform frontend. It evokes the texture of aged rice paper with ink-like typography, minimal radius, hairline borders, and a seal-blue accent. The system is activated via `data-theme="warm-paper"` on the document root.

## Design Tokens

### Paper Background Layers

| Token | Value | Usage |
|-------|-------|-------|
| `--warm-paper-bg` | `#fbf8f0` | Primary paper surface |
| `--warm-paper-bg-elevated` | `#fffcf7` | Elevated surfaces (cards, modals) |
| `--warm-paper-bg-deep` | `#f5efe4` | Deeper layer (sidebars, wells) |
| `--warm-paper-bg-glass` | `rgba(251, 248, 240, 0.92)` | Glass overlay effect |

### Ink Text Hierarchy

| Token | Value | Usage |
|-------|-------|-------|
| `--warm-paper-text` | `#2a2622` | Dense ink — primary text |
| `--warm-paper-text-secondary` | `#4a433c` | Secondary text |
| `--warm-paper-text-muted` | `#6b6158` | Captions, placeholders |

### Border & Line

| Token | Value | Usage |
|-------|-------|-------|
| `--warm-paper-border` | `#d8cfbe` | Ink-line — main divider |
| `--warm-paper-border-width` | `1px` | Hairline border width |

### Seal Accent

| Token | Value | Usage |
|-------|-------|-------|
| `--warm-paper-accent` | `#537d96` | Seal-blue primary accent |
| `--warm-paper-accent-hover` | `#466a80` | Hover state |
| `--warm-paper-accent-subtle` | `rgba(83, 125, 150, 0.08)` | Subtle background |
| `--warm-paper-accent-rgb` | `83, 125, 150` | For rgba() usage |

### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--warm-paper-success` | `#4a6b4a` | Ink green |
| `--warm-paper-warning` | `#8b6f47` | Aged paper amber |
| `--warm-paper-danger` | `#8b2c1f` | Deep coral (zhu sha) |

### Border Radius (minimal, seal-like)

| Token | Value | Usage |
|-------|-------|-------|
| `--warm-paper-radius-sm` | `2px` | Input, button, chip |
| `--warm-paper-radius-md` | `3px` | Card, list block |
| `--warm-paper-radius-lg` | `4px` | Modal |

### Elevation Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--warm-paper-shadow-sm` | `0 1px 2px rgba(42,38,34,0.03)` | Subtle lift |
| `--warm-paper-shadow-md` | `0 2px 4px rgba(42,38,34,0.04)` | Medium elevation |
| `--warm-paper-shadow-lg` | `0 4px 8px rgba(42,38,34,0.05)` | High elevation |

## Layout Principles

1. **Chat-only surface**: On `/` and `/chat`, the page shows only conversation content. Settings are accessed exclusively through a floating button-triggered menu.
2. **Floating settings popover**: A small gear button in the chat header controls opens a floating panel. The panel closes on Escape and outside click, and returns focus to the trigger button.
3. **No visible product switch in chat**: The chat header retains brand identity and navigation context switches (chat/workspace/operations), but the admin/settings switch is removed — settings live in the floating menu.
4. **Low radii**: All interactive elements use 2–4px radius. Cards and containers use 3–4px.
5. **Hairline borders**: All borders are 1px `#d8cfbe`.
6. **Ink hierarchy**: Three text tiers — dense ink (#2A2622), secondary (#4A433C), muted (#6B6158).

## File Structure

```
web/DESIGN.md                          # This file
web/src/theme.css                      # [data-theme] selector overrides (imported after styles.css)
web/src/theme-storage.ts               # Theme persistence (readStoredTheme, applyDocumentTheme, persistTheme)
web/src/features/settings/
  SettingsContent.tsx                   # Shared settings content (theme + providers + subagents)
  FloatingSettingsMenu.tsx              # Floating settings trigger + popover
  floating-settings.css                 # Floating menu styles
  SettingsTab.tsx                       # /admin/settings route (uses SettingsContent)
```

## CSS Architecture

- `styles.css` defines base design tokens and the Hana-inspired override at the bottom.
- `theme.css` provides `[data-theme="warm-paper"]` overrides that activate the warm-paper palette when the theme is selected. It is imported **after** `styles.css` in `App.tsx`.
- `floating-settings.css` provides styles for the floating settings menu popover.

## Component Patterns

- **SettingsContent**: Reusable content extracted from SettingsTab. Accepts an optional `embedMode` prop to omit the header when used inside a floating popover.
- **FloatingSettingsMenu**: Renders a settings gear button that opens a floating panel containing SettingsContent. Uses `aria-*` attributes for accessibility. Handles Escape key and outside click dismissal.
