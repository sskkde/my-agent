import {
  parseCommand as parseCommandCore,
  isCommand as isCommandCore,
  isEscapedCommand as isEscapedCommandCore,
} from '../../../src/command-core/parser.js'

import type { ParsedCommand } from '../../../src/command-core/types.js'

export function parseCommand(input: string): ParsedCommand | null {
  return parseCommandCore(input)
}

export function isCommand(input: string): boolean {
  return isCommandCore(input)
}

export function isEscapedCommand(input: string): boolean {
  return isEscapedCommandCore(input)
}

export interface ParseResult {
  isCommand: boolean
  isEscaped: boolean
  parsed: ParsedCommand | null
  escapedText?: string
}

export function parseInput(input: string): ParseResult {
  const parsed = parseCommand(input)

  if (parsed?.isEscaped) {
    return {
      isCommand: false,
      isEscaped: true,
      parsed: null,
      escapedText: parsed.rawInput,
    }
  }

  if (parsed) {
    return {
      isCommand: true,
      isEscaped: false,
      parsed,
    }
  }

  return {
    isCommand: false,
    isEscaped: false,
    parsed: null,
  }
}

export function parseArgs(input: string): string[] {
  const parsed = parseCommandCore('/dummy ' + input)
  return parsed?.args ?? []
}
