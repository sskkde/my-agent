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
import { listProviderCatalogEntries } from '../llm/catalog/provider-catalog.js'
import { DOMESTIC_PROVIDERS } from '../llm/catalog/domestic-providers.js'
import type { ProviderType } from '../storage/provider-config-store.js'

/** Derived from catalog entries, excluding 'custom' which is not a direct-connect CLI target */
const VALID_PROVIDER_TYPES: readonly ProviderType[] = listProviderCatalogEntries()
  .filter((entry) => entry.providerType !== 'custom')
  .map((entry) => entry.providerType)

export function getValidProviderTypesForCli(): readonly ProviderType[] {
  return VALID_PROVIDER_TYPES
}

export function isValidProviderType(type: string): type is ProviderType {
  return (VALID_PROVIDER_TYPES as readonly string[]).includes(type)
}

export interface EnvProviderEntry {
  readonly name: string
  readonly providerType: string
}

export function collectEnvProvidersForDisplay(): EnvProviderEntry[] {
  const result: EnvProviderEntry[] = []

  if (process.env.OPENROUTER_API_KEY) {
    result.push({ name: 'OpenRouter', providerType: 'openrouter' })
  }

  if (process.env.OLLAMA_BASE_URL) {
    result.push({ name: 'Ollama', providerType: 'ollama' })
  }

  for (const domestic of DOMESTIC_PROVIDERS) {
    if (process.env[domestic.envApiKey]) {
      result.push({ name: domestic.displayName, providerType: domestic.providerType })
    }
  }

  return result
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
  version: '0.2.0',
}

const API_BASE_URL = process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? '3003'}`
const API_PATH_PREFIX = '/api/v1'
const SESSION_COOKIE_NAME = 'agent-platform-session'
const DEFAULT_API_TIMEOUT_MS = 10000

// =============================================================================
// CLI State
// =============================================================================

export interface CliUser {
  readonly userId: string
  readonly username: string
  readonly role: string
  readonly createdAt?: string
}

export interface CliState {
  cookieHeader: string | null
  currentUser: CliUser | null
  currentSessionId: string | null
  apiAuthToken: string | null
}

export interface CommandRuntime {
  readonly allowPrompt: boolean
}

export function createInitialCliState(): CliState {
  return {
    cookieHeader: null,
    currentUser: null,
    currentSessionId: null,
    apiAuthToken: process.env.API_AUTH_TOKEN ?? null,
  }
}

function hasAuth(state: CliState): boolean {
  return state.currentUser !== null || state.cookieHeader !== null || state.apiAuthToken !== null
}

// =============================================================================
// API Helpers
// =============================================================================

function buildApiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${API_PATH_PREFIX}${normalized}`
}

interface ApiEnvelopeSuccess<T> {
  readonly ok: true
  readonly data: T
  readonly requestId?: string
}

interface ApiEnvelopeError {
  readonly ok: false
  readonly error: { readonly code: string; readonly message: string; readonly details?: unknown }
  readonly requestId?: string
}

class CliApiError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CliApiError'
    this.code = code
  }
}

function extractSessionCookie(response: Response): string | null {
  const setCookie =
    response.headers.getSetCookie?.() ??
    (response.headers.get('set-cookie') ? [response.headers.get('set-cookie') as string] : [])
  for (const cookie of setCookie) {
    const match = cookie.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))
    if (match) {
      // Check for Max-Age=0 which means delete
      if (/max-age=0/i.test(cookie)) {
        return null
      }
      return `${SESSION_COOKIE_NAME}=${match[1]}`
    }
  }
  return null
}

async function parseApiResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return {} as T
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = (body as ApiEnvelopeError)?.error
    const message = err?.message ?? `HTTP ${response.status}: ${response.statusText}`
    const code = err?.code ?? 'UNKNOWN'
    throw new CliApiError(code, message)
  }
  const envelope = body as ApiEnvelopeSuccess<T> | T
  if (envelope && typeof envelope === 'object' && 'ok' in envelope && envelope.ok === true) {
    return (envelope as ApiEnvelopeSuccess<T>).data
  }
  // Legacy envelope: { data: ... } without ok field
  if (envelope && typeof envelope === 'object' && 'data' in envelope && !('ok' in envelope)) {
    return (envelope as { data: T }).data
  }
  return envelope as T
}

