/**
 * Provider Catalog
 * Centralized registry of built-in provider configurations
 */

import type { ProviderFamily, ProviderProtocol, PromptProviderFamily } from '../types.js'
import type { ProviderType } from '../../storage/provider-config-store.js'

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
 * Built-in provider catalog
 * Registry of all supported provider types with their metadata
 */
export const BUILTIN_PROVIDER_CATALOG: ProviderCatalogEntry[] = [
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
    providerType: 'deepseek',
    displayName: 'DeepSeek',
    family: 'deepseek',
    protocol: 'openai_chat',
    promptFamily: 'deepseek',
    defaultBaseUrl: 'https://api.deepseek.com',
    requiresApiKey: true,
    requiresBaseUrl: false,
    defaultModel: 'deepseek-v4-flash',
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
