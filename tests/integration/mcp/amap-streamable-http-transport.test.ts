import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock fns (available to vi.mock factories via hoisting) ──────

const mockConnect = vi.fn()
const mockClose = vi.fn()
const mockListTools = vi.fn()
const mockCallTool = vi.fn()
const mockTransportClose = vi.fn()
const mockTerminateSession = vi.fn()

// ─── Mock SDK modules (vi.mock is hoisted above imports) ─────────

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(function () {
    return {
      connect: mockConnect,
      close: mockClose,
      listTools: mockListTools,
      callTool: mockCallTool,
    }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function () {
    return {
      terminateSession: mockTerminateSession,
      close: mockTransportClose,
    }
  }),
}))

// ─── Import after mocks are wired ────────────────────────────────

import {
  AMapStreamableHttpTransport,
  createAMapStreamableHttpTransport,
} from '../../../src/connectors/mcp/amap-streamable-http-transport.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// ─── Fixtures ────────────────────────────────────────────────────

const ENDPOINT = 'https://mcp.amap.com/mcp'
const API_KEY = 'test-secret-key-abc123'
const CONFIG = { endpoint: ENDPOINT, apiKey: API_KEY }

function twoSdkTools() {
  return {
    tools: [
      {
        name: 'geocode',
        description: 'Convert address to coordinates',
        inputSchema: {
          type: 'object' as const,
          properties: { address: { type: 'string' } },
          required: ['address'],
        },
        outputSchema: {
          type: 'object' as const,
          properties: { lat: { type: 'number' }, lng: { type: 'number' } },
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      {
        name: 'route_plan',
        description: 'Plan a driving route',
        inputSchema: {
          type: 'object' as const,
          properties: { origin: { type: 'string' }, destination: { type: 'string' } },
          required: ['origin', 'destination'],
        },
      },
    ],
  }
}

// ─── Tests ───────────────────────────────────────────────────────

describe('AMapStreamableHttpTransport', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnect.mockResolvedValue(undefined)
    mockClose.mockResolvedValue(undefined)
    mockTerminateSession.mockResolvedValue(undefined)
    mockListTools.mockResolvedValue(twoSdkTools())
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] })
  })

  // ── connect() ──────────────────────────────────────────────────

  describe('connect()', () => {
    it('establishes connection via SDK Client + StreamableHTTPClientTransport', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      expect(StreamableHTTPClientTransport).toHaveBeenCalledOnce()
      // URL passed to transport constructor should contain the API key
      const constructedUrl = vi.mocked(StreamableHTTPClientTransport).mock.calls[0][0] as URL
      expect(constructedUrl.toString()).toContain('key=test-secret-key-abc123')

      expect(Client).toHaveBeenCalledOnce()
      expect(mockConnect).toHaveBeenCalledOnce()
    })

    it('marks connected after successful connect()', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      // Before connect, listTools should throw
      await expect(transport.listTools()).rejects.toThrow('not connected')

      await transport.connect()

      // After connect, listTools should work
      const tools = await transport.listTools()
      expect(tools).toHaveLength(2)
    })

    it('is idempotent — second connect() is a no-op', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()
      await transport.connect()

      // SDK Client and connect should only be called once
      expect(Client).toHaveBeenCalledOnce()
      expect(mockConnect).toHaveBeenCalledOnce()
    })

    it('cleans up state on connection failure', async () => {
      mockConnect.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await expect(transport.connect()).rejects.toThrow('AMap MCP connection failed')

      // After failure, a retry should create fresh SDK objects
      mockConnect.mockResolvedValueOnce(undefined)
      await transport.connect()
      expect(Client).toHaveBeenCalledTimes(2)
    })

    it('uses custom clientInfo when provided', async () => {
      const transport = new AMapStreamableHttpTransport({
        ...CONFIG,
        clientInfo: { name: 'custom-client', version: '2.0.0' },
      })
      await transport.connect()

      expect(Client).toHaveBeenCalledWith({ name: 'custom-client', version: '2.0.0' })
    })
  })

  // ── listTools() ────────────────────────────────────────────────

  describe('listTools()', () => {
    it('returns descriptors matching MCPToolDescriptor type', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()
      const tools = await transport.listTools()

      expect(tools).toHaveLength(2)

      // First tool — geocode
      const geocode = tools[0]!
      expect(geocode.name).toBe('geocode')
      expect(geocode.description).toBe('Convert address to coordinates')
      expect(geocode.toolId).toContain('geocode')
      expect(geocode.inputSchema.type).toBe('object')
      expect(geocode.inputSchema.properties).toEqual({ address: { type: 'string' } })
      expect(geocode.inputSchema.required).toEqual(['address'])
      expect(geocode.outputSchema).toEqual({
        type: 'object',
        properties: { lat: { type: 'number' }, lng: { type: 'number' } },
      })
      expect(geocode.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      })

      // Second tool — route_plan
      const route = tools[1]!
      expect(route.name).toBe('route_plan')
      expect(route.description).toBe('Plan a driving route')
      expect(route.toolId).toContain('route_plan')
      expect(route.outputSchema).toBeUndefined()
      expect(route.annotations).toBeUndefined()
    })

    it('generates stable toolId across calls', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      const tools1 = await transport.listTools()
      const tools2 = await transport.listTools()

      expect(tools1[0]!.toolId).toBe(tools2[0]!.toolId)
      expect(tools1[1]!.toolId).toBe(tools2[1]!.toolId)
    })

    it('throws when not connected', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await expect(transport.listTools()).rejects.toThrow('not connected')
    })

    it('redacts API key from error messages', async () => {
      mockListTools.mockRejectedValueOnce(new Error(`Failed for ${ENDPOINT}?key=${API_KEY}`))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      try {
        await transport.listTools()
        expect.fail('should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).not.toContain(API_KEY)
        expect(message).toContain('[REDACTED]')
      }
    })
  })

  // ── callTool() ─────────────────────────────────────────────────

  describe('callTool()', () => {
    it('returns raw SDK call result', async () => {
      const sdkResult = { content: [{ type: 'text', text: '39.9,116.4' }] }
      mockCallTool.mockResolvedValueOnce(sdkResult)

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      const result = await transport.callTool('geocode', { address: 'Beijing' })

      expect(result).toBe(sdkResult)
      expect(mockCallTool).toHaveBeenCalledWith({
        name: 'geocode',
        arguments: { address: 'Beijing' },
      })
    })

    it('throws when not connected', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await expect(transport.callTool('geocode', {})).rejects.toThrow('not connected')
    })

    it('redacts API key from callTool error messages', async () => {
      mockCallTool.mockRejectedValueOnce(new Error(`timeout for key=${API_KEY}`))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      try {
        await transport.callTool('geocode', {})
        expect.fail('should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).not.toContain(API_KEY)
        expect(message).toContain('[REDACTED]')
        expect(message).toContain('callTool(geocode)')
      }
    })

    it('wraps SDK errors with tool name context', async () => {
      mockCallTool.mockRejectedValueOnce(new Error('server error'))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      await expect(transport.callTool('route_plan', { origin: 'A', destination: 'B' }))
        .rejects.toThrow('callTool(route_plan)')
    })
  })

  // ── disconnect() ───────────────────────────────────────────────

  describe('disconnect()', () => {
    it('closes session and client without throwing', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()
      await transport.disconnect()

      expect(mockTerminateSession).toHaveBeenCalledOnce()
      expect(mockClose).toHaveBeenCalledOnce()
    })

    it('is safe to call when not connected', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await expect(transport.disconnect()).resolves.toBeUndefined()
    })

    it('swallows terminateSession errors (server may return 405)', async () => {
      mockTerminateSession.mockRejectedValueOnce(new Error('Method Not Allowed'))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      // Should not throw even if terminateSession fails
      await expect(transport.disconnect()).resolves.toBeUndefined()
      // client.close() is still called
      expect(mockClose).toHaveBeenCalledOnce()
    })

    it('swallows close errors and resets state', async () => {
      mockClose.mockRejectedValueOnce(new Error('already closed'))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      await expect(transport.disconnect()).resolves.toBeUndefined()

      // State is reset — listTools should throw 'not connected'
      await expect(transport.listTools()).rejects.toThrow('not connected')
    })

    it('allows reconnection after disconnect', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()
      await transport.disconnect()
      await transport.connect()

      // Second connect creates fresh SDK objects
      expect(Client).toHaveBeenCalledTimes(2)
      expect(mockConnect).toHaveBeenCalledTimes(2)
    })
  })

  // ── Security: no raw key leakage ───────────────────────────────

  describe('security', () => {
    it('does not expose raw API key in connect error', async () => {
      mockConnect.mockRejectedValueOnce(new Error(`auth failed for ${ENDPOINT}?key=${API_KEY}`))

      const transport = new AMapStreamableHttpTransport(CONFIG)

      try {
        await transport.connect()
        expect.fail('should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).not.toContain(API_KEY)
        expect(message).toContain('[REDACTED]')
      }
    })

    it('does not expose raw API key in listTools error', async () => {
      mockListTools.mockRejectedValueOnce(new Error(`unauthorized: key=${API_KEY}`))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      try {
        await transport.listTools()
        expect.fail('should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).not.toContain(API_KEY)
      }
    })

    it('does not expose raw API key in callTool error', async () => {
      mockCallTool.mockRejectedValueOnce(new Error(`forbidden: key=${API_KEY}`))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      try {
        await transport.callTool('geocode', {})
        expect.fail('should have thrown')
      } catch (error) {
        const message = (error as Error).message
        expect(message).not.toContain(API_KEY)
      }
    })

    it('endpoint URL passed to SDK transport includes the key (for actual request)', async () => {
      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      const constructedUrl = vi.mocked(StreamableHTTPClientTransport).mock.calls[0][0] as URL
      // The URL sent to the SDK transport DOES contain the key (needed for auth)
      expect(constructedUrl.searchParams.get('key')).toBe(API_KEY)
    })
  })

  // ── Error normalization ────────────────────────────────────────

  describe('error normalization', () => {
    it('wraps unauthorized SDK errors with redacted message', async () => {
      mockConnect.mockRejectedValueOnce(new Error('HTTP 401: Unauthorized'))

      const transport = new AMapStreamableHttpTransport(CONFIG)

      await expect(transport.connect()).rejects.toThrow('AMap MCP connection failed')
    })

    it('wraps timeout SDK errors with redacted message', async () => {
      mockListTools.mockRejectedValueOnce(new Error('ETIMEDOUT'))

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await transport.connect()

      await expect(transport.listTools()).rejects.toThrow('AMap MCP listTools failed')
    })

    it('handles non-Error thrown values', async () => {
      mockConnect.mockRejectedValueOnce('string error')

      const transport = new AMapStreamableHttpTransport(CONFIG)
      await expect(transport.connect()).rejects.toThrow('AMap MCP connection failed: string error')
    })
  })
})

// ── Factory ──────────────────────────────────────────────────────

describe('createAMapStreamableHttpTransport()', () => {
  it('returns an AMapStreamableHttpTransport instance', () => {
    const transport = createAMapStreamableHttpTransport(CONFIG)
    expect(transport).toBeInstanceOf(AMapStreamableHttpTransport)
  })
})
