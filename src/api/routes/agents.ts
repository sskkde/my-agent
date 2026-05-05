import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApiContext } from '../context.js';
import { ApiErrorFactory } from '../errors.js';
import { getToolCatalog } from '../tool-catalog.js';
import type { AgentConfig } from '../../storage/agent-config-store.js';
import {
  DEFAULT_REPAIR_ATTEMPTS,
  DEFAULT_ROUTING_TIMEOUT_MS,
  INHERIT_REPAIR_ATTEMPTS,
  INHERIT_ROUTING_TIMEOUT_MS,
} from '../../storage/agent-config-store.js';

// Built-in skills (must match skills.ts)
const BUILTIN_SKILL_IDS = [
  'artifact.create',
  'artifact.update',
  'ask_user',
  'status.query',
  'memory.retrieve',
  'transcript.search',
  'plan.patch',
  'docs.search',
];

// Valid agent IDs (V1 only supports foreground.default)
const VALID_AGENT_IDS = ['foreground.default'];

// Validation constraints
const MAX_PROMPT_LENGTH = 10000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60000;
const VALID_REPAIR_ATTEMPTS = [0, 1];

interface ConfigResponse {
  global: Partial<AgentConfig> | null;
  userOverride: Partial<AgentConfig> | null;
  effective: Partial<AgentConfig> | null;
}

/**
 * Merge user override with global config at field level
 * User override fields take precedence over global fields
 */
function mergeConfigs(global: AgentConfig | null, userOverride: AgentConfig | null): Partial<AgentConfig> | null {
  if (!global && !userOverride) return null;
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
}

interface UpdateOverrideConfigRequest {
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
  // Remove sensitive/internal fields if any (currently none, but future-proof)
  const { ...sanitized } = config;
  if (sanitized.scope === 'user' && sanitized.routingTimeoutMs === INHERIT_ROUTING_TIMEOUT_MS) {
    delete sanitized.routingTimeoutMs;
  }
  if (sanitized.scope === 'user' && sanitized.repairAttempts === INHERIT_REPAIR_ATTEMPTS) {
    delete sanitized.repairAttempts;
  }
  return sanitized;
}

function isGlobalConfigAdmin(context: ApiContext, userId: string): boolean {
  const firstUser = context.stores.userStore.getFirstCreated();
  return firstUser?.userId === userId;
}

