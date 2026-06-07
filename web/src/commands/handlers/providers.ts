import type { CommandContext, FrontendCommandResult } from '../types.js'

const VALID_PROVIDER_TYPES = ['openai', 'openrouter', 'deepseek', 'ollama', 'custom'] as const
type ProviderType = (typeof VALID_PROVIDER_TYPES)[number]

function isValidProviderType(type: string): type is ProviderType {
  return VALID_PROVIDER_TYPES.includes(type as ProviderType)
}

function createSuccessResult(commandName: string, content: string): FrontendCommandResult {
  return {
    success: true,
    commandName,
    output: { type: 'text', content },
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

export async function handleProviders(_args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  try {
    const providers = (await context.api.get('/providers')) as Array<{
      providerId: string
      providerType: string
      displayName: string
      enabled: boolean
      configured?: boolean
      lastTestStatus?: string
    }>

    if (!Array.isArray(providers) || providers.length === 0) {
      return createSuccessResult(
        'providers',
        'No providers configured.\n\nUse /provider connect <type> to add a provider.',
      )
    }

    let output = 'Configured LLM Providers:\n\n'

    for (const provider of providers) {
      const status = provider.enabled !== false ? '●' : '○'
      output += `  ${status} ${provider.displayName} (${provider.providerType})\n`
      output += `    ID: ${provider.providerId}\n`

      if (provider.lastTestStatus) {
        output += `    Last test: ${provider.lastTestStatus}\n`
      }

      output += '\n'
    }

    output += `Total: ${providers.length} provider(s)`

    return createSuccessResult('providers', output)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('providers', `Failed to fetch providers: ${message}`)
  }
}

export async function handleProviderConnect(args: string[], _context: CommandContext): Promise<FrontendCommandResult> {
  if (args.length < 1) {
    return createErrorResult(
      'provider connect',
      `Usage: /provider connect <provider-type>\n\nValid provider types: ${VALID_PROVIDER_TYPES.join(', ')}`,
    )
  }

  const providerType = args[0].toLowerCase()

  if (!isValidProviderType(providerType)) {
    return createErrorResult(
      'provider connect',
      `Invalid provider type "${providerType}". Valid types: ${VALID_PROVIDER_TYPES.join(', ')}`,
    )
  }

  return {
    success: true,
    commandName: 'provider connect',
    output: { type: 'text', content: `Opening settings to configure ${providerType} provider...` },
    navigateTo: 'settings',
  }
}

export async function handleProviderTest(args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  if (args.length < 1) {
    return createErrorResult(
      'provider test',
      'Usage: /provider test <provider-id>\n\nUse /providers to see available provider IDs.',
    )
  }

  const providerId = args[0]

  try {
    const result = (await context.api.post(`/providers/${providerId}/test`)) as {
      success: boolean
      latencyMs?: number
      modelCount?: number
      error?: string
    }

    if (result.success) {
      let output = '✓ Connection test successful\n'
      if (result.latencyMs !== undefined) {
        output += `Latency: ${result.latencyMs}ms`
      }
      if (result.modelCount !== undefined) {
        output += `\nAvailable models: ${result.modelCount}`
      }
      return createSuccessResult('provider test', output)
    } else {
      let output = '✗ Connection test failed'
      if (result.error) {
        output += `\nError: ${result.error}`
      }
      if (result.latencyMs !== undefined) {
        output += `\nLatency: ${result.latencyMs}ms`
      }
      return createErrorResult('provider test', output)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('provider test', `Test failed: ${message}`)
  }
}

export async function handleProviderEnable(
  args: string[],
  context: CommandContext,
  enable: boolean,
): Promise<FrontendCommandResult> {
  const action = enable ? 'enable' : 'disable'

  if (args.length < 1) {
    return createErrorResult(
      `provider ${action}`,
      `Usage: /provider ${action} <provider-id>\n\nUse /providers to see available provider IDs.`,
    )
  }

  const providerId = args[0]

  try {
    const result = (await context.api.put(`/providers/${providerId}`, { enabled: enable })) as {
      providerId: string
      displayName: string
      enabled: boolean
    }

    await context.refreshProviders()

    const statusText = result.enabled ? 'enabled' : 'disabled'
    const output = `✓ Provider ${action}d\n\n` + `Provider: ${result.displayName}\n` + `Status: ${statusText}`

    return createSuccessResult(`provider ${action}`, output)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult(`provider ${action}`, `Failed to ${action} provider: ${message}`)
  }
}

export async function handleProviderDelete(args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  if (args.length < 1) {
    return createErrorResult(
      'provider delete',
      'Usage: /provider delete <provider-id>\n\nUse /providers to see available provider IDs.',
    )
  }

  const providerId = args[0]

  const confirmed = window.confirm(`Are you sure you want to delete provider "${providerId}"?`)
  if (!confirmed) {
    return createSuccessResult('provider delete', 'Deletion cancelled.')
  }

  try {
    await context.api.delete(`/providers/${providerId}`)
    await context.refreshProviders()

    return createSuccessResult('provider delete', '✓ Provider deleted successfully')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return createErrorResult('provider delete', `Failed to delete provider: ${message}`)
  }
}

export async function handleProvider(args: string[], context: CommandContext): Promise<FrontendCommandResult> {
  if (args.length === 0) {
    return createErrorResult(
      'provider',
      `Usage: /provider <subcommand>\n\n` +
        `Available subcommands:\n` +
        `  connect <type>  - Connect to a new provider (navigates to Settings)\n` +
        `  test <id>       - Test provider connection\n` +
        `  enable <id>     - Enable a provider\n` +
        `  disable <id>    - Disable a provider\n` +
        `  delete <id>     - Delete a provider\n\n` +
        `Use /providers to list configured providers.`,
    )
  }

  const subcommand = args[0].toLowerCase()
  const subcommandArgs = args.slice(1)

  switch (subcommand) {
    case 'connect':
      return await handleProviderConnect(subcommandArgs, context)
    case 'test':
      return await handleProviderTest(subcommandArgs, context)
    case 'enable':
      return await handleProviderEnable(subcommandArgs, context, true)
    case 'disable':
      return await handleProviderEnable(subcommandArgs, context, false)
    case 'delete':
      return await handleProviderDelete(subcommandArgs, context)
    default:
      return createErrorResult(
        'provider',
        `Unknown provider subcommand: ${subcommand}\n\n` +
          `Available subcommands: connect, test, enable, disable, delete`,
      )
  }
}

export const providerHandlers = {
  providers: handleProviders,
  provider: handleProvider,
}