async function apiFetch<T>(
  state: CliState,
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_API_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  }
  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (state.cookieHeader) {
    headers['Cookie'] = state.cookieHeader
  }
  if (state.apiAuthToken) {
    headers['Authorization'] = `Bearer ${state.apiAuthToken}`
  }

  try {
    const response = await fetch(buildApiUrl(path), {
      ...init,
      headers,
      credentials: 'include',
      signal: controller.signal,
    })

    // Capture session cookie from login responses
    const newCookie = extractSessionCookie(response)
    if (newCookie !== null) {
      state.cookieHeader = newCookie
    }

    return await parseApiResponse<T>(response)
  } catch (error) {
    if (error instanceof CliApiError) {
      throw error
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new CliApiError('TIMEOUT', `Request timed out after ${timeoutMs}ms`)
    }
    throw new CliApiError('NETWORK_ERROR', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timeout)
  }
}

function formatApiError(error: unknown): string {
  if (error instanceof CliApiError) {
    return `${COLORS.red}✗${COLORS.reset} [${error.code}] ${error.message}`
  }
  return `${COLORS.red}✗${COLORS.reset} ${error instanceof Error ? error.message : String(error)}`
}

// =============================================================================
// Output Helpers
// =============================================================================

function print(text: string, color?: keyof typeof COLORS): void {
  if (color && COLORS[color]) {
    output.write(COLORS[color] + text + COLORS.reset)
  } else {
    output.write(text)
  }
}

function println(text: string = '', color?: keyof typeof COLORS): void {
  print(text + '\n', color)
}

// =============================================================================
// Usage / Welcome
// =============================================================================

function printUsage(): void {
  println(CONFIG.appName + ' v' + CONFIG.version, 'bold')
  println()
  println('Usage:')
  println('  npm run cli -- [options]')
  println('  npx tsx src/cli/tui.ts [options]')
  println()
  println('Options:')
  println('  --help, -h        Show this help message')
  println('  --scripted        Read commands from stdin (non-interactive)')
  println('  --version, -v     Show version information')
  println()
  println('Commands:')
  println('  /login [user] [pass]  Log in to the platform')
  println('  /logout              Log out and clear session')
  println('  /status              Show current status')
  println('  /new                 Create a new session')
  println('  /sessions            List sessions')
  println('  /session switch <id> Switch to a session')
  println('  /tools               List available tools')
  println('  /providers           List configured LLM providers')
  println('  /provider            Manage providers (connect, test, enable, disable, delete)')
  println('  /models              List available models')
  println('  /model <name>        Switch to a specific model')
  println('  /help [command]      Show help for commands')
  println('  /commands            List all available commands')
  println('  /exit, /quit         Exit the application')
  println()
  println('In scripted mode, commands are read from stdin line by line.')
  println('Non-command input sends a chat message to the current session.')
  println('Use "/exit" or "/quit" to terminate the session.')
}

function printVersion(): void {
  println(CONFIG.appName + ' v' + CONFIG.version)
}

function printWelcome(): void {
  println()
  println('╔════════════════════════════════════════╗', 'cyan')
  println(`║     ${CONFIG.appName}      ║`, 'cyan')
  println(`║           v${CONFIG.version}                   ║`, 'dim')
  println('╚════════════════════════════════════════╝', 'cyan')
  println()
  println('Type /help for available commands or /exit to quit.', 'dim')
  println('Use /login to authenticate, then /new to start a session.', 'dim')
  println()
}

// =============================================================================
// Command: /help and /commands
// =============================================================================

