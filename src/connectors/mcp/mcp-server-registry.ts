import type { ConnectionManager } from '../../storage/connection.js'
import type { MCPServerDefinition, MCPServerAuthConfig } from '../types.js'

export interface McpServerRegistry {
  registerServer(definition: MCPServerDefinition): void
  getServer(serverId: string): MCPServerDefinition | null
  listServers(): MCPServerDefinition[]
  disableServer(serverId: string): void
}

interface McpServerRow {
  server_id: string
  name: string
  version: string
  description: string | null
  base_url: string
  config_type: 'stdio' | 'http' | 'streamable_http'
  command: string | null
  args: string | null
  authentication_json: string | null
  trust_level: 'trusted' | 'verified' | 'untrusted'
  sandbox_policy: string | null
  status: 'active' | 'inactive' | 'error'
  created_at: string
  updated_at: string
}

const SECRET_QUERY_PARAMS = ['key', 'api_key', 'apikey', 'token', 'secret', 'access_token']

function redactSecretParams(baseUrl: string): string {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(baseUrl)
  } catch {
    return baseUrl
  }
  let mutated = false
  for (const param of SECRET_QUERY_PARAMS) {
    if (parsedUrl.searchParams.has(param)) {
      parsedUrl.searchParams.delete(param)
      mutated = true
    }
  }
  return mutated ? parsedUrl.toString() : baseUrl
}

class SqliteMcpServerRegistry implements McpServerRegistry {
  constructor(private readonly connection: ConnectionManager) {}

  registerServer(definition: MCPServerDefinition): void {
    const normalized = this.normalizeDefinition(definition)
    const now = new Date().toISOString()
    const createdAt = normalized.createdAt || now
    const updatedAt = normalized.updatedAt || now

    this.connection.exec(
      `INSERT INTO mcp_servers (
        server_id, name, version, description, base_url, config_type, command, args,
        authentication_json, trust_level, sandbox_policy, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET
        name = excluded.name,
        version = excluded.version,
        description = excluded.description,
        base_url = excluded.base_url,
        config_type = excluded.config_type,
        command = excluded.command,
        args = excluded.args,
        authentication_json = excluded.authentication_json,
        trust_level = excluded.trust_level,
        sandbox_policy = excluded.sandbox_policy,
        status = excluded.status,
        updated_at = excluded.updated_at`,
      [
        normalized.serverId,
        normalized.name,
        normalized.version,
        normalized.description ?? null,
        normalized.baseUrl,
        normalized.configType,
        normalized.command ?? null,
        normalized.args ? JSON.stringify(normalized.args) : null,
        normalized.authentication ? JSON.stringify(normalized.authentication) : null,
        normalized.trustLevel,
        normalized.sandboxPolicy ? JSON.stringify(normalized.sandboxPolicy) : null,
        normalized.status,
        createdAt,
        updatedAt,
      ],
    )
  }

  getServer(serverId: string): MCPServerDefinition | null {
    const rows = this.connection.query<McpServerRow>('SELECT * FROM mcp_servers WHERE server_id = ?', [serverId])
    return rows[0] ? this.rowToDefinition(rows[0]) : null
  }

  listServers(): MCPServerDefinition[] {
    const rows = this.connection.query<McpServerRow>('SELECT * FROM mcp_servers ORDER BY created_at ASC')
    return rows.map((row) => this.rowToDefinition(row))
  }

  disableServer(serverId: string): void {
    this.connection.exec('UPDATE mcp_servers SET status = ?, updated_at = ? WHERE server_id = ?', [
      'inactive',
      new Date().toISOString(),
      serverId,
    ])
  }

  private normalizeDefinition(
    definition: MCPServerDefinition,
  ): Required<
    Pick<
      MCPServerDefinition,
      'serverId' | 'name' | 'version' | 'baseUrl' | 'capabilities' | 'supportedFormats' | 'createdAt' | 'updatedAt'
    >
  > &
    Omit<
      MCPServerDefinition,
      'serverId' | 'name' | 'version' | 'baseUrl' | 'capabilities' | 'supportedFormats' | 'createdAt' | 'updatedAt'
    > {
    const configType = definition.configType ?? (definition.baseUrl.startsWith('http') ? 'http' : 'stdio')
    if (configType === 'stdio' && (!definition.command || definition.command.trim().length === 0)) {
      throw new Error('MCP stdio server requires command')
    }
    if (configType === 'stdio' && definition.args !== undefined && !Array.isArray(definition.args)) {
      throw new Error('MCP stdio server args must be an array')
    }
    if (configType === 'http' || configType === 'streamable_http') {
      try {
        const parsedUrl = new URL(definition.baseUrl)
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
          throw new Error('unsupported protocol')
        }
      } catch {
        throw new Error(`MCP ${configType} server requires a valid http(s) baseUrl`)
      }
    }

    const sanitizedBaseUrl = redactSecretParams(definition.baseUrl)

    return {
      ...definition,
      baseUrl: sanitizedBaseUrl,
      configType,
      trustLevel: definition.trustLevel ?? 'untrusted',
      sandboxPolicy: definition.sandboxPolicy ?? {},
      status: definition.status ?? 'active',
    }
  }

  private rowToDefinition(row: McpServerRow): MCPServerDefinition {
    return {
      serverId: row.server_id,
      name: row.name,
      version: row.version,
      description: row.description ?? undefined,
      baseUrl: row.base_url,
      configType: row.config_type,
      command: row.command ?? undefined,
      args: this.parseJson<string[]>(row.args, []),
      authentication: this.parseJson<MCPServerAuthConfig | undefined>(row.authentication_json, undefined),
      capabilities: [],
      supportedFormats: ['json'],
      trustLevel: row.trust_level,
      sandboxPolicy: this.parseJson<Record<string, unknown>>(row.sandbox_policy, {}),
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private parseJson<T>(value: string | null, fallback: T): T {
    if (!value) {
      return fallback
    }
    return JSON.parse(value) as T
  }
}

export function createMcpServerRegistry(connection: ConnectionManager): McpServerRegistry {
  return new SqliteMcpServerRegistry(connection)
}

export { SqliteMcpServerRegistry, redactSecretParams }
