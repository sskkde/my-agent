import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
import type {
  ProviderSummary,
  CreateProviderRequest,
  UpdateProviderRequest,
  TestProviderResponse,
} from '../types.js';
import type { ProviderType, ProviderConfigSanitized } from '../../storage/provider-config-store.js';
import { randomUUID } from 'crypto';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';

const VALID_PROVIDER_TYPES: ProviderType[] = ['openai', 'openrouter', 'ollama', 'custom'];
const TEST_TIMEOUT_MS = 10000;

function sanitizeProviderForResponse(provider: ProviderConfigSanitized): ProviderSummary {
  return {
    providerId: provider.providerId,
    providerType: provider.providerType,
    displayName: provider.displayName,
    enabled: provider.enabled,
    configured: provider.configured,
    apiKeyLast4: provider.apiKeyLast4,
    baseUrl: provider.baseUrl,
    selectedModel: provider.selectedModel,
    source: provider.source,
    lastTestStatus: provider.lastTestStatus,
    lastTestedAt: provider.lastTestedAt,
    createdAt: provider.createdAt,
    updatedAt: provider.updatedAt,
  };
}

function validateProviderType(providerType: unknown): providerType is ProviderType {
  return typeof providerType === 'string' && VALID_PROVIDER_TYPES.includes(providerType as ProviderType);
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  modelCount?: number;
  error?: string;
}

function formatConnectionError(err: Error & { code?: string }, target: string): string {
  const details = err.message || err.code || 'unknown network error';
  const code = err.code && err.message ? ` (${err.code})` : '';
  return `Connection error: ${details}${code} while connecting to ${target}`;
}

function buildOpenAICompatibleModelsPath(baseUrl: string): string {
  const url = new URL(baseUrl);
  const trimmedPath = url.pathname.replace(/\/+$/, '');

  if (trimmedPath.endsWith('/models')) {
    return trimmedPath || '/models';
  }

  if (/\/v\d+$/.test(trimmedPath) || /\/api\/v\d+$/.test(trimmedPath)) {
    return `${trimmedPath}/models`;
  }

  return `${trimmedPath || ''}/v1/models`;
}

async function testOpenAICompatibleConnection(apiKey: string, baseUrl: string): Promise<TestResult> {
  const startTime = Date.now();

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return {
      success: false,
      latencyMs: 0,
      error: 'Invalid base URL format'
    };
  }

  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const path = buildOpenAICompatibleModelsPath(baseUrl);
  const target = `${url.origin}${path}`;
  
  return new Promise((resolve) => {
    const req = requestFn({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: TEST_TIMEOUT_MS,
    }, (res) => {
      const latencyMs = Date.now() - startTime;
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const modelCount = Array.isArray(parsed.data) ? parsed.data.length : undefined;
            resolve({ success: true, latencyMs, modelCount });
          } catch {
            resolve({ success: true, latencyMs });
          }
        } else if (res.statusCode === 401) {
          resolve({ 
            success: false, 
            latencyMs, 
            error: 'Authentication failed: Invalid API key' 
          });
        } else {
          resolve({ 
            success: false, 
            latencyMs, 
            error: `Provider returned status ${res.statusCode}` 
          });
        }
      });
    });
    
    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime;
      resolve({ 
        success: false, 
        latencyMs, 
        error: formatConnectionError(err, target)
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      const latencyMs = Date.now() - startTime;
      resolve({ 
        success: false, 
        latencyMs, 
        error: `Connection timed out while connecting to ${target}`
      });
    });
    
    req.end();
  });
}

async function testOpenAIConnection(apiKey: string, baseUrl?: string | null): Promise<TestResult> {
  return testOpenAICompatibleConnection(apiKey, baseUrl || 'https://api.openai.com/v1');
}

async function testOpenRouterConnection(apiKey: string, baseUrl?: string | null): Promise<TestResult> {
  return testOpenAICompatibleConnection(apiKey, baseUrl || 'https://openrouter.ai/api/v1');
}

