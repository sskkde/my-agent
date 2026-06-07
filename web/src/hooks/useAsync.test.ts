import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAsync, useFetch } from './useAsync'

describe('useAsync', () => {
  it('should initialize with default state', () => {
    const asyncFn = vi.fn().mockResolvedValue('data')
    const { result } = renderHook(() => useAsync(asyncFn))

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should initialize with initial data', () => {
    const asyncFn = vi.fn().mockResolvedValue('data')
    const { result } = renderHook(() => useAsync(asyncFn, 'initial'))

    expect(result.current.data).toBe('initial')
  })

  it('should handle successful execution', async () => {
    const asyncFn = vi.fn().mockResolvedValue('result')
    const { result } = renderHook(() => useAsync(asyncFn))

    await act(async () => {
      const res = await result.current.execute()
      expect(res).toBe('result')
    })

    expect(result.current.data).toBe('result')
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should handle error during execution', async () => {
    const asyncFn = vi.fn().mockRejectedValue(new Error('test error'))
    const { result } = renderHook(() => useAsync(asyncFn))

    await act(async () => {
      const res = await result.current.execute()
      expect(res).toBeNull()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe('test error')
  })

  it('should set loading state during execution', async () => {
    let resolvePromise: (value: string) => void
    const asyncFn = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePromise = resolve
        }),
    )
    const { result } = renderHook(() => useAsync(asyncFn))

    act(() => {
      result.current.execute()
    })

    expect(result.current.loading).toBe(true)

    await act(async () => {
      resolvePromise('done')
    })

    expect(result.current.loading).toBe(false)
  })

  it('should reset state', async () => {
    const asyncFn = vi.fn().mockResolvedValue('result')
    const { result } = renderHook(() => useAsync(asyncFn))

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.data).toBe('result')

    act(() => {
      result.current.reset()
    })

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('should allow manual state updates', () => {
    const asyncFn = vi.fn().mockResolvedValue('data')
    const { result } = renderHook(() => useAsync(asyncFn))

    act(() => {
      result.current.setData('manual data')
    })
    expect(result.current.data).toBe('manual data')

    act(() => {
      result.current.setLoading(true)
    })
    expect(result.current.loading).toBe(true)

    act(() => {
      result.current.setError('manual error')
    })
    expect(result.current.error).toBe('manual error')
  })
})

describe('useFetch', () => {
  it('should be an alias for useAsync', () => {
    const fetchFn = vi.fn().mockResolvedValue('data')
    const { result } = renderHook(() => useFetch(fetchFn))

    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
    expect(typeof result.current.execute).toBe('function')
    expect(typeof result.current.reset).toBe('function')
  })
})
