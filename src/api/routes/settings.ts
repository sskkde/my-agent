import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import type { SettingsConfig } from '../types.js'
import type { ApiContext } from '../context.js'
import { success, envelopeError } from '../response-envelope.js'
import { ResourceType, Action } from '../../permissions/rbac-types.js'
import type { AppTheme, CommandPrefs, ThinkingLevel } from '../../storage/user-settings-store.js'

const VALID_THEMES = new Set<AppTheme>(['default', 'warm-paper', 'dark'])
const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(['off', 'minimal', 'low', 'medium', 'high'])

function resolveUserId(request: FastifyRequest): string {
  return request.user?.userId ?? 'local-user'
}

export function registerSettingsRoutes(server: FastifyInstance, context: ApiContext): void {
  server.get('/api/v1/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.requirePermission(ResourceType.settings, Action.read)) {
      return reply
    }
    const userId = resolveUserId(request)
    const userPrefs = context.userSettingsStore.get(userId)

    const settings: SettingsConfig = {
      localOnly: true,
      providers: {
        openrouter: {
          configured: !!process.env.OPENROUTER_API_KEY,
        },
        ollama: {
          configured: !!process.env.OLLAMA_BASE_URL,
        },
      },
      retentionDays: 30,
      theme: userPrefs.theme,
      commandPrefs: userPrefs.commandPrefs,
    }

    return reply.code(200).send(success({ settings }, request.requestId))
  })

  server.patch<{ Body: Partial<UpdateSettingsRequest> }>(
    '/api/v1/settings',
    async (request: FastifyRequest<{ Body: Partial<UpdateSettingsRequest> }>, reply: FastifyReply) => {
      if (!request.requirePermission(ResourceType.settings, Action.update)) {
        return reply
      }

      const body = request.body ?? {}
      const userId = resolveUserId(request)
      const updates: { theme?: AppTheme; commandPrefs?: CommandPrefs } = {}

      if (body.theme !== undefined) {
        if (body.theme !== null && !VALID_THEMES.has(body.theme as AppTheme)) {
          return reply.code(400).send(envelopeError('BAD_REQUEST', `Invalid theme: ${body.theme}`, request.requestId))
        }
        updates.theme = body.theme === null ? undefined : (body.theme as AppTheme)
      }

      if (body.commandPrefs !== undefined) {
        const prefs = body.commandPrefs
        if (prefs !== null && typeof prefs !== 'object') {
          return reply.code(400).send(envelopeError('BAD_REQUEST', 'commandPrefs must be an object', request.requestId))
        }
        if (prefs === null) {
          updates.commandPrefs = undefined
        } else {
          const thinkingLevel = prefs.thinkingLevel
          if (thinkingLevel !== undefined && !VALID_THINKING_LEVELS.has(thinkingLevel as ThinkingLevel)) {
            return reply
              .code(400)
              .send(envelopeError('BAD_REQUEST', `Invalid thinkingLevel: ${thinkingLevel}`, request.requestId))
          }
          updates.commandPrefs = {
            verbose: typeof prefs.verbose === 'boolean' ? prefs.verbose : false,
            reasoningVisible: typeof prefs.reasoningVisible === 'boolean' ? prefs.reasoningVisible : false,
            thinkingLevel: (thinkingLevel as ThinkingLevel) ?? 'off',
          }
        }
      }

      const merged = context.userSettingsStore.update(userId, updates)

      const settings: SettingsConfig = {
        localOnly: true,
        providers: {
          openrouter: {
            configured: !!process.env.OPENROUTER_API_KEY,
          },
          ollama: {
            configured: !!process.env.OLLAMA_BASE_URL,
          },
        },
        retentionDays: 30,
        theme: merged.theme,
        commandPrefs: merged.commandPrefs,
      }

      return reply.code(200).send(success({ settings }, request.requestId))
    },
  )
}

export interface UpdateSettingsRequest {
  theme?: string | null
  commandPrefs?: {
    verbose?: boolean
    reasoningVisible?: boolean
    thinkingLevel?: string
  } | null
}
