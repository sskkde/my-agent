import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createE2EHarness, type E2EHarness } from './test-harness.js';

describe('Flow 1: Ordinary Chat', () => {
  let harness: E2EHarness;

  beforeEach(() => {
    harness = createE2EHarness();
  });

  afterEach(() => {
    harness.close();
  });

  it('should process simple chat message without creating PlannerRun or ToolCall', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'Hello, how are you?';

    await harness.sendMessage(userId, sessionId, message);

    const transcripts = harness.stores.transcriptStore.findBySession(sessionId);
    expect(transcripts.length).toBeGreaterThan(0);
  });

  it('should return response for ordinary chat message', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'What is the weather like?';

    const result = await harness.sendMessage(userId, sessionId, message);

    expect(result.foregroundDecision.route).toBe('answer_directly');
    expect(result.foregroundDecision.requiresPlanner).toBe(false);
    expect(result.foregroundDecision.userVisibleResponse).toBeDefined();
    expect(result.foregroundDecision.userVisibleResponse?.length).toBeGreaterThan(0);
  });

  it('should create TranscriptRecord for chat message', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'Tell me a joke';

    await harness.sendMessage(userId, sessionId, message);

    const transcripts = harness.stores.transcriptStore.findBySession(sessionId);
    expect(transcripts.length).toBeGreaterThan(0);

    const latestTranscript = transcripts[transcripts.length - 1];
    expect(latestTranscript).toBeDefined();
    expect(latestTranscript.sessionId).toBe(sessionId);
    expect(latestTranscript.userId).toBe(userId);
  });

  it('should NOT create PlannerRun for ordinary chat', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'What day is it today?';

    const result = await harness.sendMessage(userId, sessionId, message);

    expect(result.foregroundDecision.requiresPlanner).toBe(false);
    expect(result.foregroundDecision.route).not.toBe('spawn_planner');
  });

  it('should NOT create RuntimeAction for ordinary chat', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'Good morning!';

    await harness.sendMessage(userId, sessionId, message);

    const actions = harness.stores.runtimeActionStore.query({ userId });
    const chatRelatedActions = actions.filter(a =>
      a.sessionId === sessionId &&
      a.targetAction !== 'gateway.inbound_received'
    );

    expect(chatRelatedActions.length).toBe(0);
  });

  it('should NOT create ToolExecution for ordinary chat', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'Nice to meet you';

    const result = await harness.sendMessage(userId, sessionId, message);

    expect(result.toolExecutions.length).toBe(0);
  });

  it('should create Gateway events for chat flow', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'How does this work?';

    await harness.sendMessage(userId, sessionId, message);

    const events = harness.stores.eventStore.query({ sessionId });
    const inboundEvents = events.filter(e =>
      (e as { eventType: string }).eventType === 'gateway_inbound_received'
    );

    expect(inboundEvents.length).toBeGreaterThan(0);
  });

  it('should generate outbound envelope with text response', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';
    const message = 'Can you help me?';

    const result = await harness.sendMessage(userId, sessionId, message);

    expect(result.outboundEnvelopes.length).toBeGreaterThan(0);

    const textEnvelopes = result.outboundEnvelopes.filter(e => e.messageType === 'text');
    expect(textEnvelopes.length).toBeGreaterThan(0);

    const lastEnvelope = textEnvelopes[textEnvelopes.length - 1];
    expect(lastEnvelope.content.text).toBeDefined();
    expect(lastEnvelope.recipient.userId).toBe(userId);
    expect(lastEnvelope.recipient.sessionId).toBe(sessionId);
  });

  it('should maintain session isolation between different sessions', async () => {
    const userId = 'user_001';
    const sessionId1 = 'sess_001';
    const sessionId2 = 'sess_002';

    await harness.sendMessage(userId, sessionId1, 'Message in session 1');
    await harness.sendMessage(userId, sessionId2, 'Message in session 2');

    const transcripts1 = harness.stores.transcriptStore.findBySession(sessionId1);
    const transcripts2 = harness.stores.transcriptStore.findBySession(sessionId2);

    expect(transcripts1.length).toBeGreaterThan(0);
    expect(transcripts2.length).toBeGreaterThan(0);

    for (const t of transcripts1) {
      expect(t.sessionId).toBe(sessionId1);
    }

    for (const t of transcripts2) {
      expect(t.sessionId).toBe(sessionId2);
    }
  });

  it('should handle multiple chat messages in same session', async () => {
    const userId = 'user_001';
    const sessionId = 'sess_001';

    await harness.sendMessage(userId, sessionId, 'First message');
    await harness.sendMessage(userId, sessionId, 'Second message');
    await harness.sendMessage(userId, sessionId, 'Third message');

    const transcripts = harness.stores.transcriptStore.findBySession(sessionId);
    expect(transcripts.length).toBeGreaterThanOrEqual(3);
  });
});
