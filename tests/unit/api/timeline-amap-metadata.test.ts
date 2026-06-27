import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createConsoleTimelineService, type ConsoleTimelineStores } from '../../../src/api/console-timeline.js'
import type { TranscriptStore, TurnTranscript } from '../../../src/storage/transcript-store.js'
import type { EventStore } from '../../../src/storage/event-store.js'

const SENTINEL_SECRET = 'AMAP_SECRET_SHOULD_NOT_APPEAR'

describe('Console Timeline — AMap MCP Metadata Enrichment', () => {
  let stores: ConsoleTimelineStores
  let savedTranscripts: TurnTranscript[]
  let service: ReturnType<typeof createConsoleTimelineService>

  beforeEach(() => {
    savedTranscripts = []

    const mockTranscriptStore = {
      saveTurn: vi.fn((transcript: TurnTranscript) => {
        savedTranscripts.push(transcript)
        return true
      }),
      getTurn: vi.fn().mockReturnValue(null),
      findBySession: vi.fn((sessionId: string) => {
        return savedTranscripts.filter((t) => t.sessionId === sessionId)
      }),
      search: vi.fn().mockReturnValue([]),
      findByArtifactRef: vi.fn().mockReturnValue([]),
      findByPlannerRunId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn().mockReturnValue(0),
    } as unknown as TranscriptStore

    const mockEventStore = {
      append: vi.fn(),
      query: vi.fn().mockReturnValue([]),
      findByCorrelationId: vi.fn().mockReturnValue([]),
      findByCausationId: vi.fn().mockReturnValue([]),
      updateUserIdForSession: vi.fn(),
    } as unknown as EventStore

    stores = { transcriptStore: mockTranscriptStore, eventStore: mockEventStore }
    service = createConsoleTimelineService(stores)
  })

  describe('tool_call events always include metadata.toolName', () => {
    const session = 'test-amap-toolname'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-toolname-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Search for coffee shops' },
        output: { visibleMessages: [] },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-1', toolName: 'mcp.amap-maps.maps_search_poi', status: 'completed' as const },
            { toolCallId: 'tc-2', toolName: 'read_file', status: 'completed' as const },
            { toolCallId: 'tc-3', toolName: 'web_search', status: 'failed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T10:00:00.000Z',
      })
    })

    it('includes toolName in metadata for AMap tool calls', () => {
      const result = service.getTimeline(session)
      const toolCall = result.events.find(
        (e) => e.eventType === 'tool_call' && e.metadata?.toolCallId === 'tc-1',
      )
      expect(toolCall).toBeDefined()
      expect(toolCall!.metadata?.toolName).toBe('mcp.amap-maps.maps_search_poi')
    })

    it('includes toolName in metadata for non-AMap tool calls', () => {
      const result = service.getTimeline(session)
      const readFile = result.events.find(
        (e) => e.eventType === 'tool_call' && e.metadata?.toolCallId === 'tc-2',
      )
      expect(readFile).toBeDefined()
      expect(readFile!.metadata?.toolName).toBe('read_file')

      const webSearch = result.events.find(
        (e) => e.eventType === 'tool_call' && e.metadata?.toolCallId === 'tc-3',
      )
      expect(webSearch).toBeDefined()
      expect(webSearch!.metadata?.toolName).toBe('web_search')
    })
  })

  describe('AMap geocode tool_result enrichment', () => {
    const session = 'test-amap-geocode'
    const geocodeResult = JSON.stringify({
      geocodes: [{
        formatted_address: '北京市朝阳区望京街道',
        location: '116.481028,39.989643',
        level: '门牌号',
        province: '北京市',
        city: '北京市',
        district: '朝阳区',
      }],
    })

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-geocode-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Geocode this address' },
        output: {
          visibleMessages: [{ messageId: 'msg-geo-001', role: 'tool', content: geocodeResult }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-geo-1', toolName: 'mcp.amap-maps.maps_geo', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T11:00:00.000Z',
      })
    })

    it('enriches tool_result with parsed geocode data', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      expect(toolResult).toBeDefined()

      const amapResult = toolResult!.metadata?.amapResult as Record<string, unknown>
      expect(amapResult).toBeDefined()
      expect(amapResult.resultType).toBe('geocode')

      const geocodes = amapResult.geocodes as Array<Record<string, unknown>>
      expect(geocodes).toHaveLength(1)
      expect(geocodes[0].formatted_address).toBe('北京市朝阳区望京街道')
      expect(geocodes[0].location).toBe('116.481028,39.989643')
      expect(geocodes[0].province).toBe('北京市')
      expect(geocodes[0].city).toBe('北京市')
      expect(geocodes[0].district).toBe('朝阳区')
    })

    it('includes amapToolNames in tool_result metadata', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      expect(toolResult!.metadata?.amapToolNames).toEqual(['mcp.amap-maps.maps_geo'])
    })
  })

  describe('AMap POI tool_result enrichment', () => {
    const session = 'test-amap-poi'
    const poiResult = JSON.stringify({
      pois: [
        { name: '星巴克(望京店)', location: '116.481028,39.989643', address: '望京街道1号', type: '餐饮服务;咖啡厅', typecode: '050301' },
        { name: '瑞幸咖啡(望京SOHO)', location: '116.482000,39.990000', address: '望京SOHO T1', type: '餐饮服务;咖啡厅', typecode: '050301' },
      ],
    })

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-poi-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Find coffee shops nearby' },
        output: {
          visibleMessages: [{ messageId: 'msg-poi-001', role: 'tool', content: poiResult }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-poi-1', toolName: 'mcp.amap-maps.maps_search_poi', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T12:00:00.000Z',
      })
    })

    it('enriches tool_result with parsed POI data', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      const amapResult = toolResult!.metadata?.amapResult as Record<string, unknown>
      expect(amapResult).toBeDefined()
      expect(amapResult.resultType).toBe('poi')

      const pois = amapResult.pois as Array<Record<string, unknown>>
      expect(pois).toHaveLength(2)
      expect(pois[0].name).toBe('星巴克(望京店)')
      expect(pois[1].name).toBe('瑞幸咖啡(望京SOHO)')
    })
  })

  describe('AMap route tool_result enrichment', () => {
    const session = 'test-amap-route'
    const routeResult = JSON.stringify({
      route: {
        origin: '116.481028,39.989643',
        destination: '116.397428,39.90923',
        paths: [{ distance: '15200', duration: '2700' }, { distance: '18500', duration: '3200' }],
      },
    })

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-route-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Plan a driving route' },
        output: {
          visibleMessages: [{ messageId: 'msg-route-001', role: 'tool', content: routeResult }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-route-1', toolName: 'mcp.amap-maps.maps_direction_driving', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T13:00:00.000Z',
      })
    })

    it('enriches tool_result with parsed route data', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      const amapResult = toolResult!.metadata?.amapResult as Record<string, unknown>
      expect(amapResult).toBeDefined()
      expect(amapResult.resultType).toBe('route')
      expect(amapResult.origin).toBe('116.481028,39.989643')
      expect(amapResult.destination).toBe('116.397428,39.90923')

      const paths = amapResult.paths as Array<Record<string, unknown>>
      expect(paths).toHaveLength(2)
      expect(paths[0].distance).toBe('15200')
      expect(paths[0].duration).toBe('2700')
    })
  })

  describe('AMap weather tool_result enrichment', () => {
    const session = 'test-amap-weather'
    const weatherResult = JSON.stringify({
      lives: [{
        city: '北京市', weather: '晴', temperature: '28',
        winddirection: '南', windpower: '≤3', humidity: '45',
      }],
    })

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-weather-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Check Beijing weather' },
        output: {
          visibleMessages: [{ messageId: 'msg-weather-001', role: 'tool', content: weatherResult }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-weather-1', toolName: 'mcp.amap-maps.maps_weather', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T14:00:00.000Z',
      })
    })

    it('enriches tool_result with parsed weather data', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      const amapResult = toolResult!.metadata?.amapResult as Record<string, unknown>
      expect(amapResult).toBeDefined()
      expect(amapResult.resultType).toBe('weather')

      const lives = amapResult.lives as Array<Record<string, unknown>>
      expect(lives).toHaveLength(1)
      expect(lives[0].city).toBe('北京市')
      expect(lives[0].weather).toBe('晴')
      expect(lives[0].temperature).toBe('28')
    })
  })

  describe('AMap distance tool_result enrichment', () => {
    const session = 'test-amap-distance'
    const distanceResult = JSON.stringify({
      results: [{ distance: '5200', duration: '600' }, { distance: '8100', duration: '900' }],
    })

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-distance-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Measure distance between points' },
        output: {
          visibleMessages: [{ messageId: 'msg-dist-001', role: 'tool', content: distanceResult }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-dist-1', toolName: 'mcp.amap-maps.maps_distance', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T15:00:00.000Z',
      })
    })

    it('enriches tool_result with parsed distance data', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      const amapResult = toolResult!.metadata?.amapResult as Record<string, unknown>
      expect(amapResult).toBeDefined()
      expect(amapResult.resultType).toBe('distance')

      const results = amapResult.results as Array<Record<string, unknown>>
      expect(results).toHaveLength(2)
      expect(results[0].distance).toBe('5200')
    })
  })

  describe('Secret redaction in AMap metadata', () => {
    const session = 'test-amap-redaction'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-redact-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Geocode with leaked key' },
        output: {
          visibleMessages: [{
            messageId: 'msg-redact-001',
            role: 'tool',
            content: JSON.stringify({
              geocodes: [{
                formatted_address: '北京市朝阳区',
                location: '116.481028,39.989643',
                level: '门牌号',
                province: '北京市',
                city: '北京市',
                district: '朝阳区',
                apiKey: SENTINEL_SECRET,
                token: 'leaked_bearer_token_value_here',
                secret: 'should_not_appear',
              }],
            }),
          }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-redact-1', toolName: 'mcp.amap-maps.maps_geo', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T16:00:00.000Z',
      })
    })

    it('redacts secret fields from AMap result metadata', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      const metadataSerialized = JSON.stringify(toolResult!.metadata)
      expect(metadataSerialized).not.toContain(SENTINEL_SECRET)
      expect(metadataSerialized).not.toContain('leaked_bearer_token_value_here')
      expect(metadataSerialized).not.toContain('should_not_appear')
    })

    it('preserves safe fields after redaction', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      const amapResult = toolResult!.metadata?.amapResult as Record<string, unknown>
      expect(amapResult).toBeDefined()

      const geocodes = amapResult.geocodes as Array<Record<string, unknown>>
      expect(geocodes[0].formatted_address).toBe('北京市朝阳区')
      expect(geocodes[0].location).toBe('116.481028,39.989643')
    })
  })

  describe('Sentinel key is absent from serialized event JSON', () => {
    const session = 'test-amap-sentinel'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-sentinel-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'POI with sentinel secrets in wrapper' },
        output: {
          visibleMessages: [{
            messageId: 'msg-sentinel-001',
            role: 'tool',
            content: JSON.stringify({
              pois: [{ name: 'Test POI', location: '116.0,39.0', address: 'Test Address', type: 'test', typecode: '000000' }],
              key: SENTINEL_SECRET,
              api_key: SENTINEL_SECRET,
              access_token: SENTINEL_SECRET,
            }),
          }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-sentinel-1', toolName: 'mcp.amap-maps.maps_search_poi', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T17:00:00.000Z',
      })
    })

    it('sentinel secret is absent from tool_result metadata', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      const metadataSerialized = JSON.stringify(toolResult!.metadata)
      expect(metadataSerialized).not.toContain(SENTINEL_SECRET)
    })

    it('sentinel secret is absent from tool_call event', () => {
      const result = service.getTimeline(session)
      const toolCall = result.events.find((e) => e.eventType === 'tool_call')
      const eventSerialized = JSON.stringify(toolCall)
      expect(eventSerialized).not.toContain(SENTINEL_SECRET)
    })
  })

  describe('Non-AMap tool_result events are not enriched', () => {
    const session = 'test-non-amap'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-nonamap-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Read a file' },
        output: {
          visibleMessages: [{ messageId: 'msg-nonamap-001', role: 'tool', content: '{"fileContents":"hello world"}' }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-nonamap-1', toolName: 'read_file', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T18:00:00.000Z',
      })
    })

    it('does not add amapToolNames or amapResult for non-AMap tools', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult!.metadata?.amapToolNames).toBeUndefined()
      expect(toolResult!.metadata?.amapResult).toBeUndefined()
    })
  })

  describe('Non-JSON tool_result content is handled gracefully', () => {
    const session = 'test-non-json'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-nonjson-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Tool with plain text result' },
        output: {
          visibleMessages: [{ messageId: 'msg-nonjson-001', role: 'tool', content: 'This is plain text, not JSON' }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-nonjson-1', toolName: 'mcp.amap-maps.maps_geo', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T19:00:00.000Z',
      })
    })

    it('adds amapToolNames but no amapResult for non-JSON content', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult!.metadata?.amapToolNames).toEqual(['mcp.amap-maps.maps_geo'])
      expect(toolResult!.metadata?.amapResult).toBeUndefined()
    })
  })

  describe('JSON tool_result that is not an AMap pattern', () => {
    const session = 'test-non-amap-json'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-nonamapjson-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'AMap tool returns non-AMap structure' },
        output: {
          visibleMessages: [{
            messageId: 'msg-nonamapjson-001',
            role: 'tool',
            content: JSON.stringify({ status: 'ok', data: [1, 2, 3] }),
          }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-nonamapjson-1', toolName: 'mcp.amap-maps.maps_geo', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T20:00:00.000Z',
      })
    })

    it('adds amapToolNames but no amapResult when JSON lacks AMap patterns', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult!.metadata?.amapToolNames).toEqual(['mcp.amap-maps.maps_geo'])
      expect(toolResult!.metadata?.amapResult).toBeUndefined()
    })
  })

  describe('AMap tool with raw name pattern (non-bridged)', () => {
    const session = 'test-raw-amap'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-raw-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Geocode with raw tool name' },
        output: {
          visibleMessages: [{
            messageId: 'msg-raw-001',
            role: 'tool',
            content: JSON.stringify({
              geocodes: [{ formatted_address: '上海市浦东新区', location: '121.473701,31.230416' }],
            }),
          }],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-raw-1', toolName: 'amap_geocode', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T21:00:00.000Z',
      })
    })

    it('detects raw AMap tool names (non-bridged)', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult!.metadata?.amapToolNames).toEqual(['amap_geocode'])

      const amapResult = toolResult!.metadata?.amapResult as Record<string, unknown>
      expect(amapResult).toBeDefined()
      expect(amapResult.resultType).toBe('geocode')
    })
  })

  describe('Existing ConsoleTimelineEvent shape is preserved', () => {
    const session = 'test-shape-preserved'

    beforeEach(() => {
      savedTranscripts.push({
        turnId: 'turn-shape-001',
        sessionId: session,
        userId: 'user-1',
        input: { userMessageSummary: 'Shape preservation test' },
        output: {
          visibleMessages: [
            { messageId: 'msg-shape-001', role: 'assistant', content: 'I will look that up for you.' },
            {
              messageId: 'msg-shape-002',
              role: 'tool',
              content: JSON.stringify({ geocodes: [{ formatted_address: 'Test', location: '0,0' }] }),
            },
          ],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-shape-1', toolName: 'mcp.amap-maps.maps_geo', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-06-27T22:00:00.000Z',
      })
    })

    it('all events have required ConsoleTimelineEvent fields', () => {
      const result = service.getTimeline(session)
      for (const event of result.events) {
        expect(event.eventId).toBeDefined()
        expect(event.eventType).toBeDefined()
        expect(event.sessionId).toBe(session)
        expect(event.timestamp).toBeDefined()
      }
    })

    it('tool_call event has correct eventType and content format', () => {
      const result = service.getTimeline(session)
      const toolCall = result.events.find((e) => e.eventType === 'tool_call')
      expect(toolCall).toBeDefined()
      expect(toolCall!.content).toBe('mcp.amap-maps.maps_geo: completed')
      expect(toolCall!.actor).toBe('system')
    })

    it('tool_result event preserves base metadata fields', () => {
      const result = service.getTimeline(session)
      const toolResult = result.events.find((e) => e.eventType === 'tool_result')
      expect(toolResult).toBeDefined()
      expect(toolResult!.actor).toBe('system')
      expect(toolResult!.metadata?.turnId).toBe('turn-shape-001')
      expect(toolResult!.metadata?.userId).toBe('user-1')
    })
  })
})
