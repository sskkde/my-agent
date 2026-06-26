# AMap MCP Setup Guide

**Status:** Active
**Last Updated:** 2026-06-26

This guide covers enabling and configuring AMap (高德地图) backend map tools through the official AMap MCP Server.

---

## Overview

AMap MCP provides server-side map capabilities to agents through the Model Context Protocol. Tools cover geocoding, POI search, route planning, weather queries, and distance calculations.

**Scope:** Backend tools only. No frontend map UI, JSAPI integration, or browser-side rendering is included in this setup. Frontend map display is planned as a separate initiative.

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
