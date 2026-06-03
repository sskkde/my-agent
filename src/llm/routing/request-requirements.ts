/**
 * Request Requirements Module
 * Analyzes LLM requests to determine capability requirements and validates model compatibility
 */

import type { LLMRequest, ModelInfo, RequestRequirements } from '../types.js';

/**
 * Derives request requirements from an LLM request
 * Analyzes the request structure to determine what capabilities are needed
 * 
 * @param request - The LLM request to analyze
 * @returns RequestRequirements object indicating what capabilities are needed
 * 
 * @example
 * ```typescript
 * const requirements = deriveRequestRequirements({
 *   model: 'gpt-4',
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   tools: [{ type: 'function', function: { name: 'get_weather', ... } }]
 * });
 * // requirements.requiresTools === true
 * ```
 */
export function deriveRequestRequirements(request: LLMRequest): RequestRequirements {
  return {
    requiresTools: Array.isArray(request.tools) && request.tools.length > 0,
    requiresJsonMode: request.responseFormat?.type === 'json_object',
    requiresStreaming: false, // Conservative: we don't know streaming intent from request yet
    requiresVision: false,    // No vision content detection in current LLMRequest shape
    requiresAudio: false,     // No audio in current request shape
    requiresPdf: false,       // No PDF in current request shape
    minOutputTokens: request.maxTokens,
  };
}

/**
 * Checks if a model can serve a request based on requirements
 * Validates that the model has all required capabilities to fulfill the request
 * 
 * @param requirements - The requirements derived from the request
 * @param model - The model to validate against requirements
 * @returns true if the model can serve the request, false otherwise
 * 
 * @example
 * ```typescript
 * const requirements = { requiresTools: true, ... };
 * const model = {
 *   capabilities: { functionCalling: true, ... },
 *   limits: { outputTokens: 4096, ... }
 * };
 * const canServe = canServeRequest(requirements, model); // true
 * ```
 */
export function canServeRequest(requirements: RequestRequirements, model: ModelInfo): boolean {
  if (requirements.requiresTools && !model.capabilities.functionCalling) {
    return false;
  }

  if (requirements.requiresJsonMode && !model.capabilities.jsonMode) {
    return false;
  }

  if (requirements.requiresStreaming && !model.capabilities.streaming) {
    return false;
  }

  if (requirements.requiresVision && !model.capabilities.vision) {
    return false;
  }

  if (requirements.requiresAudio && !model.capabilities.audioInput) {
    return false;
  }

  if (requirements.requiresPdf && !model.capabilities.pdfInput) {
    return false;
  }

  if (requirements.minOutputTokens && model.limits.outputTokens < requirements.minOutputTokens) {
    return false;
  }

  return true;
}