function executeHelp(args: string[]): string {
  if (args.length === 0) {
    let out = 'Available Commands:\n\n'

    const categories: Record<string, CommandDefinition[]> = {}
    const commands = getAllCommands()

    for (const cmd of commands) {
      if (!categories[cmd.category]) {
        categories[cmd.category] = []
      }
      categories[cmd.category].push(cmd)
    }

    for (const [category, cmds] of Object.entries(categories)) {
      out += COLORS.bold + category.toUpperCase() + COLORS.reset + '\n'
      for (const cmd of cmds) {
        const aliases = cmd.aliases && cmd.aliases.length > 0 ? ' (' + cmd.aliases.join(', ') + ')' : ''
        out += `  ${COLORS.cyan}/${cmd.name}${COLORS.reset}${aliases}\n`
        out += `    ${cmd.description}\n`
      }
      out += '\n'
    }

    out += 'Type /help <command> for detailed information about a specific command.'
    return out
  }

  const commandName = resolveAlias(args[0]).toLowerCase()
  const cmd = COMMAND_CATALOG[commandName as keyof typeof COMMAND_CATALOG]

  if (!cmd) {
    return `Unknown command: ${args[0]}. Type /commands to see available commands.`
  }

  let out = `${COLORS.bold}${COLORS.cyan}/${cmd.name}${COLORS.reset}\n\n`
  out += `Description: ${cmd.description}\n`
  out += `Category: ${cmd.category}\n`
  out += `Usage: ${cmd.usage || '/' + cmd.name}\n`

  if (cmd.aliases && cmd.aliases.length > 0) {
    out += `Aliases: ${cmd.aliases.join(', ')}\n`
  }

  if (cmd.subcommands) {
    out += '\nSubcommands:\n'
    for (const [name, sub] of Object.entries(cmd.subcommands)) {
      out += `  ${name} - ${sub.description}\n`
    }
  }

  return out
}

function executeCommands(): string {
  const commands = getAllCommands()
  let out = 'Available Commands:\n\n'
  for (const cmd of commands) {
    const aliases = cmd.aliases && cmd.aliases.length > 0 ? ` (${cmd.aliases.join(', ')})` : ''
    out += `  ${COLORS.cyan}/${cmd.name}${COLORS.reset}${aliases}\n`
  }
  out += `\nTotal: ${commands.length} commands`
  return out
}

// =============================================================================
// Command: /status
// =============================================================================

async function executeStatus(state: CliState): Promise<string> {
  const timestamp = new Date().toISOString()

  let out = `${COLORS.bold}Status${COLORS.reset}\n\n`
  out += `Timestamp: ${timestamp}\n`
  out += `Mode: Local CLI\n`

  if (state.currentUser) {
    out += `User: ${COLORS.green}${state.currentUser.username}${COLORS.reset} (${state.currentUser.role})\n`
  } else if (state.apiAuthToken) {
    out += `Auth: ${COLORS.yellow}API token${COLORS.reset}\n`
  } else {
    out += `Auth: ${COLORS.dim}not logged in${COLORS.reset}\n`
  }

  if (state.currentSessionId) {
    out += `Current Session: ${COLORS.cyan}${state.currentSessionId}${COLORS.reset}\n`
  } else {
    out += `Current Session: ${COLORS.dim}none${COLORS.reset}\n`
  }

  try {
    const data = await apiFetch<{ status?: string }>(state, '/health', undefined, 2000)
    const status = data.status ?? 'unknown'
    const colored = status === 'healthy' ? COLORS.green : COLORS.yellow
    out += `API Server: ${colored}${status}${COLORS.reset} (${API_BASE_URL})\n`
  } catch {
    out += `API Server: ${COLORS.dim}Offline${COLORS.reset} (${API_BASE_URL} not reachable)\n`
  }

  return out
}

// =============================================================================
// Command: /login and /logout
// =============================================================================

