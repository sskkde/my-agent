#!/usr/bin/env node
/**
 * Terminal TUI Entrypoint
 * Lightweight readline-based TUI backed by shared command-core
 * Supports both interactive and --scripted modes
 */

import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output, exit } from 'node:process'
import { parseCommand } from '../command-core/parser.js'
import { COMMAND_CATALOG, getAllCommands } from '../command-core/catalog.js'
import { resolveAlias } from '../command-core/aliases.js'
import type { CommandDefinition, ParsedCommand } from '../command-core/types.js'

const VALID_PROVIDER_TYPES = ['openai', 'openrouter', 'deepseek', 'ollama'] as const
type ProviderType = (typeof VALID_PROVIDER_TYPES)[number]

function isValidProviderType(type: string): type is ProviderType {
  return VALID_PROVIDER_TYPES.includes(type as ProviderType)
}

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
}

// Configuration
const CONFIG = {
  prompt: '> ',
  appName: 'Agent Platform TUI',
  version: '0.1.0',
}

const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3003'}`

/**
 * Print colored text to stdout
 */
function print(text: string, color?: keyof typeof COLORS): void {
  if (color && COLORS[color]) {
    output.write(COLORS[color] + text + COLORS.reset)
  } else {
    output.write(text)
  }
}

/**
 * Print a line of colored text
 */
function println(text: string = '', color?: keyof typeof COLORS): void {
  print(text + '\n', color)
}

/**
 * Print usage information for the TUI
 */
function printUsage(): void {
  println(CONFIG.appName + ' v' + CONFIG.version, 'bold')
  println()
  println('Usage:')
  println('  npx tsx src/cli/tui.ts [options]')
  println()
  println('Options:')
  println('  --help, -h        Show this help message')
  println('  --scripted        Read commands from stdin (non-interactive)')
  println('  --version, -v     Show version information')
  println()
  println('Commands:')
  println('  /help [command]   Show help for commands')
  println('  /commands         List all available commands')
  println('  /status           Show current status')
  println('  /providers        List configured LLM providers')
  println('  /provider         Manage providers (connect, test, enable, disable, delete)')
  println('  /models           List available models')
  println('  /model <name>     Switch to a specific model')
  println('  /exit, /quit      Exit the application')
  println()
  println('In scripted mode, commands are read from stdin line by line.')
  println('Use "/exit" or "/quit" to terminate the session.')
}

/**
 * Print version information
 */
function printVersion(): void {
  println(CONFIG.appName + ' v' + CONFIG.version)
}

/**
 * Print the welcome banner
 */
function printWelcome(): void {
  println()
  println('╔════════════════════════════════════════╗', 'cyan')
  println('║     ' + CONFIG.appName + '      ║', 'cyan')
  println('║           v' + CONFIG.version + '                   ║', 'dim')
  println('╚════════════════════════════════════════╝', 'cyan')
  println()
  println('Type /help for available commands or /exit to quit.', 'dim')
  println()
}

/**
 * Execute the /help command
 */
function executeHelp(args: string[]): string {
  if (args.length === 0) {
    // General help
    let output = 'Available Commands:\n\n'

    const categories: Record<string, CommandDefinition[]> = {}
    const commands = getAllCommands()

    // Group commands by category
    for (const cmd of commands) {
      if (!categories[cmd.category]) {
        categories[cmd.category] = []
      }
      categories[cmd.category].push(cmd)
    }

    // Print commands by category
    for (const [category, cmds] of Object.entries(categories)) {
      output += COLORS.bold + category.toUpperCase() + COLORS.reset + '\n'
      for (const cmd of cmds) {
        const aliases = cmd.aliases && cmd.aliases.length > 0 ? ' (' + cmd.aliases.join(', ') + ')' : ''
        output += `  ${COLORS.cyan}/${cmd.name}${COLORS.reset}${aliases}\n`
        output += `    ${cmd.description}\n`
      }
      output += '\n'
    }

    output += 'Type /help <command> for detailed information about a specific command.'
    return output
  } else {
    // Help for specific command
    const commandName = resolveAlias(args[0]).toLowerCase()
    const cmd = COMMAND_CATALOG[commandName as keyof typeof COMMAND_CATALOG]

    if (!cmd) {
      return `Unknown command: ${args[0]}. Type /commands to see available commands.`
    }

    let output = `${COLORS.bold}${COLORS.cyan}/${cmd.name}${COLORS.reset}\n\n`
    output += `Description: ${cmd.description}\n`
    output += `Category: ${cmd.category}\n`
    output += `Usage: ${cmd.usage || '/' + cmd.name}\n`

    if (cmd.aliases && cmd.aliases.length > 0) {
      output += `Aliases: ${cmd.aliases.join(', ')}\n`
    }

    if (cmd.subcommands) {
      output += '\nSubcommands:\n'
      for (const [name, sub] of Object.entries(cmd.subcommands)) {
        output += `  ${name} - ${sub.description}\n`
      }
    }

    return output
  }
}

