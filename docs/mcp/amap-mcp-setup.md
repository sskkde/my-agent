# AMap MCP Setup Guide

**Status:** Active
**Last Updated:** 2026-06-26

This guide covers enabling and configuring AMap (高德地图) backend map tools through the official AMap MCP Server.

---

## Overview

AMap MCP provides server-side map capabilities to agents through the Model Context Protocol. Tools cover geocoding, POI search, route planning, weather queries, and distance calculations.

**Scope:** Backend map tools (geocoding, POI, routes, weather, distance) via AMap MCP Server. A frontend map UI with JSAPI rendering is also available, see [Frontend Map Configuration](#frontend-map-configuration).

---

## Prerequisites

- Node.js >= 20
- AMap Web API Key (see [Getting a Key](#getting-a-key))
- Network access to `mcp.amap.com` (for Streamable HTTP transport)

---

## Quick Start

```bash
# 1. Add to your .env file
AMAP_MCP_ENABLED=true
AMAP_MAPS_API_KEY=your_amap_web_api_key_here

# 2. Restart the API server
npm run start:api
```

When enabled, AMap tools appear in the tool catalog (`GET /api/v1/tools`) and become available to agents during sessions.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AMAP_MCP_ENABLED` | No | `false` | Enable/disable AMap MCP tools |
| `AMAP_MAPS_API_KEY` | When enabled | (none) | AMap Web API Key |
| `AMAP_MCP_BASE_URL` | No | `https://mcp.amap.com/mcp` | MCP server endpoint |
| `AMAP_MCP_TIMEOUT_MS` | No | `30000` | Tool call timeout in milliseconds |
| `AMAP_MCP_TRANSPORT` | No | `streamable_http` | Transport protocol (`streamable_http` or `stdio`) |

---

## Transport Protocols

### Streamable HTTP (Default)

The primary transport connects to AMap's hosted MCP Server over HTTP. This is the recommended approach for most deployments.

- Endpoint: `https://mcp.amap.com/mcp`
- The API key is injected at runtime as a query parameter, never persisted in the endpoint URL
- Supports automatic reconnection on transient failures

### stdio (Fallback)

For environments where HTTP-based MCP is not suitable, stdio transport runs a local MCP process and communicates over standard input/output.

- Requires a local MCP server binary or script
- Set `AMAP_MCP_TRANSPORT=stdio` to activate
- The `AMAP_MCP_BASE_URL` is ignored in stdio mode; the local process path is used instead

---

## Supported Tool Categories

### Geocoding

Convert between addresses and geographic coordinates.

- Forward geocoding: address string → latitude/longitude
- Reverse geocoding: coordinates → structured address

### POI Search

Search for points of interest by keyword, category, or proximity.

- Keyword search: "咖啡店", "加油站"
- Around search: POIs near a given coordinate
- Category-based search: restaurants, hotels, attractions, etc.

### Route Planning

Calculate routes between two or more points.

- Driving routes (with traffic consideration)
- Walking routes
- Cycling routes
- Public transit routes

### Weather Query

Retrieve current weather conditions and forecasts for a location.

- Real-time weather data
- Multi-day forecasts

### Distance Measurement

Calculate distances between multiple points.

- Straight-line distance
- Driving distance
- Walking distance

---

## Getting a Key

1. Visit the [AMap Open Platform Console](https://console.amap.com/dev/key/app)
2. Register an account or sign in
3. Create a new application
4. Add a key with type **Web服务 (Web Service)**
5. Copy the generated key

The key should be a 32-character hex string. Set it as `AMAP_MAPS_API_KEY` in your environment.

---

## Key Types: MCP Key vs JSAPI Key

AMap uses **two separate key types** for backend and frontend access. They are not interchangeable.

| Concern | Key Type (AMap Console) | Environment Variable | Where It Runs |
|---------|------------------------|---------------------|---------------|
| Backend MCP tools | **Web服务 (Web Service)** | `AMAP_MAPS_API_KEY` | Server-side (Node.js) |
| Frontend map UI | **Web端 (JS API)** | `VITE_AMAP_JSAPI_KEY` | Browser-side (Vite) |

**Do not swap these keys.** The Web服务 key authenticates server-to-server API calls. The Web端(JS API) key authenticates browser-side JSAPI loading with domain restrictions.

To use both backend tools and the frontend map, create **two separate keys** in the AMap console under the same application.

---

## Frontend Map Configuration

The platform includes a browser-side map UI that renders AMap JSAPI maps with markers, routes, polylines, and info windows. This is configured separately from the backend MCP tools.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_AMAP_JSAPI_KEY` | For frontend map | (none) | AMap JSAPI key (Web端(JS API) type) |
| `VITE_AMAP_SECURITY_JS_CODE` | In production | (none) | Security JS code for registered domains |
| `VITE_AMAP_SERVICE_HOST` | No | (none) | Custom service host for reverse proxy |
| `VITE_AMAP_MOCK` | No | `false` | Force mock mode (no real AMap calls) |

### Local Development

```bash
# In .env or .env.local
VITE_AMAP_JSAPI_KEY=your_amap_jsapi_key_here
```

With just the key set, the map loads from AMap's CDN. No security JS code or service host is needed for `localhost`.

### Production Deployment

Production deployments on a registered domain need two extra settings:

1. **Security JS code** — obtain from the AMap console key settings page. This is required when the page is served from a non-localhost domain.

2. **Service host** (optional) — if you run a reverse proxy on your own domain, set `VITE_AMAP_SERVICE_HOST` to route AMap API requests through it. This avoids cross-origin issues and lets you add caching or rate limiting.

```bash
# Production .env
VITE_AMAP_JSAPI_KEY=your_amap_jsapi_key_here
VITE_AMAP_SECURITY_JS_CODE=your_security_js_code_here
VITE_AMAP_SERVICE_HOST=https://map-api.your-domain.com
```

### How It Works

The config module at `web/src/config/amap.ts` reads these variables:

- `getAmapConfig()` returns the resolved config object (or `null` if the key is missing)
- `isAmapEnabled()` returns whether the map feature can load
- `isAmapMockMode()` returns `true` when the key is absent or `VITE_AMAP_MOCK=true`

Map components check `isAmapMockMode()` before loading the JSAPI. In mock mode, a placeholder renders instead of making network calls.

---

## Test Mocking

Tests never make real AMap network calls. Two mechanisms ensure this:

1. **Missing key** — test environments typically don't set `VITE_AMAP_JSAPI_KEY`. When the key is absent, `isAmapMockMode()` returns `true` and map components render a placeholder.

2. **Explicit mock flag** — set `VITE_AMAP_MOCK=true` to force mock mode even when a key exists. This is useful for integration tests that configure the key but don't want JSAPI network traffic.

```bash
# In test environment or .env.test
VITE_AMAP_MOCK=true
```

Unit tests for map components mock the `useAmapLoader` hook and `@amap/amap-jsapi-loader` module entirely, returning a fake AMap namespace with `vi.fn()` constructors. This gives full control over method assertions without any browser globals or network dependencies.

The backend MCP tools (`AMAP_MAPS_API_KEY`) are separate. Tests for the MCP connector use the existing mock connector pattern (`CONNECTOR_MODE=mock`).

---

## Security

### Key Protection

API keys are sensitive credentials. Follow these rules:

- **Never commit keys to version control.** Use environment variables, `.env` files (excluded from git), or a secrets manager.
- **Never embed keys in `baseUrl`.** The platform injects the key at runtime, not at configuration time.
- **Automatic redaction.** The platform strips key values from stored metadata, error messages, audit logs, and tool transcripts.

### Permission Model

AMap tools follow the platform's existing permission framework:

- Read-only tools (geocoding, POI search, weather, distance) are categorized as `read` or `search` with medium/low sensitivity
- Action tools (route planning with side effects, if any) require explicit permission approval
- Tool access is governed by agent-type tool envelopes

### What Gets Stored

| Data | Stored? | Notes |
|------|---------|-------|
| API Key value | No | Injected at runtime, never persisted |
| MCP endpoint URL | Yes | Without key query parameter |
| Auth configuration shape | Yes | e.g., `{ type: 'api_key', placement: 'query' }` |
| Tool call results | Yes | In session transcripts (redacted if key appears) |
| Tool schemas | Yes | Name, description, input/output schemas |

---

## Disabled Behavior

When `AMAP_MCP_ENABLED` is not set or set to `false`:

- No MCP connection is attempted
- No AMap tools appear in the tool catalog
- No startup errors or warnings (clean no-op)

When `AMAP_MCP_ENABLED=true` but `AMAP_MAPS_API_KEY` is missing:

- A startup warning is logged
- No MCP connection is attempted
- No AMap tools appear in the tool catalog
- The API server continues to start normally

---

## Troubleshooting

### Tools not appearing in catalog

1. Verify `AMAP_MCP_ENABLED=true` is set
2. Verify `AMAP_MAPS_API_KEY` has a valid value
3. Check API server logs for MCP connection errors
4. Ensure network access to `mcp.amap.com`

### Tool calls timing out

Increase `AMAP_MCP_TIMEOUT_MS` (default 30 seconds):

```bash
AMAP_MCP_TIMEOUT_MS=60000
```

### Key-related errors

- `invalid_credentials`: The API key is invalid or expired. Generate a new key on the AMap console.
- `rate_limited`: The key has exceeded its quota. Check usage on the AMap console.

---

## References

- [AMap Open Platform](https://console.amap.com/)
- [AMap MCP Server Documentation](https://mcp.amap.com/)
- `src/connectors/mcp/amap-streamable-http-transport.ts` - Transport implementation
- `src/connectors/mcp/register-amap-mcp-tools.ts` - Bootstrap registration
- `.env.example` - Environment variable template