async function executeLogin(
  args: string[],
  state: CliState,
  runtime: CommandRuntime,
): Promise<string> {
  let username: string
  let password: string

  if (args.length >= 2) {
    username = args[0]
    password = args[1]
  } else if (runtime.allowPrompt) {
    const rl = createInterface({ input, output })
    try {
      username = (await rl.question('Username: ')).trim()
      if (!username) {
        rl.close()
        return 'Login cancelled: username is required.'
      }
      password = await promptForSecret('Password:')
      if (!password) {
        rl.close()
        return 'Login cancelled: password is required.'
      }
    } finally {
      rl.close()
    }
  } else {
    return 'Usage: /login <username> <password>\n\nIn scripted mode, both username and password must be provided as arguments.'
  }

  try {
    const data = await apiFetch<{ user: CliUser }>(state, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    })

    state.currentUser = data.user
    state.currentSessionId = null

    return (
      `${COLORS.green}✓${COLORS.reset} Logged in as ${data.user.username} (${data.user.role})\n\n` +
      `Use /new to create a session or /sessions to list existing sessions.`
    )
  } catch (error) {
    return formatApiError(error)
  }
}

async function executeLogout(state: CliState): Promise<string> {
  try {
    await apiFetch(state, '/auth/logout', { method: 'POST' })
  } catch {
    // Best-effort logout; clear local state regardless
  }

  state.cookieHeader = null
  state.currentUser = null
  state.currentSessionId = null

  return `${COLORS.green}✓${COLORS.reset} Logged out.`
}

// =============================================================================
// Command: /new, /sessions, /session
// =============================================================================

async function executeNewSession(state: CliState): Promise<string> {
  if (!hasAuth(state)) {
    return `${COLORS.yellow}Not authenticated.${COLORS.reset} Use /login first or configure API_AUTH_TOKEN.`
  }

  try {
    const body = state.currentUser ? JSON.stringify({ userId: state.currentUser.userId }) : '{}'
    const data = await apiFetch<{ session: { sessionId: string; messageCount: number } }>(state, '/sessions', {
      method: 'POST',
      body,
    })

    state.currentSessionId = data.session.sessionId

    return (
      `${COLORS.green}✓${COLORS.reset} New session created\n` +
      `Session ID: ${COLORS.cyan}${data.session.sessionId}${COLORS.reset}\n` +
      `Now you can send messages. Type /help for more commands.`
    )
  } catch (error) {
    return formatApiError(error)
  }
}

interface SessionListItem {
  sessionId: string
  title?: string
  status?: string
  messageCount?: number
  lastActivityAt?: string
}

async function executeSessions(state: CliState): Promise<string> {
  if (!hasAuth(state)) {
    return `${COLORS.yellow}Not authenticated.${COLORS.reset} Use /login first or configure API_AUTH_TOKEN.`
  }

  try {
    const data = await apiFetch<{ items: SessionListItem[]; total: number }>(state, '/sessions?limit=50')

    if (!data.items || data.items.length === 0) {
      return `No sessions found. Use /new to create a session.`
    }

    let out = `${COLORS.bold}Sessions${COLORS.reset} (${data.total} total)\n\n`
    for (const s of data.items) {
      const marker = s.sessionId === state.currentSessionId ? `${COLORS.green}*${COLORS.reset}` : ' '
      const title = s.title || 'Untitled'
      const status = s.status === 'active' ? `${COLORS.green}active${COLORS.reset}` : s.status ?? 'unknown'
      out += `${marker} ${COLORS.cyan}${s.sessionId}${COLORS.reset}  ${title}  [${status}]  ${s.messageCount ?? 0} msgs\n`
    }
    out += `\n* = current session. Use /session switch <id> to change.`
    return out
  } catch (error) {
    return formatApiError(error)
  }
}