function validateConfigInput(
  input: UpdateGlobalConfigRequest | UpdateOverrideConfigRequest,
  providerConfigStore: ApiContext['providerConfigStore'],
  userId: string | null,
  isGlobal: boolean
): { valid: boolean; error?: { code: string; message: string } } {
  // Validate displayName if provided
  if (input.displayName !== undefined) {
    if (typeof input.displayName !== 'string' || input.displayName.trim().length === 0) {
      return { valid: false, error: { code: 'INVALID_DISPLAY_NAME', message: 'Display name must be a non-empty string' } };
    }
    if (input.displayName.length > 100) {
      return { valid: false, error: { code: 'DISPLAY_NAME_TOO_LONG', message: 'Display name must be 100 characters or less' } };
    }
  }

  // Validate systemPrompt if provided
  if (input.systemPrompt !== undefined) {
    if (typeof input.systemPrompt !== 'string') {
      return { valid: false, error: { code: 'INVALID_SYSTEM_PROMPT', message: 'System prompt must be a string' } };
    }
    if (input.systemPrompt.length > MAX_PROMPT_LENGTH) {
      return { valid: false, error: { code: 'SYSTEM_PROMPT_TOO_LONG', message: `System prompt must be ${MAX_PROMPT_LENGTH} characters or less` } };
    }
  }

  // Validate routingPrompt if provided
  if (input.routingPrompt !== undefined) {
    if (input.routingPrompt !== null && typeof input.routingPrompt !== 'string') {
      return { valid: false, error: { code: 'INVALID_ROUTING_PROMPT', message: 'Routing prompt must be a string or null' } };
    }
    if (typeof input.routingPrompt === 'string' && input.routingPrompt.length > MAX_PROMPT_LENGTH) {
      return { valid: false, error: { code: 'ROUTING_PROMPT_TOO_LONG', message: `Routing prompt must be ${MAX_PROMPT_LENGTH} characters or less` } };
    }
  }

  // Validate providerId if provided
  if (input.providerId !== undefined) {
    if (input.providerId !== null) {
      const provider = providerConfigStore.getById(input.providerId);
      if (!provider) {
        return { valid: false, error: { code: 'INVALID_PROVIDER_ID', message: 'Provider not found' } };
      }
      // For user overrides, verify provider ownership
      if (!isGlobal && userId && provider.userId !== userId) {
        return { valid: false, error: { code: 'PROVIDER_ACCESS_DENIED', message: 'Provider does not belong to the current user' } };
      }
    }
  }

  // Validate model if provided
  if (input.model !== undefined && input.model !== null) {
    if (typeof input.model !== 'string' || input.model.trim().length === 0) {
      return { valid: false, error: { code: 'INVALID_MODEL', message: 'Model must be a non-empty string' } };
    }
  }

  // Validate allowedToolIds if provided
  if (input.allowedToolIds !== undefined) {
    if (!Array.isArray(input.allowedToolIds)) {
      return { valid: false, error: { code: 'INVALID_TOOL_IDS', message: 'Tool IDs must be an array' } };
    }
    const validToolIds = getValidToolIds();
    const invalidTools = input.allowedToolIds.filter(id => !validToolIds.includes(id));
    if (invalidTools.length > 0) {
      return { valid: false, error: { code: 'INVALID_TOOL_ID', message: `Invalid tool IDs: ${invalidTools.join(', ')}` } };
    }
  }

  // Validate allowedSkillIds if provided
  if (input.allowedSkillIds !== undefined) {
    if (!Array.isArray(input.allowedSkillIds)) {
      return { valid: false, error: { code: 'INVALID_SKILL_IDS', message: 'Skill IDs must be an array' } };
    }
    const validSkillIds = getValidSkillIds();
    const invalidSkills = input.allowedSkillIds.filter(id => !validSkillIds.includes(id));
    if (invalidSkills.length > 0) {
      return { valid: false, error: { code: 'INVALID_SKILL_ID', message: `Invalid skill IDs: ${invalidSkills.join(', ')}` } };
    }
  }

  // Validate routingTimeoutMs if provided
  if (input.routingTimeoutMs !== undefined) {
    if (typeof input.routingTimeoutMs !== 'number' || !Number.isInteger(input.routingTimeoutMs)) {
      return { valid: false, error: { code: 'INVALID_TIMEOUT', message: 'Timeout must be an integer' } };
    }
    if (input.routingTimeoutMs < MIN_TIMEOUT_MS || input.routingTimeoutMs > MAX_TIMEOUT_MS) {
      return { valid: false, error: { code: 'TIMEOUT_OUT_OF_RANGE', message: `Timeout must be between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} milliseconds` } };
    }
  }

  // Validate repairAttempts if provided (V1 only allows 0 or 1)
  if (input.repairAttempts !== undefined) {
    if (typeof input.repairAttempts !== 'number' || !Number.isInteger(input.repairAttempts)) {
      return { valid: false, error: { code: 'INVALID_REPAIR_ATTEMPTS', message: 'Repair attempts must be an integer' } };
    }
    if (!VALID_REPAIR_ATTEMPTS.includes(input.repairAttempts)) {
      return { valid: false, error: { code: 'REPAIR_ATTEMPTS_OUT_OF_RANGE', message: `Repair attempts must be 0 or 1 for V1` } };
    }
  }

  // Validate enabled if provided
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
    return { valid: false, error: { code: 'INVALID_ENABLED', message: 'Enabled must be a boolean' } };
  }

  return { valid: true };
}

