/**
 * Shared command types for WebUI and terminal TUI parity
 * Framework-free - no React, no DOM, no Fastify dependencies
 */

export type CommandName =
  | 'help'
  | 'commands'
  | 'tools'
  | 'skill'
  | 'status'
  | 'diagnostics'
  | 'usage'
  | 'new'
  | 'session'
  | 'sessions'
  | 'logs'
  | 'debug'
  | 'settings'
  | 'export-session'
  | 'think'
  | 'verbose'
  | 'reasoning'
  | 'model'
  | 'models'
  | 'providers'
  | 'provider'
  | 'workdir'
  | 'logout'
  | 'exit'
  | 'quit'

export type CommandCategory = 'help' | 'status' | 'session' | 'data' | 'preference' | 'provider' | 'auth'

export type CommandRisk = 'safe' | 'mutation'

export interface CommandSubcommand {
  description: string
  usage?: string
  risk: CommandRisk
}

export interface CommandDefinition {
  name: CommandName
  aliases?: string[]
  description: string
  usage?: string
  category: CommandCategory
  risk: CommandRisk
  requiresAuth: boolean
  backendMutation: boolean
  subcommands?: Record<string, CommandSubcommand>
}

export interface ParsedCommand {
  command: string
  args: string[]
  rawInput: string
  isEscaped: boolean
}

export interface CommandResult {
  success: boolean
  output?: string
  error?: string
  commandName: string
}

export type CommandOutputKind = 'text' | 'json' | 'error' | 'success'

export interface CommandOutput {
  kind: CommandOutputKind
  content: string
  metadata?: Record<string, unknown>
}