async function handleSessionSubcommand(args: string[], state: CliState): Promise<string> {
  if (args.length === 0) {
    return (
      `Usage: /session <subcommand>\n\n` +
      `Available subcommands:\n` +
      `  list             - List all sessions\n` +
      `  switch <id>      - Switch to a session\n\n` +
      `Other subcommands (rename, clear, archive, delete) are not yet implemented.`
    )
  }

  const sub = args[0].toLowerCase()
  const subArgs = args.slice(1)

  switch (sub) {
    case 'list':
      return await executeSessions(state)

    case 'switch': {
      if (subArgs.length < 1) {
        return `Usage: /session switch <session-id>\n\nUse /sessions to see available session IDs.`
      }
      const sessionId = subArgs[0]
      if (!hasAuth(state)) {
        return `${COLORS.yellow}Not authenticated.${COLORS.reset} Use /login first.`
      }
      try {
        await apiFetch(state, `/sessions/${sessionId}`)
        state.currentSessionId = sessionId
        return `${COLORS.green}✓${COLORS.reset} Switched to session: ${COLORS.cyan}${sessionId}${COLORS.reset}`
      } catch (error) {
        return formatApiError(error)
      }
    }

    default:
      return `Subcommand /session ${sub} is not yet implemented in this pass.`
  }
}

// =============================================================================
// Command: /tools
// =============================================================================

async function executeTools(state: CliState): Promise<string> {
  try {
    const data = await apiFetch<{
      tools?: Array<{ id?: string; name?: string; category?: string; description?: string }>
      total?: number
    }>(state, '/tools')

    const tools = data.tools ?? []
    if (tools.length === 0) {
      return `No tools available.`
    }

    let out = `${COLORS.bold}Available Tools${COLORS.reset} (${data.total ?? tools.length})\n\n`
    for (const t of tools) {
      const id = t.id ?? t.name ?? 'unknown'
      out += `  ${COLORS.cyan}${id}${COLORS.reset}`
      if (t.category) {
        out += `  [${t.category}]`
      }
      if (t.description) {
        out += `\n    ${COLORS.dim}${t.description}${COLORS.reset}`
      }
      out += '\n'
    }
    return out
  } catch (error) {
    return formatApiError(error)
  }
}

// =============================================================================
// Command: /providers, /provider, /models, /model
// =============================================================================

async function executeProviders(state: CliState): Promise<string> {
  let out = `${COLORS.bold}Configured LLM Providers${COLORS.reset}\n\n`

  try {
    const providers = await apiFetch<
      Array<{ id?: string; name?: string; displayName?: string; enabled?: boolean; description?: string }>
    >(state, '/providers')

    const list = Array.isArray(providers) ? providers : []
    if (list.length > 0) {
      for (const provider of list) {
        const status =
          provider.enabled !== false ? `${COLORS.green}●${COLORS.reset}` : `${COLORS.gray}○${COLORS.reset}`
        out += `  ${status} ${provider.displayName || provider.name || provider.id}\n`
        if (provider.description) {
          out += `      ${COLORS.dim}${provider.description}${COLORS.reset}\n`
        }
      }
    } else {
      out += `  No providers configured.\n`
      out += `\nUse /provider connect <name> to add a provider.`
    }
  } catch (error) {
    if (error instanceof CliApiError && (error.code === 'UNAUTHORIZED' || error.code === 'FORBIDDEN')) {
      out += `  ${COLORS.yellow}Not authenticated.${COLORS.reset} Use /login first.\n`
    } else {
      out += `  ${COLORS.dim}API not available - showing local configuration${COLORS.reset}\n\n`
      const envProviders = collectEnvProvidersForDisplay()
      if (envProviders.length > 0) {
        for (const provider of envProviders) {
          out += `  ${COLORS.green}●${COLORS.reset} ${provider.name} (${provider.providerType})\n`
        }
      } else {
        out += `  No providers configured in environment.\n`
        out += `\nSet an API key environment variable (e.g. OPENROUTER_API_KEY, OLLAMA_BASE_URL).`
      }
    }
  }

  return out
}

