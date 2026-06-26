/**
 * AMap MCP Tools Bootstrap Helper
 *
 * Registers AMap MCP tools into the existing {@link ToolRegistry} during
 * API context startup. The registration is gated behind two environment
 * variables:
 *
 * - `AMAP_MCP_ENABLED` must be exactly `"true"`
 * - `AMAP_MAPS_API_KEY` must be a non-empty string
 *
 * When either condition is not met the function is a silent no-op — no
 * transport is created, no session is opened, and no tools appear in the
 * registry. This keeps AMap integration opt-in and crash-safe.
 *
 * @module connectors/mcp/register-amap-mcp-tools
 */

import type { ConnectionManager } from '../../storage/connection.js'
import type { ToolRegistry } from '../../tools/types.js'
import type { McpTransport } from './mcp-session-manager.js'
import { createMcpSessionManager } from './mcp-session-manager.js'
import { createMcpServerRegistry } from './mcp-server-registry.js'
import { McpToolBridge, type McpToolTransport } from './mcp-tool-bridge.js'
import { AMapStreamableHttpTransport } from './amap-streamable-http-transport.js'
import { redactMcpErrorMessage } from './mcp-secret-redaction.js'

/** Well-known server ID for the AMap MCP server. */
const AMAP_SERVER_ID = 'amap-maps'

/** Default AMap MCP Streamable HTTP endpoint (without key). */
const DEFAULT_AMAP_ENDPOINT = 'https://mcp.amap.com/mcp'

/**
 * Dependencies injected into the bootstrap helper.
 * Keeping these explicit makes the function testable without touching
 * the real API context or live AMap servers.
 */
export interface RegisterAMapMcpToolsDeps {
  /** Database connection for MCP session/server tables. */
  connection: ConnectionManager
  /** The tool registry to register discovered tools into. */
  toolRegistry: ToolRegistry
  /** Override env lookup (defaults to `process.env`). */
  env?: Record<string, string | undefined>
  /**
   * Optional pre-built transport. When provided the helper skips creating
   * an {@link AMapStreamableHttpTransport} and uses this instead. Useful
   * for tests that inject a mock transport.
   */
  transportOverride?: McpTransport & McpToolTransport
}

/**
 * Attempts to register AMap MCP tools into `toolRegistry`.
 *
 * Behaviour:
 * - If `AMAP_MCP_ENABLED` is not `"true"` → no-op.
 * - If `AMAP_MAPS_API_KEY` is empty or unset → logs a warning and returns.
 * - Otherwise: registers server definition, opens session, discovers tools,
 *   registers them into the registry.
 *
 * Errors during registration are caught and logged so a misconfigured AMap
 * key never crashes the API startup.
 */
export async function registerAMapMcpTools(deps: RegisterAMapMcpToolsDeps): Promise<void> {
  const env = deps.env ?? process.env

  // ── Gate 1: explicit enablement ──────────────────────────────────
  const enabled = (env.AMAP_MCP_ENABLED ?? '').toLowerCase() === 'true'
  if (!enabled) {
    return // disabled — no-op
  }

  // ── Gate 2: API key present ──────────────────────────────────────
  const apiKey = env.AMAP_MAPS_API_KEY?.trim()
  if (!apiKey) {
    // Enabled but no key — warn and no-op. Never crash.
    console.warn('[amap-mcp] AMAP_MCP_ENABLED=true but AMAP_MAPS_API_KEY is not set. Skipping AMap MCP tool registration.')
    return
  }

  const endpoint = (env.AMAP_MCP_BASE_URL ?? DEFAULT_AMAP_ENDPOINT).trim()

  try {
    // ── Register server definition ─────────────────────────────────
    const serverRegistry = createMcpServerRegistry(deps.connection)
    serverRegistry.registerServer({
      serverId: AMAP_SERVER_ID,
      name: 'AMap Maps MCP',
      version: '1.0.0',
      description: '高德地图 MCP Server — geocoding, POI search, route planning, weather',
      baseUrl: endpoint, // no key — registry redacts secrets
      configType: 'streamable_http',
      capabilities: [],
      supportedFormats: ['json'],
      authentication: {
        type: 'api_key',
        required: true,
        placement: 'query',
        name: 'key',
        envVar: 'AMAP_MAPS_API_KEY',
      },
      trustLevel: 'untrusted',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    // ── Create transport ───────────────────────────────────────────
    const transport: McpTransport & McpToolTransport =
      deps.transportOverride ??
      new AMapStreamableHttpTransport({ endpoint, apiKey })

    // ── Wire session manager with transport ────────────────────────
    const transports = new Map<string, McpTransport & McpToolTransport>([
      [AMAP_SERVER_ID, transport],
    ])
    const sessionManager = createMcpSessionManager(deps.connection, transports as Map<string, McpTransport>)

    // ── Open session (connects transport) ──────────────────────────
    const session = await sessionManager.openSessionAsync(AMAP_SERVER_ID)

    // If the session opened in error state (e.g. transport.connect() threw),
    // we still proceed — the bridge will handle unhealthy sessions gracefully.
    if (session.status === 'unhealthy') {
      console.warn(`[amap-mcp] Session opened in error state: ${session.lastError ?? 'unknown'}. Tools may not be available.`)
    }

    // ── Create bridge and register tools ───────────────────────────
    const bridge = new McpToolBridge({
      sessionManager,
      getTransport: (_sessionId, serverId) => {
        if (serverId !== AMAP_SERVER_ID) return undefined
        return transports.get(serverId) as McpToolTransport | undefined
      },
    })

    await bridge.registerTools(deps.toolRegistry, session.sessionId)

    const toolCount = deps.toolRegistry.listTools().filter((t) => t.metadata?.bridge === 'mcp' && t.metadata?.serverId === AMAP_SERVER_ID).length
    console.log(`[amap-mcp] Registered ${toolCount} AMap MCP tool(s).`)
  } catch (error) {
    // Registration failure must never crash the API process.
    const message = redactMcpErrorMessage(error instanceof Error ? error.message : String(error))
    console.warn(`[amap-mcp] Failed to register AMap MCP tools: ${message}`)
  }
}
