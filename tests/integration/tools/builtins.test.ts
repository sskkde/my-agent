/**
 * Integration tests for built-in safe tools
 * Following TDD - write failing tests first, then implement
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ToolRegistry } from '../../../src/tools/types.js';
import { createToolRegistry } from '../../../src/tools/tool-registry.js';
import { registerBuiltInTools } from '../../../src/tools/builtins/index.js';
import type { ArtifactStore, Artifact } from '../../../src/storage/artifact-store.js';
import type { SummaryStore, SummaryRecord } from '../../../src/storage/summary-store.js';
import type { TranscriptStore, TurnTranscript } from '../../../src/storage/transcript-store.js';
import type { PlanStore, ExecutionPlanRecord, PlanPatch, PlanStep } from '../../../src/storage/plan-store.js';
import type { ToolResultStore, ToolResultBlob } from '../../../src/storage/tool-result-store.js';
import type { LongTermMemoryStore, LongTermMemoryRecord, LongTermMemoryPatch, MemoryType, TombstoneInput } from '../../../src/storage/long-term-memory-store.js';
import type { SessionStore, Session, CreateSessionInput, ListSessionsOptions, UpdateMetadataInput } from '../../../src/storage/session-store.js';
import type { PermissionContext } from '../../../src/permissions/types.js';

// Helper to create valid PermissionContext for tests
function createTestPermissionContext(): PermissionContext {
  return {
    userId: 'user_123',
    sessionId: 'session_123',
    mode: 'ask_on_write',
    grants: [],
  };
}

// Mock stores for testing
class MockArtifactStore implements ArtifactStore {
  private artifacts: Map<string, Artifact> = new Map();
  private artifactsByArtifactId: Map<string, Artifact> = new Map();

  create(data: Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>): Artifact {
    const artifact: Artifact = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.artifacts.set(artifact.id, artifact);
    this.artifactsByArtifactId.set(artifact.artifactId, artifact);
    return artifact;
  }

  findByArtifactId(artifactId: string): Artifact | undefined {
    return this.artifactsByArtifactId.get(artifactId);
  }

  findById(id: string): Artifact | undefined {
    return this.artifacts.get(id);
  }

  findByUserId(userId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.userId === userId);
  }

  findBySessionId(sessionId: string): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.sessionId === sessionId);
  }

  findByType(type: Artifact['artifactType']): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.artifactType === type);
  }

  findByStatus(status: Artifact['status']): Artifact[] {
    return Array.from(this.artifacts.values()).filter(a => a.status === status);
  }

  update(id: string, data: Partial<Omit<Artifact, 'id' | 'createdAt' | 'updatedAt'>>): Artifact | undefined {
    const existing = this.artifacts.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data, updatedAt: new Date().toISOString() };
    this.artifacts.set(id, updated);
    this.artifactsByArtifactId.set(updated.artifactId, updated);
    return updated;
  }

  delete(id: string): boolean {
    const artifact = this.artifacts.get(id);
    if (artifact) {
      this.artifactsByArtifactId.delete(artifact.artifactId);
    }
    return this.artifacts.delete(id);
  }

  applyMigrations(): void {}
}

class MockSummaryStore implements SummaryStore {
  private summaries: Map<string, SummaryRecord> = new Map();

  save(record: SummaryRecord): void {
    this.summaries.set(record.summaryId, record);
  }

  getBySummaryId(summaryId: string): SummaryRecord | null {
    return this.summaries.get(summaryId) ?? null;
  }

  getByType(summaryType: SummaryRecord['summaryType']): SummaryRecord[] {
    return Array.from(this.summaries.values()).filter(s => s.summaryType === summaryType);
  }

  getWorkingSummary(runId: string): SummaryRecord | null {
    return Array.from(this.summaries.values()).find(
      s => s.runId === runId && s.summaryType === 'working_summary'
    ) ?? null;
  }

  getSessionMemory(sessionId: string): SummaryRecord | null {
    return Array.from(this.summaries.values()).find(
      s => s.sessionId === sessionId && s.summaryType === 'session_memory'
    ) ?? null;
  }

  applyPatch(summaryId: string, patch: Partial<SummaryRecord>): SummaryRecord {
    const existing = this.summaries.get(summaryId);
    if (!existing) throw new Error(`Summary ${summaryId} not found`);
    const updated = { ...existing, ...patch, summaryId, createdAt: existing.createdAt, updatedAt: new Date().toISOString() };
    this.summaries.set(summaryId, updated);
    return updated;
  }
}

class MockTranscriptStore implements TranscriptStore {
  private transcripts: Map<string, TurnTranscript> = new Map();

  saveTurn(transcript: TurnTranscript): boolean {
    this.transcripts.set(transcript.turnId, transcript);
    return true;
  }

  getTurn(turnId: string): TurnTranscript | null {
    return this.transcripts.get(turnId) ?? null;
  }

  findBySession(sessionId: string): TurnTranscript[] {
    return Array.from(this.transcripts.values()).filter(t => t.sessionId === sessionId);
  }

  search(query: string): TurnTranscript[] {
    return Array.from(this.transcripts.values()).filter(t => 
      t.input.userMessageSummary?.includes(query) ||
      t.output.visibleMessages.some(m => m.content.includes(query))
    );
  }

  findByArtifactRef(): TurnTranscript[] {
    return [];
  }

  findByPlannerRunId(): TurnTranscript[] {
    return [];
  }

  updateUserIdForSession(): number {
    return 0;
  }
}

class MockPlanStore implements PlanStore {
  private plans: Map<string, ExecutionPlanRecord> = new Map();
  private patches: Map<string, PlanPatch[]> = new Map();

  createPlan(plan: ExecutionPlanRecord): ExecutionPlanRecord {
    this.plans.set(plan.planId, plan);
    return plan;
  }

  getPlan(planId: string): ExecutionPlanRecord | null {
    return this.plans.get(planId) ?? null;
  }

  applyPatch(patch: PlanPatch): ExecutionPlanRecord {
    const existing = this.plans.get(patch.planId);
    if (!existing) throw new Error(`Plan ${patch.planId} not found`);
    const patchData = JSON.parse(patch.patch);
    const updated = { 
      ...existing, 
      ...patchData, 
      currentVersion: patch.toVersion,
      updatedAt: new Date().toISOString() 
    };
    this.plans.set(patch.planId, updated);
    const existingPatches = this.patches.get(patch.planId) ?? [];
    existingPatches.push(patch);
    this.patches.set(patch.planId, existingPatches);
    return updated;
  }

  getPatches(planId: string): PlanPatch[] {
    return this.patches.get(planId) ?? [];
  }

  findByObjectiveHash(): ExecutionPlanRecord[] {
    return [];
  }

  updateStepStatus(planId: string, stepId: string, status: string): void {
    const plan = this.plans.get(planId);
    if (plan) {
      const step = plan.steps.find(s => s.stepId === stepId);
      if (step) step.status = status as PlanStep['status'];
    }
  }
}

class MockToolResultStore implements ToolResultStore {
  private results: Map<string, ToolResultBlob> = new Map();

  create(data: Omit<ToolResultBlob, 'id' | 'createdAt'>): ToolResultBlob {
    const result: ToolResultBlob = {
      id: crypto.randomUUID(),
      ...data,
      createdAt: new Date().toISOString(),
    };
    this.results.set(result.id, result);
    return result;
  }

  findById(id: string): ToolResultBlob | undefined {
    return this.results.get(id);
  }

  findByToolCallId(toolCallId: string): ToolResultBlob[] {
    return Array.from(this.results.values()).filter(r => r.toolCallId === toolCallId);
  }

  findBySessionId(sessionId: string): ToolResultBlob[] {
    return Array.from(this.results.values()).filter(r => r.sessionId === sessionId);
  }

  findByToolName(toolName: string): ToolResultBlob[] {
    return Array.from(this.results.values()).filter(r => r.toolName === toolName);
  }

  findBySensitivity(sensitivity: ToolResultBlob['sensitivity']): ToolResultBlob[] {
    return Array.from(this.results.values()).filter(r => r.sensitivity === sensitivity);
  }

  delete(id: string): boolean {
    return this.results.delete(id);
  }

  applyMigrations(): void {}
}

class MockLongTermMemoryStore implements LongTermMemoryStore {
  private memories: Map<string, LongTermMemoryRecord> = new Map();

  save(record: LongTermMemoryRecord): void {
    this.memories.set(record.memoryId, record);
  }

  getByMemoryId(memoryId: string): LongTermMemoryRecord | null {
    return this.memories.get(memoryId) ?? null;
  }

  getByUserId(userId: string): LongTermMemoryRecord[] {
    return Array.from(this.memories.values()).filter(
      m => m.userId === userId && m.lifecycle.status !== 'deleted'
    );
  }

  getByType(memoryType: MemoryType): LongTermMemoryRecord[] {
    return Array.from(this.memories.values()).filter(
      m => m.memoryType === memoryType && m.lifecycle.status !== 'deleted'
    );
  }

  search(query: string, userId: string, limit?: number): LongTermMemoryRecord[] {
    return this.getByUserId(userId)
      .filter(m => 
        m.content.text.toLowerCase().includes(query.toLowerCase()) ||
        m.retrieval.keywords.some(k => k.toLowerCase().includes(query.toLowerCase()))
      )
      .slice(0, limit ?? 10);
  }

  delete(memoryId: string): void {
    const existing = this.memories.get(memoryId);
    if (existing) {
      this.memories.set(memoryId, {
        ...existing,
        lifecycle: { ...existing.lifecycle, status: 'deleted' }
      });
    }
  }

  applyPatch(memoryId: string, patch: LongTermMemoryPatch): LongTermMemoryRecord {
    const existing = this.memories.get(memoryId);
    if (!existing) throw new Error(`Memory ${memoryId} not found`);
    const updated = { ...existing, ...patch, memoryId, userId: existing.userId };
    this.memories.set(memoryId, updated);
    return updated;
  }

  findCurrentByFingerprint(userId: string, fingerprint: string): LongTermMemoryRecord | null {
    return Array.from(this.memories.values()).find(
      m => m.userId === userId && m.fingerprint === fingerprint && m.lifecycle.status === 'active'
    ) ?? null;
  }

  upsertExtracted(record: LongTermMemoryRecord): void {
    this.save(record);
  }

  createTombstone(_input: TombstoneInput): void {
    // No-op for mock
  }

  hasTombstone(_userId: string, _fingerprint: string, _sourceWindowHash: string): boolean {
    return false;
  }

  searchActive(query: string, userId: string, limit: number): LongTermMemoryRecord[] {
    return this.getByUserId(userId)
      .filter(m => 
        m.lifecycle.status === 'active' &&
        (m.content.text.toLowerCase().includes(query.toLowerCase()) ||
         m.retrieval.keywords.some(k => k.toLowerCase().includes(query.toLowerCase())))
      )
      .slice(0, limit);
  }
}

class MockSessionStore implements SessionStore {
  private sessions: Map<string, Session> = new Map();

  create(input: CreateSessionInput): Session {
    const session: Session = {
      sessionId: input.sessionId,
      userId: input.userId,
      title: input.title,
      status: input.status ?? 'active',
      messageCount: input.messageCount ?? 0,
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    this.sessions.set(session.sessionId, session);
    return session;
  }

  getById(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null;
  }

  list(options?: ListSessionsOptions): Session[] {
    let result = Array.from(this.sessions.values());
    if (options?.userId) {
      result = result.filter(s => s.userId === options.userId);
    }
    if (options?.status) {
      result = result.filter(s => s.status === options.status);
    }
    return result;
  }

  updateActivity(sessionId: string, lastActivityAt: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivityAt = lastActivityAt;
      return true;
    }
    return false;
  }

  updateMetadata(sessionId: string, input: UpdateMetadataInput): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (input.messageCount !== undefined) {
        session.messageCount = input.messageCount;
      }
      if (input.lastActivityAt !== undefined) {
        session.lastActivityAt = input.lastActivityAt;
      }
      return true;
    }
    return false;
  }

  updateStatus(sessionId: string, status: 'active' | 'archived' | 'closed'): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      return true;
    }
    return false;
  }

  updateTitle(sessionId: string, title: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.title = title;
      return true;
    }
    return false;
  }

  updateUserId(sessionId: string, newUserId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.userId = newUserId;
      return true;
    }
    return false;
  }

  setModel(sessionId: string, selectedModel: string, selectedProviderId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.selectedModel = selectedModel;
      session.selectedProviderId = selectedProviderId;
      return true;
    }
    return false;
  }

  getCount(options?: { userId?: string; status?: 'active' | 'archived' | 'closed' }): number {
    let result = Array.from(this.sessions.values());
    if (options?.userId) {
      result = result.filter(s => s.userId === options.userId);
    }
    if (options?.status) {
      result = result.filter(s => s.status === options.status);
    }
    return result.length;
  }
}

describe('Built-in Safe Tools', () => {
  let registry: ToolRegistry;
  let artifactStore: MockArtifactStore;
  let summaryStore: MockSummaryStore;
  let transcriptStore: MockTranscriptStore;
  let planStore: MockPlanStore;
  let toolResultStore: MockToolResultStore;
  let longTermMemoryStore: MockLongTermMemoryStore;
  let sessionStore: MockSessionStore;

  beforeEach(() => {
    artifactStore = new MockArtifactStore();
    summaryStore = new MockSummaryStore();
    transcriptStore = new MockTranscriptStore();
    planStore = new MockPlanStore();
    toolResultStore = new MockToolResultStore();
    longTermMemoryStore = new MockLongTermMemoryStore();
    sessionStore = new MockSessionStore();
    
    registry = createToolRegistry();
    registerBuiltInTools(registry, {
      artifactStore,
      summaryStore,
      transcriptStore,
      planStore,
      longTermMemoryStore,
      toolResultStore,
      sessionStore,
    });
  });

  describe('artifact.create', () => {
    it('should create an artifact with artifactId prefixed with art_', async () => {
      const tool = registry.getTool('artifact.create');
      expect(tool).toBeDefined();

      const result = await tool!.handler!(
        { title: 'Test Document', content: 'Test content', artifactType: 'document' },
        {
          toolCallId: 'tc_123',
          toolName: 'artifact.create',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as Record<string, unknown>).artifactId).toMatch(/^art_/);
      expect(result.resultPreview).toContain('Created artifact');
    });

    it('should return error if title is missing', async () => {
      const tool = registry.getTool('artifact.create');
      
      const result = await tool!.handler!(
        { content: 'Test content' },
        {
          toolCallId: 'tc_123',
          toolName: 'artifact.create',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return error if content is missing', async () => {
      const tool = registry.getTool('artifact.create');
      
      const result = await tool!.handler!(
        { title: 'Test Document' },
        {
          toolCallId: 'tc_123',
          toolName: 'artifact.create',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('artifact.update', () => {
    it('should update an existing artifact', async () => {
      // First create an artifact
      const createTool = registry.getTool('artifact.create');
      const createResult = await createTool!.handler!(
        { title: 'Original Title', content: 'Original content', artifactType: 'document' },
        {
          toolCallId: 'tc_123',
          toolName: 'artifact.create',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(createResult.success).toBe(true);
      const artifactId = (createResult.data as Record<string, unknown>).artifactId;

      // Now update it
      const updateTool = registry.getTool('artifact.update');
      const updateResult = await updateTool!.handler!(
        { artifactId, title: 'Updated Title', content: 'Updated content' },
        {
          toolCallId: 'tc_124',
          toolName: 'artifact.update',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(updateResult.success).toBe(true);
      expect(updateResult.data).toBeDefined();
      expect((updateResult.data as Record<string, unknown>).artifactId).toBe(artifactId);
      expect((updateResult.data as Record<string, unknown>).name).toBe('Updated Title');
      expect(updateResult.resultPreview).toContain('Updated artifact');
    });

    it('should return error if artifact not found', async () => {
      const tool = registry.getTool('artifact.update');
      
      const result = await tool!.handler!(
        { artifactId: 'art_nonexistent', title: 'New Title', content: 'New content' },
        {
          toolCallId: 'tc_123',
          toolName: 'artifact.update',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('ARTIFACT_NOT_FOUND');
    });
  });

  describe('ask_user', () => {
    it('should return pending approval request', async () => {
      const tool = registry.getTool('ask_user');
      expect(tool).toBeDefined();

      const result = await tool!.handler!(
        { question: 'What is your preferred color?', context: 'For theme customization' },
        {
          toolCallId: 'tc_123',
          toolName: 'ask_user',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as Record<string, unknown>).status).toBe('pending_approval');
      expect((result.data as Record<string, unknown>).question).toBe('What is your preferred color?');
      expect(result.resultPreview).toContain('Awaiting user response');
    });

    it('should return error if question is missing', async () => {
      const tool = registry.getTool('ask_user');
      
      const result = await tool!.handler!(
        { context: 'Some context' },
        {
          toolCallId: 'tc_123',
          toolName: 'ask_user',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('status.query', () => {
    it('should query active work projection (stub)', async () => {
      const tool = registry.getTool('status.query');
      expect(tool).toBeDefined();

      const result = await tool!.handler!(
        {},
        {
          toolCallId: 'tc_123',
          toolName: 'status.query',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as Record<string, unknown>).activeWork).toBeDefined();
      expect(result.resultPreview).toContain('Active work status');
    });

    it('should accept optional targetId parameter', async () => {
      const tool = registry.getTool('status.query');
      
      const result = await tool!.handler!(
        { targetId: 'run_123' },
        {
          toolCallId: 'tc_123',
          toolName: 'status.query',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
  });

  describe('memory.retrieve', () => {
    it('should retrieve from memory store', async () => {
      // First save some memory
      const summaryRecord: SummaryRecord = {
        summaryId: 'mem_123',
        summaryType: 'session_memory',
        userId: 'user_123',
        sessionId: 'session_123',
        summary: 'User prefers dark mode',
        sourceRefs: { transcriptRefs: ['trans_1'] },
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      summaryStore.save(summaryRecord);

      const tool = registry.getTool('memory.retrieve');
      const result = await tool!.handler!(
        { sessionId: 'session_123', limit: 10 },
        {
          toolCallId: 'tc_123',
          toolName: 'memory.retrieve',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as Record<string, unknown>).memories).toBeInstanceOf(Array);
      expect(((result.data as Record<string, unknown>).memories as Array<unknown>).length).toBeGreaterThan(0);
      expect(result.resultPreview).toContain('Retrieved');
    });

    it('should return error if neither sessionId nor userId provided', async () => {
      const tool = registry.getTool('memory.retrieve');
      
      const result = await tool!.handler!(
        {},
        {
          toolCallId: 'tc_123',
          toolName: 'memory.retrieve',
          userId: '',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('MISSING_PARAMETERS');
    });
  });

  describe('transcript.search', () => {
    it('should search transcript store', async () => {
      // First save a transcript
      const transcript: TurnTranscript = {
        turnId: 'turn_123',
        sessionId: 'session_123',
        userId: 'user_123',
        input: { userMessageSummary: 'Testing search functionality' },
        output: { visibleMessages: [{ messageId: 'msg_1', role: 'assistant', content: 'I can help you search' }] },
        visibility: 'public',
        createdAt: new Date().toISOString(),
      };
      transcriptStore.saveTurn(transcript);

      const tool = registry.getTool('transcript.search');
      const result = await tool!.handler!(
        { query: 'search', sessionId: 'session_123' },
        {
          toolCallId: 'tc_123',
          toolName: 'transcript.search',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as Record<string, unknown>).results).toBeInstanceOf(Array);
      expect(((result.data as Record<string, unknown>).results as Array<unknown>).length).toBeGreaterThan(0);
      expect(result.resultPreview).toContain('Found');
    });

    it('should return error if query is missing', async () => {
      const tool = registry.getTool('transcript.search');
      
      const result = await tool!.handler!(
        { sessionId: 'session_123' },
        {
          toolCallId: 'tc_123',
          toolName: 'transcript.search',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('plan.patch', () => {
    it('should patch execution plan', async () => {
      // First create a plan
      const plan: ExecutionPlanRecord = {
        planId: 'plan_123',
        userId: 'user_123',
        sessionId: 'session_123',
        objective: 'Test objective',
        status: 'in_execution',
        currentVersion: 1,
        steps: [{ stepId: 'step_1', description: 'Step 1', status: 'pending' }],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      planStore.createPlan(plan);

      const tool = registry.getTool('plan.patch');
      const result = await tool!.handler!(
        { 
          planId: 'plan_123', 
          patch: JSON.stringify({ 
            steps: [{ stepId: 'step_1', description: 'Updated Step 1', status: 'in_progress' }]
          }),
          fromVersion: 1,
          toVersion: 2,
          createdAt: new Date().toISOString(),
        },
        {
          toolCallId: 'tc_123',
          toolName: 'plan.patch',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect((result.data as Record<string, unknown>).planId).toBe('plan_123');
      expect((result.data as Record<string, unknown>).currentVersion).toBe(2);
      expect(result.resultPreview).toContain('Patched plan');
    });

    it('should return error if planId is missing', async () => {
      const tool = registry.getTool('plan.patch');
      
      const result = await tool!.handler!(
        { patch: '{}' },
        {
          toolCallId: 'tc_123',
          toolName: 'plan.patch',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('docs.search (mock)', () => {
    it('should return preview for large results with persistedResultRef', async () => {
      const tool = registry.getTool('docs.search');
      expect(tool).toBeDefined();

      const result = await tool!.handler!(
        { query: 'typescript', limit: 100 },
        {
          toolCallId: 'tc_123',
          toolName: 'docs.search',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.resultPreview).toContain('Found');
      expect(result.resultRef).toBeDefined();
    });
  });

  describe('web.search', () => {
    it('should be registered as a built-in search tool', () => {
      const tool = registry.getTool('web.search');

      expect(tool).toBeDefined();
      expect(tool?.category).toBe('search');
      expect(tool?.sensitivity).toBe('medium');
    });

    it('should return recoverable error when search provider is not configured', async () => {
      const tool = registry.getTool('web.search');
      expect(tool).toBeDefined();

      const result = await tool!.handler(
        { query: 'latest TypeScript release' },
        {
          toolCallId: 'tc_web_search_123',
          toolName: 'web.search',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(result.error?.recoverable).toBe(true);
    });
  });

  describe('Large result handling', () => {
    it('should store large results in ToolResultStore and return preview + resultRef', async () => {
      const tool = registry.getTool('transcript.search');
      
      // Create many transcripts to trigger large result handling
      for (let i = 0; i < 1000; i++) {
        const transcript: TurnTranscript = {
          turnId: `turn_${i}`,
          sessionId: 'session_123',
          userId: 'user_123',
          input: { userMessageSummary: `Message ${i} with some content to make it larger ${'x'.repeat(500)}` },
          output: { visibleMessages: [{ messageId: `msg_${i}`, role: 'assistant', content: `Response ${i} ${'y'.repeat(500)}` }] },
          visibility: 'public',
          createdAt: new Date().toISOString(),
        };
        transcriptStore.saveTurn(transcript);
      }

      const result = await tool!.handler!(
        { query: 'content', sessionId: 'session_123' },
        {
          toolCallId: 'tc_123',
          toolName: 'transcript.search',
          userId: 'user_123',
          sessionId: 'session_123',
          permissionContext: createTestPermissionContext(),
          executionStartTime: new Date().toISOString(),
          stores: { toolExecutionStore: { updateStatus: () => {}, saveResult: () => {} } },
        }
      );

      expect(result.success).toBe(true);
      // Large results should have resultRef for fetching full results
      expect(result.resultRef).toBeDefined();
      expect(result.resultPreview).toContain('preview');
    });
  });
});
