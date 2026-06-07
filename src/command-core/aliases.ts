/**
 * Command alias mappings
 * Maps alias names to their canonical command names
 */

import type { CommandName } from './types.js'

export const COMMAND_ALIASES: Record<string, CommandName> = {
  quit: 'exit',
}

export const COMMAND_ALIASES_REVERSE: Record<CommandName, string[]> = {
  help: [],
  commands: [],
  tools: [],
  skill: [],
  status: [],
  diagnostics: [],
  usage: [],
  new: [],
  session: [],
  sessions: [],
  logs: [],
  debug: [],
  settings: [],
  'export-session': [],
  think: [],
  verbose: [],
  reasoning: [],
  model: [],
  models: [],
  providers: [],
  provider: [],
  logout: [],
  exit: ['quit'],
  quit: [],
}

/**
 * Resolve an alias to its canonical command name
 * Returns the input if no alias exists
 */
export function resolveAlias(input: string): CommandName | string {
  const normalized = input.toLowerCase().trim()
  return COMMAND_ALIASES[normalized] ?? normalized
}

/**
 * Check if a command name is an alias
 */
export function isAlias(input: string): boolean {
  const normalized = input.toLowerCase().trim()
  return normalized in COMMAND_ALIASES
}

/**
 * Get all aliases for a canonical command name
 */
export function getAliasesForCommand(commandName: CommandName): string[] {
  return COMMAND_ALIASES_REVERSE[commandName] ?? []
}
