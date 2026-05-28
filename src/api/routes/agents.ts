import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { success, envelopeError } from '../response-envelope.js';
import { getToolCatalog } from '../tool-catalog.js';
import type { AgentConfig } from '../../storage/agent-config-store.js';
import {
  DEFAULT_REPAIR_ATTEMPTS,
  DEFAULT_ROUTING_TIMEOUT_MS,
  INHERIT_REPAIR_ATTEMPTS,
  INHERIT_ROUTING_TIMEOUT_MS,
} from '../../storage/agent-config-store.js';
import { resolvePrompt } from '../../agents/prompt-registry.js';
import { ResourceType, Action } from '../../permissions/rbac-types.js';

const BUILTIN_SKILL_IDS = [
  'artifact.create',
  'artifact.update',
  'ask_user',
  'status.query',
  'memory.retrieve',
  'transcript.search',
  'plan.patch',
  'docs.search',
  'web.search',
];

const VALID_AGENT_IDS = ['foreground.default'];

const MAX_PROMPT_LENGTH = 10000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;
const VALID_REPAIR_ATTEMPTS = [0, 1];

interface ConfigResponse {
  global: Partial<AgentConfig> | null;
  userOverride: Partial<AgentConfig> | null;
  effective: (Partial<AgentConfig> & {
    resolvedPromptType?: string;
    resolvedPromptVersion?: string;
    promptFallbackReason?: 'UNKNOWN_PROMPT_VERSION' | 'UNKNOWN_PROMPT_TYPE';
  }) | null;
}

function mergeConfigs(global: AgentConfig | null, userOverride: AgentConfig | null): Partial<AgentConfig> | null {
  if (!global && !userOverride) {
    return null;
  }
  if (!userOverride) return global as Partial<AgentConfig>;

  return {
    agentConfigId: userOverride.agentConfigId,
    agentId: userOverride.agentId,
    scope: userOverride.scope,
    userId: userOverride.userId,
    displayName: userOverride.displayName ?? global?.displayName,
    enabled: userOverride.enabled ?? global?.enabled,
    systemPrompt: userOverride.systemPrompt ?? global?.systemPrompt,
    routingPrompt: userOverride.routingPrompt ?? global?.routingPrompt,
    providerId: userOverride.providerId ?? global?.providerId,
    model: userOverride.model ?? global?.model,
    allowedToolIds: userOverride.allowedToolIds ?? global?.allowedToolIds ?? [],
    allowedSkillIds: userOverride.allowedSkillIds ?? global?.allowedSkillIds ?? [],
    routingTimeoutMs: userOverride.routingTimeoutMs === INHERIT_ROUTING_TIMEOUT_MS
      ? global?.routingTimeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS
      : userOverride.routingTimeoutMs,
    repairAttempts: userOverride.repairAttempts === INHERIT_REPAIR_ATTEMPTS
      ? global?.repairAttempts ?? DEFAULT_REPAIR_ATTEMPTS
      : userOverride.repairAttempts,
    promptType: userOverride.promptType ?? global?.promptType ?? null,
    promptVersion: userOverride.promptVersion ?? global?.promptVersion ?? null,
    searchLlmProviderId: userOverride.searchLlmProviderId ?? global?.searchLlmProviderId ?? null,
    searchLlmModel: userOverride.searchLlmModel ?? global?.searchLlmModel ?? null,
    createdAt: userOverride.createdAt,
    updatedAt: userOverride.updatedAt,
  };
}

interface UpdateGlobalConfigRequest {
  displayName?: string;
  enabled?: boolean;
  systemPrompt?: string;
  routingPrompt?: string;
  providerId?: string;
  model?: string;
  allowedToolIds?: string[];
  allowedSkillIds?: string[];
  routingTimeoutMs?: number;
  repairAttempts?: number;
  searchLlmProviderId?: string;
  searchLlmModel?: string;
}

