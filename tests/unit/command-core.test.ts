import { describe, it, expect } from 'vitest';
import {
  CommandName,
  CommandCategory,
  COMMAND_CATALOG,
  getCommand,
  hasCommand,
  getAllCommands,
  getCommandsByCategory,
  getSubcommand,
  hasSubcommand,
  parseCommand,
  isCommand,
  isEscapedCommand,
  createSuccessResult,
  createErrorResult,
  COMMAND_ALIASES,
  COMMAND_ALIASES_REVERSE,
  resolveAlias,
  isAlias,
  getAliasesForCommand,
} from '../../src/command-core/index.js';

describe('Command Types', () => {
  it('should have all 24 command names defined', () => {
    const expectedCommands: CommandName[] = [
      'help',
      'commands',
      'tools',
      'skill',
      'status',
      'diagnostics',
      'usage',
      'new',
      'session',
      'sessions',
      'logs',
      'debug',
      'settings',
      'export-session',
      'think',
      'verbose',
      'reasoning',
      'model',
      'models',
      'providers',
      'provider',
      'logout',
      'exit',
      'quit',
    ];

    const actualCommands = Object.keys(COMMAND_CATALOG);
    expect(actualCommands.length).toBe(24);
    expectedCommands.forEach((cmd) => {
      expect(actualCommands).toContain(cmd);
    });
  });

  it('should have valid command categories', () => {
    const categories: CommandCategory[] = [
      'help',
      'status',
      'session',
      'data',
      'preference',
      'provider',
      'auth',
    ];

    const allCommands = getAllCommands();
    allCommands.forEach((cmd) => {
      expect(categories).toContain(cmd.category);
    });
  });

  it('should have valid risk levels', () => {
    const allCommands = getAllCommands();
    allCommands.forEach((cmd) => {
      expect(['safe', 'mutation']).toContain(cmd.risk);
    });
  });
});

describe('Command Catalog', () => {
  it('getCommand should return command definition for valid commands', () => {
    const helpCmd = getCommand('help');
    expect(helpCmd).toBeDefined();
    expect(helpCmd?.name).toBe('help');
    expect(helpCmd?.category).toBe('help');
    expect(helpCmd?.risk).toBe('safe');

    const exitCmd = getCommand('exit');
    expect(exitCmd).toBeDefined();
    expect(exitCmd?.name).toBe('exit');
  });

  it('getCommand should return undefined for non-existent commands', () => {
    expect(getCommand('nonexistent' as CommandName)).toBeUndefined();
  });

  it('hasCommand should return true for valid commands', () => {
    expect(hasCommand('help')).toBe(true);
    expect(hasCommand('exit')).toBe(true);
    expect(hasCommand('provider')).toBe(true);
  });

  it('hasCommand should return false for invalid commands', () => {
    expect(hasCommand('nonexistent')).toBe(false);
    expect(hasCommand('')).toBe(false);
  });

  it('getAllCommands should return all 24 commands', () => {
    const commands = getAllCommands();
    expect(commands.length).toBe(24);
    expect(commands.every((cmd) => cmd.name)).toBe(true);
  });

  it('getCommandsByCategory should return commands filtered by category', () => {
    const helpCommands = getCommandsByCategory('help');
    expect(helpCommands.length).toBeGreaterThan(0);
    expect(helpCommands.every((cmd) => cmd.category === 'help')).toBe(true);

    const authCommands = getCommandsByCategory('auth');
    expect(authCommands.every((cmd) => cmd.category === 'auth')).toBe(true);
  });

  it('getSubcommand should return subcommand definition', () => {
    const listSub = getSubcommand('session', 'list');
    expect(listSub).toBeDefined();
    expect(listSub?.description).toBeDefined();
    expect(listSub?.risk).toBeDefined();

    const connectSub = getSubcommand('provider', 'connect');
    expect(connectSub).toBeDefined();
  });

  it('getSubcommand should return undefined for non-existent subcommands', () => {
    expect(getSubcommand('help', 'nonexistent')).toBeUndefined();
    expect(getSubcommand('session', 'nonexistent')).toBeUndefined();
  });

  it('hasSubcommand should return true for valid subcommands', () => {
    expect(hasSubcommand('session', 'list')).toBe(true);
    expect(hasSubcommand('session', 'switch')).toBe(true);
    expect(hasSubcommand('provider', 'connect')).toBe(true);
    expect(hasSubcommand('provider', 'test')).toBe(true);
    expect(hasSubcommand('provider', 'enable')).toBe(true);
    expect(hasSubcommand('provider', 'disable')).toBe(true);
    expect(hasSubcommand('provider', 'delete')).toBe(true);
  });

  it('hasSubcommand should return false for invalid subcommands', () => {
    expect(hasSubcommand('help', 'anything')).toBe(false);
    expect(hasSubcommand('session', 'nonexistent')).toBe(false);
    expect(hasSubcommand('exit', 'sub')).toBe(false);
  });

  it('provider command should have all required subcommands', () => {
    const providerCmd = getCommand('provider');
    expect(providerCmd?.subcommands).toBeDefined();
    expect(hasSubcommand('provider', 'connect')).toBe(true);
    expect(hasSubcommand('provider', 'test')).toBe(true);
    expect(hasSubcommand('provider', 'enable')).toBe(true);
    expect(hasSubcommand('provider', 'disable')).toBe(true);
    expect(hasSubcommand('provider', 'delete')).toBe(true);
  });

  it('session command should have all required subcommands', () => {
    expect(hasSubcommand('session', 'list')).toBe(true);
    expect(hasSubcommand('session', 'switch')).toBe(true);
    expect(hasSubcommand('session', 'rename')).toBe(true);
    expect(hasSubcommand('session', 'clear')).toBe(true);
    expect(hasSubcommand('session', 'archive')).toBe(true);
    expect(hasSubcommand('session', 'delete')).toBe(true);
  });
});