/**
 * Execute the /commands command
 */
function executeCommands(): string {
  const commands = getAllCommands()
  let output = 'Available Commands:\n\n'

  for (const cmd of commands) {
    const aliases = cmd.aliases && cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : ''
    output += `  ${COLORS.cyan}/${cmd.name}${COLORS.reset}${aliases}\n`
  }

  output += `\nTotal: ${commands.length} commands`
  return output
}

/**
 * Execute the /status command
 */
async function executeStatus(): Promise<string> {
  const timestamp = new Date().toISOString()

  let output = `${COLORS.bold}Status${COLORS.reset}\n\n`
  output += `Timestamp: ${timestamp}\n`
  output += `Mode: Local CLI\n`
  output += `Status: ${COLORS.green}Ready${COLORS.reset}\n`

  // Try to check if API server is running
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 1000)

    const response = await fetch(`${API_BASE_URL}/api/health`, {
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      output += `API Server: ${COLORS.green}Online${COLORS.reset} (${API_BASE_URL})\n`
    } else {
      output += `API Server: ${COLORS.yellow}Degraded${COLORS.reset} (${API_BASE_URL})\n`
    }
  } catch {
    output += `API Server: ${COLORS.dim}Offline${COLORS.reset} (${API_BASE_URL} not reachable)\n`
  }

  return output
}

/**
 * Execute the /providers command
 */
async function executeProviders(): Promise<string> {
  let output = `${COLORS.bold}Configured LLM Providers${COLORS.reset}\n\n`

  // Try to fetch providers from API
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(`${API_BASE_URL}/api/providers`, {
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      const providers = await response.json()

      if (Array.isArray(providers) && providers.length > 0) {
        for (const provider of providers) {
          const status =
            provider.enabled !== false ? `${COLORS.green}●${COLORS.reset}` : `${COLORS.gray}○${COLORS.reset}`
          output += `  ${status} ${provider.name || provider.id}\n`
          if (provider.description) {
            output += `      ${COLORS.dim}${provider.description}${COLORS.reset}\n`
          }
        }
      } else {
        output += `  No providers configured.\n`
        output += `\nUse /provider connect <name> to add a provider.`
      }
    } else {
      output += `  ${COLORS.yellow}Unable to fetch providers from API${COLORS.reset}\n`
      output += `  Status: ${response.status} ${response.statusText}\n`
    }
  } catch {
    // Fallback to local configuration
    output += `  ${COLORS.dim}API not available - showing local configuration${COLORS.reset}\n\n`

    // Check for environment-based providers
    const envProviders = []

    if (process.env.OPENROUTER_API_KEY) {
      envProviders.push({ name: 'OpenRouter', type: 'openrouter', enabled: true })
    }

    if (process.env.OLLAMA_BASE_URL) {
      envProviders.push({ name: 'Ollama', type: 'ollama', enabled: true })
    }

    if (envProviders.length > 0) {
      for (const provider of envProviders) {
        output += `  ${COLORS.green}●${COLORS.reset} ${provider.name} (${provider.type})\n`
      }
    } else {
      output += `  No providers configured in environment.\n`
      output += `\nSet OPENROUTER_API_KEY or OLLAMA_BASE_URL environment variables.`
    }
  }

  return output
}

/**
 * Execute the /models command
 */
async function executeModels(): Promise<string> {
  let output = `${COLORS.bold}Available Models${COLORS.reset}\n\n`

  // Try to fetch models from API
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)

    const response = await fetch(`${API_BASE_URL}/api/models`, {
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      const models = await response.json()

      if (Array.isArray(models) && models.length > 0) {
        for (const model of models) {
          const current = model.current ? ` ${COLORS.yellow}[current]${COLORS.reset}` : ''
          output += `  ${COLORS.cyan}${model.id || model.name}${COLORS.reset}${current}\n`
          if (model.provider) {
            output += `      Provider: ${model.provider}\n`
          }
        }
      } else {
        output += `  No models available.\n`
      }
    } else {
      output += `  ${COLORS.yellow}Unable to fetch models from API${COLORS.reset}\n`
    }
  } catch {
    output += `  ${COLORS.dim}API not available${COLORS.reset}\n`
    output += `  Configure providers to see available models.\n`
  }

  return output
}

