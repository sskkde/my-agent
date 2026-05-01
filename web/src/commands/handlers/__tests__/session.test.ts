import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { CommandContext } from '../../types.js';
import * as apiClient from '../../../api/client.js';
import {
  handleNew,
  handleSession,
  handleSessions,
  handleSettings,
  sessionHandlers,
} from '../session.js';

describe('Session Command Handlers', () => {
  let mockContext: CommandContext;
  let mockCreateSession: MockedFunction<typeof apiClient.createSession>;
  let mockGetSession: MockedFunction<typeof apiClient.getSession>;
  let mockGetSessions: MockedFunction<typeof apiClient.getSessions>;
  let mockGetSettings: MockedFunction<typeof apiClient.getSettings>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();

    mockCreateSession = vi.spyOn(apiClient, 'createSession') as MockedFunction<typeof apiClient.createSession>;
    mockGetSession = vi.spyOn(apiClient, 'getSession') as MockedFunction<typeof apiClient.getSession>;
    mockGetSessions = vi.spyOn(apiClient, 'getSessions') as MockedFunction<typeof apiClient.getSessions>;
    mockGetSettings = vi.spyOn(apiClient, 'getSettings') as MockedFunction<typeof apiClient.getSettings>;

    mockContext = {
      sessionId: 'session-123',
      setSelectedSessionId: vi.fn(),
      refreshSessions: vi.fn().mockResolvedValue(undefined),
      setActiveTab: vi.fn(),
      refreshProviders: vi.fn().mockResolvedValue(undefined),
      auth: {
        isAuthenticated: true,
        logout: vi.fn(),
      },
      api: {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
      },
    };
  });

  describe('handleNew', () => {
    it('should create a new session and select it', async () => {
      const newSessionId = 'session-new-456';
      mockCreateSession.mockResolvedValue({
        session: {
          sessionId: newSessionId,
          userId: 'user-1',
          messageCount: 0,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
      });

      const result = await handleNew([], mockContext);

      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      expect(mockContext.refreshSessions).toHaveBeenCalledTimes(1);
      expect(mockContext.setSelectedSessionId).toHaveBeenCalledWith(newSessionId);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ sessionId: newSessionId });
      expect(result.output?.content).toContain(newSessionId);
    });

    it('should return error when createSession fails', async () => {
      mockCreateSession.mockRejectedValue(new Error('Network error'));

      const result = await handleNew([], mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
      expect(result.output?.type).toBe('error');
    });
  });

  describe('handleSession (no args)', () => {
    it('should return current session info when session is selected', async () => {
      mockGetSession.mockResolvedValue({
        session: {
          sessionId: 'session-123',
          userId: 'user-1',
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
      });

      const result = await handleSession([], mockContext);

      expect(mockGetSession).toHaveBeenCalledWith('session-123');
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: 'session-123',
        title: 'session-123',
        status: 'active',
        messageCount: 5,
      });
    });

    it('should return error when no session is selected', async () => {
      mockContext.sessionId = null;

      const result = await handleSession([], mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No session selected');
      expect(mockGetSession).not.toHaveBeenCalled();
    });

    it('should return error when getSession fails', async () => {
      mockGetSession.mockRejectedValue(new Error('Session not found'));

      const result = await handleSession([], mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Session not found');
    });
  });

  describe('handleSession (with args)', () => {
    it('should switch to specified session', async () => {
      const targetSessionId = 'session-target-789';
      mockGetSession.mockResolvedValue({
        session: {
          sessionId: targetSessionId,
          userId: 'user-1',
          messageCount: 10,
          lastActivityAt: new Date().toISOString(),
          activePlannerRunIds: [],
          activeBackgroundRunIds: [],
        },
      });

      const result = await handleSession([targetSessionId], mockContext);

      expect(mockGetSession).toHaveBeenCalledWith(targetSessionId);
      expect(mockContext.setSelectedSessionId).toHaveBeenCalledWith(targetSessionId);
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        id: targetSessionId,
        title: targetSessionId,
        status: 'active',
        messageCount: 10,
      });
    });

    it('should return error when session not found', async () => {
      const targetSessionId = 'nonexistent-session';
      mockGetSession.mockRejectedValue(new Error('Not found'));

      const result = await handleSession([targetSessionId], mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe(`Session not found: ${targetSessionId}`);
    });
  });

  describe('handleSessions', () => {
    it('should list up to 10 sessions', async () => {
      const mockSessions = [
        {
          sessionId: 'session-1',
          userId: 'user-1',
          title: 'Session One',
          status: 'active' as const,
          messageCount: 5,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          sessionId: 'session-2',
          userId: 'user-1',
          title: 'Session Two',
          status: 'archived' as const,
          messageCount: 20,
          lastActivityAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ];

      mockGetSessions.mockResolvedValue({
        sessions: mockSessions,
        total: 2,
      });

      const result = await handleSessions([], mockContext);

      expect(mockGetSessions).toHaveBeenCalledWith(undefined, 10, 0);
      expect(result.success).toBe(true);
      expect((result.data as { sessions: unknown[] }).sessions).toHaveLength(2);
      expect((result.data as { sessions: unknown[] }).sessions[0]).toEqual({
        id: 'session-1',
        title: 'Session One',
        status: 'active',
        messageCount: 5,
      });
      expect((result.data as { total: number }).total).toBe(2);
    });

    it('should return message when no sessions exist', async () => {
      mockGetSessions.mockResolvedValue({
        sessions: [],
        total: 0,
      });

      const result = await handleSessions([], mockContext);

      expect(result.success).toBe(true);
      expect(result.output?.content).toBe('No sessions found');
      expect((result.data as { sessions: unknown[] }).sessions).toEqual([]);
      expect((result.data as { total: number }).total).toBe(0);
    });

    it('should return error when getSessions fails', async () => {
      mockGetSessions.mockRejectedValue(new Error('Database error'));

      const result = await handleSessions([], mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Database error');
    });
  });

  describe('handleSettings', () => {
    it('should navigate to settings tab when setActiveTab is available', async () => {
      const mockSettings = {
        localOnly: true,
        providers: { openai: { configured: true } },
        retentionDays: 30,
      };

      mockGetSettings.mockResolvedValue({
        settings: mockSettings,
      });

      const result = await handleSettings([], mockContext);

      expect(mockGetSettings).toHaveBeenCalledTimes(1);
      expect(mockContext.setActiveTab).toHaveBeenCalledWith('settings');
      expect(result.success).toBe(true);
      expect(result.navigateTo).toBe('settings');
      expect(result.data).toEqual(mockSettings);
    });

    it('should return settings summary when setActiveTab is not in context', async () => {
      const mockSettings = {
        localOnly: false,
        providers: { openrouter: { configured: false } },
        retentionDays: 90,
      };

      mockGetSettings.mockResolvedValue({
        settings: mockSettings,
      });

      const contextWithoutSetActiveTab = { ...mockContext };
      delete (contextWithoutSetActiveTab as Record<string, unknown>).setActiveTab;

      const result = await handleSettings([], contextWithoutSetActiveTab);

      expect(mockGetSettings).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.navigateTo).toBeUndefined();
      expect(result.output?.content).toContain('Local Only: No');
      expect(result.output?.content).toContain('Retention Days: 90');
    });

    it('should return error when getSettings fails', async () => {
      mockGetSettings.mockRejectedValue(new Error('Unauthorized'));

      const result = await handleSettings([], mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unauthorized');
    });
  });

  describe('sessionHandlers export', () => {
    it('should export all handlers', () => {
      expect(sessionHandlers.new).toBe(handleNew);
      expect(sessionHandlers.session).toBe(handleSession);
      expect(sessionHandlers.sessions).toBe(handleSessions);
      expect(sessionHandlers.settings).toBe(handleSettings);
    });
  });
});
