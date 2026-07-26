import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import type { ProviderType } from '../storage/provider-config-store.js'
import { getProviderCatalogEntry } from './catalog/provider-catalog.js'
import { stripVersionSegment } from './url-normalize.js'

export const TEST_TIMEOUT_MS = 10000

export interface RemoteModelsResult {
  success: boolean
  latencyMs: number
  models: string[]
  modelCount?: number
  error?: string
}

export interface FetchRemoteModelsInput {
  providerType: ProviderType
  apiKey: string | null
  baseUrl: string | null
}

/**
 * Build the models path for an OpenAI-compatible base URL.
 *
 * Rules (reused from src/api/routes/providers.ts):
 *   - If path already ends with /models → keep
 *   - If ends with /v\d+ or /api/v\d+ → append /models
 *   - Otherwise → append /v1/models
 */
export function buildOpenAICompatibleModelsPath(baseUrl: string): string {
  const url = new URL(baseUrl)
  const trimmedPath = url.pathname.replace(/\/+$/, '')

  if (trimmedPath.endsWith('/models')) {
    return trimmedPath || '/models'
  }

  if (/\/v\d+$/.test(trimmedPath) || /\/api\/v\d+$/.test(trimmedPath)) {
    return `${trimmedPath}/models`
  }

  return `${trimmedPath || ''}/v1/models`
}

function formatConnectionError(err: Error & { code?: string }, target: string): string {
  const details = err.message || err.code || 'unknown network error'
  const code = err.code && err.message ? ` (${err.code})` : ''
  return `Connection error: ${details}${code} while connecting to ${target}`
}

function parseOpenAIShapedModels(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object') return []
  const data = (parsed as { data?: unknown }).data
  if (!Array.isArray(data)) return []
  return data
    .filter((entry): entry is { id: string } => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === 'string'
      )
    })
    .map((entry) => entry.id)
}

function parseOllamaTagsModels(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object') return []
  const models = (parsed as { models?: unknown }).models
  if (!Array.isArray(models)) return []
  return models
    .filter((entry): entry is { name: string } => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as { name?: unknown }).name === 'string'
      )
    })
    .map((entry) => entry.name)
}

function performRequest(
  url: URL,
  path: string,
  headers: Record<string, string>,
  target: string,
  parseBody: (parsed: unknown) => string[],
): Promise<RemoteModelsResult> {
  const startTime = Date.now()
  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest

  return new Promise((resolve) => {
    const req = requestFn(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path,
        method: 'GET',
        headers,
        timeout: TEST_TIMEOUT_MS,
      },
      (res) => {
        const latencyMs = Date.now() - startTime
        let data = ''

        res.on('data', (chunk: Buffer) => {
          data += chunk.toString()
        })

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data)
              const models = parseBody(parsed)
              resolve({ success: true, latencyMs, models, modelCount: models.length })
            } catch {
              resolve({ success: false, latencyMs, models: [], error: 'Invalid JSON response' })
            }
          } else if (res.statusCode === 401) {
            resolve({
              success: false,
              latencyMs,
              models: [],
              error: 'Authentication failed: Invalid API key',
            })
          } else {
            resolve({
              success: false,
              latencyMs,
              models: [],
              error: `Provider returned status ${res.statusCode}`,
            })
          }
        })
      },
    )

    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        models: [],
        error: formatConnectionError(err, target),
      })
    })

    req.on('timeout', () => {
      req.destroy()
      const latencyMs = Date.now() - startTime
      resolve({
        success: false,
        latencyMs,
        models: [],
        error: `Connection timed out while connecting to ${target}`,
      })
    })

    req.end()
  })
}

function fetchOpenAICompatible(apiKey: string, baseUrl: string): Promise<RemoteModelsResult> {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return Promise.resolve({
      success: false,
      latencyMs: 0,
      models: [],
      error: 'Invalid base URL format',
    })
  }

  const path = buildOpenAICompatibleModelsPath(baseUrl)
  const target = `${url.origin}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  return performRequest(url, path, headers, target, parseOpenAIShapedModels)
}

function fetchOllamaTags(baseUrl: string): Promise<RemoteModelsResult> {
  // Ollama canonical tags endpoint is /api/tags on the origin (NOT /v1/api/tags).
  // Strip any trailing /vN version segment from the stored base URL before
  // building the tags URL so a base configured as http://host:11434/v1 still
  // hits http://host:11434/api/tags.
  const origin = stripVersionSegment(baseUrl)
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return Promise.resolve({
      success: false,
      latencyMs: 0,
      models: [],
      error: 'Invalid base URL format',
    })
  }

  const path = '/api/tags'
  const target = `${url.origin}${path}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  return performRequest(url, path, headers, target, parseOllamaTagsModels)
}

/**
 * Fetch model IDs from a remote LLM provider. Pure helper — no DB, network-only.
 *
 * Dispatches by providerType using the provider catalog:
 *   - mock → returns a fixed mock-model without any network call
 *   - ollama → GET {baseUrl}/api/tags, parse models[].name
 *   - openai-compatible (openai, openrouter, deepseek, custom, domestic) →
 *       GET {baseUrl}/v1/models (path built by buildOpenAICompatibleModelsPath),
 *       parse data[].id
 *   - unknown → failure with "Unsupported provider type: <type>"
 */
export async function fetchRemoteProviderModels(input: FetchRemoteModelsInput): Promise<RemoteModelsResult> {
  const { providerType, apiKey, baseUrl } = input

  if (providerType === 'mock') {
    return { success: true, latencyMs: 0, models: ['mock-model'], modelCount: 1 }
  }

  const catalogEntry = getProviderCatalogEntry(providerType)
  if (!catalogEntry) {
    return {
      success: false,
      latencyMs: 0,
      models: [],
      error: `Unsupported provider type: ${providerType}`,
    }
  }

  const effectiveBaseUrl = baseUrl ?? catalogEntry.defaultBaseUrl ?? null

  // Ollama model discovery uses the canonical /api/tags endpoint on the
  // origin. Dispatch by providerType (not catalog family) so this still
  // fires after the catalog family was changed to 'openai_compatible'.
  if (providerType === 'ollama') {
    if (!effectiveBaseUrl) {
      return { success: false, latencyMs: 0, models: [], error: 'Base URL is required for Ollama' }
    }
    return fetchOllamaTags(effectiveBaseUrl)
  }

  // OpenAI-compatible family (openai, openrouter, deepseek, custom, domestic)
  if (!apiKey) {
    return {
      success: false,
      latencyMs: 0,
      models: [],
      error: `API key is required for ${providerType} provider`,
    }
  }
  if (!effectiveBaseUrl) {
    return {
      success: false,
      latencyMs: 0,
      models: [],
      error: `Base URL is required for ${providerType} provider`,
    }
  }

  return fetchOpenAICompatible(apiKey, effectiveBaseUrl)
}