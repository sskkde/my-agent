import type { CommandContext, CommandHandler, FrontendCommandResult } from '../types.js'
import type { ConsoleSessionInfo } from '../../api/types.js'
import { createSession, getSession, getSessions, getSettings, updateSession } from '../../api/client.js'

export const handleNew: CommandHandler = async (
  _args: string[],
  context: CommandContext,
): Promise<FrontendCommandResult> => {
  try {
    const response = await createSession()
    const newSessionId = response.session.sessionId

    await context.refreshSessions()
    context.setSelectedSessionId(newSessionId)

    return {
      success: true,
      output: {
        type: 'text',
        content: `Created new session: ${newSessionId}`,
      },
      data: { sessionId: newSessionId },
    }
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to create session: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const SESSION_SUBCOMMANDS = new Set(['list', 'switch', 'rename', 'clear', 'archive', 'delete'])

export const handleSessionArchive: CommandHandler = async (
  _args: string[],
  context: CommandContext,
): Promise<FrontendCommandResult> => {
  const currentSessionId = context.sessionId

  if (!currentSessionId) {
    return {
      success: false,
      output: {
        type: 'error',
        content: 'No session currently selected to archive',
      },
      error: 'No session selected',
    }
  }

  try {
    await updateSession(currentSessionId, { status: 'archived' })
    await context.refreshSessions()

    return {
      success: true,
      output: {
        type: 'text',
        content: `Session ${currentSessionId} has been archived`,
      },
      data: { sessionId: currentSessionId, status: 'archived' },
    }
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to archive session: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const handleSession: CommandHandler = async (
  args: string[],
  context: CommandContext,
): Promise<FrontendCommandResult> => {
  if (args.length === 0) {
    const currentSessionId = context.sessionId

    if (!currentSessionId) {
      return {
        success: false,
        output: {
          type: 'error',
          content: 'No session currently selected',
        },
        error: 'No session selected',
      }
    }

    try {
      const response = await getSession(currentSessionId)
      const session = response.session

      return {
        success: true,
        output: {
          type: 'structured',
          content: `Session: ${session.sessionId}\nStatus: active\nMessages: ${session.messageCount}`,
          data: {
            id: session.sessionId,
            title: session.sessionId,
            status: 'active',
            messageCount: session.messageCount,
          },
        },
        data: {
          id: session.sessionId,
          title: session.sessionId,
          status: 'active',
          messageCount: session.messageCount,
        },
      }
    } catch (error) {
      return {
        success: false,
        output: {
          type: 'error',
          content: `Failed to get session info: ${error instanceof Error ? error.message : String(error)}`,
        },
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const firstArg = args[0]
  const subcommandArgs = args.slice(1)

  if (SESSION_SUBCOMMANDS.has(firstArg)) {
    switch (firstArg) {
      case 'archive':
        return await handleSessionArchive(subcommandArgs, context)
      default:
        return {
          success: false,
          output: {
            type: 'error',
            content: `Subcommand "${firstArg}" is defined but not yet implemented in the frontend handler.`,
          },
          error: `Subcommand not implemented: ${firstArg}`,
        }
    }
  }

  const targetSessionId = firstArg

  try {
    const response = await getSession(targetSessionId)
    const session = response.session

    context.setSelectedSessionId(session.sessionId)

    return {
      success: true,
      output: {
        type: 'structured',
        content: `Switched to session: ${session.sessionId}\nStatus: active\nMessages: ${session.messageCount}`,
        data: {
          id: session.sessionId,
          title: session.sessionId,
          status: 'active',
          messageCount: session.messageCount,
        },
      },
      data: {
        id: session.sessionId,
        title: session.sessionId,
        status: 'active',
        messageCount: session.messageCount,
      },
    }
  } catch {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Session not found: ${targetSessionId}`,
      },
      error: `Session not found: ${targetSessionId}`,
    }
  }
}

export const handleSessions: CommandHandler = async (
  _args: string[],
  _context: CommandContext,
): Promise<FrontendCommandResult> => {
  try {
    const response = await getSessions(undefined, 10, 0)
    const sessions = response.sessions

    if (sessions.length === 0) {
      return {
        success: true,
        output: {
          type: 'text',
          content: '暂无会话',
        },
        data: { sessions: [], total: 0 },
      }
    }

    const sessionList = sessions
      .map(
        (session: ConsoleSessionInfo) =>
          `${session.sessionId} | ${session.title} | ${session.status} | ${session.messageCount} messages`,
      )
      .join('\n')

    return {
      success: true,
      output: {
        type: 'structured',
        content: `Sessions (${sessions.length} of ${response.total}):\n\nID | Title | Status | Messages\n${'-'.repeat(50)}\n${sessionList}`,
        data: {
          sessions: sessions.map((s: ConsoleSessionInfo) => ({
            id: s.sessionId,
            title: s.title,
            status: s.status,
            messageCount: s.messageCount,
          })),
          total: response.total,
        },
      },
      data: {
        sessions: sessions.map((s: ConsoleSessionInfo) => ({
          id: s.sessionId,
          title: s.title,
          status: s.status,
          messageCount: s.messageCount,
        })),
        total: response.total,
      },
    }
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to get sessions: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const handleSettings: CommandHandler = async (
  _args: string[],
  context: CommandContext,
): Promise<FrontendCommandResult> => {
  try {
    const response = await getSettings()
    const settings = response.settings

    if (context.setActiveTab) {
      context.setActiveTab('settings')

      return {
        success: true,
        output: {
          type: 'text',
          content: 'Navigating to settings tab...',
        },
        data: settings,
        navigateTo: 'settings',
      }
    }

    const settingsSummary = [
      `Local Only: ${settings.localOnly ? 'Yes' : 'No'}`,
      `Retention Days: ${settings.retentionDays}`,
      `Configured Providers: ${Object.keys(settings.providers).length}`,
    ].join('\n')

    return {
      success: true,
      output: {
        type: 'structured',
        content: `Settings:\n${'-'.repeat(30)}\n${settingsSummary}`,
        data: settings,
      },
      data: settings,
    }
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to get settings: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export const sessionHandlers = {
  new: handleNew,
  session: handleSession,
  sessions: handleSessions,
  settings: handleSettings,
}