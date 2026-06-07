import { describe, it, expect } from 'vitest'
import { isValidToolName, sanitizeToolName } from '../../../src/tools/tool-name.js'

describe('isValidToolName', () => {
  it('accepts simple alphanumeric names', () => {
    expect(isValidToolName('read_file')).toBe(true)
    expect(isValidToolName('search')).toBe(true)
    expect(isValidToolName('tool42')).toBe(true)
  })

  it('accepts names with hyphens and underscores', () => {
    expect(isValidToolName('my-tool')).toBe(true)
    expect(isValidToolName('my_tool-v2')).toBe(true)
  })

  it('accepts names exactly at max length 64', () => {
    const name = 'A'.repeat(64)
    expect(isValidToolName(name)).toBe(true)
  })

  it('rejects names longer than 64 characters', () => {
    const name = 'A'.repeat(65)
    expect(isValidToolName(name)).toBe(false)
  })

  it('rejects names with dots (connector/mcp legacy pattern)', () => {
    expect(isValidToolName('connector.github.list_repos')).toBe(false)
    expect(isValidToolName('mcp.server.tool')).toBe(false)
  })

  it('rejects names with spaces', () => {
    expect(isValidToolName('my tool')).toBe(false)
  })

  it('rejects names with special characters', () => {
    expect(isValidToolName('tool@name')).toBe(false)
    expect(isValidToolName('tool/name')).toBe(false)
    expect(isValidToolName('tool:name')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isValidToolName('')).toBe(false)
  })
})

describe('sanitizeToolName', () => {
  it('passes through already-valid names', () => {
    expect(sanitizeToolName('valid_name')).toBe('valid_name')
    expect(sanitizeToolName('my-tool-42')).toBe('my-tool-42')
  })

  it('replaces dots with underscores (connector pattern)', () => {
    expect(sanitizeToolName('connector.github.list_repos')).toBe('connector_github_list_repos')
  })

  it('replaces dots and multiple separators (mcp pattern)', () => {
    expect(sanitizeToolName('mcp.github-server.search_repos')).toBe('mcp_github-server_search_repos')
  })

  it('replaces spaces and special chars with underscores', () => {
    expect(sanitizeToolName('my tool@name!')).toBe('my_tool_name')
    expect(sanitizeToolName('tool name')).toBe('tool_name')
  })

  it('collapses consecutive underscores', () => {
    expect(sanitizeToolName('a..b')).toBe('a_b')
  })

  it('truncates to max 64 characters', () => {
    const long = 'A'.repeat(100)
    const result = sanitizeToolName(long)
    expect(result.length).toBeLessThanOrEqual(64)
    expect(isValidToolName(result)).toBe(true)
  })

  it('returns "tool" for empty or all-invalid input', () => {
    expect(sanitizeToolName('!!!')).toBe('tool')
    expect(sanitizeToolName('.')).toBe('tool')
  })

  it('preserves hyphens and underscores during sanitization', () => {
    expect(sanitizeToolName('connector.github-api.list_repos-v2')).toBe('connector_github-api_list_repos-v2')
  })
})
