/**
 * Frontend command catalog extending shared core catalog
 * Adds UI-specific metadata while avoiding duplicate definitions
 */

import {
  COMMAND_CATALOG as SHARED_COMMAND_CATALOG,
  getCommand as getSharedCommand,
  hasCommand as hasSharedCommand,
  getAllCommands as getAllSharedCommands,
  getCommandsByCategory as getSharedCommandsByCategory,
  getSubcommand as getSharedSubcommand,
  hasSubcommand as hasSharedSubcommand,
} from '../../../src/command-core/catalog.js';

import type {
  CommandDefinition as SharedCommandDefinition,
  CommandName as SharedCommandName,
} from '../../../src/command-core/types.js';

import type {
  FrontendCommandDefinition,
  FrontendCommandName,
  CommandUIMetadata,
} from './types.js';

/**
 * Dangerous commands that should be excluded from the WebUI
 * These are terminal-only or admin-only commands
 */
export const EXCLUDED_DANGEROUS_COMMANDS: readonly string[] = [
  'bash',
  'mcp',
  'plugins',
  'config',
  'restart',
  'allowlist',
  'tts',
] as const;

/**
 * UI metadata for each command category
 */
const CATEGORY_UI_METADATA: Record<
  SharedCommandDefinition['category'],
  Pick<CommandUIMetadata, 'icon' | 'color'>
> = {
  help: { icon: 'help-circle', color: 'blue' },
  status: { icon: 'activity', color: 'green' },
  session: { icon: 'message-square', color: 'purple' },
  data: { icon: 'database', color: 'orange' },
  preference: { icon: 'settings', color: 'gray' },
  provider: { icon: 'server', color: 'cyan' },
  auth: { icon: 'lock', color: 'red' },
};

/**
 * UI metadata for specific commands
 */
const COMMAND_UI_OVERRIDES: Partial<
  Record<SharedCommandName, Partial<CommandUIMetadata>>
> = {
  help: { showInQuickActions: true },
  new: { showInQuickActions: true },
  settings: { showInQuickActions: true },
  logout: { showInQuickActions: true },
  exit: { keyboardShortcut: 'Ctrl+Q' },
  quit: { keyboardShortcut: 'Ctrl+Q' },
};

/**
 * Transform shared command definition to frontend version with UI metadata
 */
function addUiMetadata(
  definition: SharedCommandDefinition
): FrontendCommandDefinition {
  const categoryMetadata = CATEGORY_UI_METADATA[definition.category];
  const commandOverrides = COMMAND_UI_OVERRIDES[definition.name] ?? {};

  return {
    ...definition,
    ui: {
      ...categoryMetadata,
      ...commandOverrides,
    },
  };
}

/**
 * Frontend command catalog - filtered and enhanced version of shared catalog
 * Contains all 24 top-level commands + provider subcommands
 */
export const COMMAND_CATALOG: Record<
  FrontendCommandName,
  FrontendCommandDefinition
> = (() => {
  const catalog = {} as Record<FrontendCommandName, FrontendCommandDefinition>;

  for (const [name, definition] of Object.entries(SHARED_COMMAND_CATALOG)) {
    if (EXCLUDED_DANGEROUS_COMMANDS.includes(name)) {
      continue;
    }

    const frontendName = name as FrontendCommandName;
    catalog[frontendName] = addUiMetadata(definition);
  }

  return catalog;
})();

/**
 * Get all frontend commands as an array
 * @returns Array of all command definitions
 */
export function getAllCommands(): FrontendCommandDefinition[] {
  return Object.values(COMMAND_CATALOG);
}

/**
 * Get a specific command by name
 * @param name Command name
 * @returns Command definition or undefined if not found/excluded
 */
export function getCommand(
  name: string
): FrontendCommandDefinition | undefined {
  if (isExcludedCommand(name)) {
    return undefined;
  }
  return COMMAND_CATALOG[name as FrontendCommandName];
}

/**
 * Check if a command exists in the frontend catalog
 * @param name Command name to check
 * @returns True if command exists and is not excluded
 */
export function hasCommand(name: string): boolean {
  if (isExcludedCommand(name)) {
    return false;
  }
  return name in COMMAND_CATALOG;
}

/**
 * Check if a command name is in the excluded dangerous commands list
 * @param name Command name to check
 * @returns True if command is excluded from WebUI
 */
export function isExcludedCommand(name: string): boolean {
  return EXCLUDED_DANGEROUS_COMMANDS.includes(name);
}

/**
 * Get commands filtered by category
 * @param category Category to filter by
 * @returns Array of commands in that category
 */
export function getCommandsByCategory(
  category: SharedCommandDefinition['category']
): FrontendCommandDefinition[] {
  return getAllCommands().filter((cmd) => cmd.category === category);
}

/**
 * Get a subcommand definition
 * @param commandName Parent command name
 * @param subcommandName Subcommand name
 * @returns Subcommand definition or undefined
 */
export function getSubcommand(
  commandName: string,
  subcommandName: string
): SharedCommandDefinition['subcommands'] extends infer S
  ? S extends Record<string, infer V>
    ? V | undefined
    : undefined
  : undefined {
  const command = getCommand(commandName);
  return command?.subcommands?.[subcommandName] as ReturnType<
    typeof getSubcommand
  >;
}

/**
 * Check if a command has a specific subcommand
 * @param commandName Parent command name
 * @param subcommandName Subcommand name
 * @returns True if subcommand exists
 */
export function hasSubcommand(
  commandName: string,
  subcommandName: string
): boolean {
  const command = getCommand(commandName);
  return subcommandName in (command?.subcommands ?? {});
}

/**
 * Get all provider subcommands
 * Provider commands: connect, test, enable, disable, delete
 * @returns Array of provider subcommand names
 */
export function getProviderSubcommands(): string[] {
  const providerCmd = COMMAND_CATALOG.provider;
  if (!providerCmd?.subcommands) {
    return [];
  }
  return Object.keys(providerCmd.subcommands);
}

/**
 * Get the count of top-level commands in the catalog
 * @returns Number of commands (should be 24)
 */
export function getCommandCount(): number {
  return Object.keys(COMMAND_CATALOG).length;
}

// Re-export shared utilities for convenience
export {
  getSharedCommand,
  hasSharedCommand,
  getAllSharedCommands,
  getSharedCommandsByCategory,
  getSharedSubcommand,
  hasSharedSubcommand,
  SHARED_COMMAND_CATALOG,
};