async function testOllamaConnection(baseUrl: string): Promise<TestResult> {
  const startTime = Date.now();
  
  // Parse base URL to determine if http or https
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { 
      success: false, 
      latencyMs: 0, 
      error: 'Invalid base URL format' 
    };
  }
  
  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
  
  return new Promise((resolve) => {
    const req = requestFn({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/api/tags',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: TEST_TIMEOUT_MS,
    }, (res) => {
      const latencyMs = Date.now() - startTime;
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const modelCount = Array.isArray(parsed.models) ? parsed.models.length : undefined;
            resolve({ success: true, latencyMs, modelCount });
          } catch {
            resolve({ success: true, latencyMs });
          }
        } else {
          resolve({ 
            success: false, 
            latencyMs, 
            error: `Ollama returned status ${res.statusCode}` 
          });
        }
      });
    });
    
    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime;
      resolve({ 
        success: false, 
        latencyMs, 
        error: formatConnectionError(err, `${baseUrl.replace(/\/+$/, '')}/api/tags`)
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      const latencyMs = Date.now() - startTime;
      resolve({ 
        success: false, 
        latencyMs, 
        error: 'Connection timed out' 
      });
    });
    
    req.end();
  });
}

async function testCustomConnection(apiKey: string, baseUrl: string): Promise<TestResult> {
  const startTime = Date.now();

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return {
      success: false,
      latencyMs: 0,
      error: 'Invalid base URL format'
    };
  }

  const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
  const path = buildOpenAICompatibleModelsPath(baseUrl);

  return new Promise((resolve) => {
    const req = requestFn({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: TEST_TIMEOUT_MS,
    }, (res) => {
      const latencyMs = Date.now() - startTime;
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const modelCount = Array.isArray(parsed.data) ? parsed.data.length : undefined;
            resolve({ success: true, latencyMs, modelCount });
          } catch {
            resolve({ success: true, latencyMs });
          }
        } else if (res.statusCode === 401) {
          resolve({
            success: false,
            latencyMs,
            error: 'Authentication failed: Invalid API key'
          });
        } else {
          resolve({
            success: false,
            latencyMs,
            error: `Provider returned status ${res.statusCode}`
          });
        }
      });
    });

    req.on('error', (err) => {
      const latencyMs = Date.now() - startTime;
      resolve({
        success: false,
        latencyMs,
        error: formatConnectionError(err, `${url.origin}${path}`)
      });
    });

    req.on('timeout', () => {
      req.destroy();
      const latencyMs = Date.now() - startTime;
      resolve({
        success: false,
        latencyMs,
        error: 'Connection timed out'
      });
    });

    req.end();
  });
}

async function testEnvProvider(providerId: string): Promise<TestResult | null> {
  switch (providerId) {
    case 'openrouter': {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'OPENROUTER_API_KEY not configured' };
      }
      return testOpenRouterConnection(apiKey, null);
    }
    case 'ollama': {
      const baseUrl = process.env.OLLAMA_BASE_URL;
      if (!baseUrl) {
        return { success: false, latencyMs: 0, error: 'OLLAMA_BASE_URL not configured' };
      }
      return testOllamaConnection(baseUrl);
    }
    case 'openai': {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'OPENAI_API_KEY not configured' };
      }
      return testOpenAIConnection(apiKey, null);
    }
    default:
      return null;
  }
}

async function testProviderConnection(
  providerType: ProviderType,
  apiKey: string | null,
  baseUrl: string | null
): Promise<TestResult> {
  switch (providerType) {
    case 'openai':
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'API key is required for OpenAI' };
      }
      return testOpenAIConnection(apiKey, baseUrl);
    case 'openrouter':
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'API key is required for OpenRouter' };
      }
      return testOpenRouterConnection(apiKey, baseUrl);
    case 'ollama':
      if (!baseUrl) {
        return { success: false, latencyMs: 0, error: 'Base URL is required for Ollama' };
      }
      return testOllamaConnection(baseUrl);
    case 'custom':
      if (!apiKey) {
        return { success: false, latencyMs: 0, error: 'API key is required for custom provider' };
      }
      if (!baseUrl) {
        return { success: false, latencyMs: 0, error: 'Base URL is required for custom provider' };
      }
      return testCustomConnection(apiKey, baseUrl);
    default:
      return { success: false, latencyMs: 0, error: 'Unknown provider type' };
  }
}

