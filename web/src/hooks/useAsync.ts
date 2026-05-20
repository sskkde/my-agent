import { useState, useCallback } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseAsyncReturn<T> extends AsyncState<T> {
  execute: () => Promise<T | null>;
  reset: () => void;
  setData: (data: T | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

/**
 * A hook for managing async operation state.
 * Useful for one-off async operations like form submissions.
 */
export function useAsync<T>(
  asyncFn: () => Promise<T>,
  initialData: T | null = null
): UseAsyncReturn<T> {
  const [state, setState] = useState<AsyncState<T>>({
    data: initialData,
    loading: false,
    error: null,
  });

  const execute = useCallback(async (): Promise<T | null> => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await asyncFn();
      setState({ data: result, loading: false, error: null });
      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '未知错误';
      setState((prev) => ({ ...prev, loading: false, error: errorMessage }));
      return null;
    }
  }, [asyncFn]);

  const reset = useCallback(() => {
    setState({ data: initialData, loading: false, error: null });
  }, [initialData]);

  const setData = useCallback((data: T | null) => {
    setState((prev) => ({ ...prev, data }));
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setState((prev) => ({ ...prev, loading }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  return {
    ...state,
    execute,
    reset,
    setData,
    setLoading,
    setError,
  };
}

/**
 * A hook for managing async data fetching with automatic execution.
 * Useful for components that need to fetch data on mount.
 */
export function useFetch<T>(
  fetchFn: () => Promise<T>,
  initialData: T | null = null
): UseAsyncReturn<T> {
  return useAsync(fetchFn, initialData);
}
