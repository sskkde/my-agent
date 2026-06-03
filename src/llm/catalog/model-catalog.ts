/**
 * Model Catalog
 * Provides model lookup and fallback resolution
 */

import type { ModelInfo, ProviderFamily, ProviderProtocol } from '../types.js';
import {
  BUILTIN_MODELS,
  DEFAULT_TEXT_MODEL_CAPABILITIES,
  DEFAULT_LIMITS,
} from './builtin-models.js';

/**
 * Generates a unique key for a model
 * @param providerId - The provider identifier
 * @param modelId - The model identifier
 * @returns A key in the format "providerId/modelId"
 */
export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

/**
 * Retrieves a built-in model by provider and model ID
 * @param providerId - The provider identifier
 * @param modelId - The model identifier
 * @returns The model info if found, null otherwise
 */
export function getBuiltinModel(
  providerId: string,
  modelId: string
): ModelInfo | null {
  const key = modelKey(providerId, modelId);
  const model = BUILTIN_MODELS.find(
    (m) => modelKey(m.providerId, m.modelId) === key
  );
  return model ?? null;
}

/**
 * Creates a fallback model info with conservative defaults
 * Used when a model is not in the built-in catalog
 * @param providerId - The provider identifier
 * @param modelId - The model identifier
 * @param family - Optional provider family (defaults to 'openai_compatible')
 * @param protocol - Optional provider protocol (defaults to 'openai_chat')
 * @returns A model info with conservative defaults
 */
export function createFallbackModelInfo(
  providerId: string,
  modelId: string,
  family?: ProviderFamily,
  protocol?: ProviderProtocol
): ModelInfo {
  return {
    providerId,
    modelId,
    family: family ?? 'openai_compatible',
    protocol: protocol ?? 'openai_chat',
    capabilities: DEFAULT_TEXT_MODEL_CAPABILITIES,
    limits: DEFAULT_LIMITS,
  };
}

/**
 * Resolves model info by trying built-in catalog first, then fallback
 * @param providerId - The provider identifier
 * @param modelId - The model identifier
 * @param family - Optional provider family for fallback
 * @param protocol - Optional provider protocol for fallback
 * @returns The model info (from catalog or fallback)
 */
export function resolveModelInfo(
  providerId: string,
  modelId: string,
  family?: ProviderFamily,
  protocol?: ProviderProtocol
): ModelInfo {
  const builtin = getBuiltinModel(providerId, modelId);
  if (builtin) {
    return builtin;
  }
  return createFallbackModelInfo(providerId, modelId, family, protocol);
}
