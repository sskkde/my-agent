/**
 * Provider Catalog
 * Centralized registry of built-in provider configurations
 */

import type { ProviderFamily, ProviderProtocol, PromptProviderFamily } from '../types.js'
import type { ProviderType } from '../../storage/provider-config-store.js'
import { DOMESTIC_PROVIDERS } from './domestic-providers.js'

/**
 * Provider catalog entry
 * Metadata for a built-in provider type
 */
export interface ProviderCatalogEntry {
  /** Provider type identifier */
  providerType: ProviderType
  /** Human-readable display name */
  displayName: string
  /** Provider family (architectural category) */
  family: ProviderFamily
  /** Communication protocol */
  protocol: ProviderProtocol
  /** Prompt template family */
  promptFamily: PromptProviderFamily
  /** Default base URL (optional) */
  defaultBaseUrl?: string
  /** Whether API key is required */
  requiresApiKey: boolean
  /** Whether base URL is required */
  requiresBaseUrl: boolean
  /** Default model ID (optional) */
  defaultModel?: string
}

/**
 * Non-domestic provider catalog entries (hand-maintained)
 */
const NON_DOMESTIC_CATALOG_ENTRIES: ProviderCatalogEntry[] = [
  {
    providerType: 'openai',
    displayName: 'OpenAI',
    family: 'openai',
    protocol: 'openai_chat',
    promptFamily: 'openai',
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    providerType: 'openrouter',
    displayName: 'OpenRouter',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    promptFamily: 'openai',
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    providerType: 'ollama',
    displayName: 'Ollama',
    family: 'ollama',
    protocol: 'ollama_chat',
    promptFamily: 'ollama',
    requiresApiKey: false,
    requiresBaseUrl: true,
    defaultBaseUrl: 'http://localhost:11434',
  },
  {
    providerType: 'custom',
    displayName: 'Custom',
    family: 'openai_compatible',
    protocol: 'openai_chat',
    promptFamily: 'openai',
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
]

/**
 * Domestic provider catalog entries (generated from DOMESTIC_PROVIDERS definitions)
 * All domestic providers use OpenAI-compatible API protocol.
 */
const DOMESTIC_CATALOG_ENTRIES: ProviderCatalogEntry[] = DOMESTIC_PROVIDERS.map((p) => ({
  providerType: p.providerType as ProviderType,
  displayName: p.displayName,
  family: 'openai_compatible' as ProviderFamily,
  protocol: 'openai_chat' as ProviderProtocol,
  promptFamily: 'openai' as PromptProviderFamily,
  defaultBaseUrl: p.defaultBaseUrl,
  defaultModel: p.defaultModel,
  requiresApiKey: true,
  requiresBaseUrl: false,
}))

/**
 * Built-in provider catalog
 * Registry of all supported provider types with their metadata
 */
export const BUILTIN_PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  ...NON_DOMESTIC_CATALOG_ENTRIES,
  ...DOMESTIC_CATALOG_ENTRIES,
]

/**
 * Get provider catalog entry by type
 * @param providerType - Provider type to look up
 * @returns Catalog entry or null if not found
 */
export function getProviderCatalogEntry(providerType: string): ProviderCatalogEntry | null {
  return BUILTIN_PROVIDER_CATALOG.find((entry) => entry.providerType === providerType) ?? null
}

/**
 * Check if a provider type is known
 * @param providerType - Provider type to check
 * @returns True if provider type is in the catalog
 */
export function isKnownProviderType(providerType: string): boolean {
  return BUILTIN_PROVIDER_CATALOG.some((entry) => entry.providerType === providerType)
}

/**
 * List all provider catalog entries
 * @returns Array of all catalog entries
 */
export function listProviderCatalogEntries(): ProviderCatalogEntry[] {
  return [...BUILTIN_PROVIDER_CATALOG]
}
