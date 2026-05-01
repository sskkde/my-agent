import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleHelp, handleCommands, handleExit, handleQuit } from '../static.js';
import type { CommandContext } from '../../types.js';

const mockContext: CommandContext = {
  sessionId: 'test-session-123',
  setSelectedSessionId: vi.fn(),
  refreshSessions: vi.fn().mockResolvedValue(undefined),
  setActiveTab: vi.fn(),
  refreshProviders: vi.fn().mockResolvedValue(undefined),
  auth: {
    isAuthenticated: true,
    logout: vi.fn(),
  },
  api: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    delete: vi.fn().mockResolvedValue({}),
  },
};

describe('static handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleHelp', () => {
    it('should return list of all commands when no args provided', async () => {
      const result = await handleHelp([], mockContext);

      expect(result.success).toBe(true);
      expect(result.commandName).toBe('help');
      expect(result.output?.content).toContain('Available Commands:');
      expect(result.output?.content).toContain('/help');
      expect(result.output?.content).toContain('/status');
    });

    it('should return detailed help for specific command', async () => {
      const result = await handleHelp(['status'], mockContext);

      expect(result.success).toBe(true);
      expect(result.commandName).toBe('help');
      expect(result.output?.content).toContain('/status');
      expect(result.output?.content).toContain('Description:');
    });

    it('should return error for unknown command', async () => {
      const result = await handleHelp(['unknowncommand'], mockContext);

      expect(result.success).toBe(false);
      expect(result.commandName).toBe('help');
      expect(result.error).toContain('Unknown command');
    });
  });

  describe('handleCommands', () => {
    it('should return detailed commands grouped by category', async () => {
      const result = await handleCommands([], mockContext);

      expect(result.success).toBe(true);
      expect(result.commandName).toBe('commands');
      expect(result.output?.content).toContain('Available Commands by Category:');
      expect(result.output?.content).toContain('Help & Information');
    });
  });

  describe('handleExit', () => {
    it('should return informational message about browser tab', async () => {
      const result = await handleExit([], mockContext);

      expect(result.success).toBe(true);
      expect(result.commandName).toBe('exit');
      expect(result.output?.content).toContain('cannot close browser tab');
    });
  });

  describe('handleQuit', () => {
    it('should return informational message about browser tab', async () => {
      const result = await handleQuit([], mockContext);

      expect(result.success).toBe(true);
      expect(result.commandName).toBe('quit');
      expect(result.output?.content).toContain('cannot close browser tab');
    });
  });
});
