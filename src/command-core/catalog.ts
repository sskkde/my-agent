/**
 * Command catalog with all 24 top-level commands
 * Includes provider subcommands: connect, test, enable, disable, delete
 */

import type { CommandDefinition, CommandName, CommandSubcommand } from './types.js'

export const COMMAND_CATALOG: Record<CommandName, CommandDefinition> = {
  help: {
    name: 'help',
    aliases: [],
    description: 'Show help information for commands',
    usage: '/help [command]',
    category: 'help',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  commands: {
    name: 'commands',
    aliases: [],
    description: 'List all available commands',
    usage: '/commands',
    category: 'help',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  tools: {
    name: 'tools',
    aliases: [],
    description: 'List available tools',
    usage: '/tools',
    category: 'help',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  skill: {
    name: 'skill',
    aliases: [],
    description: 'Execute a skill',
    usage: '/skill <skill-name> [args...]',
    category: 'help',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  status: {
    name: 'status',
    aliases: [],
    description: 'Show current session status',
    usage: '/status',
    category: 'status',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  diagnostics: {
    name: 'diagnostics',
    aliases: [],
    description: 'Run system diagnostics',
    usage: '/diagnostics',
    category: 'status',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  usage: {
    name: 'usage',
    aliases: [],
    description: 'Show usage statistics',
    usage: '/usage',
    category: 'status',
    risk: 'safe',
    requiresAuth: true,
    backendMutation: false,
  },
  new: {
    name: 'new',
    aliases: [],
    description: 'Create a new session',
    usage: '/new',
    category: 'session',
    risk: 'mutation',
    requiresAuth: false,
    backendMutation: true,
  },
  session: {
    name: 'session',
    aliases: [],
    description: 'Manage sessions',
    usage: '/session <subcommand>',
    category: 'session',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
    subcommands: {
      list: {
        description: 'List all sessions',
        usage: '/session list',
        risk: 'safe',
      },
      switch: {
        description: 'Switch to a different session',
        usage: '/session switch <session-id>',
        risk: 'mutation',
      },
      rename: {
        description: 'Rename current session',
        usage: '/session rename <new-name>',
        risk: 'mutation',
      },
      clear: {
        description: 'Clear current session history',
        usage: '/session clear',
        risk: 'mutation',
      },
      archive: {
        description: 'Archive current session',
        usage: '/session archive',
        risk: 'mutation',
      },
      delete: {
        description: 'Delete a session',
        usage: '/session delete <session-id>',
        risk: 'mutation',
      },
    },
  },
  sessions: {
    name: 'sessions',
    aliases: [],
    description: 'List all sessions (alias for /session list)',
    usage: '/sessions',
    category: 'session',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  logs: {
    name: 'logs',
    aliases: [],
    description: 'View system logs',
    usage: '/logs [lines]',
    category: 'data',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  debug: {
    name: 'debug',
    aliases: [],
    description: 'Toggle debug mode',
    usage: '/debug [on|off]',
    category: 'data',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  settings: {
    name: 'settings',
    aliases: [],
    description: 'View or modify settings',
    usage: '/settings [key] [value]',
    category: 'preference',
    risk: 'mutation',
    requiresAuth: false,
    backendMutation: true,
  },
  'export-session': {
    name: 'export-session',
    aliases: [],
    description: 'Export current session to file',
    usage: '/export-session [format]',
    category: 'data',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  think: {
    name: 'think',
    aliases: [],
    description: 'Toggle thinking/reasoning display',
    usage: '/think [on|off]',
    category: 'preference',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  verbose: {
    name: 'verbose',
    aliases: [],
    description: 'Toggle verbose output mode',
    usage: '/verbose [on|off]',
    category: 'preference',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  reasoning: {
    name: 'reasoning',
    aliases: [],
    description: 'Toggle reasoning visibility',
    usage: '/reasoning [on|off]',
    category: 'preference',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  model: {
    name: 'model',
    aliases: [],
    description: 'Switch to a specific model',
    usage: '/model <model-name>',
    category: 'preference',
    risk: 'safe',
    requiresAuth: true,
    backendMutation: false,
  },
  models: {
    name: 'models',
    aliases: [],
    description: 'List available models',
    usage: '/models',
    category: 'preference',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  providers: {
    name: 'providers',
    aliases: [],
    description: 'List configured LLM providers',
    usage: '/providers',
    category: 'provider',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  provider: {
    name: 'provider',
    aliases: [],
    description: 'Manage LLM providers',
    usage: '/provider <subcommand>',
    category: 'provider',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
    subcommands: {
      connect: {
        description: 'Connect to a new provider',
        usage: '/provider connect <provider-name>',
        risk: 'mutation',
      },
      test: {
        description: 'Test provider connection',
        usage: '/provider test <provider-name>',
        risk: 'safe',
      },
      enable: {
        description: 'Enable a provider',
        usage: '/provider enable <provider-name>',
        risk: 'mutation',
      },
      disable: {
        description: 'Disable a provider',
        usage: '/provider disable <provider-name>',
        risk: 'mutation',
      },
      delete: {
        description: 'Delete a provider configuration',
        usage: '/provider delete <provider-name>',
        risk: 'mutation',
      },
    },
  },
  logout: {
    name: 'logout',
    aliases: [],
    description: 'Log out and clear credentials',
    usage: '/logout',
    category: 'auth',
    risk: 'mutation',
    requiresAuth: true,
    backendMutation: true,
  },
  exit: {
    name: 'exit',
    aliases: ['quit'],
    description: 'Exit the application',
    usage: '/exit',
    category: 'auth',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
  quit: {
    name: 'quit',
    aliases: [],
    description: 'Exit the application (alias for /exit)',
    usage: '/quit',
    category: 'auth',
    risk: 'safe',
    requiresAuth: false,
    backendMutation: false,
  },
}

export function getCommand(name: CommandName): CommandDefinition | undefined {
  return COMMAND_CATALOG[name]
}

export function hasCommand(name: string): name is CommandName {
  return name in COMMAND_CATALOG
}

export function getAllCommands(): CommandDefinition[] {
  return Object.values(COMMAND_CATALOG)
}

export function getCommandsByCategory(category: CommandDefinition['category']): CommandDefinition[] {
  return Object.values(COMMAND_CATALOG).filter((cmd) => cmd.category === category)
}

export function getSubcommand(commandName: CommandName, subcommandName: string): CommandSubcommand | undefined {
  const command = COMMAND_CATALOG[commandName]
  return command?.subcommands?.[subcommandName]
}

export function hasSubcommand(commandName: CommandName, subcommandName: string): boolean {
  const command = COMMAND_CATALOG[commandName]
  return subcommandName in (command?.subcommands ?? {})
}
