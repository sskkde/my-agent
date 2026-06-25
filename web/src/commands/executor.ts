/**
 * Command executor
 * Dispatches parsed commands to their appropriate handlers
 *
 * NOTE: Handler imports will fail until T5-T8 are implemented.
 * This is expected scaffolding that will work once handlers are available.
 */

import type { ParsedCommand } from '../../../src/command-core/types.js'
import type { CommandContext, FrontendCommandResult } from './types.js'
import { hasCommand, getCommand } from './catalog.js'

import { preferenceHandlers } from './handlers/preferences.js'
import { dataHandlers } from './handlers/data.js'
import { providerHandlers } from './handlers/providers.js'
import { workdirHandlers } from './handlers/workdir.js'

/**
 * Placeholder handler for commands not yet implemented
 * Returns a helpful message indicating the command is not yet available
 */
function createPlaceholderHandler(commandName: string) {
  return async (_args: string[], _context: CommandContext): Promise<FrontendCommandResult> => {
    return {
      success: false,
      output: {
        type: 'error',
        content: `Command "${commandName}" handler not yet implemented. This scaffolding will work once T5-T8 handlers are available.`,
      },
      error: `Command "${commandName}" handler not yet implemented. This scaffolding will work once T5-T8 handlers are available.`,
      commandName,
    }
  }
}

/**
 * Maps command names to their handler functions
 * Handlers are dynamically resolved to allow for future implementations
 */
const handlerMap: Record<
  string,
  (args: string[], context: CommandContext) => Promise<FrontendCommandResult> | FrontendCommandResult
> = {
  help: createPlaceholderHandler('help'),
  commands: createPlaceholderHandler('commands'),
  tools: createPlaceholderHandler('tools'),
  skill: dataHandlers.skill,
  status: createPlaceholderHandler('status'),
  diagnostics: createPlaceholderHandler('diagnostics'),
  usage: dataHandlers.usage,
  new: createPlaceholderHandler('new'),
  session: createPlaceholderHandler('session'),
  sessions: createPlaceholderHandler('sessions'),
  logs: dataHandlers.logs,
  debug: dataHandlers.debug,
  settings: createPlaceholderHandler('settings'),
  'export-session': dataHandlers['export-session'],
  think: preferenceHandlers.think,
  verbose: preferenceHandlers.verbose,
  reasoning: preferenceHandlers.reasoning,
  model: createPlaceholderHandler('model'),
  models: createPlaceholderHandler('models'),
  providers: providerHandlers.providers,
  provider: providerHandlers.provider,
  workdir: workdirHandlers.workdir,
  logout: createPlaceholderHandler('logout'),
  exit: createPlaceholderHandler('exit'),
  quit: createPlaceholderHandler('quit'),
}

/**
 * Error result factory for consistent error responses
 */
function createErrorResult(commandName: string, error: string): FrontendCommandResult {
  return {
    success: false,
    error,
    commandName,
  }
}

/**
 * Executes a parsed command by dispatching to the appropriate handler
 *
 * @param parsed - The parsed command with command name and arguments
 * @param context - The command execution context
 * @returns The result of command execution
 */
export async function executeCommand(parsed: ParsedCommand, context: CommandContext): Promise<FrontendCommandResult> {
  const { command, args, isEscaped } = parsed

  // Handle escaped input (should not be treated as commands)
  if (isEscaped) {
    return createErrorResult(command, 'Escaped input detected. Command execution skipped.')
  }

  // Validate command exists in catalog
  if (!hasCommand(command)) {
    return createErrorResult(command, `Unknown command: "${command}". Type /help for available commands.`)
  }

  const commandDef = getCommand(command)
  if (!commandDef) {
    return createErrorResult(command, `Command "${command}" is not available.`)
  }

  // Get the handler for this command
  const handler = handlerMap[command]
  if (!handler) {
    return createErrorResult(command, `No handler registered for command: "${command}"`)
  }

  try {
    // Execute the handler
    const result = await handler(args, context)
    return result
  } catch (error) {
    // Handle any unexpected errors from the handler
    const errorMessage = error instanceof Error ? error.message : String(error)
    return createErrorResult(command, `Command execution failed: ${errorMessage}`)
  }
}

/**
 * Type guard to check if a value is a valid ParsedCommand
 */
export function isParsedCommand(value: unknown): value is ParsedCommand {
  if (!value || typeof value !== 'object') {
    return false
  }

  const cmd = value as Record<string, unknown>
  return (
    typeof cmd.command === 'string' &&
    Array.isArray(cmd.args) &&
    cmd.args.every((arg) => typeof arg === 'string') &&
    typeof cmd.rawInput === 'string' &&
    typeof cmd.isEscaped === 'boolean'
  )
}

/**
 * Creates a mock parsed command for testing
 */
export function createParsedCommand(
  command: string,
  args: string[] = [],
  rawInput?: string,
  isEscaped = false,
): ParsedCommand {
  return {
    command,
    args,
    rawInput: rawInput ?? `/${command} ${args.join(' ')}`.trim(),
    isEscaped,
  }
}
