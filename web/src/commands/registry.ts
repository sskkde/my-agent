import { COMMAND_CATALOG, getCommand } from './catalog.js'

import type { FrontendCommandDefinition, RegisteredCommand, CommandHandler } from './types.js'

export class CommandRegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CommandRegistryError'
  }
}

export class DuplicateCommandError extends CommandRegistryError {
  constructor(commandName: string) {
    super(`Command "${commandName}" is already registered`)
    this.name = 'DuplicateCommandError'
  }
}

export class CommandRegistry {
  private handlers: Map<string, CommandHandler> = new Map()
  private definitions: Map<string, FrontendCommandDefinition> = new Map()
  private aliases: Map<string, string> = new Map()
  private registeredCommands: Set<string> = new Set()

  constructor() {
    this.initializeAliases()
  }

  private initializeAliases(): void {
    for (const [name, definition] of Object.entries(COMMAND_CATALOG)) {
      if (definition.aliases && definition.aliases.length > 0) {
        for (const alias of definition.aliases) {
          this.aliases.set(alias, name)
        }
      }
    }

    this.aliases.set('quit', 'exit')
  }

  register(command: FrontendCommandDefinition, handler: CommandHandler): void {
    const name = command.name

    if (this.registeredCommands.has(name) || this.definitions.has(name)) {
      throw new DuplicateCommandError(name)
    }

    this.registeredCommands.add(name)
    this.definitions.set(name, command)
    this.handlers.set(name, handler)

    if (command.aliases) {
      for (const alias of command.aliases) {
        const existingAliasTarget = this.aliases.get(alias)
        if (existingAliasTarget && existingAliasTarget !== name) {
          throw new DuplicateCommandError(alias)
        }
        if (this.registeredCommands.has(alias) || this.definitions.has(alias)) {
          throw new DuplicateCommandError(alias)
        }
        this.handlers.set(alias, handler)
        this.aliases.set(alias, name)
      }
    }
  }

  registerCatalog(catalog: Record<string, FrontendCommandDefinition>, handlers: Record<string, CommandHandler>): void {
    for (const [name, definition] of Object.entries(catalog)) {
      const handler = handlers[name]
      if (!handler) {
        throw new CommandRegistryError(`No handler provided for command: ${name}`)
      }
      this.register(definition, handler)
    }
  }

  getCommand(name: string): RegisteredCommand | null {
    const resolvedName = this.resolveAlias(name)

    const definition = this.definitions.get(resolvedName)
    if (!definition) {
      const catalogDefinition = getCommand(resolvedName)
      if (!catalogDefinition) {
        return null
      }
    }

    const handler = this.handlers.get(resolvedName)
    if (!handler) {
      return null
    }

    const finalDefinition = this.definitions.get(resolvedName) ?? getCommand(resolvedName)

    if (!finalDefinition) {
      return null
    }

    return {
      definition: finalDefinition,
      handler,
    }
  }

  hasCommand(name: string): boolean {
    const resolvedName = this.resolveAlias(name)
    return this.handlers.has(resolvedName)
  }

  listCommands(): FrontendCommandDefinition[] {
    const result: FrontendCommandDefinition[] = []
    for (const name of this.registeredCommands) {
      const def = this.definitions.get(name)
      if (def) {
        result.push(def)
      }
    }
    return result
  }

  resolveAlias(name: string): string {
    const resolved = this.aliases.get(name)
    if (resolved) {
      return resolved
    }
    return name
  }

  isAlias(name: string): boolean {
    return this.aliases.has(name)
  }

  getAliasTarget(name: string): string | null {
    return this.aliases.get(name) ?? null
  }

  getAllAliases(): Map<string, string> {
    return new Map(this.aliases)
  }

  getRegisteredCount(): number {
    return this.registeredCommands.size
  }

  clear(): void {
    this.handlers.clear()
    this.definitions.clear()
    this.aliases.clear()
    this.registeredCommands.clear()
    this.initializeAliases()
  }
}

export function createRegistry(): CommandRegistry {
  return new CommandRegistry()
}

export const defaultRegistry = new CommandRegistry()
