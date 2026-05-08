import type { SearchBackendConfig, SearchBackendResult } from './types.js';

export function resolveSearchBackend(config: SearchBackendConfig): SearchBackendResult {
  const { backend, searxngBaseUrl, tavilyApiKey, remoteApiUrl } = config;

  if (backend === 'searxng') {
    return { selectedBackend: 'searxng', baseUrl: searxngBaseUrl };
  }

  if (backend === 'tavily') {
    return { selectedBackend: 'tavily' };
  }

  if (backend === 'remote') {
    return { selectedBackend: 'remote', baseUrl: remoteApiUrl };
  }

  if (backend === 'playwright') {
    return { selectedBackend: 'playwright' };
  }

  if (backend === 'auto') {
    if (searxngBaseUrl) {
      return { selectedBackend: 'searxng', baseUrl: searxngBaseUrl };
    }
    if (tavilyApiKey) {
      return { selectedBackend: 'tavily' };
    }
    if (remoteApiUrl) {
      return { selectedBackend: 'remote', baseUrl: remoteApiUrl };
    }
    return { selectedBackend: 'none', errorCode: 'PROVIDER_NOT_CONFIGURED' };
  }

  if (backend === 'auto-browser') {
    if (searxngBaseUrl) {
      return { selectedBackend: 'searxng', baseUrl: searxngBaseUrl };
    }
    if (tavilyApiKey) {
      return { selectedBackend: 'tavily' };
    }
    if (remoteApiUrl) {
      return { selectedBackend: 'remote', baseUrl: remoteApiUrl };
    }
    return { selectedBackend: 'playwright' };
  }

  return { selectedBackend: 'none', errorCode: 'PROVIDER_NOT_CONFIGURED' };
}
