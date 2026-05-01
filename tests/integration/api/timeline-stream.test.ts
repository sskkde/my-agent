import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAuthenticatedTestContext, closeAuthenticatedTestContext, type AuthenticatedTestContext } from '../../helpers/auth.js';
import type { TurnTranscript } from '../../../src/storage/transcript-store.js';

interface SnapshotData {
  type: string;
  events: Array<{ eventId: string; eventType: string }>;
  timestamp: string;
}

async function readSnapshotFromStream(url: string, authCookie: string, timeoutMs = 3000): Promise<{ snapshotData: SnapshotData; response: Response }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Cookie': authCookie },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No reader');

    const decoder = new TextDecoder();
    const { value } = await reader.read();
    const text = decoder.decode(value);

    reader.cancel();
    clearTimeout(timeout);

    const lines = text.split('\n').filter(line => line.startsWith('data:'));
    const snapshotData = JSON.parse(lines[0].replace('data: ', '')) as SnapshotData;

    return { snapshotData, response };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

describe('Timeline Stream API', () => {
  let ctx: AuthenticatedTestContext;
  let baseUrl: string;
  let authCookie: string;
  let sessionId: string;

  beforeAll(async () => {
    ctx = await createAuthenticatedTestContext();
    baseUrl = ctx.baseUrl;
    authCookie = ctx.authCookie;

    const createResponse = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
      body: JSON.stringify({})
    });
    const body = await createResponse.json() as { data: { session: { sessionId: string } } };
    sessionId = body.data.session.sessionId;
  });

  afterAll(async () => {
    await closeAuthenticatedTestContext(ctx);
  });

  describe('GET /api/sessions/:sessionId/timeline/stream', () => {
    it('should return 404 for non-existent session', async () => {
      const response = await fetch(`${baseUrl}/api/sessions/non-existent-id/timeline/stream`, {
        headers: { 'Cookie': authCookie },
      });
      expect(response.status).toBe(404);
    });

    it('should connect and receive snapshot event with empty events for new session', async () => {
      const result = await readSnapshotFromStream(`${baseUrl}/api/sessions/${sessionId}/timeline/stream`, authCookie);

      expect(result.response.status).toBe(200);
      expect(result.response.headers.get('content-type')).toBe('text/event-stream');
      expect(result.response.headers.get('cache-control')).toBe('no-cache');

      expect(result.snapshotData.type).toBe('snapshot');
      expect(Array.isArray(result.snapshotData.events)).toBe(true);
      expect(result.snapshotData.events).toHaveLength(0);
      expect(result.snapshotData.timestamp).toBeDefined();
    });

    it('should receive snapshot with timeline events after seeding data', async () => {
      const turn: TurnTranscript = {
        turnId: 'turn-stream-001',
        sessionId,
        userId: 'test-user',
        input: {
          userMessageSummary: 'Test message for stream',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-stream-001', role: 'assistant', content: 'Test response' },
          ],
        },
        visibility: 'public',
        createdAt: '2026-04-29T20:00:00.000Z',
      };
      ctx.apiContext.stores.transcriptStore.saveTurn(turn);

      const result = await readSnapshotFromStream(`${baseUrl}/api/sessions/${sessionId}/timeline/stream`, authCookie);

      expect(result.response.status).toBe(200);
      expect(result.snapshotData.type).toBe('snapshot');
      expect(result.snapshotData.events).toHaveLength(2);
      expect(result.snapshotData.events[0].eventType).toBe('user_message');
      expect(result.snapshotData.events[1].eventType).toBe('assistant_message');
    });

    it('should skip events with after parameter', async () => {
      const newSessionResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const newSessionBody = await newSessionResponse.json() as { data: { session: { sessionId: string } } };
      const newSessionId = newSessionBody.data.session.sessionId;

      const turn: TurnTranscript = {
        turnId: 'turn-after-001',
        sessionId: newSessionId,
        userId: 'test-user',
        input: {
          userMessageSummary: 'First message',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-after-001', role: 'assistant', content: 'First response' },
            { messageId: 'msg-after-002', role: 'assistant', content: 'Second response' },
          ],
        },
        visibility: 'public',
        createdAt: '2026-04-29T21:00:00.000Z',
      };
      ctx.apiContext.stores.transcriptStore.saveTurn(turn);

      const resultWithoutAfter = await readSnapshotFromStream(`${baseUrl}/api/sessions/${newSessionId}/timeline/stream`, authCookie);
      expect(resultWithoutAfter.snapshotData.events).toHaveLength(3);

      const firstEventId = resultWithoutAfter.snapshotData.events[0].eventId;

      const resultWithAfter = await readSnapshotFromStream(`${baseUrl}/api/sessions/${newSessionId}/timeline/stream?after=${firstEventId}`, authCookie);
      expect(resultWithAfter.snapshotData.events).toHaveLength(2);
      expect(resultWithAfter.snapshotData.events[0].eventType).toBe('assistant_message');
      expect(resultWithAfter.snapshotData.events[1].eventType).toBe('assistant_message');
    });

    it('should return all events when after cursor not found', async () => {
      const newSessionResponse = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': authCookie },
        body: JSON.stringify({})
      });
      const newSessionBody = await newSessionResponse.json() as { data: { session: { sessionId: string } } };
      const newSessionId = newSessionBody.data.session.sessionId;

      const turn: TurnTranscript = {
        turnId: 'turn-notfound-001',
        sessionId: newSessionId,
        userId: 'test-user',
        input: {
          userMessageSummary: 'Test for not found cursor',
        },
        output: {
          visibleMessages: [
            { messageId: 'msg-notfound-001', role: 'assistant', content: 'Response' },
          ],
        },
        visibility: 'public',
        createdAt: '2026-04-29T22:00:00.000Z',
      };
      ctx.apiContext.stores.transcriptStore.saveTurn(turn);

      const result = await readSnapshotFromStream(`${baseUrl}/api/sessions/${newSessionId}/timeline/stream?after=non-existent-event-id`, authCookie);
      expect(result.snapshotData.events).toHaveLength(2);
    });
  });
});
