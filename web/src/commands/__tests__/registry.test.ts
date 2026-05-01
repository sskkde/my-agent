import { describe, it, expect, beforeEach } from 'vitest';
import {
  CommandRegistry,
  createRegistry,
  DuplicateCommandError,
  CommandRegistryError,
} from '../registry.js';
import type {
  FrontendCommandDefinition,
  FrontendCommandResult,
} from '../types.js';

const mockHandler = async (): Promise<FrontendCommandResult> => ({
  success: true,
  commandName: 'test',
});

const createMockCommand = (
  name: string,
  aliases?: string[]
): FrontendCommandDefinition => ({
  name: name as FrontendCommandDefinition['name'],
  description: `Test ${name} command`,
  category: 'help',
  risk: 'safe',
  requiresAuth: false,
  backendMutation: false,
  aliases,
});

describe('CommandRegistry', () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  describe('register', () => {
    it('should register a command', () => {
      const cmd = createMockCommand('test');
      registry.register(cmd, mockHandler);

      expect(registry.hasCommand('test')).toBe(true);
      expect(registry.getRegisteredCount()).toBe(1);
    });

    it('should register command with aliases', () => {
      const cmd = createMockCommand('exit', ['quit', 'q']);
      registry.register(cmd, mockHandler);

      expect(registry.hasCommand('exit')).toBe(true);
      expect(registry.hasCommand('quit')).toBe(true);
      expect(registry.hasCommand('q')).toBe(true);
    });

    it('should throw DuplicateCommandError for duplicate command', () => {
      const cmd = createMockCommand('test');
      registry.register(cmd, mockHandler);

      expect(() => registry.register(cmd, mockHandler)).toThrow(
        DuplicateCommandError
      );
    });

    it('should throw DuplicateCommandError for duplicate alias', () => {
      const cmd1 = createMockCommand('cmd1', ['alias1']);
      const cmd2 = createMockCommand('cmd2', ['alias1']);

      registry.register(cmd1, mockHandler);
      expect(() => registry.register(cmd2, mockHandler)).toThrow(
        DuplicateCommandError
      );
    });

    it('should throw error when registering alias that matches existing command', () => {
      const cmd1 = createMockCommand('test');
      const cmd2 = createMockCommand('other', ['test']);

      registry.register(cmd1, mockHandler);
      expect(() => registry.register(cmd2, mockHandler)).toThrow(
        DuplicateCommandError
      );
    });
  });

  describe('getCommand', () => {
    it('should retrieve registered command', () => {
      const cmd = createMockCommand('test');
      registry.register(cmd, mockHandler);

      const result = registry.getCommand('test');
      expect(result).not.toBeNull();
      expect(result?.definition.name).toBe('test');
      expect(result?.handler).toBe(mockHandler);
    });

    it('should return null for unregistered command', () => {
      expect(registry.getCommand('nonexistent')).toBeNull();
    });

    it('should resolve alias to command', () => {
      const cmd = createMockCommand('exit', ['quit']);
      registry.register(cmd, mockHandler);

      const result = registry.getCommand('quit');
      expect(result?.definition.name).toBe('exit');
    });
  });

  describe('hasCommand', () => {
    it('should return true for registered command', () => {
      const cmd = createMockCommand('test');
      registry.register(cmd, mockHandler);

      expect(registry.hasCommand('test')).toBe(true);
    });

    it('should return true for registered alias', () => {
      const cmd = createMockCommand('exit', ['quit']);
      registry.register(cmd, mockHandler);

      expect(registry.hasCommand('quit')).toBe(true);
    });

    it('should return false for unregistered command', () => {
      expect(registry.hasCommand('nonexistent')).toBe(false);
    });
  });

  describe('resolveAlias', () => {
    it('should resolve quit to exit', () => {
      const cmd = createMockCommand('exit', ['quit']);
      registry.register(cmd, mockHandler);

      expect(registry.resolveAlias('quit')).toBe('exit');
    });

    it('should return original name if not an alias', () => {
      const cmd = createMockCommand('test');
      registry.register(cmd, mockHandler);

      expect(registry.resolveAlias('test')).toBe('test');
    });

    it('should handle builtin quit->exit alias', () => {
      expect(registry.resolveAlias('quit')).toBe('exit');
    });

    it('should resolve chained aliases', () => {
      const cmd = createMockCommand('final', ['middle']);
      registry.register(cmd, mockHandler);

      expect(registry.resolveAlias('middle')).toBe('final');
    });
  });

  describe('isAlias', () => {
    it('should identify quit as alias', () => {
      expect(registry.isAlias('quit')).toBe(true);
    });

    it('should not identify command name as alias', () => {
      const cmd = createMockCommand('test');
      registry.register(cmd, mockHandler);

      expect(registry.isAlias('test')).toBe(false);
    });

    it('should identify registered aliases', () => {
      const cmd = createMockCommand('command', ['alias']);
      registry.register(cmd, mockHandler);

      expect(registry.isAlias('alias')).toBe(true);
    });
  });

  describe('getAliasTarget', () => {
    it('should return target for alias', () => {
      expect(registry.getAliasTarget('quit')).toBe('exit');
    });

    it('should return null for non-alias', () => {
      expect(registry.getAliasTarget('nonexistent')).toBeNull();
    });

    it('should return target for registered alias', () => {
      const cmd = createMockCommand('target', ['alias']);
      registry.register(cmd, mockHandler);

      expect(registry.getAliasTarget('alias')).toBe('target');
    });
  });

  describe('getAllAliases', () => {
    it('should include builtin aliases', () => {
      const aliases = registry.getAllAliases();
      expect(aliases.get('quit')).toBe('exit');
    });

    it('should include registered aliases', () => {
      const cmd = createMockCommand('target', ['a1', 'a2']);
      registry.register(cmd, mockHandler);

      const aliases = registry.getAllAliases();
      expect(aliases.get('a1')).toBe('target');
      expect(aliases.get('a2')).toBe('target');
    });
  });

  describe('listCommands', () => {
    it('should return empty array for empty registry', () => {
      expect(registry.listCommands()).toEqual([]);
    });

    it('should return registered commands', () => {
      const cmd1 = createMockCommand('cmd1');
      const cmd2 = createMockCommand('cmd2');

      registry.register(cmd1, mockHandler);
      registry.register(cmd2, mockHandler);

      const commands = registry.listCommands();
      expect(commands).toHaveLength(2);
      expect(commands.map((c) => c.name)).toContain('cmd1');
      expect(commands.map((c) => c.name)).toContain('cmd2');
    });

    it('should not include aliases in list', () => {
      const cmd = createMockCommand('test', ['alias']);
      registry.register(cmd, mockHandler);

      const commands = registry.listCommands();
      expect(commands).toHaveLength(1);
      expect(commands[0]?.name).toBe('test');
    });
  });

  describe('registerCatalog', () => {
    it('should register multiple commands from catalog', () => {
      const catalog = {
        cmd1: createMockCommand('cmd1'),
        cmd2: createMockCommand('cmd2'),
      };
      const handlers = {
        cmd1: mockHandler,
        cmd2: mockHandler,
      };

      registry.registerCatalog(catalog, handlers);

      expect(registry.hasCommand('cmd1')).toBe(true);
      expect(registry.hasCommand('cmd2')).toBe(true);
    });

    it('should throw error if handler missing', () => {
      const catalog = {
        cmd1: createMockCommand('cmd1'),
      };
      const handlers = {};

      expect(() => registry.registerCatalog(catalog, handlers)).toThrow(
        CommandRegistryError
      );
    });
  });

  describe('clear', () => {
    it('should remove all registrations', () => {
      const cmd = createMockCommand('test');
      registry.register(cmd, mockHandler);

      registry.clear();

      expect(registry.hasCommand('test')).toBe(false);
      expect(registry.getRegisteredCount()).toBe(0);
    });

    it('should preserve builtin aliases after clear', () => {
      registry.clear();

      expect(registry.resolveAlias('quit')).toBe('exit');
      expect(registry.isAlias('quit')).toBe(true);
    });
  });

  describe('getRegisteredCount', () => {
    it('should return zero for new registry', () => {
      expect(registry.getRegisteredCount()).toBe(0);
    });

    it('should count registered commands', () => {
      registry.register(createMockCommand('cmd1'), mockHandler);
      registry.register(createMockCommand('cmd2'), mockHandler);

      expect(registry.getRegisteredCount()).toBe(2);
    });
  });

  describe('integration with catalog', () => {
    it('should work with command from catalog', async () => {
      const { COMMAND_CATALOG } = await import('../catalog.js');
      const helpCmd = COMMAND_CATALOG.help;

      registry.register(helpCmd, mockHandler);

      expect(registry.hasCommand('help')).toBe(true);
      const retrieved = registry.getCommand('help');
      expect(retrieved?.definition.name).toBe('help');
    });
  });
});

describe('createRegistry', () => {
  it('should create new registry instance', () => {
    const reg1 = createRegistry();
    const reg2 = createRegistry();

    reg1.register(createMockCommand('test'), mockHandler);

    expect(reg1.hasCommand('test')).toBe(true);
    expect(reg2.hasCommand('test')).toBe(false);
  });
});

describe('error classes', () => {
  it('should create DuplicateCommandError', () => {
    const error = new DuplicateCommandError('test');
    expect(error.name).toBe('DuplicateCommandError');
    expect(error.message).toContain('test');
    expect(error).toBeInstanceOf(CommandRegistryError);
  });

  it('should create CommandRegistryError', () => {
    const error = new CommandRegistryError('message');
    expect(error.name).toBe('CommandRegistryError');
    expect(error.message).toBe('message');
  });
});
