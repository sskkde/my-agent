/**
 * Pure command parser - no React, no DOM dependencies
 * Parses slash commands from user input
 */

import type { ParsedCommand } from './types.js'

const WHITESPACE_REGEX = /\s+/

function unescapeString(str: string): string {
  return str.replace(/\\(.)/g, '$1')
}

function parseArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuotes: string | null = null
  let escaped = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (escaped) {
      current += char
      escaped = false
      continue
    }

    if (char === '\\' && inQuotes) {
      const nextChar = input[i + 1]
      if (nextChar === '"' || nextChar === "'") {
        current += nextChar
        i++
        continue
      }
    }

    if (char === '\\' && !inQuotes) {
      escaped = true
      continue
    }

    if (char === '"' || char === "'") {
      if (inQuotes === null) {
        inQuotes = char
      } else if (inQuotes === char) {
        inQuotes = null
      } else {
        current += char
      }
      continue
    }

    if (WHITESPACE_REGEX.test(char) && inQuotes === null) {
      if (current.length > 0) {
        args.push(unescapeString(current))
        current = ''
      }
      continue
    }

    current += char
  }

  if (current.length > 0) {
    args.push(unescapeString(current))
  }

  return args
}

export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim()

  if (trimmed.startsWith('//')) {
    return {
      command: '',
      args: [],
      rawInput: trimmed.slice(2),
      isEscaped: true,
    }
  }

  if (!trimmed.startsWith('/')) {
    return null
  }

  const withoutSlash = trimmed.slice(1)
  const spaceIndex = withoutSlash.search(WHITESPACE_REGEX)

  let command: string
  let rest: string

  if (spaceIndex === -1) {
    command = withoutSlash.toLowerCase()
    rest = ''
  } else {
    command = withoutSlash.slice(0, spaceIndex).toLowerCase()
    rest = withoutSlash.slice(spaceIndex + 1).trim()
  }

  const args = parseArgs(rest)

  return {
    command,
    args,
    rawInput: trimmed,
    isEscaped: false,
  }
}

export function isCommand(input: string): boolean {
  const trimmed = input.trim()
  return trimmed.startsWith('/') && !trimmed.startsWith('//')
}

export function isEscapedCommand(input: string): boolean {
  return input.trim().startsWith('//')
}
