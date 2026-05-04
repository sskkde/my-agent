import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as api from '../../api/client';
import { TimelineList } from '../../components/timeline/TimelineList';
import type { ConsoleSessionInfo, ConsoleTimelineEvent, CreateProviderRequest, UpdateProviderRequest } from '../../api/types';
import type { TabId } from '../../components/TabNav';

import { executeCommand } from '../../commands/executor';
import { parseInput, isCommand } from '../../commands/parser';
import { createCommandEvent } from '../../commands/formatters';
import { loadPreferences } from '../../commands/preferences';
import type { CommandContext, AuthContext } from '../../commands/types';
import { ProcessingStatus } from './ProcessingStatus';
import type { ProcessingStatusPayload } from '../../api/types';

type StreamStatus = 'connecting' | 'connected' | 'disconnected';

const LOCAL_USER_MESSAGE_PREFIX = 'local-user-message';

const createLocalUserMessageEvent = (
  sessionId: string,
  content: string,
  baselineServerMessageCount: number
): ConsoleTimelineEvent => ({
  eventId: `${LOCAL_USER_MESSAGE_PREFIX}-${sessionId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  eventType: 'user_message',
  sessionId,
  timestamp: new Date().toISOString(),
  content,
  metadata: {
    localOnly: true,
    status: 'pending',
    baselineServerMessageCount,
  },
  actor: 'user',
});

const countServerUserMessagesByContent = (
  events: ConsoleTimelineEvent[],
  content: string
): number => events.filter((event) => (
  event.eventType === 'user_message' && event.content === content
)).length;

const getBaselineServerMessageCount = (event: ConsoleTimelineEvent): number => {
  const value = event.metadata?.baselineServerMessageCount;
  return typeof value === 'number' ? value : 0;
};

interface SessionConsoleTabProps {
  setActiveTab?: (tabId: TabId) => void;
  auth?: AuthContext;
}

const SessionConsoleTab: React.FC<SessionConsoleTabProps> = ({
  setActiveTab,
  auth,
}) => {
  const [sessions, setSessions] = useState<ConsoleSessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ConsoleSessionInfo | null>(null);

  const [events, setEvents] = useState<ConsoleTimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('disconnected');

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [localCommandEvents, setLocalCommandEvents] = useState<Map<string, ConsoleTimelineEvent[]>>(
    new Map()
  );
  const [localMessageEvents, setLocalMessageEvents] = useState<Map<string, ConsoleTimelineEvent[]>>(
    new Map()
  );
  const [streamingDrafts, setStreamingDrafts] = useState<Map<string, { content: string; sequence: number }>>(new Map());
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatusPayload | null>(null);

  // Mobile drawer state
  const [isSessionsDrawerOpen, setIsSessionsDrawerOpen] = useState(false);

  const preferences = useMemo(() => loadPreferences(), []);

  useEffect(() => {
    let mounted = true;

    const fetchSessions = async () => {
      try {
        setSessionsLoading(true);
        setSessionsError(null);
        const response = await api.getSessions();
        if (mounted) {
          setSessions(response.sessions);
        }
      } catch (err) {
        if (mounted) {
          setSessionsError(err instanceof Error ? err.message : 'Failed to load sessions');
        }
      } finally {
        if (mounted) {
          setSessionsLoading(false);
        }
      }
    };

    fetchSessions();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId) {
      setSelectedSession(null);
      setEvents([]);
      setStreamStatus('disconnected');
      return;
    }

    let mounted = true;
    let unsubscribe: (() => void) | null = null;

    const loadSessionAndTimeline = async () => {
      try {
        setTimelineLoading(true);
        setTimelineError(null);

        const sessionResponse = await api.getSession(selectedSessionId);
        if (!mounted) return;
        const sessionInfo: ConsoleSessionInfo = {
          ...sessionResponse.session,
          title: `Session ${sessionResponse.session.sessionId.slice(-8)}`,
          status: 'active',
          createdAt: sessionResponse.session.lastActivityAt,
          updatedAt: sessionResponse.session.lastActivityAt,
        };
        setSelectedSession(sessionInfo);

        const timelineResponse = await api.getSessionTimeline(selectedSessionId);
        if (!mounted) return;
        setEvents(timelineResponse.events);

        setStreamStatus('connecting');
        unsubscribe = api.subscribeSessionTimeline(
          selectedSessionId,
          (event) => {
            if (!mounted) return;
            setEvents((prev) => {
              if (prev.some((e) => e.eventId === event.eventId)) {
                return prev;
              }
              return [...prev, event];
            });

            // If this is a final assistant message, remove any streaming draft for this attempt
            if (event.eventType === 'assistant_message' && event.metadata?.attemptId) {
              const attemptId = event.metadata.attemptId as string;
              setStreamingDrafts((prev) => {
                const next = new Map(prev);
                next.delete(attemptId);
                return next;
              });
            }
          },
          () => {
            if (mounted) {
              setStreamStatus('disconnected');
            }
          },
          (status) => {
            if (mounted) {
              setProcessingStatus(status);
            }
          },
          (token) => {
            if (!mounted) return;
            setStreamingDrafts((prev) => {
              const next = new Map(prev);
              const existing = next.get(token.attemptId);

              // Only update if this is a newer sequence number
              if (!existing || token.sequence > existing.sequence) {
                next.set(token.attemptId, {
                  content: (existing?.content || '') + token.delta,
                  sequence: token.sequence,
                });
              }
              return next;
            });
          }
        );
        setStreamStatus('connected');
      } catch (err) {
        if (mounted) {
          setTimelineError(err instanceof Error ? err.message : 'Failed to load timeline');
          setStreamStatus('disconnected');
        }
      } finally {
        if (mounted) {
          setTimelineLoading(false);
        }
      }
    };

    loadSessionAndTimeline();

    return () => {
      mounted = false;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [selectedSessionId]);

  const handleCreateSession = async () => {
    try {
      const response = await api.createSession();
      const newSession: ConsoleSessionInfo = {
        ...response.session,
        title: `Session ${response.session.sessionId.slice(-8)}`,
        status: 'active',
        createdAt: response.session.lastActivityAt,
        updatedAt: response.session.lastActivityAt,
      };
      setSessions((prev) => [newSession, ...prev]);
      setSelectedSessionId(newSession.sessionId);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to create session');
    }
  };

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setDraft('');
    setSendError(null);
    // Close mobile drawer when selecting a session
    setIsSessionsDrawerOpen(false);
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const response = await api.getSessions();
      setSessions(response.sessions);
    } catch (err) {
      setSessionsError(err instanceof Error ? err.message : 'Failed to refresh sessions');
    }
  }, []);

  const refreshProviders = useCallback(async () => {
    try {
      await api.getProviders();
    } catch (err) {
      console.warn('Failed to refresh providers:', err);
    }
  }, []);

  const createCommandContext = useCallback((): CommandContext => {
    return {
      sessionId: selectedSessionId,
      setSelectedSessionId,
      refreshSessions,
      setActiveTab: setActiveTab ?? (() => {}),
      refreshProviders,
      auth: auth ?? { isAuthenticated: false, logout: () => {} },
      api: {
        get: async (path: string) => {
          if (path === '/providers') {
            return api.getProviders();
          }
          throw new Error(`GET ${path} not implemented`);
        },
        post: async (path: string, body?: unknown) => {
          if (path === '/providers') {
            return api.createProvider(body as CreateProviderRequest);
          }
          if (path.startsWith('/providers/') && path.endsWith('/test')) {
            const providerId = path.split('/')[2];
            return api.testProvider(providerId);
          }
          throw new Error(`POST ${path} not implemented`);
        },
        put: async (path: string, body?: unknown) => {
          if (path.startsWith('/providers/')) {
            const providerId = path.split('/')[2];
            return api.updateProvider(providerId, body as UpdateProviderRequest);
          }
          throw new Error(`PUT ${path} not implemented`);
        },
        delete: async (path: string) => {
          if (path.startsWith('/providers/')) {
            const providerId = path.split('/')[2];
            return api.deleteProvider(providerId);
          }
          throw new Error(`DELETE ${path} not implemented`);
        },
      },
    };
  }, [selectedSessionId, setActiveTab, auth, refreshSessions, refreshProviders]);

  const addLocalCommandEvent = useCallback((sessionId: string, event: ConsoleTimelineEvent) => {
    setLocalCommandEvents((prev) => {
      const newMap = new Map(prev);
      const existingEvents = newMap.get(sessionId) || [];
      newMap.set(sessionId, [...existingEvents, event]);
      return newMap;
    });
  }, []);

  const addLocalMessageEvent = useCallback((sessionId: string, content: string): ConsoleTimelineEvent => {
    const baselineServerMessageCount = countServerUserMessagesByContent(events, content);
    const event = createLocalUserMessageEvent(sessionId, content, baselineServerMessageCount);
    setLocalMessageEvents((prev) => {
      const newMap = new Map(prev);
      const existingEvents = newMap.get(sessionId) || [];
      newMap.set(sessionId, [...existingEvents, event]);
      return newMap;
    });
    return event;
  }, [events]);

  const removeLocalMessageEvent = useCallback((sessionId: string, eventId: string) => {
    setLocalMessageEvents((prev) => {
      const existingEvents = prev.get(sessionId);
      if (!existingEvents) return prev;

      const remainingEvents = existingEvents.filter((event) => event.eventId !== eventId);
      const newMap = new Map(prev);
      if (remainingEvents.length > 0) {
        newMap.set(sessionId, remainingEvents);
      } else {
        newMap.delete(sessionId);
      }
      return newMap;
    });
  }, []);

  const handleSend = async () => {
    if (!selectedSessionId || !draft.trim() || sending) return;

    const trimmedDraft = draft.trim();

    if (trimmedDraft.startsWith('//')) {
      const escapedText = trimmedDraft.slice(2);
      setSending(true);
      setSendError(null);
      const localEvent = addLocalMessageEvent(selectedSessionId, escapedText);

      try {
        await api.sendMessage(selectedSessionId, escapedText);
        setDraft('');

        const timelineResponse = await api.getSessionTimeline(selectedSessionId);
        setEvents(timelineResponse.events);
      } catch (err) {
        removeLocalMessageEvent(selectedSessionId, localEvent.eventId);
        setSendError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        setSending(false);
      }
      return;
    }

    if (isCommand(trimmedDraft)) {
      setSending(true);
      setSendError(null);

      try {
        const parseResult = parseInput(trimmedDraft);

        if (parseResult.isCommand && parseResult.parsed) {
          const context = createCommandContext();
          const result = await executeCommand(parseResult.parsed, context);

          const commandEvent = createCommandEvent(result, selectedSessionId);
          addLocalCommandEvent(selectedSessionId, commandEvent);

          setDraft('');
        }
      } catch (err) {
        setSendError(err instanceof Error ? err.message : 'Command execution failed');
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);
    setSendError(null);
    const localEvent = addLocalMessageEvent(selectedSessionId, trimmedDraft);

    try {
      await api.sendMessage(selectedSessionId, trimmedDraft);
      setDraft('');

      const timelineResponse = await api.getSessionTimeline(selectedSessionId);
      setEvents(timelineResponse.events);
    } catch (err) {
      removeLocalMessageEvent(selectedSessionId, localEvent.eventId);
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (draft.trim() && !sending) {
        handleSend();
      }
    }
  };

  const handleRetryStream = () => {
    if (selectedSessionId) {
      const currentId = selectedSessionId;
      setSelectedSessionId(null);
      setTimeout(() => setSelectedSessionId(currentId), 0);
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const mergedEvents = useMemo(() => {
    const sessionLocalEvents = selectedSessionId
      ? localCommandEvents.get(selectedSessionId) || []
      : [];
    const sessionLocalMessageEvents = selectedSessionId
      ? localMessageEvents.get(selectedSessionId) || []
      : [];

    const serverUserMessageCounts = new Map<string, number>();
    events.forEach((event) => {
      if (event.eventType !== 'user_message' || !event.content) return;
      serverUserMessageCounts.set(event.content, (serverUserMessageCounts.get(event.content) || 0) + 1);
    });

    const nextServerMessageOrdinals = new Map<string, number>();
    const orderedLocalMessageEvents = [...sessionLocalMessageEvents].sort((a, b) => (
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    ));

    const pendingMessageEvents = orderedLocalMessageEvents.filter((event) => {
      if (!event.content) return true;

      const baselineServerMessageCount = getBaselineServerMessageCount(event);
      const serverEventCount = serverUserMessageCounts.get(event.content) || 0;
      const nextServerMessageOrdinal = nextServerMessageOrdinals.get(event.content) || 1;
      const matchingServerMessageOrdinal = Math.max(
        nextServerMessageOrdinal,
        baselineServerMessageCount + 1
      );

      if (matchingServerMessageOrdinal > serverEventCount) return true;

      nextServerMessageOrdinals.set(event.content, matchingServerMessageOrdinal + 1);
      return false;
    });

    const allEvents = [...events, ...pendingMessageEvents, ...sessionLocalEvents];
    const dedupedEvents = allEvents.filter((event, index) => (
      allEvents.findIndex((candidate) => candidate.eventId === event.eventId) === index
    ));

    dedupedEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    if (!preferences.reasoningVisible) {
      return dedupedEvents.filter((event) => event.eventType !== 'thinking_summary');
    }

    return dedupedEvents;
  }, [events, localCommandEvents, localMessageEvents, selectedSessionId, preferences.reasoningVisible]);

  const renderStreamStatus = () => {
    const statusText = streamStatus === 'connected'
      ? '已连接'
      : streamStatus === 'connecting'
        ? '连接中...'
        : '已断开';
    const statusClass = streamStatus === 'connected'
      ? 'stream-status-connected'
      : streamStatus === 'connecting'
        ? 'stream-status-connecting'
        : 'stream-status-disconnected';

    return (
      <div className="stream-status-indicator" data-testid="session-timeline-stream-status">
        <span className={`stream-status-badge ${statusClass}`}>{statusText}</span>
        {streamStatus === 'disconnected' && (
          <button className="stream-retry-button" onClick={handleRetryStream}>
            重试
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={`session-console-rich ${isSessionsDrawerOpen ? 'session-console-rich--drawer-open' : ''}`}>
      {/* Mobile Drawer Backdrop */}
      {isSessionsDrawerOpen && (
        <div
          className="session-sidebar-backdrop"
          data-testid="session-sidebar-backdrop"
          onClick={() => setIsSessionsDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sessions List Sidebar */}
      <aside className="sessions-sidebar" data-testid="sessions-sidebar">
        <div className="sessions-sidebar-header">
          <h3>会话列表</h3>
          {/* Mobile close button */}
          <button
            className="session-sidebar-close"
            data-testid="session-sidebar-close"
            onClick={() => setIsSessionsDrawerOpen(false)}
            aria-label="关闭会话列表"
          >
            ✕
          </button>
          <button
            className="session-new-button"
            data-testid="session-new-button"
            onClick={handleCreateSession}
            disabled={sessionsLoading}
          >
            新建会话
          </button>
        </div>

        {sessionsLoading && (
          <div className="sessions-loading">加载中...</div>
        )}

        {sessionsError && (
          <div className="sessions-error">{sessionsError}</div>
        )}

        {!sessionsLoading && !sessionsError && (
          <div className="sessions-list" data-testid="sessions-list">
            {sessions.length === 0 ? (
              <div className="sessions-empty">
                <p>暂无会话</p>
                <p>点击上方按钮创建新会话</p>
              </div>
            ) : (
              sessions.map((session) => (
                <div
                  key={session.sessionId}
                  className={`session-item ${selectedSessionId === session.sessionId ? 'session-item--selected' : ''}`}
                  data-testid={`session-item-${session.sessionId}`}
                  onClick={() => handleSelectSession(session.sessionId)}
                >
                  <div className="session-item-title">
                    {session.title || `会话 ${session.sessionId.slice(-8)}`}
                  </div>
                  <div className="session-item-meta">
                    <span className="session-item-count">{session.messageCount} 消息</span>
                    <span className="session-item-time">{formatDate(session.lastActivityAt)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="session-main">
        {!selectedSessionId ? (
          <>
            {/* Mobile session sidebar toggle for empty state */}
            <div className="timeline-header timeline-header--empty">
              <button
                className="session-sidebar-toggle"
                data-testid="session-sidebar-toggle"
                onClick={() => setIsSessionsDrawerOpen(true)}
                aria-controls="sessions-sidebar"
                aria-label="打开会话列表"
                aria-expanded={isSessionsDrawerOpen}
              >
                ☰
              </button>
              <h3>会话控制台</h3>
            </div>
            <div className="session-empty-state" data-testid="session-empty-state">
              <div className="empty-icon">💬</div>
              <p>从左侧选择一个会话</p>
              <p>或创建一个新会话开始对话</p>
            </div>
          </>
        ) : (
          <>
            {/* Timeline Header */}
            <div className="timeline-header">
              {/* Mobile session sidebar toggle */}
              <button
                className="session-sidebar-toggle"
                data-testid="session-sidebar-toggle"
                onClick={() => setIsSessionsDrawerOpen(true)}
                aria-controls="sessions-sidebar"
                aria-label="打开会话列表"
                aria-expanded={isSessionsDrawerOpen}
              >
                ☰
              </button>
              <h3>
                {selectedSession?.title || `会话 ${selectedSessionId.slice(-8)}`}
              </h3>
              {renderStreamStatus()}
            </div>

            {/* Timeline */}
            <div className="session-timeline-container" data-testid="session-timeline">
              <TimelineList
                events={mergedEvents}
                loading={timelineLoading}
                error={timelineError || undefined}
              />
              {/* Streaming Drafts */}
              {Array.from(streamingDrafts.entries()).map(([attemptId, draft]) => (
                <div
                  key={`draft-${attemptId}`}
                  className="timeline-event-card timeline-event-card--streaming-draft"
                  data-testid="streaming-assistant-draft"
                  data-attempt-id={attemptId}
                >
                  <div className="timeline-event-header">
                    <span className="timeline-event-label">Assistant (streaming)</span>
                  </div>
                  <div className="timeline-event-body">
                    <div className="timeline-event-content">{draft.content}</div>
                  </div>
                </div>
              ))}
            </div>

            {/* Error Display */}
            {sendError && (
              <div className="session-error" data-testid="session-error">
                {sendError}
              </div>
            )}

            {/* Processing Status Indicator */}
            <ProcessingStatus
              streamStatus={streamStatus}
              processingStatus={processingStatus}
              onRetry={handleRetryStream}
            />

            {/* Input Dock */}
            <div className="session-input-dock">
              <input
                type="text"
                className="session-input"
                data-testid="session-message-input"
                placeholder="输入消息或 /help 查看命令..."
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
              />
              <button
                className="session-send-button"
                data-testid="session-send-button"
                onClick={handleSend}
                disabled={!draft.trim() || sending}
              >
                {sending ? '发送中...' : '发送'}
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default SessionConsoleTab;
