import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/config/amap', () => ({
  getAmapConfig: vi.fn(),
  isAmapMockMode: vi.fn(),
  isAmapEnabled: vi.fn(),
}))

vi.mock('@amap/amap-jsapi-loader', () => ({
  load: vi.fn(),
}))

import useAmapLoader, {
  mockAmapInstances,
  resetMockAmapInstances,
} from './useAmapLoader'
import { getAmapConfig, isAmapMockMode } from '@/config/amap'
import { load as loadAmap } from '@amap/amap-jsapi-loader'

const mockGetAmapConfig = vi.mocked(getAmapConfig)
const mockIsAmapMockMode = vi.mocked(isAmapMockMode)
const mockLoadAmap = vi.mocked(loadAmap)

const TEST_CONFIG = {
  key: 'test-key-123',
  version: '2.0',
  securityJsCode: 'test-security-code',
  serviceHost: undefined,
}

const TEST_AMAP = { Map: class {}, Marker: class {}, Polyline: class {}, InfoWindow: class {} }

describe('useAmapLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockAmapInstances()
    delete (window as unknown as Record<string, unknown>)._AMapSecurityConfig
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)._AMapSecurityConfig
  })

  // --- Security config ---

  it('sets window._AMapSecurityConfig before calling load()', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)

    const loadOrder: string[] = []
    mockLoadAmap.mockImplementation(() => {
      // At the point load() is called, security config must already be set
      const secConfig = (window as unknown as Record<string, unknown>)._AMapSecurityConfig as
        | { securityJsCode: string }
        | undefined
      if (secConfig?.securityJsCode === 'test-security-code') {
        loadOrder.push('load:securityConfigSet')
      }
      loadOrder.push('load:called')
      return Promise.resolve(TEST_AMAP)
    })

    await act(async () => {
      renderHook(() => useAmapLoader())
    })

    expect(loadOrder).toEqual(['load:securityConfigSet', 'load:called'])
    expect((window as unknown as Record<string, unknown>)._AMapSecurityConfig).toEqual({
      securityJsCode: 'test-security-code',
    })
  })

  it('skips security config when securityJsCode is not set', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue({ key: 'k', version: '2.0' })
    mockLoadAmap.mockResolvedValue(TEST_AMAP)

    await act(async () => {
      renderHook(() => useAmapLoader())
    })

    expect((window as unknown as Record<string, unknown>)._AMapSecurityConfig).toBeUndefined()
    expect(mockLoadAmap).toHaveBeenCalled()
  })

  // --- Plugin pass-through ---

  it('passes plugins to load()', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)
    mockLoadAmap.mockResolvedValue(TEST_AMAP)

    await act(async () => {
      renderHook(() => useAmapLoader({ plugins: ['AMap.Scale', 'AMap.ToolBar'] }))
    })

    expect(mockLoadAmap).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'test-key-123',
        version: '2.0',
        plugins: ['AMap.Scale', 'AMap.ToolBar'],
      }),
    )
  })

  it('omits plugins from load options when none provided', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)
    mockLoadAmap.mockResolvedValue(TEST_AMAP)

    await act(async () => {
      renderHook(() => useAmapLoader())
    })

    expect(mockLoadAmap).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'test-key-123', version: '2.0' }),
    )
    const callOpts = mockLoadAmap.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callOpts).not.toHaveProperty('plugins')
  })

  // --- Loading / success / error states ---

  it('sets loading=false and amap on success', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)
    mockLoadAmap.mockResolvedValue(TEST_AMAP)

    const { result } = renderHook(() => useAmapLoader())

    // Initial state: loading
    expect(result.current.loading).toBe(true)
    expect(result.current.amap).toBeNull()
    expect(result.current.error).toBeNull()

    await act(async () => {
      // Wait for the load promise to resolve
    })

    expect(result.current.loading).toBe(false)
    expect(result.current.amap).toBe(TEST_AMAP)
    expect(result.current.error).toBeNull()
  })

  it('sets error on load failure', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)
    mockLoadAmap.mockRejectedValue(new Error('Network timeout'))

    const { result } = renderHook(() => useAmapLoader())

    await act(async () => {})

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('Network timeout')
    expect(result.current.amap).toBeNull()
  })

  it('handles non-Error rejection gracefully', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)
    mockLoadAmap.mockRejectedValue('string error')

    const { result } = renderHook(() => useAmapLoader())

    await act(async () => {})

    expect(result.current.error).toBe('Failed to load AMap JSAPI')
    expect(result.current.amap).toBeNull()
  })

  it('clears error on subsequent successful load', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)
    mockLoadAmap.mockRejectedValueOnce(new Error('first failure'))

    const { result, rerender } = renderHook(
      (props: { plugins?: string[] }) => useAmapLoader(props),
      { initialProps: {} },
    )

    await act(async () => {})
    expect(result.current.error).toBe('first failure')

    // Set up success for the next load
    mockLoadAmap.mockResolvedValueOnce(TEST_AMAP)

    // Change plugins to trigger effect re-run
    rerender({ plugins: ['AMap.Scale'] })

    await act(async () => {})

    expect(result.current.error).toBeNull()
    expect(result.current.amap).toBe(TEST_AMAP)
    expect(result.current.loading).toBe(false)
  })

  it('sets error when config is not available', () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(null)

    const { result } = renderHook(() => useAmapLoader())

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('AMap JSAPI key not configured')
    expect(result.current.amap).toBeNull()
    expect(mockLoadAmap).not.toHaveBeenCalled()
  })

  // --- Mock mode ---

  it('returns mock AMap in mock mode without calling load()', () => {
    mockIsAmapMockMode.mockReturnValue(true)

    const { result } = renderHook(() => useAmapLoader())

    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(result.current.amap).not.toBeNull()
    expect(mockLoadAmap).not.toHaveBeenCalled()
  })

  it('mock AMap constructors track instances for test assertions', () => {
    mockIsAmapMockMode.mockReturnValue(true)

    const { result } = renderHook(() => useAmapLoader())
    const amap = result.current.amap!

    const container = document.createElement('div')
    new amap.Map(container, { zoom: 10 })
    new amap.Map(container, { zoom: 12 })
    new amap.Marker({ position: [116.39, 39.9] })
    new amap.Polyline({ path: [[116.39, 39.9]] })
    new amap.InfoWindow({ content: 'hello' })

    expect(mockAmapInstances.Map).toHaveLength(2)
    expect(mockAmapInstances.Map[0]).toEqual([container, { zoom: 10 }])
    expect(mockAmapInstances.Map[1]).toEqual([container, { zoom: 12 }])
    expect(mockAmapInstances.Marker).toHaveLength(1)
    expect(mockAmapInstances.Marker[0]).toEqual([{ position: [116.39, 39.9] }])
    expect(mockAmapInstances.Polyline).toHaveLength(1)
    expect(mockAmapInstances.InfoWindow).toHaveLength(1)
  })

  it('resetMockAmapInstances clears tracked instances', () => {
    mockIsAmapMockMode.mockReturnValue(true)

    const { result } = renderHook(() => useAmapLoader())
    new result.current.amap!.Map(document.createElement('div'))
    expect(mockAmapInstances.Map).toHaveLength(1)

    resetMockAmapInstances()
    expect(mockAmapInstances.Map).toHaveLength(0)
  })

  // --- Cleanup ---

  it('does not update state after unmount during pending load', async () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)

    let resolveLoad: (value: unknown) => void
    mockLoadAmap.mockImplementation(
      () => new Promise((resolve) => {
        resolveLoad = resolve
      }),
    )

    const { result, unmount } = renderHook(() => useAmapLoader())
    expect(result.current.loading).toBe(true)

    unmount()

    // Resolve after unmount — should NOT trigger state update
    await act(async () => {
      resolveLoad!(TEST_AMAP)
    })

    // If the hook tried to setState after unmount, React would warn/error.
    // The fact that we reach here without error proves cleanup works.
    expect(result.current.loading).toBe(true)
    expect(result.current.amap).toBeNull()
  })

  // --- No real network ---

  it('makes no real network calls (loader is fully mocked)', () => {
    mockIsAmapMockMode.mockReturnValue(false)
    mockGetAmapConfig.mockReturnValue(TEST_CONFIG)
    mockLoadAmap.mockResolvedValue(TEST_AMAP)

    renderHook(() => useAmapLoader())

    // The mock was called, not the real loader
    expect(mockLoadAmap).toHaveBeenCalledTimes(1)
    // No script tags appended to document
    const scripts = document.querySelectorAll('script[src*="amap"]')
    expect(scripts).toHaveLength(0)
  })
})