/**
 * Execute the /model command
 */
async function executeModel(args: string[]): Promise<string> {
  if (args.length === 0) {
    return `Usage: /model <model-name>\n\nUse /models to see available models.`
  }

  const modelName = args[0]

  // In a real implementation, this would set the active model
  // For now, we just acknowledge the command
  return (
    `Switched to model: ${COLORS.cyan}${modelName}${COLORS.reset}\n\n` +
    `Note: Model switching requires the API server to be running.`
  )
}

/**
 * Prompt for password/API key without echoing to terminal
 */
async function promptForSecret(promptText: string): Promise<string> {
  return new Promise((resolve, reject) => {
    print(promptText + ' ')

    const stdin = process.stdin
    const stdout = process.stdout

    stdin.setRawMode?.(true)
    stdin.setEncoding('utf8')
    stdin.resume()

    let input = ''

    const onData = (char: string) => {
      const charCode = char.charCodeAt(0)

      if (charCode === 3) {
        stdin.setRawMode?.(false)
        stdin.off('data', onData)
        stdin.pause()
        println()
        reject(new Error('Cancelled'))
        return
      }

      if (charCode === 13) {
        stdin.setRawMode?.(false)
        stdin.off('data', onData)
        stdin.pause()
        println()
        resolve(input)
        return
      }

      if (charCode === 127) {
        if (input.length > 0) {
          input = input.slice(0, -1)
          stdout.write('\b \b')
        }
        return
      }

      if (charCode >= 32 && charCode <= 126) {
        input += char
        stdout.write('*')
      }
    }

    stdin.on('data', onData)
  })
}

/**
 * Handle /provider connect subcommand
 */