export function registerProviderRoutes(server: FastifyInstance, context: ApiContext): void {
  const providerConfigStore = context.providerConfigStore;

  // GET /api/providers - List all providers for current user
  server.get(
    '/api/providers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      if (!providerConfigStore) {
        const error = ApiErrorFactory.serviceUnavailable('Provider configuration store not available');
        return reply.code(503).send(error);
      }

      const providers = providerConfigStore.listByUser(userId);
      const summaries = providers.map(sanitizeProviderForResponse);

      return reply.code(200).send({ data: summaries });
    }
  );

  // POST /api/providers - Create a new provider
  server.post<{ Body: CreateProviderRequest }>(
    '/api/providers',
    async (request: FastifyRequest<{ Body: CreateProviderRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      if (!providerConfigStore) {
        const error = ApiErrorFactory.serviceUnavailable('Provider configuration store not available');
        return reply.code(503).send(error);
      }

      const { providerType, displayName, apiKey, baseUrl, selectedModel } = request.body || {};

      // Validate providerType
      if (!validateProviderType(providerType)) {
        const error = ApiErrorFactory.badRequest(
          `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}`
        );
        error.error.code = 'INVALID_PROVIDER_TYPE';
        return reply.code(400).send(error);
      }

      // Validate required fields based on provider type
      if ((providerType === 'openai' || providerType === 'openrouter' || providerType === 'custom') && !apiKey) {
        const error = ApiErrorFactory.badRequest(
          `API key is required for ${providerType} provider`
        );
        error.error.code = 'API_KEY_REQUIRED';
        return reply.code(400).send(error);
      }

      if ((providerType === 'ollama' || providerType === 'custom') && !baseUrl) {
        const error = ApiErrorFactory.badRequest(
          `Base URL is required for ${providerType} provider`
        );
        error.error.code = 'BASE_URL_REQUIRED';
        return reply.code(400).send(error);
      }

      // Validate displayName if provided
      if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length === 0)) {
        const error = ApiErrorFactory.badRequest('Display name must be a non-empty string');
        error.error.code = 'INVALID_DISPLAY_NAME';
        return reply.code(400).send(error);
      }

      const providerId = randomUUID();
      const finalDisplayName = displayName?.trim() || `${providerType}-${providerId.slice(0, 8)}`;

      try {
        const provider = providerConfigStore.create({
          providerId,
          userId,
          providerType,
          displayName: finalDisplayName,
          apiKey,
          baseUrl,
          selectedModel,
          enabled: true,
        });

        const summary = sanitizeProviderForResponse(provider);
        return reply.code(201).send({ data: summary });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to create provider';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // PATCH /api/providers/:providerId - Update a provider
  server.patch<{ Params: { providerId: string }; Body: UpdateProviderRequest }>(
    '/api/providers/:providerId',
    async (request: FastifyRequest<{ Params: { providerId: string }; Body: UpdateProviderRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      if (!providerConfigStore) {
        const error = ApiErrorFactory.serviceUnavailable('Provider configuration store not available');
        return reply.code(503).send(error);
      }

      const { providerId } = request.params;
      const existingProvider = providerConfigStore.getById(providerId);

      if (!existingProvider) {
        const error = ApiErrorFactory.notFound('Provider not found');
        return reply.code(404).send(error);
      }

      // Verify the provider belongs to the current user
      if (existingProvider.userId !== userId) {
        const error = ApiErrorFactory.forbidden('Access denied to this provider');
        return reply.code(403).send(error);
      }

      const { displayName, apiKey, baseUrl, selectedModel, enabled } = request.body || {};

      // Validate displayName if provided
      if (displayName !== undefined && (typeof displayName !== 'string' || displayName.trim().length === 0)) {
        const error = ApiErrorFactory.badRequest('Display name must be a non-empty string');
        error.error.code = 'INVALID_DISPLAY_NAME';
        return reply.code(400).send(error);
      }

      // Build updates object
      const updates: Record<string, unknown> = {};
      if (displayName !== undefined) updates.displayName = displayName.trim();
      if (apiKey !== undefined) updates.apiKey = apiKey;
      if (baseUrl !== undefined) updates.baseUrl = baseUrl;
      if (selectedModel !== undefined) updates.selectedModel = selectedModel;
      if (enabled !== undefined) updates.enabled = enabled;

      if (Object.keys(updates).length === 0) {
        const error = ApiErrorFactory.badRequest('No valid fields to update');
        error.error.code = 'NO_UPDATES';
        return reply.code(400).send(error);
      }

      try {
        const updated = providerConfigStore.update(providerId, updates);
        if (!updated) {
          const error = ApiErrorFactory.internalError('Failed to update provider');
          return reply.code(500).send(error);
        }

        const provider = providerConfigStore.getById(providerId);
        if (!provider) {
          const error = ApiErrorFactory.notFound('Provider not found after update');
          return reply.code(404).send(error);
        }

        const summary = sanitizeProviderForResponse(provider);
        return reply.code(200).send({ data: summary });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update provider';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // DELETE /api/providers/:providerId - Delete a provider
  server.delete<{ Params: { providerId: string } }>(
    '/api/providers/:providerId',
    async (request: FastifyRequest<{ Params: { providerId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      if (!providerConfigStore) {
        const error = ApiErrorFactory.serviceUnavailable('Provider configuration store not available');
        return reply.code(503).send(error);
      }

      const { providerId } = request.params;
      const existingProvider = providerConfigStore.getById(providerId);

      if (!existingProvider) {
        const error = ApiErrorFactory.notFound('Provider not found');
        return reply.code(404).send(error);
      }

      // Verify the provider belongs to the current user
      if (existingProvider.userId !== userId) {
        const error = ApiErrorFactory.forbidden('Access denied to this provider');
        return reply.code(403).send(error);
      }

      try {
        const deleted = providerConfigStore.remove(providerId);
        if (!deleted) {
          const error = ApiErrorFactory.internalError('Failed to delete provider');
          return reply.code(500).send(error);
        }

        return reply.code(204).send();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete provider';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // POST /api/providers/:providerId/test - Test provider connection
  server.post<{ Params: { providerId: string } }>(
    '/api/providers/:providerId/test',
    async (request: FastifyRequest<{ Params: { providerId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { providerId } = request.params;

      // Check if this is an env-backed provider
      const envProviderResult = await testEnvProvider(providerId);
      if (envProviderResult) {
        const response: TestProviderResponse = {
          success: envProviderResult.success,
          latencyMs: envProviderResult.latencyMs,
          modelCount: envProviderResult.modelCount,
          error: envProviderResult.error,
        };
        return reply.code(200).send({ data: response });
      }

      if (!providerConfigStore) {
        const error = ApiErrorFactory.serviceUnavailable('Provider configuration store not available');
        return reply.code(503).send(error);
      }

      const existingProvider = providerConfigStore.getById(providerId);

      if (!existingProvider) {
        const error = ApiErrorFactory.notFound('Provider not found');
        return reply.code(404).send(error);
      }

      // Verify the provider belongs to the current user
      if (existingProvider.userId !== userId) {
        const error = ApiErrorFactory.forbidden('Access denied to this provider');
        return reply.code(403).send(error);
      }

      // Get provider with decrypted secret
      const providerWithSecret = providerConfigStore.getByIdWithSecret(providerId);
      if (!providerWithSecret) {
        const error = ApiErrorFactory.notFound('Provider configuration not found');
        return reply.code(404).send(error);
      }

      // Test the connection
      const testResult = await testProviderConnection(
        providerWithSecret.providerType,
        providerWithSecret.apiKey,
        providerWithSecret.baseUrl
      );

      // Update test status in store
      const status = testResult.success ? 'success' : 'failed';
      providerConfigStore.updateTestStatus(providerId, status);

      const response: TestProviderResponse = {
        success: testResult.success,
        latencyMs: testResult.latencyMs,
        modelCount: testResult.modelCount,
        error: testResult.error,
      };

      return reply.code(200).send({ data: response });
    }
  );
}
