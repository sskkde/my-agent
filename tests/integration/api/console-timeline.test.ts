import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiContext, isApiContextError, type ApiContext } from '../../../src/api/context.js';
import { createConsoleTimelineService, type ConsoleTimelineService } from '../../../src/api/console-timeline.js';
import type { TurnTranscript } from '../../../src/storage/transcript-store.js';
import type { EventRecord } from '../../../src/storage/event-store.js';

describe('Console Timeline Service', () => {
  let apiContext: ApiContext;
  let timelineService: ConsoleTimelineService;
  const sessionId = 'test-session-001';
  const userId = 'test-user-001';

  beforeAll(() => {
    const ctx = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctx)) {
      throw new Error(`Failed to create API context: ${ctx.message}`);
    }
    apiContext = ctx;
    timelineService = createConsoleTimelineService({
      transcriptStore: apiContext.stores.transcriptStore,
      eventStore: apiContext.stores.eventStore,
    });
  });

  afterAll(() => {
    if (apiContext && 'connection' in apiContext) {
      (apiContext as any).connection.close();
    }
  });

  describe('Empty session', () => {
    it('should return empty array and total=0 for session with no data', () => {
      const result = timelineService.getTimeline('non-existent-session');
      expect(result.events).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('Single turn with user input and assistant messages', () => {
    beforeAll(() => {
      const turn: TurnTranscript = {
        turnId: 'turn-001',
        sessionId,
        userId,
        input: {
          userMessageSummary: 'Hello, can you help me?',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-001', role: 'assistant', content: 'Hello! How can I assist you today?' },
            { messageId: 'msg-002', role: 'assistant', content: 'I can help with various tasks.' },
          ],
        },
        visibility: 'public',
        createdAt: '2026-04-29T10:00:00.000Z',
      };
      apiContext.stores.transcriptStore.saveTurn(turn);
    });

    it('should emit user_message and 2 assistant_message events in order', () => {
      const result = timelineService.getTimeline(sessionId);
      expect(result.total).toBe(3);
      expect(result.events).toHaveLength(3);

      const [userMsg, assistantMsg1, assistantMsg2] = result.events;

      expect(userMsg.eventType).toBe('user_message');
      expect(userMsg.eventId).toBe('turn-turn-001-input');
      expect(userMsg.content).toBe('Hello, can you help me?');
      expect(userMsg.actor).toBe(userId);

      expect(assistantMsg1.eventType).toBe('assistant_message');
      expect(assistantMsg1.eventId).toBe('turn-turn-001-msg-0');
      expect(assistantMsg1.content).toBe('Hello! How can I assist you today?');
      expect(assistantMsg1.actor).toBe('assistant');

      expect(assistantMsg2.eventType).toBe('assistant_message');
      expect(assistantMsg2.eventId).toBe('turn-turn-001-msg-1');
      expect(assistantMsg2.content).toBe('I can help with various tasks.');
      expect(assistantMsg2.actor).toBe('assistant');
    });

    it('should have stable ordering by timestamp then eventId', () => {
      const result = timelineService.getTimeline(sessionId);
      const timestamps = result.events.map(e => e.timestamp);

      const sortedTimestamps = [...timestamps].sort();
      expect(timestamps).toEqual(sortedTimestamps);

      for (let i = 1; i < result.events.length; i++) {
        if (result.events[i].timestamp === result.events[i - 1].timestamp) {
          expect(result.events[i].eventId.localeCompare(result.events[i - 1].eventId)).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('Turn with tool call summaries', () => {
    const sessionWithTools = 'test-session-tools';

    beforeAll(() => {
      const turn: TurnTranscript = {
        turnId: 'turn-tool-001',
        sessionId: sessionWithTools,
        userId,
        input: {
          userMessageSummary: 'Run analysis',
        },
        output: {
          visibleMessages: [],
        },
        runtimeSummary: {
          toolCallSummaries: [
            { toolCallId: 'tc-1', toolName: 'analyze_data', status: 'completed' as const },
            { toolCallId: 'tc-2', toolName: 'generate_report', status: 'completed' as const },
          ],
        },
        visibility: 'public',
        createdAt: '2026-04-29T11:00:00.000Z',
      };
      apiContext.stores.transcriptStore.saveTurn(turn);
    });

    it('should emit tool_call events for each tool call summary', () => {
      const result = timelineService.getTimeline(sessionWithTools);
      const toolEvents = result.events.filter(e => e.eventType === 'tool_call');

      expect(toolEvents).toHaveLength(2);
      expect(toolEvents[0].content).toBe('analyze_data: completed');
      expect(toolEvents[0].eventId).toBe('turn-turn-tool-001-tool-0');
      expect(toolEvents[1].content).toBe('generate_report: completed');
      expect(toolEvents[1].eventId).toBe('turn-turn-tool-001-tool-1');
    });

    it('should include metadata with tool call index', () => {
      const result = timelineService.getTimeline(sessionWithTools);
      const toolEvents = result.events.filter(e => e.eventType === 'tool_call');

      expect(toolEvents[0].metadata?.toolCallIndex).toBe(0);
      expect(toolEvents[1].metadata?.toolCallIndex).toBe(1);
    });
  });

  describe('Turn with approval summaries', () => {
    const sessionWithApprovals = 'test-session-approvals';

    beforeAll(() => {
      const turn: TurnTranscript = {
        turnId: 'turn-approval-001',
        sessionId: sessionWithApprovals,
        userId,
        input: {
          userMessageSummary: 'Delete production database',
        },
        output: {
          visibleMessages: [],
        },
        runtimeSummary: {
          approvalSummaries: [
            'Approval requested: Delete database prod-db (HIGH RISK)',
          ],
        },
        visibility: 'public',
        createdAt: '2026-04-29T12:00:00.000Z',
      };
      apiContext.stores.transcriptStore.saveTurn(turn);
    });

    it('should emit approval_request events for each approval summary', () => {
      const result = timelineService.getTimeline(sessionWithApprovals);
      const approvalEvents = result.events.filter(e => e.eventType === 'approval_request');

      expect(approvalEvents).toHaveLength(1);
      expect(approvalEvents[0].content).toBe('Approval requested: Delete database prod-db (HIGH RISK)');
      expect(approvalEvents[0].eventId).toBe('turn-turn-approval-001-approval-0');
      expect(approvalEvents[0].actor).toBe('system');
    });
  });

  describe('Turn with artifact refs', () => {
    const sessionWithArtifacts = 'test-session-artifacts';

    beforeAll(() => {
      const turn: TurnTranscript = {
        turnId: 'turn-artifact-001',
        sessionId: sessionWithArtifacts,
        userId,
        input: {
          userMessageSummary: 'Generate report',
        },
        output: {
          visibleMessages: [],
          artifactRefs: ['artifact-001', 'artifact-002'],
        },
        visibility: 'public',
        createdAt: '2026-04-29T13:00:00.000Z',
      };
      apiContext.stores.transcriptStore.saveTurn(turn);
    });

    it('should emit artifact_created events for each artifact ref', () => {
      const result = timelineService.getTimeline(sessionWithArtifacts);
      const artifactEvents = result.events.filter(e => e.eventType === 'artifact_created');

      expect(artifactEvents).toHaveLength(2);
      expect(artifactEvents[0].content).toBe('Artifact created: artifact-001');
      expect(artifactEvents[0].metadata?.artifactRef).toBe('artifact-001');
      expect(artifactEvents[1].content).toBe('Artifact created: artifact-002');
      expect(artifactEvents[1].metadata?.artifactRef).toBe('artifact-002');
    });
  });

  describe('Event store run events', () => {
    const sessionWithRuns = 'test-session-runs';

    beforeAll(() => {
      const runEvents: EventRecord[] = [
        {
          eventId: 'evt-run-001',
          eventType: 'run_started',
          sourceModule: 'planner',
          sessionId: sessionWithRuns,
          payload: { runId: 'run-001', message: 'Starting planning run' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2026-04-29T14:00:00.000Z',
        },
        {
          eventId: 'evt-run-002',
          eventType: 'run_progress',
          sourceModule: 'planner',
          sessionId: sessionWithRuns,
          payload: { runId: 'run-001', progress: 50 },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2026-04-29T14:01:00.000Z',
        },
        {
          eventId: 'evt-run-003',
          eventType: 'run_completed',
          sourceModule: 'planner',
          sessionId: sessionWithRuns,
          payload: { runId: 'run-001', message: 'Run completed successfully' },
          sensitivity: 'low',
          retentionClass: 'standard',
          createdAt: '2026-04-29T14:02:00.000Z',
        },
      ];
      apiContext.stores.eventStore.append(runEvents);
    });

    it('should map run events to timeline events', () => {
      const result = timelineService.getTimeline(sessionWithRuns);

      expect(result.total).toBe(3);
      expect(result.events[0].eventType).toBe('run_started');
      expect(result.events[1].eventType).toBe('run_progress');
      expect(result.events[2].eventType).toBe('run_completed');
    });

    it('should preserve event metadata from event store', () => {
      const result = timelineService.getTimeline(sessionWithRuns);
      const startedEvent = result.events.find(e => e.eventType === 'run_started');

      expect(startedEvent?.metadata?.runId).toBe('run-001');
      expect(startedEvent?.metadata?.sourceModule).toBe('planner');
      expect(startedEvent?.actor).toBe('planner');
    });
  });

  describe('Event store error events', () => {
    const sessionWithErrors = 'test-session-errors';

    beforeAll(() => {
      const errorEvents: EventRecord[] = [
        {
          eventId: 'evt-error-001',
          eventType: 'tool_execution_error',
          sourceModule: 'tool',
          sessionId: sessionWithErrors,
          payload: { error: 'Tool execution failed: timeout' },
          sensitivity: 'medium',
          retentionClass: 'standard',
          createdAt: '2026-04-29T15:00:00.000Z',
        },
        {
          eventId: 'evt-error-002',
          eventType: 'error',
          sourceModule: 'kernel',
          sessionId: sessionWithErrors,
          payload: { message: 'Kernel panic' },
          sensitivity: 'high',
          retentionClass: 'long',
          createdAt: '2026-04-29T15:01:00.000Z',
        },
      ];
      apiContext.stores.eventStore.append(errorEvents);
    });

    it('should map error events to error timeline events', () => {
      const result = timelineService.getTimeline(sessionWithErrors);
      const errorEvents = result.events.filter(e => e.eventType === 'error');

      expect(errorEvents).toHaveLength(2);
      expect(errorEvents[0].content).toBe('Tool execution failed: timeout');
      expect(errorEvents[0].metadata?.originalEventType).toBe('tool_execution_error');
      expect(errorEvents[1].content).toBe('Kernel panic');
    });
  });

  describe('Pagination', () => {
    const sessionForPagination = 'test-session-pagination';

    beforeAll(() => {
      for (let i = 0; i < 5; i++) {
        const turn: TurnTranscript = {
          turnId: `turn-pag-${i}`,
          sessionId: sessionForPagination,
          userId,
          input: {
            userMessageSummary: `Message ${i}`,
          },
          output: {
            visibleMessages: [],
          },
          visibility: 'public',
          createdAt: `2026-04-29T16:0${i}:00.000Z`,
        };
        apiContext.stores.transcriptStore.saveTurn(turn);
      }
    });

    it('should return all events when no pagination options provided', () => {
      const result = timelineService.getTimeline(sessionForPagination);
      expect(result.events).toHaveLength(5);
      expect(result.total).toBe(5);
    });

    it('should limit results with limit option', () => {
      const result = timelineService.getTimeline(sessionForPagination, { limit: 2 });
      expect(result.events).toHaveLength(2);
      expect(result.total).toBe(5);
      expect(result.events[0].content).toBe('Message 0');
      expect(result.events[1].content).toBe('Message 1');
    });

    it('should offset results with offset option', () => {
      const result = timelineService.getTimeline(sessionForPagination, { limit: 2, offset: 2 });
      expect(result.events).toHaveLength(2);
      expect(result.events[0].content).toBe('Message 2');
      expect(result.events[1].content).toBe('Message 3');
    });

    it('should handle offset beyond total', () => {
      const result = timelineService.getTimeline(sessionForPagination, { offset: 10 });
      expect(result.events).toHaveLength(0);
      expect(result.total).toBe(5);
    });

    it('should respect max limit of 200', () => {
      const result = timelineService.getTimeline(sessionForPagination, { limit: 500 });
      expect(result.events.length).toBeLessThanOrEqual(200);
    });
  });

  describe('Event type filtering', () => {
    const sessionWithMixedEvents = 'test-session-filter';

    beforeAll(() => {
      const turn: TurnTranscript = {
        turnId: 'turn-filter-001',
        sessionId: sessionWithMixedEvents,
        userId,
        input: {
          userMessageSummary: 'Filter test message',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-filter-001', role: 'assistant', content: 'Assistant response' },
          ],
        },
        runtimeSummary: {
          toolCallSummaries: [{ toolCallId: 'tc-f1', toolName: 'tool_call', status: 'completed' as const }],
        },
        visibility: 'public',
        createdAt: '2026-04-29T17:00:00.000Z',
      };
      apiContext.stores.transcriptStore.saveTurn(turn);
    });

    it('should filter events by type', () => {
      const result = timelineService.getTimeline(sessionWithMixedEvents, {
        eventTypes: ['user_message'],
      });
      expect(result.events).toHaveLength(1);
      expect(result.events[0].eventType).toBe('user_message');
    });

    it('should filter by multiple event types', () => {
      const result = timelineService.getTimeline(sessionWithMixedEvents, {
        eventTypes: ['user_message', 'assistant_message'],
      });
      expect(result.events).toHaveLength(2);
      expect(result.events.map(e => e.eventType).sort()).toEqual(['assistant_message', 'user_message']);
    });
  });

  describe('Old transcript compatibility (EC-8)', () => {
    const oldTranscriptSession = 'test-session-old-transcript';

    beforeAll(() => {
      // Old transcript format: runtimeSummary is completely undefined
      const turnWithoutRuntimeSummary: TurnTranscript = {
        turnId: 'turn-old-001',
        sessionId: oldTranscriptSession,
        userId,
        input: {
          userMessageSummary: 'Old format message',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-old-001', role: 'assistant', content: 'Response without runtime summary' },
          ],
        },
        // No runtimeSummary at all - old format
        visibility: 'public',
        createdAt: '2026-04-29T19:00:00.000Z',
      };

      // Old transcript format: runtimeSummary exists but no toolCallSummaries
      const turnWithEmptyRuntimeSummary: TurnTranscript = {
        turnId: 'turn-old-002',
        sessionId: oldTranscriptSession,
        userId,
        input: {
          userMessageSummary: 'Another old format',
        },
        output: {
          visibleMessages: [],
        },
        runtimeSummary: {
          // Has runtimeSummary but no toolCallSummaries
          foregroundDecisionId: 'decision-001',
        },
        visibility: 'public',
        createdAt: '2026-04-29T19:01:00.000Z',
      };

      // Old transcript with approval/ack messages
      const turnWithAckMessages: TurnTranscript = {
        turnId: 'turn-old-003',
        sessionId: oldTranscriptSession,
        userId,
        input: {
          userMessageSummary: 'Request requiring approval',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-ack-001', role: 'approval', content: 'Approval granted for action' },
          ],
        },
        runtimeSummary: {
          approvalSummaries: ['Approval granted'],
        },
        visibility: 'public',
        createdAt: '2026-04-29T19:02:00.000Z',
      };

      apiContext.stores.transcriptStore.saveTurn(turnWithoutRuntimeSummary);
      apiContext.stores.transcriptStore.saveTurn(turnWithEmptyRuntimeSummary);
      apiContext.stores.transcriptStore.saveTurn(turnWithAckMessages);
    });

    it('should render old transcript without runtimeSummary without crash', () => {
      const result = timelineService.getTimeline(oldTranscriptSession);
      
      // Should have events for the turn
      const userEvents = result.events.filter(e => e.eventType === 'user_message');
      const assistantEvents = result.events.filter(e => e.eventType === 'assistant_message');
      
      expect(userEvents.length).toBeGreaterThanOrEqual(1);
      expect(assistantEvents.length).toBeGreaterThanOrEqual(1);
      
      // Should not crash and should have proper content
      const oldMsg = result.events.find(e => e.content === 'Response without runtime summary');
      expect(oldMsg).toBeDefined();
    });

    it('should handle runtimeSummary without toolCallSummaries (null/undefined)', () => {
      const result = timelineService.getTimeline(oldTranscriptSession);
      
      // Should not crash
      expect(result.events.length).toBeGreaterThan(0);
      
      // No tool_call events should be emitted for old format
      const toolEvents = result.events.filter(e => e.eventType === 'tool_call');
      expect(toolEvents).toHaveLength(0);
    });

    it('should handle old transcript with approval/ack messages', () => {
      const result = timelineService.getTimeline(oldTranscriptSession);
      
      // Should have approval_decision event from approval role message
      const approvalEvents = result.events.filter(e => e.eventType === 'approval_decision');
      expect(approvalEvents.length).toBeGreaterThanOrEqual(1);
      expect(approvalEvents[0].content).toBe('Approval granted for action');
    });

    it('should verify toolCallSummaries is undefined in old data', () => {
      // Read back the turn to verify old format
      const turn = apiContext.stores.transcriptStore.getTurn('turn-old-001');
      expect(turn).toBeDefined();
      expect(turn?.runtimeSummary).toBeUndefined();
      
      const turn2 = apiContext.stores.transcriptStore.getTurn('turn-old-002');
      expect(turn2).toBeDefined();
      expect(turn2?.runtimeSummary?.toolCallSummaries).toBeUndefined();
    });
  });

  describe('Complex session with multiple turns', () => {
    const complexSession = 'test-session-complex';

    beforeAll(() => {
      const turn1: TurnTranscript = {
        turnId: 'turn-complex-001',
        sessionId: complexSession,
        userId,
        input: {
          userMessageSummary: 'First message',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-c001', role: 'assistant', content: 'First response' },
          ],
        },
        visibility: 'public',
        createdAt: '2026-04-29T18:00:00.000Z',
      };

      const turn2: TurnTranscript = {
        turnId: 'turn-complex-002',
        sessionId: complexSession,
        userId,
        input: {
          userMessageSummary: 'Second message',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-c002', role: 'assistant', content: 'Second response' },
          ],
        },
        runtimeSummary: {
          toolCallSummaries: [{ toolCallId: 'tc-c2', toolName: 'tool_in_second_turn', status: 'completed' as const }],
        },
        visibility: 'public',
        createdAt: '2026-04-29T18:01:00.000Z',
      };

      apiContext.stores.transcriptStore.saveTurn(turn1);
      apiContext.stores.transcriptStore.saveTurn(turn2);

      const runEvent: EventRecord = {
        eventId: 'evt-complex-run',
        eventType: 'run_started',
        sourceModule: 'planner',
        sessionId: complexSession,
        payload: { message: 'Run started' },
        sensitivity: 'low',
        retentionClass: 'standard',
        createdAt: '2026-04-29T18:02:00.000Z',
      };
      apiContext.stores.eventStore.append(runEvent);
    });

    it('should correctly interleave transcript and event store events', () => {
      const result = timelineService.getTimeline(complexSession);

      expect(result.total).toBe(6);

      const eventTypes = result.events.map(e => e.eventType);
      expect(eventTypes).toEqual([
        'user_message',
        'assistant_message',
        'user_message',
        'assistant_message',
        'tool_call',
        'run_started',
      ]);
    });

    it('should maintain chronological order across sources', () => {
      const result = timelineService.getTimeline(complexSession);
      const timestamps = result.events.map(e => new Date(e.timestamp).getTime());

      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });
  });
});
