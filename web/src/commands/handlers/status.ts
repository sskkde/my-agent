import type { CommandContext, CommandHandler, FrontendCommandResult } from '../types.js';
import {
  getHealth,
  getTools,
  getProviders,
  logout as apiLogout,
} from '../../api/client.js';

export const handleStatus: CommandHandler = async (
  _args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  try {
    const health = await getHealth();

    const lines = [
      'System Status:',
      '',
      `  Overall: ${health.status}`,
      `  API: ${health.modules.api.status}`,
      `  Database: ${health.modules.database.status}`,
      `  LLM Gateway: ${health.modules.llmGateway.status}`,
    ];

    if (health.timestamp) {
      const timestamp = new Date(health.timestamp).toLocaleString();
      lines.push(`  Timestamp: ${timestamp}`);
    }

    return {
      success: true,
      output: { type: 'text', content: lines.join('\n') },
      commandName: 'status',
    };
  } catch (error) {
    return {
      success: false,
      output: { type: 'error', content: `Failed to get system status: ${error instanceof Error ? error.message : String(error)}` },
      error: `Failed to get system status: ${error instanceof Error ? error.message : String(error)}`,
      commandName: 'status',
    };
  }
};

export const handleDiagnostics: CommandHandler = async (
  _args: string[],
  context: CommandContext
): Promise<FrontendCommandResult> => {
  try {
    const lines = ['System Diagnostics:', ''];

    const health = await getHealth();
    lines.push('Health Status:');
    lines.push(`  Overall: ${health.status}`);
    lines.push(`  API: ${health.modules.api.status}`);
    lines.push(`  Database: ${health.modules.database.status}`);
    lines.push(`  LLM Gateway: ${health.modules.llmGateway.status}`);
    lines.push('');

    lines.push('Authentication:');
    lines.push(`  Authenticated: ${context.auth.isAuthenticated ? 'Yes' : 'No'}`);
    lines.push('');

    try {
      const providers = await getProviders();
      lines.push('Providers:');
      lines.push(`  Total: ${providers.length}`);
      if (providers.length > 0) {
        lines.push(`  Configured: ${providers.map((p) => p.displayName).join(', ')}`);
      }
      lines.push('');
    } catch {
      lines.push('Providers: Unable to fetch provider list');
      lines.push('');
    }

    lines.push('Session:');
    lines.push(`  Current Session: ${context.sessionId || 'None'}`);

    return {
      success: true,
      output: { type: 'text', content: lines.join('\n') },
      commandName: 'diagnostics',
    };
  } catch (error) {
    return {
      success: false,
      output: { type: 'error', content: `Diagnostics failed: ${error instanceof Error ? error.message : String(error)}` },
      error: `Diagnostics failed: ${error instanceof Error ? error.message : String(error)}`,
      commandName: 'diagnostics',
    };
  }
};

export const handleTools: CommandHandler = async (
  _args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  try {
    const tools = await getTools();

    if (tools.tools.length === 0) {
      return {
        success: true,
        output: { type: 'text', content: 'No tools available.' },
        commandName: 'tools',
      };
    }

    const lines = ['Available Tools:', ''];

    for (const tool of tools.tools) {
      lines.push(`  ${tool.name}`);
      lines.push(`    ${tool.description}`);
      lines.push(`    Category: ${tool.category} | Sensitivity: ${tool.sensitivity}`);
      lines.push('');
    }

    lines.push(`Total: ${tools.total} tool${tools.total === 1 ? '' : 's'}`);

    return {
      success: true,
      output: { type: 'text', content: lines.join('\n') },
      commandName: 'tools',
    };
  } catch (error) {
    return {
      success: false,
      output: { type: 'error', content: `Failed to get tools: ${error instanceof Error ? error.message : String(error)}` },
      error: `Failed to get tools: ${error instanceof Error ? error.message : String(error)}`,
      commandName: 'tools',
    };
  }
};

export const handleModels: CommandHandler = async (
  _args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  try {
    const providers = await getProviders();

    if (providers.length === 0) {
      return {
        success: true,
        output: { type: 'text', content: 'No providers configured. Configure a provider first to see available models.' },
        commandName: 'models',
      };
    }

    const lines = ['Available Models by Provider:', ''];

    for (const provider of providers) {
      lines.push(`${provider.displayName} (${provider.providerType}):`);
      lines.push(`  Status: ${provider.enabled ? 'Enabled' : 'Disabled'}`);
      if (provider.selectedModel) {
        lines.push(`    Selected model: ${provider.selectedModel}`);
      } else {
        lines.push('    No model selected');
      }
      lines.push('');
    }

    return {
      success: true,
      output: { type: 'text', content: lines.join('\n') },
      commandName: 'models',
    };
  } catch (error) {
    return {
      success: false,
      output: { type: 'error', content: `Failed to get models: ${error instanceof Error ? error.message : String(error)}` },
      error: `Failed to get models: ${error instanceof Error ? error.message : String(error)}`,
      commandName: 'models',
    };
  }
};

export const handleModel: CommandHandler = async (
  args: string[],
  _context: CommandContext
): Promise<FrontendCommandResult> => {
  if (args.length === 0) {
    return {
      success: true,
      output: { type: 'text', content: 'No model currently selected. Use /model <provider/model> to select a model.' },
      commandName: 'model',
    };
  }

  const modelArg = args[0];

  return {
    success: false,
    output: { type: 'error', content: `Model selection validation not yet implemented. Attempted to select: ${modelArg}` },
    error: `Model selection validation not yet implemented. Attempted to select: ${modelArg}`,
    commandName: 'model',
  };
};

export const handleLogout: CommandHandler = async (
  _args: string[],
  context: CommandContext
): Promise<FrontendCommandResult> => {
  try {
    await apiLogout();

    context.auth.logout();

    return {
      success: true,
      output: { type: 'success', content: 'Successfully logged out.' },
      commandName: 'logout',
      showToast: true,
      toastType: 'success',
    };
  } catch (error) {
    return {
      success: false,
      output: { type: 'error', content: `Logout failed: ${error instanceof Error ? error.message : String(error)}` },
      error: `Logout failed: ${error instanceof Error ? error.message : String(error)}`,
      commandName: 'logout',
      showToast: true,
      toastType: 'error',
    };
  }
};

export const statusHandlers = {
  status: handleStatus,
  diagnostics: handleDiagnostics,
  tools: handleTools,
  models: handleModels,
  model: handleModel,
  logout: handleLogout,
};