async function executeModels(state: CliState): Promise<string> {
  let out = `${COLORS.bold}Available Models${COLORS.reset}\n\n`

  try {
    const data = await apiFetch<{
      providers?: Array<{ providerId?: string; displayName?: string; models?: Array<{ id?: string; name?: string }> }>
      selectedModel?: string
      selectedProviderId?: string
    }>(state, '/agents/foreground.default/config')

    const providers = data.providers ?? []
    if (providers.length > 0) {
      for (const p of providers) {
        out += `${COLORS.bold}${p.displayName || p.providerId}${COLORS.reset}\n`
        const models = p.models ?? []
        for (const m of models) {
          const isCurrent = m.id === data.selectedModel || m.name === data.selectedModel
          const marker = isCurrent ? ` ${COLORS.yellow}[current]${COLORS.reset}` : ''
          out += `  ${COLORS.cyan}${m.id || m.name}${COLORS.reset}${marker}\n`
        }
        out += '\n'
      }
    } else {
      out += `  No models available. Configure a provider first.`
    }
  } catch {
    out += `  ${COLORS.dim}API not available${COLORS.reset}\n`
    out += `  Configure providers to see available models.\n`
  }

  return out
}

async function executeModel(args: string[], state: CliState): Promise<string> {
  if (args.length === 0) {
    return `Usage: /model <model-name>\n\nUse /models to see available models.`
  }

  const modelName = args[0]

  try {
    await apiFetch(state, '/agents/foreground.default/config/global', {
      method: 'PATCH',
      body: JSON.stringify({ model: modelName }),
    })
    return `${COLORS.green}✓${COLORS.reset} Switched to model: ${COLORS.cyan}${modelName}${COLORS.reset}`
  } catch (error) {
    return formatApiError(error)
  }
}

// =============================================================================
// Provider subcommands
// =============================================================================

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

async function handleProviderConnect(
  args: string[],
  state: CliState,
  runtime: CommandRuntime,
): Promise<string> {
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
      if (runtime.allowPrompt) {
        const rl = createInterface({ input, output })
        try {
          const baseUrl = await rl.question('Enter Ollama base URL (default: http://localhost:11434): ')
          requestBody.baseUrl = baseUrl.trim() || 'http://localhost:11434'
        } finally {
          rl.close()
        }
      } else {
        requestBody.baseUrl = 'http://localhost:11434'
      }
    } else {
      if (runtime.allowPrompt) {
        try {
          const apiKey = await promptForSecret(`Enter ${providerType} API key:`)
          if (!apiKey.trim()) {
            return `Error: API key is required for ${providerType}`
          }
          requestBody.apiKey = apiKey
        } catch {
          return 'Provider connection cancelled.'
        }
      } else {
        return `Error: API key is required for ${providerType}. Use interactive mode or set the env var.`
      }
    }

    const data = await apiFetch<{ providerId: string; displayName: string }>(state, '/providers', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })

    return (
      `${COLORS.green}✓${COLORS.reset} Connected to ${providerType}\n\n` +
      `Provider ID: ${data.providerId}\n` +
      `Display Name: ${data.displayName}\n` +
      `Status: ${COLORS.green}enabled${COLORS.reset}`
    )
  } catch (error) {
    if (error instanceof Error && error.message === 'Cancelled') {
      return 'Provider connection cancelled.'
    }
    return formatApiError(error)
  }
}

async function handleProviderTest(args: string[], state: CliState): Promise<string> {
  if (args.length < 1) {
    return `Usage: /provider test <provider-id>\n\n` + `Use /providers to see available provider IDs.`
  }

  const providerId = args[0]

  try {
    const data = await apiFetch<{ success: boolean; latencyMs?: number; modelCount?: number; error?: string }>(
      state,
      `/providers/${providerId}/test`,
      { method: 'POST' },
      15000,
    )

    if (data.success) {
      let out = `${COLORS.green}✓${COLORS.reset} Connection test successful\n`
      out += `Latency: ${data.latencyMs}ms`
      if (data.modelCount !== undefined) {
        out += `\nAvailable models: ${data.modelCount}`
      }
      return out
    }

    let out = `${COLORS.red}✗${COLORS.reset} Connection test failed\n`
    if (data.error) {
      out += `Error: ${data.error}`
    }
    return out
  } catch (error) {
    return formatApiError(error)
  }
}

