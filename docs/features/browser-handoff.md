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

The internal state machine has 6 states. The API surface collapses them into 4 wire states (see `mapOwnershipToState`): `resuming` is reported as `agent_controlled`, and `closed` / `error` are reported as `idle`.

| Internal state | API `state` | Who owns the page | Description |
|---|---|---|---|
| `agent_controlled` | `agent_controlled` | Agent | Agent navigates and interacts freely |
| `handoff_requested` | `handoff_requested` | Nobody (transitional) | Agent asked for human help; waiting for takeover |
| `human_controlled` | `user_controlled` | Human | Human has an active takeover lease |
| `resuming` | `agent_controlled` | Nobody (transitional) | Human released; agent is resuming |
| `closed` | `idle` | Nobody | Session shut down |
| `error` | `idle` | Nobody | Browser page crashed |

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

All endpoints require authentication and live under `/api/v1/sessions/:sessionId/browser/`. Responses use the platform's standard envelope: success bodies are `{ "ok": true, "data": <payload>, "requestId": "<id>" }` and error bodies are `{ "ok": false, "error": { "code": "<CODE>", "message": "<text>" }, "requestId": "<id>" }`.

| Endpoint | Method | Description |
|---|---|---|
| `/status` | GET | Current session state, URL, last activity, viewport |
| `/frame/stream` | SSE | Live JPEG frame stream (snapshot → frames → heartbeats) |
| `/takeover` | POST | Human acquires control (creates lease) |
| `/input` | POST | Send click / keypress / type / scroll / navigate |
| `/release` | POST | Human releases control back to agent |
| `/agent-request-takeover` | POST | Agent signals it needs human help (returns current status) |

### Response Shapes

`GET /status` → `BrowserStatusResponse`:

```json
{
  "ok": true,
  "requestId": "req-1",
  "data": {
    "sessionId": "abc123",
    "state": "agent_controlled",
    "url": "https://example.com",
    "lastActivityAt": "2026-06-30T12:00:00.000Z",
    "viewport": { "width": 1280, "height": 720 }
  }
}
```

`POST /takeover` and `POST /release` → `BrowserTakeoverResponse`:

```json
{
  "ok": true,
  "requestId": "req-2",
  "data": {
    "sessionId": "abc123",
    "state": "user_controlled",
    "previousState": "idle"
  }
}
```

`POST /input` → `BrowserInputResponse`:

```json
{ "ok": true, "requestId": "req-3", "data": { "success": true } }
```

`POST /agent-request-takeover` → `BrowserStatusResponse` (same shape as `GET /status`).

### SSE Frame Stream

`GET /frame/stream` opens a `text/event-stream` and emits three event types, each serialized as `data: <json>\n\n`:

| Event `type` | Fields | When |
|---|---|---|
| `snapshot` | `state`, `url`, `timestamp` | Emitted once on connection open |
| `frame` | `data` (base64 JPEG), `timestamp`, `width`, `height` | Each captured frame |
| `heartbeat` | `timestamp` | Every 5 seconds (keep-alive) |

The stream closes when the client disconnects; the server unsubscribes from the frame stream and clears the heartbeat timer.

### Example: Take Over a Session

```bash
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/takeover \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

### Example: Send Input

```bash
# Click at normalized coordinates (0.5, 0.3) — x and y must be in [0, 1]
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "click", "payload": {"x": 0.5, "y": 0.3}}'

# Press a key (action is "keypress"; payload.key is required, payload.modifiers is optional string[])
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "keypress", "payload": {"key": "Enter", "modifiers": ["Shift"]}}'

# Type text
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "type", "payload": {"text": "hello@example.com"}}'

# Scroll (deltaX/deltaY are pixel offsets, required; x/y are optional pixel anchors)
curl -X POST http://localhost:3003/api/v1/sessions/abc123/browser/input \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "scroll", "payload": {"deltaX": 0, "deltaY": 300}}'

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

### Error Codes

| HTTP | `error.code` | Trigger |
|---|---|---|
| 400 | `BAD_REQUEST` | Request body missing `action` or `payload` |
| 400 | `INVALID_INPUT` | Boundary parse failure (non-finite number, click x/y outside [0,1], invalid button, non-positive clickCount, non-string modifiers, empty string, unknown action) |
| 403 | `FORBIDDEN` | `POST /input` without an active lease; `POST /release` by a non-lease-holder |
| 404 | `NOT_FOUND` | Browser session or live page not found |
| 409 | `LEASE_CONFLICT` | `POST /takeover` while another user holds the lease |
| 409 | `TAKEOVER_FAILED` / `RELEASE_FAILED` | Other takeover/release failures |
| 500 | `INPUT_DISPATCH_FAILED` | Playwright `page.*` call rejected during input dispatch |
| 503 | `SERVICE_UNAVAILABLE` | Browser session manager or frame stream not configured |

---

## Security Considerations

### Local-Only by Default

The browser runs headless on the same machine as the API server. No debug port is exposed. No remote DevTools connection is supported. The browser binary communicates with the platform through Playwright's internal IPC, not through a network socket.

**Do not expose the browser debug port.** The platform does not support or document raw CDP (Chrome DevPort Protocol) access. All browser interaction goes through the authenticated API endpoints above.

### Input Validation

- Click coordinates (`x`, `y`) are normalized to the [0, 1] range. Out-of-range values are rejected with `INVALID_INPUT`.
- Scroll `deltaX` / `deltaY` are pixel offsets (not normalized); both are required. Optional `x` / `y` are pixel anchors.
- The `keypress` action requires a non-empty `payload.key`; `payload.modifiers` is an optional string array (defaults to `[]`).
- The `type` action requires a non-empty `payload.text`.
- The `navigate` action requires a non-empty `payload.url` and calls `page.goto()` directly. The browser's own security model (same-origin policy, HTTPS enforcement) applies.
- The `click` action accepts optional `payload.button` (`left` | `middle` | `right`, default `left`) and `payload.clickCount` (positive integer, default `1`).
- All input actions require an active takeover lease held by the caller. Requests without a lease are rejected with `FORBIDDEN` (403).

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

### Takeover returns 409 (`LEASE_CONFLICT`)

Another user already holds the lease. Wait for it to expire (60 seconds default) or ask them to release. The same 409 is returned if the same user attempts a second takeover on a session they already hold.

### Input returns 403 (`FORBIDDEN`)

You don't have an active takeover lease for this session. Call `POST /takeover` first. The same code is returned when a non-lease-holder attempts `POST /release`.

### Input returns 400 (`INVALID_INPUT`)

The payload failed boundary parsing. Common causes: click `x`/`y` outside [0, 1]; missing or empty `key` / `text` / `url`; non-positive `clickCount`; `modifiers` not a string array; unknown `action`. The `error.message` names the offending field.

### Status or takeover returns 503 (`SERVICE_UNAVAILABLE`)

The browser session manager or frame stream is not configured on the server. This typically means the API context was built without a `CloakBrowserProvider`. Install the CloakBrowser binary (`npm run install:playwright`) and restart the API server.

---

## Related Docs

- [Environment Variables Reference](../deployment/env-reference.md#cloakbrowser-配置)
- [Known Limitations](../security/known-limitations.md)
- [Production Security Model](../security/production-security-model.md)
