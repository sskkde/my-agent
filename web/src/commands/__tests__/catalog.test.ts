import { describe, it, expect } from 'vitest'
import {
  COMMAND_CATALOG,
  getAllCommands,
  getCommand,
  hasCommand,
  getCommandCount,
  getProviderSubcommands,
  isExcludedCommand,
  EXCLUDED_DANGEROUS_COMMANDS,
  getSubcommand,
  hasSubcommand,
} from '../catalog.js'

describe('Command Catalog', () => {
  describe('COMMAND_CATALOG', () => {
    it('should contain exactly 25 commands', () => {
      const count = getCommandCount()
      expect(count).toBe(25)

      const allCommands = getAllCommands()
      expect(allCommands).toHaveLength(25)
    })

    it('should contain all expected command names', () => {
      const expectedCommands = [
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
        'workdir',
        'logout',
        'exit',
        'quit',
      ]

      const catalogKeys = Object.keys(COMMAND_CATALOG).sort()
      const expectedKeys = expectedCommands.sort()

      expect(catalogKeys).toEqual(expectedKeys)
    })
  })

  describe('Provider subcommands', () => {
    it('should have all provider subcommands', () => {
      const providerSubcommands = getProviderSubcommands()

      expect(providerSubcommands).toContain('connect')
      expect(providerSubcommands).toContain('test')
      expect(providerSubcommands).toContain('enable')
      expect(providerSubcommands).toContain('disable')
      expect(providerSubcommands).toContain('delete')
      expect(providerSubcommands).toHaveLength(5)
    })

    it('should allow accessing individual provider subcommands', () => {
      const connectCmd = getSubcommand('provider', 'connect')
      expect(connectCmd).toBeDefined()
      expect(connectCmd?.risk).toBe('mutation')

      const testCmd = getSubcommand('provider', 'test')
      expect(testCmd).toBeDefined()
      expect(testCmd?.risk).toBe('safe')

      const enableCmd = getSubcommand('provider', 'enable')
      expect(enableCmd).toBeDefined()
      expect(enableCmd?.risk).toBe('mutation')

      const disableCmd = getSubcommand('provider', 'disable')
      expect(disableCmd).toBeDefined()
      expect(disableCmd?.risk).toBe('mutation')

      const deleteCmd = getSubcommand('provider', 'delete')
      expect(deleteCmd).toBeDefined()
      expect(deleteCmd?.risk).toBe('mutation')
    })

    it('should correctly identify provider subcommand existence', () => {
      expect(hasSubcommand('provider', 'connect')).toBe(true)
      expect(hasSubcommand('provider', 'test')).toBe(true)
      expect(hasSubcommand('provider', 'enable')).toBe(true)
      expect(hasSubcommand('provider', 'disable')).toBe(true)
      expect(hasSubcommand('provider', 'delete')).toBe(true)
      expect(hasSubcommand('provider', 'nonexistent')).toBe(false)
    })
  })

  describe('Excluded dangerous commands', () => {
    it('should exclude the correct dangerous commands', () => {
      const expectedExcluded = ['bash', 'mcp', 'plugins', 'config', 'restart', 'allowlist', 'tts']

      expect(EXCLUDED_DANGEROUS_COMMANDS).toEqual(expectedExcluded)
    })

    it('should identify excluded commands correctly', () => {
      EXCLUDED_DANGEROUS_COMMANDS.forEach((cmd) => {
        expect(isExcludedCommand(cmd)).toBe(true)
      })
    })

    it('should not include excluded commands in catalog', () => {
      EXCLUDED_DANGEROUS_COMMANDS.forEach((cmd) => {
        expect(hasCommand(cmd)).toBe(false)
        expect(getCommand(cmd)).toBeUndefined()
      })
    })

    it('should mark non-excluded commands correctly', () => {
      expect(isExcludedCommand('help')).toBe(false)
      expect(isExcludedCommand('settings')).toBe(false)
      expect(isExcludedCommand('logout')).toBe(false)
      expect(isExcludedCommand('provider')).toBe(false)
    })
  })

  describe('Command retrieval', () => {
    it('should retrieve commands by name', () => {
      const helpCmd = getCommand('help')
      expect(helpCmd).toBeDefined()
      expect(helpCmd?.name).toBe('help')
      expect(helpCmd?.category).toBe('help')

      const settingsCmd = getCommand('settings')
      expect(settingsCmd).toBeDefined()
      expect(settingsCmd?.name).toBe('settings')

      const providerCmd = getCommand('provider')
      expect(providerCmd).toBeDefined()
      expect(providerCmd?.name).toBe('provider')
    })

    it('should return undefined for non-existent commands', () => {
      expect(getCommand('nonexistent')).toBeUndefined()
    })

    it('should return undefined for excluded commands', () => {
      EXCLUDED_DANGEROUS_COMMANDS.forEach((cmd) => {
        expect(getCommand(cmd)).toBeUndefined()
      })
    })
  })

  describe('Command existence checks', () => {
    it('should correctly identify existing commands', () => {
      expect(hasCommand('help')).toBe(true)
      expect(hasCommand('settings')).toBe(true)
      expect(hasCommand('provider')).toBe(true)
      expect(hasCommand('exit')).toBe(true)
    })

    it('should correctly identify non-existent commands', () => {
      expect(hasCommand('nonexistent')).toBe(false)
      expect(hasCommand('foo')).toBe(false)
    })

    it('should return false for excluded commands', () => {
      EXCLUDED_DANGEROUS_COMMANDS.forEach((cmd) => {
        expect(hasCommand(cmd)).toBe(false)
      })
    })
  })

  describe('UI metadata', () => {
    it('should have UI metadata for all commands', () => {
      const allCommands = getAllCommands()

      allCommands.forEach((cmd) => {
        expect(cmd.ui).toBeDefined()
        expect(cmd.ui?.icon).toBeDefined()
        expect(cmd.ui?.color).toBeDefined()
      })
    })

    it('should have correct category colors', () => {
      const helpCmd = getCommand('help')
      expect(helpCmd?.ui?.color).toBe('blue')

      const statusCmd = getCommand('status')
      expect(statusCmd?.ui?.color).toBe('green')

      const sessionCmd = getCommand('session')
      expect(sessionCmd?.ui?.color).toBe('purple')

      const providerCmd = getCommand('provider')
      expect(providerCmd?.ui?.color).toBe('cyan')

      const logoutCmd = getCommand('logout')
      expect(logoutCmd?.ui?.color).toBe('red')
    })

    it('should have quick action flags for specific commands', () => {
      const helpCmd = getCommand('help')
      expect(helpCmd?.ui?.showInQuickActions).toBe(true)

      const newCmd = getCommand('new')
      expect(newCmd?.ui?.showInQuickActions).toBe(true)

      const settingsCmd = getCommand('settings')
      expect(settingsCmd?.ui?.showInQuickActions).toBe(true)

      const logoutCmd = getCommand('logout')
      expect(logoutCmd?.ui?.showInQuickActions).toBe(true)
    })

    it('should have keyboard shortcuts for exit commands', () => {
      const exitCmd = getCommand('exit')
      expect(exitCmd?.ui?.keyboardShortcut).toBe('Ctrl+Q')

      const quitCmd = getCommand('quit')
      expect(quitCmd?.ui?.keyboardShortcut).toBe('Ctrl+Q')
    })
  })

  describe('Session subcommands', () => {
    it('should have session subcommands', () => {
      const sessionCmd = getCommand('session')
      expect(sessionCmd?.subcommands).toBeDefined()

      expect(hasSubcommand('session', 'list')).toBe(true)
      expect(hasSubcommand('session', 'switch')).toBe(true)
      expect(hasSubcommand('session', 'rename')).toBe(true)
      expect(hasSubcommand('session', 'clear')).toBe(true)
      expect(hasSubcommand('session', 'archive')).toBe(true)
      expect(hasSubcommand('session', 'delete')).toBe(true)
    })
  })

  describe('Workdir subcommands', () => {
    it('should have workdir subcommands', () => {
      const workdirCmd = getCommand('workdir')
      expect(workdirCmd?.subcommands).toBeDefined()

      expect(hasSubcommand('workdir', 'list')).toBe(true)
      expect(hasSubcommand('workdir', 'new')).toBe(true)
      expect(hasSubcommand('workdir', 'switch')).toBe(true)
      expect(hasSubcommand('workdir', 'pwd')).toBe(true)
      expect(hasSubcommand('workdir', 'tree')).toBe(true)
    })

    it('should have correct workdir subcommand risk levels', () => {
      const listCmd = getSubcommand('workdir', 'list')
      expect(listCmd?.risk).toBe('safe')

      const newCmd = getSubcommand('workdir', 'new')
      expect(newCmd?.risk).toBe('mutation')

      const switchCmd = getSubcommand('workdir', 'switch')
      expect(switchCmd?.risk).toBe('mutation')

      const pwdCmd = getSubcommand('workdir', 'pwd')
      expect(pwdCmd?.risk).toBe('safe')

      const treeCmd = getSubcommand('workdir', 'tree')
      expect(treeCmd?.risk).toBe('safe')
    })

    it('should correctly identify workdir subcommand existence', () => {
      expect(hasSubcommand('workdir', 'list')).toBe(true)
      expect(hasSubcommand('workdir', 'nonexistent')).toBe(false)
    })

    it('should have workdir in session category', () => {
      const workdirCmd = getCommand('workdir')
      expect(workdirCmd?.category).toBe('session')
    })

    it('should have folder UI icon override', () => {
      const workdirCmd = getCommand('workdir')
      expect(workdirCmd?.ui?.icon).toBe('folder')
    })
  })
})
