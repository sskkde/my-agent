# Visual Browser Handoff

The visual browser handoff feature lets agents share a live browser session with human users. When an agent hits a CAPTCHA, login wall, or other interactive gate, it can hand control to a human, wait for them to resolve the issue, and then resume.

---

## How It Works

The platform launches a headless browser via CloakBrowser, creates a per-session `BrowserContext` with a `Page`, and captures periodic JPEG screenshots. These frames stream to the frontend over SSE. The ownership state machine governs who controls the page at any moment.

```
agent_controlled → handoff_requested → human_controlled → resuming → agent_controlled
```

Each transition is validated at runtime. Invalid transitions are rejected.

### Ownership States

| State | Who owns the page | Description |
|---|---|---|
| `agent_controlled` | Agent | Agent navigates and interacts freely |
| `handoff_requested` | Nobody (transitional) | Agent asked for human help; waiting for takeover |
| `human_controlled` | Human | Human has an active takeover lease |
| `resuming` | Nobody (transitional) | Human released; agent is resuming |
| `closed` | Nobody | Session shut down |
| `error` | Nobody | Browser page crashed |

### Takeover Lease

When a human takes over, they acquire an exclusive lease with a TTL (default 60 seconds). Only the lease holder can send input events. Leases expire automatically if not released.

---

## Enabling the Feature

### Prerequisites

- CloakBrowser binary installed (~206 MB, cached at `~/.cloakbrowser/`)
- Platform running with the `playwright` or `auto-browser` web search backend, or direct API usage

Install the browser binary:

```bash
npm run install:playwright
```

### Environment Variables

Add these to your `.env` file:

```bash
# Enable CloakBrowser (default: headless)
CLOAKBROWSER_HEADLESS=true

# Optional: proxy for browser traffic
# CLOAKBROWSER_PROXY=http://proxy:8080

# Optional: human-like behavior (mouse movements, delays)
# CLOAKBROWSER_HUMANIZE=false

# Optional: GeoIP-based locale/timezone
# CLOAKBROWSER_GEOIP=false

# Optional: override timezone
# CLOAKBROWSER_TIMEZONE=America/New_York

# Optional: override locale
# CLOAKBROWSER_LOCALE=en-US

# Optional: extra Chromium args (comma-separated)
# CLOAKBROWSER_ARGS=--disable-gpu,--no-sandbox
```

### Disabling

To disable the feature entirely, don't install the CloakBrowser binary. The platform detects its absence and falls back gracefully. Web search uses lightweight providers (SearXNG, Tavily) instead.

No environment variable toggle exists because the feature is opt-in at the binary level. If the binary isn't present, browser sessions fail with a clear error at the API layer.

---

## Resource Limits

| Resource | Default | Configurable |
|---|---|---|
| Max concurrent browser sessions | 5 | Via `BrowserSessionManagerConfig.maxSessions` |
| Idle timeout per session | 5 minutes | Via `BrowserSessionManagerConfig.idleTimeoutMs` |
| Viewport resolution | 1280 x 720 | Via `BrowserSessionManagerConfig.viewport` |
| Screenshot quality | JPEG quality 50 | Via `FrameStreamConfig.quality` |
| Screenshot format | JPEG | Via `FrameStreamConfig.format` |
| Min frame interval | 100ms | Via `FrameStreamConfig.minIntervalMs` |
| Takeover lease TTL | 60 seconds | Via `TakeoverLeaseConfig.defaultTtlMs` |
| Handoff wait timeout | 2 minutes | Via `HandoffWaitConfig.timeoutMs` |
| Handoff poll interval | 500ms | Via `HandoffWaitConfig.pollIntervalMs` |

### Performance Characteristics

- Screenshot capture: ~81ms per frame at 1280x720 JPEG quality 50
- Frame size: ~8KB per frame
- Binary size: ~206 MB (CloakBrowser), cached at `~/.cloakbrowser/`

---

## Screenshot Privacy

**No frame data is persisted to the database, logs, or timeline by default.**

Screenshots are captured in memory, streamed over SSE to connected clients, and discarded. The `BrowserSessionManager` stores only metadata (session ID, ownership state, health, viewport dimensions, timestamps). Raw image bytes never touch the storage layer.

When a session closes, all in-memory frame data is released. There is no screenshot history, replay buffer, or disk cache.

If you need frame persistence for debugging or auditing, that would require explicit extension of the frame stream. The current architecture does not support it.

---

## API Endpoints

All endpoints require authentication and live under `/api/v1/sessions/:sessionId/browser/`.

| Endpoint | Method | Description |
|---|---|---|
| `/status` | GET | Current session state, URL, last activity |
| `/frame/stream` | SSE | Live JPEG frame stream |
| `/takeover` | POST | Human acquires control (creates lease) |
| `/input` | POST | Send click/type/scroll/navigate/keypress |
| `/release` | POST | Human releases control back to agent |
| `/agent-request-takeover` | POST | Agent signals it needs human help |

