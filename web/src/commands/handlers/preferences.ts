import type { CommandHandler, FrontendCommandResult } from '../types.js'
import { loadPreferences, updatePreference, type ThinkingLevel } from '../preferences.js'

const VALID_THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high']

function formatThinkingLevel(level: ThinkingLevel): string {
  const displayMap: Record<ThinkingLevel, string> = {
    off: 'off',
    minimal: 'minimal',
    low: 'low',
    medium: 'medium',
    high: 'high',
  }
  return displayMap[level]
}

export const handleThink: CommandHandler = async (args: string[]): Promise<FrontendCommandResult> => {
  const prefs = loadPreferences()

  if (args.length === 0) {
    return {
      success: true,
      output: {
        type: 'text',
        content: `Current thinking level: ${formatThinkingLevel(prefs.thinkingLevel)}\n\nThis is a UI preference only; backend model behavior is unchanged.`,
      },
      commandName: 'think',
    }
  }

  const value = args[0].toLowerCase()

  if (value === 'status') {
    return {
      success: true,
      output: {
        type: 'text',
        content: `Current thinking level: ${formatThinkingLevel(prefs.thinkingLevel)}\n\nThis is a UI preference only; backend model behavior is unchanged.`,
      },
      commandName: 'think',
    }
  }

  if (!VALID_THINKING_LEVELS.includes(value as ThinkingLevel)) {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Invalid thinking level: "${args[0]}". Valid values are: off, minimal, low, medium, high.`,
      },
      error: `Invalid thinking level: "${args[0]}"`,
      commandName: 'think',
    }
  }

  updatePreference('thinkingLevel', value as ThinkingLevel)

  return {
    success: true,
    output: {
      type: 'text',
      content: `Thinking level set to: ${formatThinkingLevel(value as ThinkingLevel)}\n\nThis is a UI preference only; backend model behavior is unchanged.`,
    },
    commandName: 'think',
  }
}

export const handleVerbose: CommandHandler = async (args: string[]): Promise<FrontendCommandResult> => {
  const prefs = loadPreferences()

  if (args.length === 0) {
    return {
      success: true,
      output: {
        type: 'text',
        content: `Verbose output: ${prefs.verbose ? 'on' : 'off'}\n\nThis is a UI preference only.`,
      },
      commandName: 'verbose',
    }
  }

  const value = args[0].toLowerCase()

  if (value === 'status') {
    return {
      success: true,
      output: {
        type: 'text',
        content: `Verbose output: ${prefs.verbose ? 'on' : 'off'}\n\nThis is a UI preference only.`,
      },
      commandName: 'verbose',
    }
  }

  if (value !== 'on' && value !== 'off') {
    return {
      success: false,
      output: { type: 'error', content: `Invalid value: "${args[0]}". Use 'on' or 'off'.` },
      error: `Invalid value: "${args[0]}"`,
      commandName: 'verbose',
    }
  }

  const newValue = value === 'on'
  updatePreference('verbose', newValue)

  return {
    success: true,
    output: { type: 'text', content: `Verbose output: ${newValue ? 'on' : 'off'}\n\nThis is a UI preference only.` },
    commandName: 'verbose',
  }
}

export const handleReasoning: CommandHandler = async (args: string[]): Promise<FrontendCommandResult> => {
  const prefs = loadPreferences()

  if (args.length === 0) {
    return {
      success: true,
      output: {
        type: 'text',
        content: `Reasoning/thinking summary display: ${prefs.reasoningVisible ? 'on' : 'off'}\n\nThis is a UI preference only. When enabled, thinking_summary events will be displayed in the chat context.`,
      },
      commandName: 'reasoning',
    }
  }

  const value = args[0].toLowerCase()

  if (value === 'status') {
    return {
      success: true,
      output: {
        type: 'text',
        content: `Reasoning/thinking summary display: ${prefs.reasoningVisible ? 'on' : 'off'}\n\nThis is a UI preference only. When enabled, thinking_summary events will be displayed in the chat context.`,
      },
      commandName: 'reasoning',
    }
  }

  if (value !== 'on' && value !== 'off') {
    return {
      success: false,
      output: { type: 'error', content: `Invalid value: "${args[0]}". Use 'on' or 'off'.` },
      error: `Invalid value: "${args[0]}"`,
      commandName: 'reasoning',
    }
  }

  const newValue = value === 'on'
  updatePreference('reasoningVisible', newValue)

  return {
    success: true,
    output: {
      type: 'text',
      content: `Reasoning/thinking summary display: ${newValue ? 'on' : 'off'}\n\nThis is a UI preference only. ${newValue ? 'thinking_summary events will now be displayed in the chat context.' : 'thinking_summary events will be hidden from the chat context.'}`,
    },
    commandName: 'reasoning',
  }
}

export const preferenceHandlers = {
  think: handleThink,
  verbose: handleVerbose,
  reasoning: handleReasoning,
}