interface UpdateOverrideConfigRequest {
  displayName?: string;
  enabled?: boolean;
  systemPrompt?: string | null;
  routingPrompt?: string | null;
  providerId?: string | null;
  model?: string | null;
  allowedToolIds?: string[] | null;
  allowedSkillIds?: string[] | null;
  routingTimeoutMs?: number;
  repairAttempts?: number;
  searchLlmProviderId?: string | null;
  searchLlmModel?: string | null;
}

function validateAgentId(agentId: string): boolean {
  return VALID_AGENT_IDS.includes(agentId);
}

function getValidToolIds(): string[] {
  const tools = getToolCatalog();
  return tools.map(tool => tool.name);
}

function getValidSkillIds(): string[] {
  return [...BUILTIN_SKILL_IDS];
}

function sanitizeConfigForResponse(config: Partial<AgentConfig> | null): Partial<AgentConfig> | null {
  if (!config) return null;
  const { ...sanitized } = config;
  if (sanitized.scope === 'user' && sanitized.routingTimeoutMs === INHERIT_ROUTING_TIMEOUT_MS) {
    delete sanitized.routingTimeoutMs;
  }
  if (sanitized.scope === 'user' && sanitized.repairAttempts === INHERIT_REPAIR_ATTEMPTS) {
    delete sanitized.repairAttempts;
  }
  return sanitized;
}

/**
 * Builds a fallback global config when no persisted config exists.
 * This ensures the API always returns non-null global/effective config
 * so the frontend can render the form without null-reference errors.
 */
function buildDefaultGlobalConfig(agentId: string): AgentConfig {
  const now = new Date().toISOString();
  return {
    agentConfigId: 'default',
    agentId,
    scope: 'global',
    userId: null,
    displayName: 'Default Agent',
    enabled: true,
    systemPrompt: '',
    routingPrompt: null,
    providerId: null,
    model: null,
    allowedToolIds: [],
    allowedSkillIds: [],
    routingTimeoutMs: DEFAULT_ROUTING_TIMEOUT_MS,
    repairAttempts: DEFAULT_REPAIR_ATTEMPTS,
    promptType: null,
    promptVersion: null,
    searchLlmProviderId: null,
    searchLlmModel: null,
    createdAt: now,
    updatedAt: now,
  };
}