describe('Command Parser', () => {
  it('parseCommand should return null for non-command input', () => {
    expect(parseCommand('hello world')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand('   ')).toBeNull();
    expect(parseCommand('help')).toBeNull();
  });

  it('parseCommand should parse simple commands', () => {
    const result = parseCommand('/help');
    expect(result).toEqual({
      command: 'help',
      args: [],
      rawInput: '/help',
      isEscaped: false,
    });
  });

  it('parseCommand should handle escaped commands (//)', () => {
    const result = parseCommand('//hello world');
    expect(result).toEqual({
      command: '',
      args: [],
      rawInput: 'hello world',
      isEscaped: true,
    });
  });

  it('parseCommand should parse commands with arguments', () => {
    const result = parseCommand('/help commands');
    expect(result).toEqual({
      command: 'help',
      args: ['commands'],
      rawInput: '/help commands',
      isEscaped: false,
    });
  });

  it('parseCommand should parse commands with multiple arguments', () => {
    const result = parseCommand('/session switch abc123');
    expect(result).toEqual({
      command: 'session',
      args: ['switch', 'abc123'],
      rawInput: '/session switch abc123',
      isEscaped: false,
    });
  });

  it('parseCommand should handle double-quoted arguments', () => {
    const result = parseCommand('/skill my-skill "hello world"');
    expect(result?.args).toEqual(['my-skill', 'hello world']);
  });

  it('parseCommand should handle single-quoted arguments', () => {
    const result = parseCommand("/skill my-skill 'hello world'");
    expect(result?.args).toEqual(['my-skill', 'hello world']);
  });

  it('parseCommand should handle mixed quotes', () => {
    const result = parseCommand('/skill "arg one" "arg two"');
    expect(result?.args).toEqual(['arg one', 'arg two']);
  });

  it('parseCommand should handle escaped characters in quotes', () => {
    const result = parseCommand('/skill "hello \\"world\\""');
    expect(result?.args).toEqual(['hello "world"']);
  });

  it('parseCommand should handle --key=value format', () => {
    const result = parseCommand('/settings key value');
    expect(result?.args).toEqual(['key', 'value']);
  });

  it('parseCommand should normalize command names to lowercase', () => {
    const result = parseCommand('/HELP');
    expect(result?.command).toBe('help');
  });

  it('parseCommand should trim whitespace', () => {
    const result = parseCommand('  /help   ');
    expect(result?.command).toBe('help');
    expect(result?.rawInput).toBe('/help');
  });

  it('parseCommand should handle empty arguments', () => {
    const result = parseCommand('/help  ');
    expect(result?.args).toEqual([]);
  });

  it('isCommand should return true for valid commands', () => {
    expect(isCommand('/help')).toBe(true);
    expect(isCommand('/exit')).toBe(true);
  });

  it('isCommand should return false for non-commands', () => {
    expect(isCommand('help')).toBe(false);
    expect(isCommand('')).toBe(false);
    expect(isCommand('//help')).toBe(false);
  });

  it('isEscapedCommand should return true for escaped commands', () => {
    expect(isEscapedCommand('//help')).toBe(true);
    expect(isEscapedCommand('// hello world')).toBe(true);
  });

  it('isEscapedCommand should return false for non-escaped commands', () => {
    expect(isEscapedCommand('/help')).toBe(false);
    expect(isEscapedCommand('help')).toBe(false);
  });
});

describe('Command Results', () => {
  it('createSuccessResult should create success result', () => {
    const result = createSuccessResult('help', 'Help output');
    expect(result).toEqual({
      success: true,
      commandName: 'help',
      output: 'Help output',
    });
  });

  it('createErrorResult should create error result', () => {
    const result = createErrorResult('unknown', 'Command not found');
    expect(result).toEqual({
      success: false,
      commandName: 'unknown',
      error: 'Command not found',
    });
  });
});

describe('Command Aliases', () => {
  it('COMMAND_ALIASES should map quit to exit', () => {
    expect(COMMAND_ALIASES.quit).toBe('exit');
  });

  it('COMMAND_ALIASES_REVERSE should have exit include quit', () => {
    expect(COMMAND_ALIASES_REVERSE.exit).toContain('quit');
  });

  it('resolveAlias should resolve quit to exit', () => {
    expect(resolveAlias('quit')).toBe('exit');
    expect(resolveAlias('QUIT')).toBe('exit');
    expect(resolveAlias('Quit')).toBe('exit');
  });

  it('resolveAlias should return input for non-aliases', () => {
    expect(resolveAlias('help')).toBe('help');
    expect(resolveAlias('exit')).toBe('exit');
    expect(resolveAlias('unknown')).toBe('unknown');
  });

  it('isAlias should return true for alias names', () => {
    expect(isAlias('quit')).toBe(true);
  });

  it('isAlias should return false for non-alias names', () => {
    expect(isAlias('exit')).toBe(false);
    expect(isAlias('help')).toBe(false);
    expect(isAlias('unknown')).toBe(false);
  });

  it('getAliasesForCommand should return aliases for a command', () => {
    const exitAliases = getAliasesForCommand('exit');
    expect(exitAliases).toContain('quit');

    const helpAliases = getAliasesForCommand('help');
    expect(helpAliases).toEqual([]);
  });
});
