# Web Search Connector

The Web Search connector provides web and news search capabilities through multiple backend providers. It supports various search backends including SearXNG, Tavily, and legacy remote APIs.

## Features

- **Multiple Backend Support**: Choose from SearXNG, Tavily, or custom remote APIs
- **Mock Mode**: Built-in mock connector for development and testing
- **Rate Limit Handling**: Graceful handling of rate limit responses (HTTP 429)
- **Configurable Timeout**: Customizable request timeout
- **Structured Error Handling**: Clear error codes for different failure scenarios
- **Security**: API keys are passed via headers, never in URLs

## Configuration

### Backend Selection

Configure the search backend using the `WEB_SEARCH_BACKEND` environment variable:

| Value | Description | Requirements |
|-------|-------------|--------------|
| `auto` | Default. Tries SearXNG → Tavily → Remote API | At least one provider configured |
| `searxng` | Self-hosted SearXNG instance | `SEARXNG_BASE_URL` |
| `tavily` | Tavily API service | `TAVILY_API_KEY` |
| `remote` | Custom remote search API | `WEB_SEARCH_API_URL` + `WEB_SEARCH_API_KEY` |
| `playwright` | Browser-based DuckDuckGo scraping through the CloakBrowser-backed Playwright-compatible browser | `cloakbrowser`/`playwright-core` installed and CloakBrowser binary available |
| `auto-browser` | Lightweight providers → CloakBrowser fallback | `cloakbrowser`/`playwright-core` installed and CloakBrowser binary available |
| `none` | Disable web search | None |

### Environment Variables

```bash
# Backend selection (default: auto)
WEB_SEARCH_BACKEND=auto

# SearXNG (self-hosted, lightweight)
SEARXNG_BASE_URL=http://localhost:8080/search

# Tavily (API-based, requires API key)
TAVILY_API_KEY=your_tavily_api_key_here
TAVILY_BASE_URL=https://api.tavily.com  # Optional

# Legacy Remote API
WEB_SEARCH_API_URL=https://your-search-api.example.com/search
WEB_SEARCH_API_KEY=your_api_key_here

# CloakBrowser-backed browser mode
CLOAKBROWSER_HEADLESS=true
CLOAKBROWSER_HUMANIZE=false
CLOAKBROWSER_PROXY=http://user:pass@proxy.example:8080  # Optional
CLOAKBROWSER_GEOIP=false
CLOAKBROWSER_TIMEZONE=America/New_York  # Optional
CLOAKBROWSER_LOCALE=en-US  # Optional
CLOAKBROWSER_ARGS=--disable-gpu,--no-sandbox  # Optional comma-separated Chromium args
```

## Capabilities

### `search.web_search`

Search the web for information using the configured backend.

**Parameters:**
- `query` (string, required): The search query
- `limit` (number, optional): Maximum number of results (default: 5, max: 10)

**Response:**
```json
{
  "query": "search query",
  "results": [
    {
      "title": "Result Title",
      "url": "https://example.com",
      "snippet": "Result description..."
    }
  ],
  "total": 1,
  "provider": "searxng"
}
```

### `search.news_search`

Search news articles using the configured backend.

**Parameters:**
- `query` (string, required): The search query
- `limit` (number, optional): Maximum number of results (default: 5, max: 10)

## Error Codes

| Code | Description | Recoverable |
|------|-------------|-------------|
| `INVALID_QUERY` | Empty or invalid search query | Yes |
| `PROVIDER_NOT_CONFIGURED` | No search backend configured | Yes |
| `SEARCH_FAILED` | HTTP error from backend | Yes |
| `BROWSER_SEARCH_UNAVAILABLE` | Playwright backend not supported in connector mode | No |
| `RATE_LIMIT_EXCEEDED` | Rate limit exceeded (mock mode) | Yes |

## Security

### API Key Handling

- API keys are read from environment variables, not stored in connector instances
- Keys are passed via `Authorization: Bearer` header, never in URL parameters
- Error messages do not expose API keys

### Network Security

- All requests use HTTPS for Tavily and remote APIs
- Private IP addresses are not blocked (unlike Web connector, search backends are trusted)

## Mock Mode

Enable mock mode for development and testing:

```bash
CONNECTOR_MOCK_MODE=true
```

The mock connector provides:
- Predictable search results based on query matching
- Configurable rate limit simulation
- Configurable auth state simulation

### Mock Configuration

```typescript
import { createSearchConnectorAdapter } from './connectors/mocks/search-connector.js';

const mockAdapter = createSearchConnectorAdapter({
  authState: 'authenticated',  // or 'unauthenticated', 'expired'
  rateLimitMode: 'none',       // or 'limited', 'exhausted'
  errorMode: 'none',           // or 'transient', 'permanent'
});
```

## Timeout Configuration

Configure the request timeout (default: 10000ms):

```typescript
import { createRealSearchConnectorAdapter } from './connectors/search/search-connector.js';

const adapter = createRealSearchConnectorAdapter({
  timeout: 15000,  // 15 seconds
});
```

## Health Check

Check connector health:

```typescript
const health = adapter.checkHealth(instance);
// Returns: { healthy: boolean, message?: string }
```

The health check verifies:
- Backend is configured (not `none`)
- Environment variables are set for the selected backend

## Backend Details

### SearXNG

Self-hosted metasearch engine. No API key required.

```bash
SEARXNG_BASE_URL=http://localhost:8080/search
```

### Tavily

API-based search service optimized for AI applications.

```bash
TAVILY_API_KEY=tvly-xxxxx
TAVILY_BASE_URL=https://api.tavily.com  # Optional
```

### Remote API

Custom search API endpoint.

```bash
WEB_SEARCH_API_URL=https://search.example.com/api
WEB_SEARCH_API_KEY=your-key
```

### CloakBrowser-backed Browser Mode

DuckDuckGo search via browser automation now uses CloakBrowser as the Playwright-compatible browser implementation. The backend name remains `playwright` for compatibility, but the browser instance is launched lazily through CloakBrowser and injected into the search tool:

```bash
WEB_SEARCH_BACKEND=playwright
CLOAKBROWSER_HEADLESS=true
CLOAKBROWSER_HUMANIZE=true
```

Optional CloakBrowser settings include `CLOAKBROWSER_PROXY`, `CLOAKBROWSER_GEOIP`, `CLOAKBROWSER_TIMEZONE`, `CLOAKBROWSER_LOCALE`, and comma-separated `CLOAKBROWSER_ARGS`. The browser process is reused across searches and closed when the API server shuts down.

Note: Playwright/CloakBrowser backend is not supported in connector mode. Use `auto-browser` for automatic fallback in built-in tool mode.

## GA Compliance

The Web Search connector is GA-certified with the following compliance:

| Requirement | Status |
|-------------|--------|
| Auth mode documented | ✅ API key or configured backend |
| Secret encryption | ✅ Keys from environment, not stored |
| Least privilege scopes | ✅ N/A (no OAuth) |
| Rate limit handling | ✅ HTTP 429 with retry info |
| Timeout handling | ✅ Configurable (default 10s) |
| Error taxonomy | ✅ Structured error codes |
| Mock mode | ✅ Mock connector available |
| Real HTTP mode | ✅ Multiple backend support |
| Audit events | ✅ Events emitted on calls |
| Redaction | ✅ API keys redacted from logs |