async function handleProviderEnable(args: string[], enableValue: boolean, state: CliState): Promise<string> {
  const action = enableValue ? 'enable' : 'disable'

  if (args.length < 1) {
    return `Usage: /provider ${action} <provider-id>\n\n` + `Use /providers to see available provider IDs.`
  }

  const providerId = args[0]

  try {
    const data = await apiFetch<{ displayName: string; enabled: boolean }>(state, `/providers/${providerId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: enableValue }),
    })

    const status = data.enabled ? `${COLORS.green}enabled${COLORS.reset}` : `${COLORS.gray}disabled${COLORS.reset}`
    return (
      `${COLORS.green}✓${COLORS.reset} Provider ${action}d\n\n` + `Provider: ${data.displayName}\n` + `Status: ${status}`
    )
  } catch (error) {
    return formatApiError(error)
  }
}

async function handleProviderDelete(args: string[], state: CliState, runtime: CommandRuntime): Promise<string> {
  if (args.length < 1) {
    return `Usage: /provider delete <provider-id>\n\n` + `Use /providers to see available provider IDs.`
  }

  const providerId = args[0]

  if (runtime.allowPrompt) {
    const rl = createInterface({ input, output })
    try {
      const confirm = await rl.question(`Are you sure you want to delete provider "${providerId}"? [y/N]: `)
      if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        return 'Deletion cancelled.'
      }
    } finally {
      rl.close()
    }
  }

  try {
    await apiFetch(state, `/providers/${providerId}`, { method: 'DELETE' })
    return `${COLORS.green}✓${COLORS.reset} Provider deleted successfully`
  } catch (error) {
    return formatApiError(error)
  }
}

async function handleProviderSubcommand(
  args: string[],
  state: CliState,
  runtime: CommandRuntime,
): Promise<string> {
  if (args.length === 0) {
    return (
      `Usage: /provider <subcommand>\n\n` +
      `Available subcommands:\n` +
      `  connect <type>  - Connect to a new provider (${VALID_PROVIDER_TYPES.join(', ')})\n` +
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
      return await handleProviderConnect(subcommandArgs, state, runtime)
    case 'test':
      return await handleProviderTest(subcommandArgs, state)
    case 'enable':
      return await handleProviderEnable(subcommandArgs, true, state)
    case 'disable':
      return await handleProviderEnable(subcommandArgs, false, state)
    case 'delete':
      return await handleProviderDelete(subcommandArgs, state, runtime)
    default:
      return (
        `Unknown provider subcommand: ${subcommand}\n\n` +
        `Available subcommands: connect, test, enable, disable, delete`
      )
  }
}

// =============================================================================
// Chat: send non-command input to current session
// =============================================================================

export interface InputLineResult {
  readonly output: string | null
  readonly shouldExit: boolean
  readonly success: boolean
}

export async function handleChatInput(text: string, state: CliState): Promise<InputLineResult> {
  if (!text.trim()) {
    return { output: null, shouldExit: false, success: true }
  }

  if (!hasAuth(state)) {
    return {
      output: `${COLORS.yellow}Not logged in.${COLORS.reset} Use /login <username> <password> first.`,
      shouldExit: false,
      success: false,
    }
  }

  if (!state.currentSessionId) {
    return {
      output: `${COLORS.yellow}No active session.${COLORS.reset} Use /new or /session switch <session-id> first.`,
      shouldExit: false,
      success: false,
    }
  }

  try {
    const data = await apiFetch<{
      accepted: boolean
      status: string
      correlationId?: string
      envelopeId?: string
    }>(state, `/sessions/${state.currentSessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })

    let out = `${COLORS.green}✓${COLORS.reset} Message sent\n`
    out += `Session: ${state.currentSessionId}\n`
    if (data.correlationId) {
      out += `Correlation ID: ${COLORS.dim}${data.correlationId}${COLORS.reset}\n`
    }
    out += `${COLORS.dim}Note: live assistant output is not displayed in this pass.${COLORS.reset}`
    return { output: out, shouldExit: false, success: true }
  } catch (error) {
    return { output: formatApiError(error), shouldExit: false, success: false }
  }
}

