import type { CommandContext, CommandHandler, FrontendCommandResult } from '../types.js';
import { getAllCommands, getCommandsByCategory, COMMAND_CATALOG } from '../catalog.js';

function formatCommandList(): string {
  const commands = getAllCommands();
  const maxNameLength = Math.max(...commands.map((cmd) => cmd.name.length));

  const lines = commands.map((cmd) => {
    const padding = ' '.repeat(maxNameLength - cmd.name.length + 2);
    return `  /${cmd.name}${padding}${cmd.description}`;
  });

  return [
    'Available Commands:',
    '',
    ...lines,
    '',
    'Type /commands for detailed information or /help <command> for specific command help.',
  ].join('\n');
}

function formatDetailedCommands(): string {
  const categories = ['help', 'status', 'session', 'data', 'preference', 'provider', 'auth'] as const;
  const categoryLabels: Record<(typeof categories)[number], string> = {
    help: 'Help & Information',
    status: 'Status & Diagnostics',
    session: 'Session Management',
    data: 'Data & Logs',
    preference: 'Preferences',
    provider: 'Provider Management',
    auth: 'Authentication',
  };

  const sections: string[] = ['Available Commands by Category:', ''];

  for (const category of categories) {
    const commands = getCommandsByCategory(category);
    if (commands.length === 0) continue;

    sections.push(`${categoryLabels[category]}:`);
    sections.push('');

    for (const cmd of commands) {
      sections.push(`  /${cmd.name}`);
      sections.push(`    ${cmd.description}`);
      if (cmd.usage) {
        sections.push(`    Usage: ${cmd.usage}`);
      }
      if (cmd.aliases && cmd.aliases.length > 0) {
        sections.push(`    Aliases: ${cmd.aliases.map((a) => `/${a}`).join(', ')}`);
      }
      sections.push('');
    }
  }

  sections.push('Type /help <command> for detailed information about a specific command.');

  return sections.join('\n');
}

function formatSpecificCommandHelp(commandName: string): FrontendCommandResult {
  const command = COMMAND_CATALOG[commandName as keyof typeof COMMAND_CATALOG];

  if (!command) {
  return {
    success: false,
    output: { type: 'error', content: `Unknown command: "${commandName}". Type /help for available commands.` },
    error: `Unknown command: "${commandName}". Type /help for available commands.`,
    commandName: 'help',
  };
  }

  const lines: string[] = [`/${command.name}`, ''];

  lines.push(`Description: ${command.description}`);

  if (command.usage) {
    lines.push(`Usage: ${command.usage}`);
  }

  lines.push(`Category: ${command.category}`);
  lines.push(`Risk: ${command.risk}`);
  lines.push(`Requires Auth: ${command.requiresAuth ? 'Yes' : 'No'}`);

  if (command.aliases && command.aliases.length > 0) {
    lines.push(`Aliases: ${command.aliases.map((a) => `/${a}`).join(', ')}`);
  }

  if (command.subcommands) {
    lines.push('');
    lines.push('Subcommands:');
    for (const [name, sub] of Object.entries(command.subcommands)) {
      lines.push(`  ${name} - ${sub.description}`);
      if (sub.usage) {
        lines.push(`    Usage: ${sub.usage}`);
      }
    }
  }

  return {
    success: true,
    output: { type: 'text', content: lines.join('\n') },
    commandName: 'help',
  };
}

export const handleHelp: CommandHandler = async (
  args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  if (args.length > 0) {
    return formatSpecificCommandHelp(args[0]);
  }

  return {
    success: true,
    output: { type: 'text', content: formatCommandList() },
    commandName: 'help',
  };
};

export const handleCommands: CommandHandler = async (
  _args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  return {
    success: true,
    output: { type: 'text', content: formatDetailedCommands() },
    commandName: 'commands',
  };
};

export const handleExit: CommandHandler = async (
  _args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  return {
    success: true,
    output: { type: 'text', content: 'Web Console cannot close browser tab. Use your browser controls to close this tab or window.' },
    commandName: 'exit',
  };
};

export const handleQuit: CommandHandler = async (
  _args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  return {
    success: true,
    output: { type: 'text', content: 'Web Console cannot close browser tab. Use your browser controls to close this tab or window.' },
    commandName: 'quit',
  };
};

export const staticHandlers = {
  help: handleHelp,
  commands: handleCommands,
  exit: handleExit,
  quit: handleQuit,
};