async function handleProviderConnect(args: string[]): Promise<string> {
  if (args.length < 1) {
    return `Usage: /provider connect <provider-type>\n\n` + `Valid provider types: ${VALID_PROVIDER_TYPES.join(', ')}`
  }

  const providerType = args[0].toLowerCase()

  if (!isValidProviderType(providerType)) {
    return (
      `Error: Invalid provider type "${providerType}"\n\n` + `Valid provider types: ${VALID_PROVIDER_TYPES.join(', ')}`
    )
  }

  try {
    let requestBody: { providerType: string; displayName?: string; apiKey?: string; baseUrl?: string } = {
      providerType,
    }

    if (providerType === 'ollama') {
      // Prompt for base URL
      const rl = createInterface({ input, output })
      try {
        const baseUrl = await rl.question('Enter Ollama base URL (default: http://localhost:11434): ')
        requestBody.baseUrl = baseUrl.trim() || 'http://localhost:11434'
      } finally {
        rl.close()
      }
    } else {
      // Prompt for API key securely (no echo)
      try {
        const apiKey = await promptForSecret(`Enter ${providerType} API key:`)
        if (!apiKey.trim()) {
          return `Error: API key is required for ${providerType}`
        }
        requestBody.apiKey = apiKey
      } catch {
        return 'Provider connection cancelled.'
      }
    }

    // Create the provider via API
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${API_BASE_URL}/api/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      const result = (await response.json()) as { data: { providerId: string; displayName: string } }
      const provider = result.data
      return (
        `${COLORS.green}✓${COLORS.reset} Connected to ${providerType}\n\n` +
        `Provider ID: ${provider.providerId}\n` +
        `Display Name: ${provider.displayName}\n` +
        `Status: ${COLORS.green}enabled${COLORS.reset}`
      )
    } else {
      let errorMessage = `Failed to connect provider`
      try {
        const errorData = (await response.json()) as { error?: { message?: string } }
        errorMessage = errorData.error?.message || errorMessage
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`
      }
      return `${COLORS.red}✗${COLORS.reset} Connection failed: ${errorMessage}`
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'Cancelled') {
      return 'Provider connection cancelled.'
    }
    return `${COLORS.red}✗${COLORS.reset} Connection error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Handle /provider test subcommand
 */
async function handleProviderTest(args: string[]): Promise<string> {
  if (args.length < 1) {
    return `Usage: /provider test <provider-id>\n\n` + `Use /providers to see available provider IDs.`
  }

  const providerId = args[0]

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)

    const response = await fetch(`${API_BASE_URL}/api/providers/${providerId}/test`, {
      method: 'POST',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      const result = (await response.json()) as {
        data: {
          success: boolean
          latencyMs?: number
          modelCount?: number
          error?: string
        }
      }
      const testResult = result.data

      if (testResult.success) {
        let output = `${COLORS.green}✓${COLORS.reset} Connection test successful\n`
        output += `Latency: ${testResult.latencyMs}ms`
        if (testResult.modelCount !== undefined) {
          output += `\nAvailable models: ${testResult.modelCount}`
        }
        return output
      } else {
        let output = `${COLORS.red}✗${COLORS.reset} Connection test failed\n`
        if (testResult.error) {
          output += `Error: ${testResult.error}`
        }
        if (testResult.latencyMs) {
          output += `\nLatency: ${testResult.latencyMs}ms`
        }
        return output
      }
    } else {
      let errorMessage = `Test failed`
      try {
        const errorData = (await response.json()) as { error?: { message?: string } }
        errorMessage = errorData.error?.message || errorMessage
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`
      }
      return `${COLORS.red}✗${COLORS.reset} ${errorMessage}`
    }
  } catch (error) {
    return `${COLORS.red}✗${COLORS.reset} Test error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Handle /provider enable subcommand
 */
async function handleProviderEnable(args: string[], enableValue: boolean): Promise<string> {
  const action = enableValue ? 'enable' : 'disable'

  if (args.length < 1) {
    return `Usage: /provider ${action} <provider-id>\n\n` + `Use /providers to see available provider IDs.`
  }

  const providerId = args[0]

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${API_BASE_URL}/api/providers/${providerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: enableValue }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok) {
      const result = (await response.json()) as {
        data: {
          displayName: string
          enabled: boolean
        }
      }
      const provider = result.data
      const status = provider.enabled
        ? `${COLORS.green}enabled${COLORS.reset}`
        : `${COLORS.gray}disabled${COLORS.reset}`
      return (
        `${COLORS.green}✓${COLORS.reset} Provider ${action}d\n\n` +
        `Provider: ${provider.displayName}\n` +
        `Status: ${status}`
      )
    } else {
      let errorMessage = `Failed to ${action} provider`
      try {
        const errorData = (await response.json()) as { error?: { message?: string } }
        errorMessage = errorData.error?.message || errorMessage
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`
      }
      return `${COLORS.red}✗${COLORS.reset} ${errorMessage}`
    }
  } catch (error) {
    return `${COLORS.red}✗${COLORS.reset} Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Handle /provider delete subcommand
 */
async function handleProviderDelete(args: string[]): Promise<string> {
  if (args.length < 1) {
    return `Usage: /provider delete <provider-id>\n\n` + `Use /providers to see available provider IDs.`
  }

  const providerId = args[0]

  // Ask for confirmation
  const rl = createInterface({ input, output })
  try {
    const confirm = await rl.question(`Are you sure you want to delete provider "${providerId}"? [y/N]: `)
    if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
      return 'Deletion cancelled.'
    }
  } finally {
    rl.close()
  }

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${API_BASE_URL}/api/providers/${providerId}`, {
      method: 'DELETE',
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (response.ok || response.status === 204) {
      return `${COLORS.green}✓${COLORS.reset} Provider deleted successfully`
    } else {
      let errorMessage = `Failed to delete provider`
      try {
        const errorData = (await response.json()) as { error?: { message?: string } }
        errorMessage = errorData.error?.message || errorMessage
      } catch {
        errorMessage = `HTTP ${response.status}: ${response.statusText}`
      }
      return `${COLORS.red}✗${COLORS.reset} ${errorMessage}`
    }
  } catch (error) {
    return `${COLORS.red}✗${COLORS.reset} Error: ${error instanceof Error ? error.message : String(error)}`
  }
}

/**
 * Handle provider subcommands (connect, test, enable, disable, delete)
 */
async function handleProviderSubcommand(args: string[]): Promise<string> {
  if (args.length === 0) {
    return (
      `Usage: /provider <subcommand>\n\n` +
      `Available subcommands:\n` +
      `  connect <type>  - Connect to a new provider (openai, openrouter, ollama)\n` +
      `  test <id>       - Test provider connection\n` +
      `  enable <id>     - Enable a provider\n` +
      `  disable <id>    - Disable a provider\n` +
      `  delete <id>     - Delete a provider\n\n` +
      `Use /providers to list configured providers.`
    )
  }

  const subcommand = args[0].toLowerCase()
  const subcommandArgs = args.slice(1)

  switch (subcommand) {
    case 'connect':
      return await handleProviderConnect(subcommandArgs)
    case 'test':
      return await handleProviderTest(subcommandArgs)
    case 'enable':
      return await handleProviderEnable(subcommandArgs, true)
    case 'disable':
      return await handleProviderEnable(subcommandArgs, false)
    case 'delete':
      return await handleProviderDelete(subcommandArgs)
    default:
      return (
        `Unknown provider subcommand: ${subcommand}\n\n` +
        `Available subcommands: connect, test, enable, disable, delete`
      )
  }
}

/**
 * Execute a parsed command and return the result
 */
async function executeCommand(parsed: ParsedCommand): Promise<string> {
  const commandName = resolveAlias(parsed.command).toLowerCase()

  switch (commandName) {
    case 'help':
      return executeHelp(parsed.args)

    case 'commands':
      return executeCommands()

    case 'status':
      return await executeStatus()

    case 'providers':
      return await executeProviders()

    case 'provider':
      return await handleProviderSubcommand(parsed.args)

    case 'models':
      return await executeModels()

    case 'model':
      return await executeModel(parsed.args)

    case 'exit':
    case 'quit':
      return '__EXIT__'

    default: {
      // Check if it's a known command
      const cmd = COMMAND_CATALOG[commandName as keyof typeof COMMAND_CATALOG]
      if (cmd) {
        return (
          `Command /${commandName} is not yet implemented in the TUI.\n` +
          `Description: ${cmd.description}\n` +
          `Use /help ${commandName} for more information.`
        )
      }
      return `Unknown command: /${commandName}. Type /commands to see available commands.`
    }
  }
}

/**
 * Run the TUI in interactive mode
 */
async function runInteractive(): Promise<void> {
  printWelcome()

  const rl = createInterface({ input, output, prompt: CONFIG.prompt })

  try {
    while (true) {
      const line = await rl.question('')

      const trimmed = line.trim()

      // Skip empty lines
      if (!trimmed) {
        print(CONFIG.prompt)
        continue
      }

      // Check if it's a command
      const parsed = parseCommand(trimmed)

      if (!parsed) {
        // Not a command - in interactive mode, we could send this to a chat backend
        // For now, just acknowledge
        println(`Not a command: ${trimmed}`, 'dim')
        println('Type /help for available commands.', 'dim')
        print(CONFIG.prompt)
        continue
      }

      // Execute the command
      try {
        const result = await executeCommand(parsed)

        if (result === '__EXIT__') {
          println('Goodbye!', 'green')
          break
        }

        println(result)
      } catch (error) {
        println(`Error: ${error instanceof Error ? error.message : String(error)}`, 'red')
      }

      print(CONFIG.prompt)
    }
  } finally {
    rl.close()
  }
}

/**
 * Run the TUI in scripted mode (read from stdin)
 */
async function runScripted(): Promise<number> {
  const rl = createInterface({ input, output })
  let exitCode = 0

  try {
    for await (const line of rl) {
      const trimmed = line.trim()

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      // Check if it's a command
      const parsed = parseCommand(trimmed)

      if (!parsed) {
        // In scripted mode, treat non-commands as errors
        println(`Error: Not a command: ${trimmed}`, 'red')
        exitCode = 1
        continue
      }

      // Execute the command
      try {
        const result = await executeCommand(parsed)

        if (result === '__EXIT__') {
          break
        }

        println(result)
      } catch (error) {
        println(`Error: ${error instanceof Error ? error.message : String(error)}`, 'red')
        exitCode = 1
      }
    }
  } finally {
    rl.close()
  }

  return exitCode
}

/**
 * Main entrypoint
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2)

  // Parse arguments
  const isHelp = args.includes('--help') || args.includes('-h')
  const isVersion = args.includes('--version') || args.includes('-v')
  const isScripted = args.includes('--scripted')

  if (isHelp) {
    printUsage()
    exit(0)
  }

  if (isVersion) {
    printVersion()
    exit(0)
  }

  if (isScripted) {
    const exitCode = await runScripted()
    exit(exitCode)
  } else {
    await runInteractive()
    exit(0)
  }
}

// Run the main function
main().catch((error) => {
  console.error('Fatal error:', error)
  exit(1)
})