// =============================================================================
// Command dispatch
// =============================================================================

async function executeCommand(
  parsed: ParsedCommand,
  state: CliState,
  runtime: CommandRuntime,
): Promise<string> {
  const commandName = resolveAlias(parsed.command).toLowerCase()

  switch (commandName) {
    case 'help':
      return executeHelp(parsed.args)

    case 'commands':
      return executeCommands()

    case 'status':
      return await executeStatus(state)

    case 'login':
      return await executeLogin(parsed.args, state, runtime)

    case 'logout':
      return await executeLogout(state)

    case 'new':
      return await executeNewSession(state)

    case 'sessions':
      return await executeSessions(state)

    case 'session':
      return await handleSessionSubcommand(parsed.args, state)

    case 'tools':
      return await executeTools(state)

    case 'providers':
      return await executeProviders(state)

    case 'provider':
      return await handleProviderSubcommand(parsed.args, state, runtime)

    case 'models':
      return await executeModels(state)

    case 'model':
      return await executeModel(parsed.args, state)

    case 'exit':
    case 'quit':
      return '__EXIT__'

    default: {
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

export async function executeInputLine(
  line: string,
  state: CliState,
  runtime: CommandRuntime,
): Promise<InputLineResult> {
  const trimmed = line.trim()

  if (!trimmed) {
    return { output: null, shouldExit: false, success: true }
  }

  const parsed = parseCommand(trimmed)

  if (!parsed) {
    return await handleChatInput(trimmed, state)
  }

  if (parsed.isEscaped) {
    return await handleChatInput(parsed.rawInput, state)
  }

  try {
    const result = await executeCommand(parsed, state, runtime)
    if (result === '__EXIT__') {
      return { output: null, shouldExit: true, success: true }
    }
    return { output: result, shouldExit: false, success: true }
  } catch (error) {
    return {
      output: error instanceof Error ? error.message : String(error),
      shouldExit: false,
      success: false,
    }
  }
}

// =============================================================================
// Interactive and Scripted modes
// =============================================================================

async function runInteractive(): Promise<void> {
  printWelcome()

  const state = createInitialCliState()
  const runtime: CommandRuntime = { allowPrompt: true }
  const rl = createInterface({ input, output, prompt: CONFIG.prompt })

  try {
    while (true) {
      const line = await rl.question('')

      const result = await executeInputLine(line, state, runtime)

      if (result.shouldExit) {
        println('Goodbye!', 'green')
        break
      }

      if (result.output) {
        println(result.output)
      }

      print(CONFIG.prompt)
    }
  } finally {
    rl.close()
  }
}

async function runScripted(): Promise<number> {
  const state = createInitialCliState()
  const runtime: CommandRuntime = { allowPrompt: false }
  const rl = createInterface({ input, output })
  let exitCode = 0

  try {
    for await (const line of rl) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith('#')) {
        continue
      }

      const result = await executeInputLine(line, state, runtime)

      if (result.shouldExit) {
        break
      }

      if (result.output) {
        println(result.output)
      }

      if (!result.success) {
        exitCode = 1
      }
    }
  } finally {
    rl.close()
  }

  return exitCode
}

// =============================================================================
// Main entrypoint
// =============================================================================

async function main(): Promise<void> {
  const args = process.argv.slice(2)

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

// ESM-safe entrypoint guard: only run when invoked directly, not on import
const _invokedDirectly =
  process.argv[1] != null &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url === `file://${decodeURIComponent(process.argv[1])}` ||
    import.meta.url === `file://${encodeURI(process.argv[1])}`)

if (_invokedDirectly) {
  main().catch((error) => {
    console.error('Fatal error:', error)
    exit(1)
  })
}