function validateConfigInput(
  input: UpdateGlobalConfigRequest | UpdateOverrideConfigRequest,
  providerConfigStore: ApiContext['providerConfigStore'],
  userId: string | null,
  isGlobal: boolean
): { valid: boolean; error?: { code: string; message: string } } {
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string' || input.displayName.trim().length === 0) {
      return { valid: false, error: { code: 'INVALID_DISPLAY_NAME', message: 'Display name must be a non-empty string' } };
    }
    if (input.displayName.length > 100) {
      return { valid: false, error: { code: 'DISPLAY_NAME_TOO_LONG', message: 'Display name must be 100 characters or less' } };
    }
  }

  if (input.systemPrompt !== undefined && input.systemPrompt !== null) {
    if (typeof input.systemPrompt !== 'string') {
      return { valid: false, error: { code: 'INVALID_SYSTEM_PROMPT', message: 'System prompt must be a string or null' } };
    }
    if (input.systemPrompt.length > MAX_PROMPT_LENGTH) {
      return { valid: false, error: { code: 'SYSTEM_PROMPT_TOO_LONG', message: `System prompt must be ${MAX_PROMPT_LENGTH} characters or less` } };
    }
  }

  if (input.routingPrompt !== undefined) {
    if (input.routingPrompt !== null && typeof input.routingPrompt !== 'string') {
      return { valid: false, error: { code: 'INVALID_ROUTING_PROMPT', message: 'Routing prompt must be a string or null' } };
    }
    if (typeof input.routingPrompt === 'string' && input.routingPrompt.length > MAX_PROMPT_LENGTH) {
      return { valid: false, error: { code: 'ROUTING_PROMPT_TOO_LONG', message: `Routing prompt must be ${MAX_PROMPT_LENGTH} characters or less` } };
    }
  }

  if (input.providerId !== undefined) {
    if (input.providerId !== null) {
      const provider = providerConfigStore.getById(input.providerId);
      if (!provider) {
        return { valid: false, error: { code: 'INVALID_PROVIDER_ID', message: 'Provider not found' } };
      }
      if (!isGlobal && userId && provider.userId !== userId) {
        return { valid: false, error: { code: 'PROVIDER_ACCESS_DENIED', message: 'Provider does not belong to the current user' } };
      }
    }
  }

  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== 'string' || input.model.trim().length === 0) {
      return { valid: false, error: { code: 'INVALID_MODEL', message: 'Model must be a non-empty string' } };
    }
  }

  if (input.allowedToolIds !== undefined && input.allowedToolIds !== null) {
    if (!Array.isArray(input.allowedToolIds)) {
      return { valid: false, error: { code: 'INVALID_TOOL_IDS', message: 'Tool IDs must be an array or null' } };
    }
    const validToolIds = getValidToolIds();
    const invalidTools = input.allowedToolIds.filter(id => !validToolIds.includes(id));
    if (invalidTools.length > 0) {
      return { valid: false, error: { code: 'INVALID_TOOL_ID', message: `Invalid tool IDs: ${invalidTools.join(', ')}` } };
    }
  }

  if (input.allowedSkillIds !== undefined && input.allowedSkillIds !== null) {
    if (!Array.isArray(input.allowedSkillIds)) {
      return { valid: false, error: { code: 'INVALID_SKILL_IDS', message: 'Skill IDs must be an array or null' } };
    }
    const validSkillIds = getValidSkillIds();
    const invalidSkills = input.allowedSkillIds.filter(id => !validSkillIds.includes(id));
    if (invalidSkills.length > 0) {
      return { valid: false, error: { code: 'INVALID_SKILL_ID', message: `Invalid skill IDs: ${invalidSkills.join(', ')}` } };
    }
  }

  if (input.routingTimeoutMs !== undefined) {
    if (typeof input.routingTimeoutMs !== 'number' || !Number.isInteger(input.routingTimeoutMs)) {
      return { valid: false, error: { code: 'INVALID_TIMEOUT', message: 'Timeout must be an integer' } };
    }
    if (input.routingTimeoutMs < MIN_TIMEOUT_MS || input.routingTimeoutMs > MAX_TIMEOUT_MS) {
      return { valid: false, error: { code: 'TIMEOUT_OUT_OF_RANGE', message: `Timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds` } };
    }
  }

  if (input.repairAttempts !== undefined) {
    if (typeof input.repairAttempts !== 'number' || !Number.isInteger(input.repairAttempts)) {
      return { valid: false, error: { code: 'INVALID_REPAIR_ATTEMPTS', message: 'Repair attempts must be an integer' } };
    }
    if (!VALID_REPAIR_ATTEMPTS.includes(input.repairAttempts)) {
      return { valid: false, error: { code: 'REPAIR_ATTEMPTS_OUT_OF_RANGE', message: `Repair attempts must be 0 or 1 for V1` } };
    }
  }

  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    return { valid: false, error: { code: 'INVALID_ENABLED', message: 'Enabled must be a boolean' } };
  }

  if (input.searchLlmProviderId !== undefined) {
    if (input.searchLlmProviderId !== null) {
      const provider = providerConfigStore.getById(input.searchLlmProviderId);
      if (!provider) {
        return { valid: false, error: { code: 'INVALID_PROVIDER_ID', message: 'Provider not found' } };
      }
      if (userId && provider.userId !== userId) {
        return { valid: false, error: { code: 'PROVIDER_ACCESS_DENIED', message: 'Provider does not belong to the current user' } };
      }
    }
  }

  if (input.searchLlmModel !== undefined && input.searchLlmModel !== null) {
    if (typeof input.searchLlmModel !== 'string' || input.searchLlmModel.trim().length === 0) {
      return { valid: false, error: { code: 'INVALID_MODEL', message: 'Model must be a non-empty string' } };
    }
  }

  return { valid: true };
}

