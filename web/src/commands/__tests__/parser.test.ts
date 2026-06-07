import { describe, it, expect } from 'vitest'
import { parseCommand, isCommand, isEscapedCommand, parseInput, parseArgs } from '../parser.js'

describe('Command Parser', () => {
  describe('parseCommand', () => {
    it('should parse simple slash commands', () => {
      const result = parseCommand('/help')
      expect(result).not.toBeNull()
      expect(result?.command).toBe('help')
      expect(result?.args).toEqual([])
      expect(result?.isEscaped).toBe(false)
    })

    it('should parse commands with single argument', () => {
      const result = parseCommand('/help settings')
      expect(result?.command).toBe('help')
      expect(result?.args).toEqual(['settings'])
    })

    it('should parse commands with multiple arguments', () => {
      const result = parseCommand('/session switch abc-123')
      expect(result?.command).toBe('session')
      expect(result?.args).toEqual(['switch', 'abc-123'])
    })

    it('should normalize command names to lowercase', () => {
      const result = parseCommand('/HELP')
      expect(result?.command).toBe('help')
    })

    it('should handle extra whitespace', () => {
      const result = parseCommand('  /help   settings  ')
      expect(result?.command).toBe('help')
      expect(result?.args).toEqual(['settings'])
    })

    it('should return null for non-command input', () => {
      expect(parseCommand('hello world')).toBeNull()
      expect(parseCommand('help')).toBeNull()
      expect(parseCommand('')).toBeNull()
    })

    it('should return null for empty input', () => {
      expect(parseCommand('')).toBeNull()
      expect(parseCommand('   ')).toBeNull()
    })
  })

  describe('escaped commands (//...)', () => {
    it('should detect escaped commands', () => {
      const result = parseCommand('//this is not a command')
      expect(result).not.toBeNull()
      expect(result?.isEscaped).toBe(true)
      expect(result?.command).toBe('')
      expect(result?.args).toEqual([])
      expect(result?.rawInput).toBe('this is not a command')
    })

    it('should handle escaped slash at start', () => {
      const result = parseCommand('// /help')
      expect(result?.isEscaped).toBe(true)
      expect(result?.rawInput).toBe(' /help')
    })

    it('should treat escaped text as literal', () => {
      const result = parseCommand('// /exit /quit /help')
      expect(result?.isEscaped).toBe(true)
      expect(result?.rawInput).toBe(' /exit /quit /help')
    })
  })

  describe('quoted arguments', () => {
    it('should handle double-quoted arguments', () => {
      const result = parseCommand('/session rename "My Session"')
      expect(result?.args).toEqual(['rename', 'My Session'])
    })

    it('should handle single-quoted arguments', () => {
      const result = parseCommand("/session rename 'My Session'")
      expect(result?.args).toEqual(['rename', 'My Session'])
    })

    it('should handle mixed quote types', () => {
      const result = parseCommand('/echo "double" and \'single\'')
      expect(result?.args).toEqual(['double', 'and', 'single'])
    })

    it('should preserve spaces inside quotes', () => {
      const result = parseCommand('/settings set theme "dark mode"')
      expect(result?.args).toEqual(['set', 'theme', 'dark mode'])
    })

    it('should handle empty quotes', () => {
      const result = parseCommand('/echo ""')
      expect(result?.args).toEqual([])
    })

    it('should handle quotes with special characters', () => {
      const result = parseCommand('/echo "hello\nworld"')
      expect(result?.args).toEqual(['hello\nworld'])
    })
  })

  describe('escaped characters', () => {
    it('should handle escaped quotes inside quotes', () => {
      const result = parseCommand('/echo "say \\"hello\\""')
      expect(result?.args).toEqual(['say "hello"'])
    })

    it('should handle escaped backslash outside quotes', () => {
      const result = parseCommand('/path "C:\\\\Users\\\\test"')
      expect(result?.command).toBe('path')
      expect(result?.args).toEqual(['C:\\Users\\test'])
    })

    it('should handle escaped spaces outside quotes', () => {
      const result = parseCommand('/echo hello\\ world')
      expect(result?.args).toEqual(['hello world'])
    })
  })

  describe('complex argument parsing', () => {
    it('should handle multiple quoted args', () => {
      const result = parseCommand('/search "term one" "term two" "term three"')
      expect(result?.args).toEqual(['term one', 'term two', 'term three'])
    })

    it('should handle mixed quoted and unquoted args', () => {
      const result = parseCommand('/command arg1 "arg two" arg3')
      expect(result?.args).toEqual(['arg1', 'arg two', 'arg3'])
    })

    it('should handle args with special characters', () => {
      const result = parseCommand('/url https://example.com/path?query=1')
      expect(result?.args).toEqual(['https://example.com/path?query=1'])
    })
  })

  describe('isCommand', () => {
    it('should return true for valid commands', () => {
      expect(isCommand('/help')).toBe(true)
      expect(isCommand('/settings')).toBe(true)
      expect(isCommand('/exit')).toBe(true)
    })

    it('should return false for escaped commands', () => {
      expect(isCommand('//help')).toBe(false)
      expect(isCommand('// /help')).toBe(false)
    })

    it('should return false for non-commands', () => {
      expect(isCommand('help')).toBe(false)
      expect(isCommand('hello')).toBe(false)
      expect(isCommand('')).toBe(false)
    })

    it('should handle whitespace', () => {
      expect(isCommand('  /help  ')).toBe(true)
    })
  })

  describe('isEscapedCommand', () => {
    it('should return true for escaped commands', () => {
      expect(isEscapedCommand('//help')).toBe(true)
      expect(isEscapedCommand('// /help')).toBe(true)
      expect(isEscapedCommand('//anything')).toBe(true)
    })

    it('should return false for regular commands', () => {
      expect(isEscapedCommand('/help')).toBe(false)
      expect(isEscapedCommand('/exit')).toBe(false)
    })

    it('should return false for non-commands', () => {
      expect(isEscapedCommand('help')).toBe(false)
      expect(isEscapedCommand('')).toBe(false)
    })
  })

  describe('parseInput (React wrapper)', () => {
    it('should identify commands', () => {
      const result = parseInput('/help')
      expect(result.isCommand).toBe(true)
      expect(result.isEscaped).toBe(false)
      expect(result.parsed?.command).toBe('help')
    })

    it('should identify escaped commands', () => {
      const result = parseInput('//help')
      expect(result.isCommand).toBe(false)
      expect(result.isEscaped).toBe(true)
      expect(result.escapedText).toBe('help')
    })

    it('should identify regular messages', () => {
      const result = parseInput('Hello world')
      expect(result.isCommand).toBe(false)
      expect(result.isEscaped).toBe(false)
      expect(result.parsed).toBeNull()
    })

    it('should include raw input in escaped result', () => {
      const result = parseInput('// /help command')
      expect(result.escapedText).toBe(' /help command')
    })
  })

  describe('parseArgs', () => {
    it('should parse simple args', () => {
      expect(parseArgs('a b c')).toEqual(['a', 'b', 'c'])
    })

    it('should parse quoted args', () => {
      expect(parseArgs('"hello world"')).toEqual(['hello world'])
    })

    it('should handle mixed args', () => {
      expect(parseArgs('arg1 "arg 2" arg3')).toEqual(['arg1', 'arg 2', 'arg3'])
    })

    it('should return empty array for empty string', () => {
      expect(parseArgs('')).toEqual([])
    })
  })
})