export function registerAgentRoutes(server: FastifyInstance, context: ApiContext): void {
  const { agentConfigStore, providerConfigStore } = context;

  // GET /api/agents/:agentId/config - Get config (global, userOverride, effective)
  server.get<{ Params: { agentId: string } }>(
    '/api/agents/:agentId/config',
    async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }
      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        const error = ApiErrorFactory.badRequest(`Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`);
        error.error.code = 'INVALID_AGENT_ID';
        return reply.code(400).send(error);
      }

      try {
        const global = agentConfigStore.getGlobalDefault();
        // Get the actual user override (not merged with global)
        const userConfigs = agentConfigStore.listByUser(userId);
        const userOverride = userConfigs.find(c => c.agentId === agentId) || null;
        // Effective is the field-level merged config
        const effective = mergeConfigs(global, userOverride);

        const response: ConfigResponse = {
          global: sanitizeConfigForResponse(global),
          userOverride: sanitizeConfigForResponse(userOverride),
          effective: sanitizeConfigForResponse(effective),
        };

        return reply.code(200).send({ data: response });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to get agent config';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // PATCH /api/agents/:agentId/config/global - Update global default config
  server.patch<{ Params: { agentId: string }; Body: UpdateGlobalConfigRequest }>(
    '/api/agents/:agentId/config/global',
    async (request: FastifyRequest<{ Params: { agentId: string }; Body: UpdateGlobalConfigRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }
      if (!isGlobalConfigAdmin(context, userId)) {
        const error = ApiErrorFactory.forbidden('Only the setup owner can update global agent config');
        return reply.code(403).send(error);
      }

      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        const error = ApiErrorFactory.badRequest(`Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`);
        error.error.code = 'INVALID_AGENT_ID';
        return reply.code(400).send(error);
      }

      const validation = validateConfigInput(request.body, providerConfigStore, null, true);
      if (!validation.valid) {
        const error = ApiErrorFactory.badRequest(validation.error!.message);
        error.error.code = validation.error!.code;
        return reply.code(400).send(error);
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
        });

        return reply.code(200).send({ data: sanitizeConfigForResponse(config) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update global config';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // PATCH /api/agents/:agentId/config/override - Update user override config
  server.patch<{ Params: { agentId: string }; Body: UpdateOverrideConfigRequest }>(
    '/api/agents/:agentId/config/override',
    async (request: FastifyRequest<{ Params: { agentId: string }; Body: UpdateOverrideConfigRequest }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        const error = ApiErrorFactory.badRequest(`Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`);
        error.error.code = 'INVALID_AGENT_ID';
        return reply.code(400).send(error);
      }

      const validation = validateConfigInput(request.body, providerConfigStore, userId, false);
      if (!validation.valid) {
        const error = ApiErrorFactory.badRequest(validation.error!.message);
        error.error.code = validation.error!.code;
        return reply.code(400).send(error);
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
          systemPrompt: systemPrompt ?? existingOverride?.systemPrompt ?? global?.systemPrompt ?? '',
          routingPrompt: routingPrompt !== undefined ? routingPrompt : existingOverride?.routingPrompt ?? undefined,
          providerId: providerId !== undefined ? providerId : existingOverride?.providerId ?? undefined,
          model: model !== undefined ? model : existingOverride?.model ?? undefined,
          allowedToolIds: allowedToolIds ?? existingOverride?.allowedToolIds ?? global?.allowedToolIds ?? [],
          allowedSkillIds: allowedSkillIds ?? existingOverride?.allowedSkillIds ?? global?.allowedSkillIds ?? [],
          routingTimeoutMs: routingTimeoutMs ?? existingOverride?.routingTimeoutMs,
          repairAttempts: repairAttempts ?? existingOverride?.repairAttempts,
        });

        return reply.code(200).send({ data: sanitizeConfigForResponse(config) });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to update user override config';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );

  // DELETE /api/agents/:agentId/config/override - Reset user override config
  server.delete<{ Params: { agentId: string } }>(
    '/api/agents/:agentId/config/override',
    async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
      const userId = request.user?.userId;
      if (!userId) {
        const error = ApiErrorFactory.unauthorized('Authentication required');
        return reply.code(401).send(error);
      }

      const { agentId } = request.params;

      if (!validateAgentId(agentId)) {
        const error = ApiErrorFactory.badRequest(`Invalid agent ID. Only ${VALID_AGENT_IDS.join(', ')} is supported.`);
        error.error.code = 'INVALID_AGENT_ID';
        return reply.code(400).send(error);
      }

      try {
        const existingOverride = agentConfigStore.listByUser(userId).find(c => c.agentId === agentId);

        if (existingOverride) {
          agentConfigStore.remove(existingOverride.agentConfigId);
        }

        return reply.code(204).send();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to delete user override config';
        const apiError = ApiErrorFactory.internalError(errorMessage);
        return reply.code(500).send(apiError);
      }
    }
  );
}
