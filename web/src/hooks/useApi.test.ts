import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useApi } from './useApi';
import { ApiClientError } from '../api/client';

describe('useApi', () => {
  const mockApiFunction = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default state', () => {
    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets loading state when executing', async () => {
    mockApiFunction.mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 100)));

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    act(() => {
      result.current.execute('arg1', 'arg2');
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets data on successful execution', async () => {
    const mockData = { id: 1, name: 'test' };
    mockApiFunction.mockResolvedValue(mockData);

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    let returnValue: { id: number; name: string } | null = null;
    await act(async () => {
      returnValue = await result.current.execute('arg1', 'arg2') as { id: number; name: string } | null;
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual(mockData);
    expect(result.current.error).toBeNull();
    expect(returnValue).toEqual(mockData);
    expect(mockApiFunction).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('sets error on failed execution with regular Error', async () => {
    mockApiFunction.mockRejectedValue(new Error('API 失败'));

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    let returnValue: unknown = 'not null';
    await act(async () => {
      returnValue = await result.current.execute();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('API 失败');
    expect(returnValue).toBeNull();
  });

  it('sets error on failed execution with ApiClientError', async () => {
    mockApiFunction.mockRejectedValue(new ApiClientError({
      code: 'NOT_FOUND',
      message: '资源不存在',
    }));

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe('资源不存在');
  });

  it('handles unknown error types', async () => {
    mockApiFunction.mockRejectedValue('string error');

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe('未知错误');
  });

  it('resets state with reset function', async () => {
    const mockData = { id: 1 };
    mockApiFunction.mockResolvedValue(mockData);

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual(mockData);

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('clears error on subsequent execution', async () => {
    mockApiFunction.mockRejectedValueOnce(new Error('第一次失败'));
    mockApiFunction.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBe('第一次失败');

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ success: true });
  });

  it('preserves data between executions', async () => {
    mockApiFunction.mockResolvedValue({ id: 1 });

    const { result } = renderHook(() => useApi(mockApiFunction as (...args: unknown[]) => Promise<unknown>));

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual({ id: 1 });

    mockApiFunction.mockResolvedValue({ id: 2 });

    await act(async () => {
      await result.current.execute();
    });

    expect(result.current.data).toEqual({ id: 2 });
  });
});