export function registerAgentRoutes(server: FastifyInstance, context: ApiContext): void {
  const { agentConfigStore, providerConfigStore } = context;

  // GET /api/agents/:agentId/config
  server.get<{ Params: { agentId: string } }>(
    '/api/v1/agents/:agentId/config',
    async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }
      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        return reply.code(400).send(envelopeError('INVALID_AGENT_ID',
          `Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`,
          request.requestId));
      }

      try {
        const global = agentConfigStore.getGlobalDefault() ?? buildDefaultGlobalConfig(agentId);
        const userConfigs = agentConfigStore.listByUser(userId);
        const userOverride = userConfigs.find(c => c.agentId === agentId) || null;
        const effective = mergeConfigs(global, userOverride) ?? global;

        const promptResolution = resolvePrompt(
          effective?.promptType ?? 'foreground.router',
          effective?.promptVersion ?? null
        );

        const response: ConfigResponse = {
          global: sanitizeConfigForResponse(global),
          userOverride: sanitizeConfigForResponse(userOverride),
          effective: {
            ...sanitizeConfigForResponse(effective),
            resolvedPromptType: promptResolution.record.id,
            resolvedPromptVersion: promptResolution.record.version,
            ...(promptResolution.fallbackReason ? { promptFallbackReason: promptResolution.fallbackReason } : {}),
          },
        };

        return reply.code(200).send(success(response, request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to get agent config';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // PATCH /api/agents/:agentId/config/global
  server.patch<{ Params: { agentId: string }; Body: UpdateGlobalConfigRequest }>(
    '/api/v1/agents/:agentId/config/global',
    async (request: FastifyRequest<{ Params: { agentId: string }; Body: UpdateGlobalConfigRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      if (!request.requirePermission(ResourceType.settings, Action.manage)) {
        return reply;
      }

      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        return reply.code(400).send(envelopeError('INVALID_AGENT_ID',
          `Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`,
          request.requestId));
      }

      const validation = validateConfigInput(request.body, providerConfigStore, userId, true);
      if (!validation.valid) {
        return reply.code(400).send(envelopeError(validation.error!.code, validation.error!.message, request.requestId));
      }

      const {
        displayName,
        enabled,
        systemPrompt,
        routingPrompt,
        providerId,
        model,
        allowedToolIds,
        allowedSkillIds,
        routingTimeoutMs,
        repairAttempts,
        searchLlmProviderId,
        searchLlmModel,
      } = request.body;

      try {
        const existingGlobal = agentConfigStore.getGlobalDefault();

        const config = agentConfigStore.upsert({
          agentId,
          scope: 'global',
          displayName: displayName ?? existingGlobal?.displayName ?? 'Default Agent',
          enabled: enabled ?? existingGlobal?.enabled ?? true,
          systemPrompt: systemPrompt ?? existingGlobal?.systemPrompt ?? '',
          routingPrompt: routingPrompt !== undefined ? routingPrompt : existingGlobal?.routingPrompt ?? undefined,
          providerId: providerId !== undefined ? providerId : existingGlobal?.providerId ?? undefined,
          model: model !== undefined ? model : existingGlobal?.model ?? undefined,
          allowedToolIds: allowedToolIds ?? existingGlobal?.allowedToolIds ?? [],
          allowedSkillIds: allowedSkillIds ?? existingGlobal?.allowedSkillIds ?? [],
          routingTimeoutMs: routingTimeoutMs ?? existingGlobal?.routingTimeoutMs ?? DEFAULT_ROUTING_TIMEOUT_MS,
          repairAttempts: repairAttempts ?? existingGlobal?.repairAttempts ?? DEFAULT_REPAIR_ATTEMPTS,
          searchLlmProviderId: searchLlmProviderId !== undefined ? searchLlmProviderId : existingGlobal?.searchLlmProviderId ?? undefined,
          searchLlmModel: searchLlmModel !== undefined ? searchLlmModel : existingGlobal?.searchLlmModel ?? undefined,
        });

        return reply.code(200).send(success(sanitizeConfigForResponse(config), request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update global config';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // PATCH /api/agents/:agentId/config/override
  server.patch<{ Params: { agentId: string }; Body: UpdateOverrideConfigRequest }>(
    '/api/v1/agents/:agentId/config/override',
    async (request: FastifyRequest<{ Params: { agentId: string }; Body: UpdateOverrideConfigRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        return reply.code(400).send(envelopeError('INVALID_AGENT_ID',
          `Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`,
          request.requestId));
      }

      const validation = validateConfigInput(request.body, providerConfigStore, userId, false);
      if (!validation.valid) {
        return reply.code(400).send(envelopeError(validation.error!.code, validation.error!.message, request.requestId));
      }

      const {
        displayName,
        enabled,
        systemPrompt,
        routingPrompt,
        providerId,
        model,
        allowedToolIds,
        allowedSkillIds,
        routingTimeoutMs,
        repairAttempts,
        searchLlmProviderId,
        searchLlmModel,
      } = request.body;

      try {
        const global = agentConfigStore.getGlobalDefault();
        const existingOverride = agentConfigStore.listByUser(userId).find(c => c.agentId === agentId);

        const config = agentConfigStore.upsert({
          agentId,
          scope: 'user',
          userId,
          displayName: displayName ?? existingOverride?.displayName ?? global?.displayName ?? 'Default Agent',
          enabled: enabled ?? existingOverride?.enabled ?? global?.enabled ?? true,
          systemPrompt: systemPrompt !== undefined 
            ? systemPrompt 
            : existingOverride?.systemPrompt ?? null,
          routingPrompt: routingPrompt !== undefined 
            ? routingPrompt 
            : existingOverride?.routingPrompt ?? null,
          providerId: providerId !== undefined 
            ? providerId 
            : existingOverride?.providerId ?? null,
          model: model !== undefined 
            ? model 
            : existingOverride?.model ?? null,
          allowedToolIds: allowedToolIds !== undefined 
            ? allowedToolIds 
            : existingOverride?.allowedToolIds ?? null,
          allowedSkillIds: allowedSkillIds !== undefined 
            ? allowedSkillIds 
            : existingOverride?.allowedSkillIds ?? null,
          routingTimeoutMs: routingTimeoutMs ?? existingOverride?.routingTimeoutMs,
          repairAttempts: repairAttempts ?? existingOverride?.repairAttempts,
          searchLlmProviderId: searchLlmProviderId !== undefined 
            ? searchLlmProviderId 
            : existingOverride?.searchLlmProviderId ?? null,
          searchLlmModel: searchLlmModel !== undefined 
            ? searchLlmModel 
            : existingOverride?.searchLlmModel ?? null,
        });

        return reply.code(200).send(success(sanitizeConfigForResponse(config), request.requestId));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update user override config';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );

  // DELETE /api/agents/:agentId/config/override
  server.delete<{ Params: { agentId: string } }>(
    '/api/v1/agents/:agentId/config/override',
    async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.code(401).send(envelopeError('UNAUTHORIZED', 'Authentication required', request.requestId));
      }

      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        return reply.code(400).send(envelopeError('INVALID_AGENT_ID',
          `Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`,
          request.requestId));
      }

      try {
        const existingOverride = agentConfigStore.listByUser(userId).find(c => c.agentId === agentId);

        if (existingOverride) {
          agentConfigStore.remove(existingOverride.agentConfigId);
        }

        return reply.code(204).send();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete user override config';
        return reply.code(500).send(envelopeError('INTERNAL_ERROR', errorMessage, request.requestId));
      }
    }
  );
}