### Example: Take Over a Session

```bash
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/takeover \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

Response:
```json
{
  "ok": true,
  "data": {
    "sessionId": "abc123",
    "state": "user_controlled",
    "previousState": "idle"
  }
}
```

### Example: Send Input

```bash
# Click at normalized coordinates (0.5, 0.3)
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "click", "payload": {"x": 0.5, "y": 0.3}}'

# Type text
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "type", "payload": {"text": "hello@example.com"}}'

# Navigate to URL
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "navigate", "payload": {"url": "https://example.com"}}'
```

### Example: Release Control

```bash
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/release \
  -H "Authorization: Bearer $TOKEN"
```

---

## Security Considerations

### Local-Only by Default

The browser runs headless on the same machine as the API server. No debug port is exposed. No remote DevTools connection is supported. The browser binary communicates with the platform through Playwright's internal IPC, not through a network socket.

**Do not expose the browser debug port.** The platform does not support or document raw CDP (Chrome DevPort Protocol) access. All browser interaction goes through the authenticated API endpoints above.

### Input Validation

- Click and scroll coordinates are normalized to the 0..1 range. Out-of-range values are rejected.
- Keyboard and text inputs are validated against the `BrowserInputEvent` type at the API boundary.
- Navigation URLs are passed directly to `page.goto()`. The browser's own security model (same-origin policy, HTTPS enforcement) applies.

### Lease Isolation

- Only one human can hold a takeover lease per session at a time.
- Lease holders are identified by user ID. Only the lease holder can send input or release.
- Leases expire automatically after their TTL. No manual cleanup required.

### No Cross-Session Data Leakage

Each browser session gets its own `BrowserContext` with isolated cookies, storage, and cache. Sessions cannot access each other's data.

---

## CAPTCHA Handoff Flow

When the web search tool encounters a CAPTCHA or blocking page:

1. The agent detects the block via `isCaptchaOrBlocked()`
2. It emits an `agent-request-takeover` event through the tool execution result
3. The session transitions to `handoff_requested`
4. The agent polls (every 500ms, up to 2 minutes) waiting for the human to resolve it
5. The human takes over via the UI, solves the CAPTCHA, and releases control
6. The agent resumes and retries the search on the same page

If no takeover lease is configured, the CAPTCHA error is returned directly to the agent without handoff.

---

## Frontend Integration

The `BrowserHandoffPanel` component renders the live frame stream and takeover controls. It:

- Subscribes to the SSE frame stream on mount
- Renders JPEG frames as `<img>` elements with object URLs
- Shows takeover/release buttons based on ownership state
- Handles click, keyboard, scroll, and text input when the user has control
- Cleans up object URLs and SSE subscriptions on unmount

State labels: idle, Agent controlled, User controlled (you), Agent requesting takeover.

---

## Known Limitations

1. **No persistent frame history.** Screenshots are ephemeral. There is no replay or scrubbing capability.

2. **Single human per session.** Only one takeover lease exists per browser session. Multi-user collaboration on the same browser is not supported.

3. **Headless only.** The browser runs without a visible window. There is no built-in way to display the browser UI on the server machine.

4. **No file upload/download through browser.** The browser handoff handles web page interaction only. File operations go through the platform's file upload API.

5. **CloakBrowser binary dependency.** The ~206 MB binary must be installed separately. It is not bundled with the platform.

6. **Idle sessions auto-close.** Sessions with no activity for 5 minutes are closed automatically. Active takeover leases reset the idle timer.

7. **Browser crashes are terminal per session.** If the browser page crashes, the session transitions to `error` state and must be recreated. There is no automatic recovery.

8. **No raw CDP access.** The platform intentionally does not expose Chrome DevTools Protocol. All browser interaction goes through the typed API.

---

## Troubleshooting

### Browser fails to launch

Check that the CloakBrowser binary is installed:

```bash
ls ~/.cloakbrowser/
```

If missing, run `npm run install:playwright`.

### Frames not appearing in the UI

- Verify the SSE connection is active (check browser dev tools Network tab)
- Confirm the session exists: `GET /api/v1/sessions/:id/browser/status`
- Check that the session is not in `closed` or `error` state

### Takeover returns 409

Another user already holds the lease. Wait for it to expire (60 seconds default) or ask them to release.

### Input returns 403

You don't have an active takeover lease. Call `POST /browser/takeover` first.

---

## Related Docs

- [Environment Variables Reference](../deployment/env-reference.md#cloakbrowser-配置)
- [Known Limitations](../security/known-limitations.md)
- [Production Security Model](../security/production-security-model.md)
