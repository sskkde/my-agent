/**
 * Frontend-specific command types extending shared core types
 * React-specific context for command execution in the WebUI
 */

import type {
  CommandDefinition as SharedCommandDefinition,
  CommandName as SharedCommandName,
  CommandResult as SharedCommandResult,
  CommandOutput as SharedCommandOutput,
  CommandRisk,
  CommandCategory,
} from '../../../src/command-core/types.js';

// Re-export shared types for convenience
export type {
  SharedCommandDefinition,
  SharedCommandName,
  SharedCommandResult,
  SharedCommandOutput,
  CommandRisk,
  CommandCategory,
};

// Export CommandResult as alias for convenience
export type CommandResult = SharedCommandResult;

/**
 * Command names available in the frontend
 * Excludes dangerous commands not suitable for WebUI
 */
export type FrontendCommandName = Exclude<
  SharedCommandName,
  | 'bash'
  | 'mcp'
  | 'plugins'
  | 'config'
  | 'restart'
  | 'allowlist'
  | 'tts'
>;

/**
 * UI-specific metadata for command display
 */
export interface CommandUIMetadata {
  /** Icon identifier for the command (e.g., 'help', 'settings', 'logout') */
  icon?: string;
  /** Color theme for the command category */
  color?: string;
  /** Whether to show the command in quick actions */
  showInQuickActions?: boolean;
  /** Keyboard shortcut if available */
  keyboardShortcut?: string;
}

/**
 * Extended command definition with UI metadata
 */
export interface FrontendCommandDefinition extends SharedCommandDefinition {
  /** UI-specific display metadata */
  ui?: CommandUIMetadata;
}

/**
 * Authentication context for commands
 */
export interface AuthContext {
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Logout callback */
  logout: () => void;
}

/**
 * API client interface for commands
 */
export interface ApiClient {
  /** GET request */
  get: (path: string) => Promise<unknown>;
  /** POST request */
  post: (path: string, body?: unknown) => Promise<unknown>;
  /** PUT request */
  put: (path: string, body?: unknown) => Promise<unknown>;
  /** DELETE request */
  delete: (path: string) => Promise<unknown>;
}

/**
 * Tab identifiers for navigation
 */
export type TabId =
  | 'dashboard'
  | 'session-console'
  | 'agent-monitor'
  | 'status'
  | 'sessions'
  | 'usage'
  | 'logs-debug'
  | 'channels'
  | 'instances'
  | 'skills'
  | 'settings';

/**
 * Command execution context provided to all command handlers
 * React-specific properties for UI state management
 */
export interface CommandContext {
  /** Current session ID */
  sessionId: string | null;
  /** Set the selected session ID */
  setSelectedSessionId: (sessionId: string | null) => void;
  /** Refresh the sessions list */
  refreshSessions: () => Promise<void>;
  /** Set the active tab */
  setActiveTab: (tabId: TabId) => void;
  /** Refresh providers list */
  refreshProviders: () => Promise<void>;
  /** Authentication context */
  auth: AuthContext;
  /** API client for backend communication */
  api: ApiClient;
}

/**
 * Frontend command output with type and content
 */
export interface FrontendCommandOutput {
  type: 'text' | 'error' | 'structured' | 'success';
  content: string;
  data?: unknown;
}

/**
 * Frontend command result with UI-specific properties
 */
export interface FrontendCommandResult extends Omit<SharedCommandResult, 'output' | 'commandName'> {
  /** Command name - optional in frontend */
  commandName?: string;
  /** Output with type, content and optional data */
  output?: FrontendCommandOutput;
  /** Additional data payload */
  data?: unknown;
  /** Whether to trigger a toast notification */
  showToast?: boolean;
  /** Toast message type */
  toastType?: 'success' | 'error' | 'info';
  /** Whether to navigate to a different tab */
  navigateTo?: TabId;
}

/**
 * Command handler function type
 */
export type CommandHandler = (
  args: string[],
  context: CommandContext
) => Promise<FrontendCommandResult> | FrontendCommandResult;

/**
 * Registered command with its handler
 */
export interface RegisteredCommand {
  definition: FrontendCommandDefinition;
  handler: CommandHandler;
}
