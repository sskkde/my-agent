/**
 * Command result factory functions
 * Pure functions for creating command results
 */

import type { CommandResult } from './types.js'

export function createSuccessResult(commandName: string, output: string): CommandResult {
  return {
    success: true,
    commandName,
    output,
  }
}

export function createErrorResult(commandName: string, error: string): CommandResult {
  return {
    success: false,
    commandName,
    error,
  }
}
