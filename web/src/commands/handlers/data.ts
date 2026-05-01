import type { CommandContext, CommandHandler, FrontendCommandResult } from '../types.js';
import type { SkillSummary, UsageSummary, LogEntry } from '../../api/types.js';
import {
  getSkills,
  getUsage,
  getSessionUsage,
  getLogs,
  getDebugReplay,
  getTranscripts,
} from '../../api/client.js';

function parseArgs(args: string[]): { flags: Record<string, string | boolean>; positional: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const flagName = arg.slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[flagName] = args[i + 1];
        i++;
      } else {
        flags[flagName] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
}

export const handleSkill: CommandHandler = async (
  args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  try {
    const response = await getSkills();
    const skills = response.skills;

    if (skills.length === 0) {
      return {
        success: true,
        output: {
          type: 'text',
          content: 'No skills found',
        },
        data: { skills: [], total: 0 },
      };
    }

    if (args.length > 0) {
      const skillId = args[0];
      const skill = skills.find((s) => s.skillId === skillId);

      if (!skill) {
        return {
          success: false,
          output: {
            type: 'error',
            content: `Skill not found: ${skillId}`,
          },
          error: `Skill not found: ${skillId}`,
        };
      }

      return {
        success: true,
        output: {
          type: 'structured',
          content: `Skill: ${skill.name}\nID: ${skill.skillId}\nType: ${skill.type}\nEnabled: ${skill.enabled ? 'Yes' : 'No'}`,
          data: skill,
        },
        data: skill,
      };
    }

    const skillList = skills
      .map((skill: SkillSummary) => `${skill.skillId} | ${skill.name} | ${skill.type} | ${skill.enabled ? 'enabled' : 'disabled'}`)
      .join('\n');

    return {
      success: true,
      output: {
        type: 'structured',
        content: `Skills (${skills.length}):\n\nID | Name | Type | Status\n${'-'.repeat(50)}\n${skillList}`,
        data: {
          skills: skills.map((s: SkillSummary) => ({
            id: s.skillId,
            name: s.name,
            type: s.type,
            enabled: s.enabled,
          })),
          total: skills.length,
        },
      },
      data: {
        skills: skills.map((s) => ({
          id: s.skillId,
          name: s.name,
          type: s.type,
          enabled: s.enabled,
        })),
        total: skills.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to get skills: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const handleUsage: CommandHandler = async (
  args: string[],
  context: CommandContext
): Promise<FrontendCommandResult> => {
  const { flags, positional } = parseArgs(args);

  try {
    if (flags.all === true) {
      const response = await getUsage(undefined, 10, 0);
      const usages = response.usages;

      if (usages.length === 0) {
        return {
          success: true,
          output: {
            type: 'text',
            content: 'No usage data found',
          },
          data: { usages: [], total: 0 },
        };
      }

      const usageList = usages
        .map(
          (u: UsageSummary) =>
            `${u.sessionId} | ${u.messageCount} msgs | ${u.toolCallCount} tools | ${u.estimatedTotalTokens} tokens`
        )
        .join('\n');

      return {
        success: true,
        output: {
          type: 'structured',
          content: `Usage (showing ${usages.length} of ${response.total}):\n\nSession | Messages | Tool Calls | Tokens\n${'-'.repeat(60)}\n${usageList}`,
          data: {
            usages: usages.map((u: UsageSummary) => ({
              sessionId: u.sessionId,
              messageCount: u.messageCount,
              toolCallCount: u.toolCallCount,
              tokens: u.estimatedTotalTokens,
            })),
            total: response.total,
          },
        },
        data: {
          usages,
          total: response.total,
        },
      };
    }

    // --session <id> flag for specific session
    const targetSessionId = typeof flags.session === 'string' ? flags.session : positional[0];

    if (targetSessionId) {
      const response = await getSessionUsage(targetSessionId);
      const usage = response.usage;

      return {
        success: true,
        output: {
          type: 'structured',
          content: `Session Usage: ${usage.sessionId}\nMessages: ${usage.messageCount}\nTurns: ${usage.turnCount}\nTool Calls: ${usage.toolCallCount}\nTokens: ${usage.estimatedTotalTokens}\nCost: ${usage.estimatedCostCents !== null ? `$${(usage.estimatedCostCents / 100).toFixed(4)}` : 'N/A'}`,
          data: usage,
        },
        data: usage,
      };
    }

    // Use selected session if available
    const currentSessionId = context.sessionId;
    if (currentSessionId) {
      const response = await getSessionUsage(currentSessionId);
      const usage = response.usage;

      return {
        success: true,
        output: {
          type: 'structured',
          content: `Session Usage: ${usage.sessionId}\nMessages: ${usage.messageCount}\nTurns: ${usage.turnCount}\nTool Calls: ${usage.toolCallCount}\nTokens: ${usage.estimatedTotalTokens}\nCost: ${usage.estimatedCostCents !== null ? `$${(usage.estimatedCostCents / 100).toFixed(4)}` : 'N/A'}`,
          data: usage,
        },
        data: usage,
      };
    }

    const response = await getUsage(undefined, 10, 0);
    const usages = response.usages;

    if (usages.length === 0) {
      return {
        success: true,
        output: {
          type: 'text',
          content: 'No usage data found',
        },
        data: { usages: [], total: 0 },
      };
    }

    const usageList = usages
      .map(
        (u: UsageSummary) =>
          `${u.sessionId} | ${u.messageCount} msgs | ${u.toolCallCount} tools | ${u.estimatedTotalTokens} tokens`
      )
      .join('\n');

    return {
      success: true,
      output: {
        type: 'structured',
        content: `Usage (no session selected, showing ${usages.length} of ${response.total}):\n\nSession | Messages | Tool Calls | Tokens\n${'-'.repeat(60)}\n${usageList}`,
        data: {
          usages: usages.map((u: UsageSummary) => ({
            sessionId: u.sessionId,
            messageCount: u.messageCount,
            toolCallCount: u.toolCallCount,
            tokens: u.estimatedTotalTokens,
          })),
          total: response.total,
        },
      },
      data: {
        usages,
        total: response.total,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to get usage: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const handleLogs: CommandHandler = async (
  args: string[],
  context: CommandContext
): Promise<FrontendCommandResult> => {
  const { flags } = parseArgs(args);

  try {
    const sessionId = typeof flags.session === 'string'
      ? flags.session
      : context.sessionId || undefined;
    const eventType = typeof flags['event-type'] === 'string' ? flags['event-type'] : undefined;
    const sourceModule = typeof flags.source === 'string' ? flags.source : undefined;
    const limit = typeof flags.limit === 'string' ? parseInt(flags.limit, 10) : 10;

    const response = await getLogs(sessionId, sourceModule, eventType, limit, 0);
    const logs = response.logs;

    if (logs.length === 0) {
      return {
        success: true,
        output: {
          type: 'text',
          content: 'No logs found',
        },
        data: { logs: [], total: 0 },
      };
    }

    const logList = logs
      .map(
        (log: LogEntry) =>
          `[${log.severity.toUpperCase()}] ${log.createdAt} | ${log.sourceModule} | ${log.eventType} | ${log.summary}`
      )
      .join('\n');

    const filterInfo = [];
    if (sessionId) filterInfo.push(`session: ${sessionId}`);
    if (eventType) filterInfo.push(`eventType: ${eventType}`);
    if (sourceModule) filterInfo.push(`source: ${sourceModule}`);

    const filterStr = filterInfo.length > 0 ? ` (filtered by ${filterInfo.join(', ')})` : '';

    return {
      success: true,
      output: {
        type: 'structured',
        content: `Logs${filterStr} (showing ${logs.length} of ${response.total}):\n\n${'-'.repeat(60)}\n${logList}`,
        data: {
          logs: logs.map((l: LogEntry) => ({
            eventId: l.eventId,
            severity: l.severity,
            sourceModule: l.sourceModule,
            eventType: l.eventType,
            summary: l.summary,
            createdAt: l.createdAt,
          })),
          total: response.total,
        },
      },
      data: {
        logs,
        total: response.total,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to get logs: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const handleDebug: CommandHandler = async (
  args: string[],
  context: CommandContext
): Promise<FrontendCommandResult> => {
  const { positional } = parseArgs(args);

    const sessionId = positional[0] || context.sessionId;

    if (!sessionId) {
    return {
      success: false,
      output: {
        type: 'error',
        content: 'No session specified. Either select a session or provide a session ID.',
      },
      error: 'No session specified',
    };
  }

  try {
    const response = await getDebugReplay(sessionId);

    const summary = [
      `Debug Replay Summary for ${sessionId}:`,
      '-'.repeat(40),
      `Total Events: ${response.eventCount}`,
      `Transcript Count: ${response.transcriptCount}`,
      `Run References: ${response.runRefs.length > 0 ? response.runRefs.join(', ') : 'None'}`,
      `Approval References: ${response.approvalRefs.length > 0 ? response.approvalRefs.join(', ') : 'None'}`,
      `Last Event ID: ${response.lastEventId || 'N/A'}`,
    ].join('\n');

    return {
      success: true,
      output: {
        type: 'structured',
        content: summary,
        data: response,
      },
      data: response,
    };
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to get debug replay: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const handleExportSession: CommandHandler = async (
  args: string[],
  context: CommandContext
): Promise<FrontendCommandResult> => {
  const { positional } = parseArgs(args);

  const sessionId = positional[0] || context.sessionId;

  if (!sessionId) {
    return {
      success: false,
      output: {
        type: 'error',
        content: 'No session specified. Either select a session or provide a session ID.',
      },
      error: 'No session specified',
    };
  }

  try {
    const response = await getTranscripts(sessionId);
    const transcripts = response.transcripts;

    const exportData = {
      sessionId,
      exportedAt: new Date().toISOString(),
      transcripts,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `session-${sessionId}-transcript.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    return {
      success: true,
      output: {
        type: 'structured',
        content: `Exported session ${sessionId}:\n${transcripts.length} transcript(s) saved to session-${sessionId}-transcript.json`,
        data: {
          sessionId,
          transcriptCount: transcripts.length,
          filename: `session-${sessionId}-transcript.json`,
        },
      },
      data: {
        sessionId,
        transcriptCount: transcripts.length,
        transcripts,
      },
    };
  } catch (error) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Failed to export session: ${error instanceof Error ? error.message : String(error)}`,
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const dataHandlers = {
  skill: handleSkill,
  usage: handleUsage,
  logs: handleLogs,
  debug: handleDebug,
  'export-session': handleExportSession,
};
