import type { CommandContext, FrontendCommandResult } from '../types.js'

// ============================================================================
// Types
// ============================================================================

interface WorkdirSummary {
  id: string
  userId: string
  name: string
  createdAt: string
  updatedAt: string
}

interface WorkdirTreeEntry {
  name: string
  type: 'file' | 'directory'
  relativePath: string
}

// ============================================================================
// Helpers
// ============================================================================

function createSuccessResult(commandName: string, content: string, data?: unknown): FrontendCommandResult {
  return {
    success: true,
    commandName,
    output: { type: 'text', content },
    data,
  }
}

function createErrorResult(commandName: string, errorMsg: string): FrontendCommandResult {
  return {
    success: false,
    commandName,
    output: { type: 'error', content: errorMsg },
    error: errorMsg,
  }
}

function requireSession(context: CommandContext): string | null {
  if (!context.sessionId) {
    return null
  }
  return context.sessionId
}

// ============================================================================
// Subcommand: list
// ============================================================================

async function handleWorkdirList(_args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  try {
    const response = (await context.api.get('/workdirs')) as {
      workdirs: WorkdirSummary[]
      total: number
    }

    if (!response.workdirs || response.workdirs.length === 0) {
      return createSuccessResult('workdir list', 'No workdirs found.\n\nUse /workdir new <name> to create one.')
    }

    const lines = response.workdirs.map(
      (w) => `  ${w.name}  (id: ${w.id})\n    Created: ${w.createdAt}`,
    )

    return createSuccessResult(
      'workdir list',
      `Workdirs (${response.workdirs.length}):\n\n${lines.join('\n\n')}`,
      { workdirs: response.workdirs, total: response.total },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('workdir list', `Failed to list workdirs: ${message}`)
  }
}

// ============================================================================
// Subcommand: new
// ============================================================================

async function handleWorkdirNew(args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  if (args.length < 1) {
    return createErrorResult('workdir new', 'Usage: /workdir new <name>')
  }

  const name = args.join(' ')

  const sessionId = requireSession(context)
  if (!sessionId) {
    return createErrorResult('workdir new', 'No session selected. Please select a session first.')
  }

  try {
    const response = (await context.api.post('/workdirs', { name })) as {
      workdir: WorkdirSummary
    }

    // Automatically switch to the newly created workdir
    await context.api.put(`/sessions/${sessionId}/workdir`, { workdirId: response.workdir.id })

    // Refresh UI state
    await context.refreshSessions()

    return createSuccessResult(
      'workdir new',
      `Created workdir "${response.workdir.name}" (id: ${response.workdir.id})\n\nSwitched to new workdir.`,
      { workdir: response.workdir },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('workdir new', `Failed to create workdir: ${message}`)
  }
}

// ============================================================================
// Subcommand: switch
// ============================================================================

async function handleWorkdirSwitch(args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  if (args.length < 1) {
    return createErrorResult('workdir switch', 'Usage: /workdir switch <id|name>')
  }

  const sessionId = requireSession(context)
  if (!sessionId) {
    return createErrorResult('workdir switch', 'No session selected. Please select a session first.')
  }

  const identifier = args[0]

  try {
    // First, list all workdirs to resolve name -> id if needed
    const listResponse = (await context.api.get('/workdirs')) as {
      workdirs: WorkdirSummary[]
      total: number
    }

    // Try to find by id first, then by name
    let workdir = listResponse.workdirs.find((w) => w.id === identifier)
    if (!workdir) {
      workdir = listResponse.workdirs.find((w) => w.name === identifier)
    }

    if (!workdir) {
      return createErrorResult(
        'workdir switch',
        `Workdir not found: "${identifier}"\n\nUse /workdir list to see available workdirs.`,
      )
    }

    await context.api.put(`/sessions/${sessionId}/workdir`, { workdirId: workdir.id })

    // Refresh UI state
    await context.refreshSessions()

    return createSuccessResult(
      'workdir switch',
      `Switched to workdir "${workdir.name}" (id: ${workdir.id})`,
      { workdir },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('workdir switch', `Failed to switch workdir: ${message}`)
  }
}

// ============================================================================
// Subcommand: pwd
// ============================================================================

async function handleWorkdirPwd(_args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  const sessionId = requireSession(context)
  if (!sessionId) {
    return createErrorResult('workdir pwd', 'No session selected. Please select a session first.')
  }

  try {
    const response = (await context.api.get(`/sessions/${sessionId}/workdir`)) as {
      workdir: WorkdirSummary | null
    }

    if (!response.workdir) {
      return createSuccessResult(
        'workdir pwd',
        'No active workdir for this session.\n\nUse /workdir switch <id|name> to set one.',
      )
    }

    return createSuccessResult(
      'workdir pwd',
      `Active workdir: ${response.workdir.name} (id: ${response.workdir.id})`,
      { workdir: response.workdir },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('workdir pwd', `Failed to get active workdir: ${message}`)
  }
}

// ============================================================================
// Subcommand: tree
// ============================================================================

async function handleWorkdirTree(args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  const sessionId = requireSession(context)
  if (!sessionId) {
    return createErrorResult('workdir tree', 'No session selected. Please select a session first.')
  }

  try {
    // Get active workdir for this session
    const activeResponse = (await context.api.get(`/sessions/${sessionId}/workdir`)) as {
      workdir: WorkdirSummary | null
    }

    if (!activeResponse.workdir) {
      return createErrorResult(
        'workdir tree',
        'No active workdir for this session.\n\nUse /workdir switch <id|name> to set one.',
      )
    }

    const workdirId = activeResponse.workdir.id
    const subPath = args.length > 0 ? args.join(' ') : ''
    const query = subPath ? `?path=${encodeURIComponent(subPath)}` : ''

    const treeResponse = (await context.api.get(`/workdirs/${workdirId}/tree${query}`)) as {
      tree: WorkdirTreeEntry[]
      path: string
    }

    if (!treeResponse.tree || treeResponse.tree.length === 0) {
      return createSuccessResult(
        'workdir tree',
        `Empty directory: ${treeResponse.path || '/'}`,
        { tree: [], path: treeResponse.path },
      )
    }

    const displayPath = treeResponse.path || '/'
    const entries = treeResponse.tree.map((entry) => {
      const prefix = entry.type === 'directory' ? '  [dir]  ' : '  [file] '
      return `${prefix}${entry.name}`
    })

    return createSuccessResult(
      'workdir tree',
      `${displayPath}:\n\n${entries.join('\n')}`,
      { tree: treeResponse.tree, path: treeResponse.path },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('workdir tree', `Failed to get directory tree: ${message}`)
  }
}

// ============================================================================
// Main workdir dispatcher
// ============================================================================

async function handleWorkdir(args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  if (args.length === 0) {
    return createErrorResult(
      'workdir',
      `Usage: /workdir <subcommand>\n\n` +
        `Available subcommands:\n` +
        `  list             - List all your workdirs\n` +
        `  new <name>       - Create a new workdir\n` +
        `  switch <id|name> - Switch active workdir for current session\n` +
        `  pwd              - Show active workdir for current session\n` +
        `  tree [path]      - Show directory tree of active workdir`,
    )
  }

  const subcommand = args[0].toLowerCase()
  const subcommandArgs = args.slice(1)

  switch (subcommand) {
    case 'list':
      return await handleWorkdirList(subcommandArgs, context)
    case 'new':
      return await handleWorkdirNew(subcommandArgs, context)
    case 'switch':
      return await handleWorkdirSwitch(subcommandArgs, context)
    case 'pwd':
      return await handleWorkdirPwd(subcommandArgs, context)
    case 'tree':
      return await handleWorkdirTree(subcommandArgs, context)
    default:
      return createErrorResult(
        'workdir',
        `Unknown workdir subcommand: ${subcommand}\n\n` +
          `Available subcommands: list, new, switch, pwd, tree`,
      )
  }
}

// ============================================================================
// Exports
// ============================================================================

export const workdirHandlers = {
  workdir: handleWorkdir,
}
