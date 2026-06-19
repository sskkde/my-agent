import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js'
import { createMigrationRunner, type MigrationRunner } from '../../../src/storage/migrations.js'
import type { Migration } from '../../../src/storage/migrations.js'
import {
  KERNEL_RUN_STATES,
  TOOL_EXECUTION_STATES,
  BACKGROUND_SUBAGENT_STATES,
  WORKFLOW_RUN_STATES,
} from '../../../src/shared/states.js'
import type {
  KernelRunState,
  ToolExecutionState,
  BackgroundSubagentState,
  WorkflowRunState,
} from '../../../src/shared/states.js'

// Runtime store imports - these will fail initially
import { createKernelRunStore, type KernelRunStore } from '../../../src/storage/kernel-run-store.js'
import { createToolExecutionStore, type ToolExecutionStore } from '../../../src/storage/tool-execution-store.js'
import { createBackgroundRunStore, type BackgroundRunStore } from '../../../src/storage/background-run-store.js'
import { createWorkflowRunStore, type WorkflowRunStore } from '../../../src/storage/workflow-run-store.js'

// Migrations for runtime tables
const runtimeMigrations: Migration[] = [
  {
    version: 1,
    name: 'create_kernel_runs_table',
    up: `
      CREATE TABLE kernel_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT,
        agent_id TEXT NOT NULL,
        invocation_source TEXT NOT NULL,
        status TEXT NOT NULL,
        checkpoint_data TEXT,
        final_result TEXT,
        metrics TEXT,
        event_start INTEGER,
        event_end INTEGER,
        parent_run_id TEXT,
        root_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_kernel_runs_session_created ON kernel_runs(session_id, created_at);
      CREATE INDEX idx_kernel_runs_agent ON kernel_runs(agent_id);
      CREATE INDEX idx_kernel_runs_invocation ON kernel_runs(invocation_source);
      CREATE INDEX idx_kernel_runs_status ON kernel_runs(status);
      CREATE INDEX idx_kernel_runs_parent ON kernel_runs(parent_run_id);
      CREATE INDEX idx_kernel_runs_root ON kernel_runs(root_run_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_kernel_runs_root;
      DROP INDEX IF EXISTS idx_kernel_runs_parent;
      DROP INDEX IF EXISTS idx_kernel_runs_status;
      DROP INDEX IF EXISTS idx_kernel_runs_invocation;
      DROP INDEX IF EXISTS idx_kernel_runs_agent;
      DROP INDEX IF EXISTS idx_kernel_runs_session_created;
      DROP TABLE IF EXISTS kernel_runs;
    `,
  },
  {
    version: 2,
    name: 'create_tool_executions_table',
    up: `
      CREATE TABLE tool_executions (
        tool_call_id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        user_id TEXT NOT NULL,
        session_id TEXT,
        kernel_run_id TEXT,
        status TEXT NOT NULL,
        params TEXT,
        result_preview TEXT,
        result_ref TEXT,
        structured_content TEXT,
        sensitivity TEXT NOT NULL DEFAULT 'low',
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        terminal_state_reached INTEGER NOT NULL DEFAULT 0,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_tool_exec_name_time ON tool_executions(tool_name, started_at);
      CREATE INDEX idx_tool_exec_session_time ON tool_executions(session_id, started_at);
      CREATE INDEX idx_tool_exec_sensitivity ON tool_executions(sensitivity);
      CREATE INDEX idx_tool_exec_kernel ON tool_executions(kernel_run_id);
      CREATE INDEX idx_tool_exec_status ON tool_executions(status);
    `,
    down: `
      DROP INDEX IF EXISTS idx_tool_exec_status;
      DROP INDEX IF EXISTS idx_tool_exec_kernel;
      DROP INDEX IF EXISTS idx_tool_exec_sensitivity;
      DROP INDEX IF EXISTS idx_tool_exec_session_time;
      DROP INDEX IF EXISTS idx_tool_exec_name_time;
      DROP TABLE IF EXISTS tool_executions;
    `,
  },
  {
    version: 3,
    name: 'create_background_runs_table',
    up: `
      CREATE TABLE background_runs (
        background_run_id TEXT PRIMARY KEY,
        subagent_run_id TEXT,
        user_id TEXT NOT NULL,
        session_id TEXT,
        agent_type TEXT NOT NULL,
        agent_profile TEXT,
        status TEXT NOT NULL,
        launch_source TEXT NOT NULL,
        checkpoint_data TEXT,
        recovery_point TEXT,
        result_data TEXT,
        error_message TEXT,
        priority INTEGER DEFAULT 0,
        scheduled_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        expires_at TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_bg_runs_user_status ON background_runs(user_id, status);
      CREATE INDEX idx_bg_runs_session_status ON background_runs(session_id, status);
      CREATE INDEX idx_bg_runs_subagent ON background_runs(subagent_run_id);
      CREATE INDEX idx_bg_runs_launch ON background_runs(launch_source);
      CREATE INDEX idx_bg_runs_updated ON background_runs(updated_at);
    `,
    down: `
      DROP INDEX IF EXISTS idx_bg_runs_updated;
      DROP INDEX IF EXISTS idx_bg_runs_launch;
      DROP INDEX IF EXISTS idx_bg_runs_subagent;
      DROP INDEX IF EXISTS idx_bg_runs_session_status;
      DROP INDEX IF EXISTS idx_bg_runs_user_status;
      DROP TABLE IF EXISTS background_runs;
    `,
  },
  {
    version: 4,
    name: 'create_workflow_runs_table',
    up: `
      CREATE TABLE workflow_runs (
        workflow_run_id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        trigger_event_id TEXT,
        status TEXT NOT NULL,
        current_step_ids TEXT,
        input_data TEXT,
        output_data TEXT,
        context_data TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default'
      );
      CREATE INDEX idx_wf_runs_workflow_time ON workflow_runs(workflow_id, started_at);
      CREATE INDEX idx_wf_runs_owner_status ON workflow_runs(owner_user_id, status);
      CREATE INDEX idx_wf_runs_trigger ON workflow_runs(trigger_event_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_wf_runs_trigger;
      DROP INDEX IF EXISTS idx_wf_runs_owner_status;
      DROP INDEX IF EXISTS idx_wf_runs_workflow_time;
      DROP TABLE IF EXISTS workflow_runs;
    `,
  },
  {
    version: 5,
    name: 'create_workflow_step_runs_table',
    up: `
      CREATE TABLE workflow_step_runs (
        step_run_id TEXT PRIMARY KEY,
        workflow_run_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        step_type TEXT NOT NULL,
        status TEXT NOT NULL,
        kernel_run_id TEXT,
        subagent_run_id TEXT,
        tool_call_id TEXT,
        approval_id TEXT,
        input_data TEXT,
        output_data TEXT,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'org_default',
        FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(workflow_run_id)
      );
      CREATE INDEX idx_wf_step_run_wf_status ON workflow_step_runs(workflow_run_id, status);
      CREATE INDEX idx_wf_step_run_step ON workflow_step_runs(step_id);
      CREATE INDEX idx_wf_step_run_kernel ON workflow_step_runs(kernel_run_id);
      CREATE INDEX idx_wf_step_run_subagent ON workflow_step_runs(subagent_run_id);
      CREATE INDEX idx_wf_step_run_tool ON workflow_step_runs(tool_call_id);
      CREATE INDEX idx_wf_step_run_approval ON workflow_step_runs(approval_id);
    `,
    down: `
      DROP INDEX IF EXISTS idx_wf_step_run_approval;
      DROP INDEX IF EXISTS idx_wf_step_run_tool;
      DROP INDEX IF EXISTS idx_wf_step_run_subagent;
      DROP INDEX IF EXISTS idx_wf_step_run_kernel;
      DROP INDEX IF EXISTS idx_wf_step_run_step;
      DROP INDEX IF EXISTS idx_wf_step_run_wf_status;
      DROP TABLE IF EXISTS workflow_step_runs;
    `,
  },
]

describe('Runtime Stores', () => {
  let connection: ConnectionManager
  let migrations: MigrationRunner
  let kernelStore: KernelRunStore
  let toolStore: ToolExecutionStore
  let bgStore: BackgroundRunStore
  let wfStore: WorkflowRunStore

  beforeEach(() => {
    connection = createConnectionManager(':memory:')
    connection.open()
    migrations = createMigrationRunner(connection)
    migrations.init()
    migrations.apply(runtimeMigrations)

    kernelStore = createKernelRunStore(connection)
    toolStore = createToolExecutionStore(connection)
    bgStore = createBackgroundRunStore(connection)
    wfStore = createWorkflowRunStore(connection)
  })

  afterEach(() => {
    connection?.close()
  })

  describe('Migrations', () => {
    it('should create all runtime tables with correct versions', () => {
      const version = migrations.getCurrentVersion()
      expect(version).toBe(5)

      const tables = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master 
        WHERE type = 'table' 
        AND name IN ('kernel_runs', 'tool_executions', 'background_runs', 'workflow_runs', 'workflow_step_runs')
      `)

      const tableNames = tables.map((t) => t.name)
      expect(tableNames).toContain('kernel_runs')
      expect(tableNames).toContain('tool_executions')
      expect(tableNames).toContain('background_runs')
      expect(tableNames).toContain('workflow_runs')
      expect(tableNames).toContain('workflow_step_runs')
    })

    it('should create all required indexes', () => {
      const indexes = connection.query<{ name: string }>(`
        SELECT name FROM sqlite_master WHERE type = 'index'
      `)

      const indexNames = indexes.map((i) => i.name)

      // Kernel run indexes
      expect(indexNames).toContain('idx_kernel_runs_session_created')
      expect(indexNames).toContain('idx_kernel_runs_agent')
      expect(indexNames).toContain('idx_kernel_runs_invocation')
      expect(indexNames).toContain('idx_kernel_runs_status')
      expect(indexNames).toContain('idx_kernel_runs_parent')
      expect(indexNames).toContain('idx_kernel_runs_root')

      // Tool execution indexes
      expect(indexNames).toContain('idx_tool_exec_name_time')
      expect(indexNames).toContain('idx_tool_exec_session_time')
      expect(indexNames).toContain('idx_tool_exec_sensitivity')
      expect(indexNames).toContain('idx_tool_exec_kernel')
      expect(indexNames).toContain('idx_tool_exec_status')

      // Background run indexes
      expect(indexNames).toContain('idx_bg_runs_user_status')
      expect(indexNames).toContain('idx_bg_runs_session_status')
      expect(indexNames).toContain('idx_bg_runs_subagent')
      expect(indexNames).toContain('idx_bg_runs_launch')
      expect(indexNames).toContain('idx_bg_runs_updated')

      // Workflow run indexes
      expect(indexNames).toContain('idx_wf_runs_workflow_time')
      expect(indexNames).toContain('idx_wf_runs_owner_status')
      expect(indexNames).toContain('idx_wf_runs_trigger')

      // Workflow step run indexes
      expect(indexNames).toContain('idx_wf_step_run_wf_status')
      expect(indexNames).toContain('idx_wf_step_run_step')
      expect(indexNames).toContain('idx_wf_step_run_kernel')
      expect(indexNames).toContain('idx_wf_step_run_subagent')
      expect(indexNames).toContain('idx_wf_step_run_tool')
      expect(indexNames).toContain('idx_wf_step_run_approval')
    })
  })

  describe('KernelRun Store', () => {
    it('should create and retrieve a kernel run', () => {
      const runId = 'kernel-run-001'
      const kernelRun = {
        runId,
        sessionId: 'session-001',
        agentId: 'agent-001',
        invocationSource: 'foreground',
        status: KERNEL_RUN_STATES.INITIALIZING as KernelRunState,
        checkpointData: { iteration: 0 },
        metrics: { tokensUsed: 0 },
        eventStart: 1,
        eventEnd: 10,
      }

      kernelStore.create(kernelRun)

      const retrieved = kernelStore.getById(runId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.runId).toBe(runId)
      expect(retrieved?.agentId).toBe('agent-001')
      expect(retrieved?.status).toBe(KERNEL_RUN_STATES.INITIALIZING)
    })

    it('should update kernel run status', () => {
      const runId = 'kernel-run-002'
      kernelStore.create({
        runId,
        sessionId: 'session-002',
        agentId: 'agent-002',
        invocationSource: 'planner',
        status: KERNEL_RUN_STATES.INITIALIZING,
      })

      kernelStore.updateStatus(runId, KERNEL_RUN_STATES.SAMPLING_MODEL)

      const retrieved = kernelStore.getById(runId)
      expect(retrieved?.status).toBe(KERNEL_RUN_STATES.SAMPLING_MODEL)
    })

    it('should save and retrieve checkpoint data', () => {
      const runId = 'kernel-run-003'
      const checkpoint = {
        iteration: 5,
        contextWindow: { messages: [] },
        toolCalls: [],
      }

      kernelStore.create({
        runId,
        agentId: 'agent-003',
        invocationSource: 'direct',
        status: KERNEL_RUN_STATES.BUILDING_CONTEXT,
      })

      kernelStore.saveCheckpoint(runId, checkpoint)

      const retrieved = kernelStore.getById(runId)
      expect(retrieved?.checkpointData).toEqual(checkpoint)
    })

    it('should save final result', () => {
      const runId = 'kernel-run-004'
      const finalResult = {
        success: true,
        output: 'Task completed successfully',
        metrics: { totalTokens: 1000 },
      }

      kernelStore.create({
        runId,
        agentId: 'agent-004',
        invocationSource: 'workflow',
        status: KERNEL_RUN_STATES.PARSING_MODEL_OUTPUT,
      })

      kernelStore.saveFinalResult(runId, finalResult)
      kernelStore.updateStatus(runId, KERNEL_RUN_STATES.COMPLETED)

      const retrieved = kernelStore.getById(runId)
      expect(retrieved?.finalResult).toEqual(finalResult)
      expect(retrieved?.status).toBe(KERNEL_RUN_STATES.COMPLETED)
    })

    it('should query by session and created time', () => {
      const sessionId = 'session-005'

      kernelStore.create({
        runId: 'run-001',
        sessionId,
        agentId: 'agent-001',
        invocationSource: 'foreground',
        status: KERNEL_RUN_STATES.COMPLETED,
      })

      kernelStore.create({
        runId: 'run-002',
        sessionId,
        agentId: 'agent-002',
        invocationSource: 'planner',
        status: KERNEL_RUN_STATES.COMPLETED,
      })

      const results = kernelStore.getBySession(sessionId)
      expect(results).toHaveLength(2)
    })

    it('should query by agent ID', () => {
      kernelStore.create({
        runId: 'run-003',
        agentId: 'agent-specific',
        invocationSource: 'direct',
        status: KERNEL_RUN_STATES.COMPLETED,
      })

      kernelStore.create({
        runId: 'run-004',
        agentId: 'agent-specific',
        invocationSource: 'direct',
        status: KERNEL_RUN_STATES.FAILED,
      })

      const results = kernelStore.getByAgentId('agent-specific')
      expect(results).toHaveLength(2)
    })

    it('should query by status', () => {
      kernelStore.create({
        runId: 'run-005',
        agentId: 'agent-001',
        invocationSource: 'direct',
        status: KERNEL_RUN_STATES.COMPLETED,
      })

      kernelStore.create({
        runId: 'run-006',
        agentId: 'agent-001',
        invocationSource: 'direct',
        status: KERNEL_RUN_STATES.FAILED,
      })

      const completed = kernelStore.getByStatus(KERNEL_RUN_STATES.COMPLETED)
      expect(completed).toHaveLength(1)
      expect(completed[0]?.runId).toBe('run-005')
    })

    it('should query by parent run ID', () => {
      kernelStore.create({
        runId: 'parent-run',
        agentId: 'agent-001',
        invocationSource: 'direct',
        status: KERNEL_RUN_STATES.COMPLETED,
      })

      kernelStore.create({
        runId: 'child-run-1',
        agentId: 'agent-001',
        invocationSource: 'subagent',
        status: KERNEL_RUN_STATES.COMPLETED,
        parentRunId: 'parent-run',
      })

      kernelStore.create({
        runId: 'child-run-2',
        agentId: 'agent-001',
        invocationSource: 'subagent',
        status: KERNEL_RUN_STATES.COMPLETED,
        parentRunId: 'parent-run',
      })

      const children = kernelStore.getByParentRunId('parent-run')
      expect(children).toHaveLength(2)
    })
  })

  describe('ToolExecution Store', () => {
    it('should create and retrieve tool execution', () => {
      const toolCallId = 'tool-call-001'
      const toolExec = {
        toolCallId,
        toolName: 'read_file',
        userId: 'user-001',
        sessionId: 'session-001',
        kernelRunId: 'kernel-001',
        status: TOOL_EXECUTION_STATES.RECEIVED as ToolExecutionState,
        params: { filePath: '/tmp/test.txt' },
        sensitivity: 'low' as const,
      }

      toolStore.create(toolExec)

      const retrieved = toolStore.getById(toolCallId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.toolName).toBe('read_file')
      expect(retrieved?.status).toBe(TOOL_EXECUTION_STATES.RECEIVED)
    })

    it('should update status through lifecycle', () => {
      const toolCallId = 'tool-call-002'
      toolStore.create({
        toolCallId,
        toolName: 'write_file',
        userId: 'user-002',
        status: TOOL_EXECUTION_STATES.RECEIVED,
        sensitivity: 'low',
      })

      toolStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.SCHEMA_VALIDATING)
      expect(toolStore.getById(toolCallId)?.status).toBe(TOOL_EXECUTION_STATES.SCHEMA_VALIDATING)

      toolStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.EXECUTING)
      expect(toolStore.getById(toolCallId)?.status).toBe(TOOL_EXECUTION_STATES.EXECUTING)

      toolStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.COMPLETED)
      expect(toolStore.getById(toolCallId)?.status).toBe(TOOL_EXECUTION_STATES.COMPLETED)
    })

    it('should enforce terminal state constraint - tool must reach terminal state', () => {
      const toolCallId = 'tool-call-003'
      toolStore.create({
        toolCallId,
        toolName: 'api_call',
        userId: 'user-003',
        kernelRunId: 'kernel-003',
        status: TOOL_EXECUTION_STATES.EXECUTING,
        sensitivity: 'low',
      })

      // Terminal states: completed, failed, denied, aborted, cancelled, discarded, timeout
      const nonTerminalStates = [
        TOOL_EXECUTION_STATES.RECEIVED,
        TOOL_EXECUTION_STATES.SCHEMA_VALIDATING,
        TOOL_EXECUTION_STATES.PERMISSION_CHECKING,
        TOOL_EXECUTION_STATES.WAITING_FOR_APPROVAL,
        TOOL_EXECUTION_STATES.EXECUTING,
        TOOL_EXECUTION_STATES.MAPPING_RESULT,
      ]

      // Verify that non-terminal states do not set terminal_state_reached
      for (const state of nonTerminalStates) {
        toolStore.updateStatus(toolCallId, state)
        const retrieved = toolStore.getById(toolCallId)
        expect(retrieved?.terminalStateReached).toBe(false)
      }

      // Terminal state should set terminal_state_reached
      toolStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.COMPLETED)
      const completed = toolStore.getById(toolCallId)
      expect(completed?.terminalStateReached).toBe(true)
      expect(completed?.completedAt).toBeDefined()
    })

    it('should store tool result with preview and ref', () => {
      const toolCallId = 'tool-call-004'
      toolStore.create({
        toolCallId,
        toolName: 'search_files',
        userId: 'user-004',
        status: TOOL_EXECUTION_STATES.EXECUTING,
        sensitivity: 'low',
      })

      const result = {
        preview: 'Found 5 matches...',
        resultRef: 'blob://results/search-004',
        structuredContent: { count: 5, files: [] },
      }

      toolStore.saveResult(toolCallId, result)
      toolStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.COMPLETED)

      const retrieved = toolStore.getById(toolCallId)
      expect(retrieved?.resultPreview).toBe(result.preview)
      expect(retrieved?.resultRef).toBe(result.resultRef)
      expect(retrieved?.structuredContent).toEqual(result.structuredContent)
    })

    it('should query by tool name and time', () => {
      toolStore.create({
        toolCallId: 'tc-001',
        toolName: 'read_file',
        userId: 'user-001',
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'low',
      })

      toolStore.create({
        toolCallId: 'tc-002',
        toolName: 'read_file',
        userId: 'user-001',
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'low',
      })

      toolStore.create({
        toolCallId: 'tc-003',
        toolName: 'write_file',
        userId: 'user-001',
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'low',
      })

      const readFiles = toolStore.getByToolName('read_file')
      expect(readFiles).toHaveLength(2)
    })

    it('should query by session', () => {
      const sessionId = 'session-tool-test'
      toolStore.create({
        toolCallId: 'tc-s1',
        toolName: 'read_file',
        userId: 'user-001',
        sessionId,
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'low',
      })

      toolStore.create({
        toolCallId: 'tc-s2',
        toolName: 'write_file',
        userId: 'user-001',
        sessionId,
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'low',
      })

      const results = toolStore.getBySession(sessionId)
      expect(results).toHaveLength(2)
    })

    it('should query by sensitivity level', () => {
      toolStore.create({
        toolCallId: 'tc-low',
        toolName: 'read_file',
        userId: 'user-001',
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'low',
      })

      toolStore.create({
        toolCallId: 'tc-high',
        toolName: 'execute_command',
        userId: 'user-001',
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'high',
      })

      const highSensitivity = toolStore.getBySensitivity('high')
      expect(highSensitivity).toHaveLength(1)
      expect(highSensitivity[0]?.toolCallId).toBe('tc-high')
    })

    it('should get pending tools for kernel run', () => {
      const kernelRunId = 'kernel-pending-test'

      toolStore.create({
        toolCallId: 'tc-pending-1',
        toolName: 'api_call',
        userId: 'user-001',
        kernelRunId,
        status: TOOL_EXECUTION_STATES.EXECUTING,
        sensitivity: 'low',
      })

      toolStore.create({
        toolCallId: 'tc-pending-2',
        toolName: 'db_query',
        userId: 'user-001',
        kernelRunId,
        status: TOOL_EXECUTION_STATES.WAITING_FOR_APPROVAL,
        sensitivity: 'low',
      })

      toolStore.create({
        toolCallId: 'tc-completed',
        toolName: 'read_file',
        userId: 'user-001',
        kernelRunId,
        status: TOOL_EXECUTION_STATES.COMPLETED,
        sensitivity: 'low',
      })

      const pending = toolStore.getPendingByKernelRunId(kernelRunId)
      expect(pending).toHaveLength(2)
    })

    it('should not allow accepted tool without terminal state', () => {
      const toolCallId = 'tc-terminal-test'
      toolStore.create({
        toolCallId,
        toolName: 'dangerous_op',
        userId: 'user-001',
        kernelRunId: 'kernel-terminal-test',
        status: TOOL_EXECUTION_STATES.EXECUTING,
        sensitivity: 'high',
      })

      // Verify terminal state tracking
      const beforeTerminal = toolStore.getById(toolCallId)
      expect(beforeTerminal?.terminalStateReached).toBe(false)

      // Complete the tool
      toolStore.updateStatus(toolCallId, TOOL_EXECUTION_STATES.COMPLETED)

      const afterTerminal = toolStore.getById(toolCallId)
      expect(afterTerminal?.terminalStateReached).toBe(true)
      expect(afterTerminal?.completedAt).toBeDefined()
    })
  })

  describe('BackgroundRun Store', () => {
    it('should create and retrieve background run', () => {
      const bgRunId = 'bg-run-001'
      const bgRun = {
        backgroundRunId: bgRunId,
        subagentRunId: 'subagent-001',
        userId: 'user-001',
        sessionId: 'session-001',
        agentType: 'analyzer',
        status: BACKGROUND_SUBAGENT_STATES.QUEUED as BackgroundSubagentState,
        launchSource: 'planner',
      }

      bgStore.create(bgRun)

      const retrieved = bgStore.getById(bgRunId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.agentType).toBe('analyzer')
      expect(retrieved?.status).toBe(BACKGROUND_SUBAGENT_STATES.QUEUED)
    })

    it('should update status through full lifecycle', () => {
      const bgRunId = 'bg-run-002'
      bgStore.create({
        backgroundRunId: bgRunId,
        userId: 'user-002',
        agentType: 'processor',
        status: BACKGROUND_SUBAGENT_STATES.QUEUED,
        launchSource: 'trigger',
      })

      bgStore.updateStatus(bgRunId, BACKGROUND_SUBAGENT_STATES.RUNNING)
      expect(bgStore.getById(bgRunId)?.status).toBe(BACKGROUND_SUBAGENT_STATES.RUNNING)

      bgStore.updateStatus(bgRunId, BACKGROUND_SUBAGENT_STATES.WAITING_FOR_APPROVAL)
      expect(bgStore.getById(bgRunId)?.status).toBe(BACKGROUND_SUBAGENT_STATES.WAITING_FOR_APPROVAL)

      bgStore.updateStatus(bgRunId, BACKGROUND_SUBAGENT_STATES.SLEEPING)
      expect(bgStore.getById(bgRunId)?.status).toBe(BACKGROUND_SUBAGENT_STATES.SLEEPING)

      bgStore.updateStatus(bgRunId, BACKGROUND_SUBAGENT_STATES.COMPLETED)
      expect(bgStore.getById(bgRunId)?.status).toBe(BACKGROUND_SUBAGENT_STATES.COMPLETED)
    })

    it('should persist and recover checkpoint state', () => {
      const bgRunId = 'bg-run-003'
      const checkpoint = {
        currentStep: 3,
        accumulatedResults: [{ step: 1, result: 'done' }],
        metadata: { progress: 0.5 },
      }

      bgStore.create({
        backgroundRunId: bgRunId,
        userId: 'user-003',
        agentType: 'long_runner',
        status: BACKGROUND_SUBAGENT_STATES.RUNNING,
        launchSource: 'scheduler',
      })

      bgStore.saveCheckpoint(bgRunId, checkpoint)

      const retrieved = bgStore.getById(bgRunId)
      expect(retrieved?.checkpointData).toEqual(checkpoint)
      expect(retrieved?.recoveryPoint).toBeDefined()
    })

    it('should query by user and status', () => {
      bgStore.create({
        backgroundRunId: 'bg-user-1',
        userId: 'user-specific',
        agentType: 'analyzer',
        status: BACKGROUND_SUBAGENT_STATES.RUNNING,
        launchSource: 'api',
      })

      bgStore.create({
        backgroundRunId: 'bg-user-2',
        userId: 'user-specific',
        agentType: 'processor',
        status: BACKGROUND_SUBAGENT_STATES.QUEUED,
        launchSource: 'api',
      })

      const userRunning = bgStore.getByUserAndStatus('user-specific', BACKGROUND_SUBAGENT_STATES.RUNNING)
      expect(userRunning).toHaveLength(1)
      expect(userRunning[0]?.backgroundRunId).toBe('bg-user-1')

      const userQueued = bgStore.getByUserAndStatus('user-specific', BACKGROUND_SUBAGENT_STATES.QUEUED)
      expect(userQueued).toHaveLength(1)
      expect(userQueued[0]?.backgroundRunId).toBe('bg-user-2')
    })

    it('should query by session and status', () => {
      const sessionId = 'session-bg-test'

      bgStore.create({
        backgroundRunId: 'bg-sess-1',
        userId: 'user-001',
        sessionId,
        agentType: 'analyzer',
        status: BACKGROUND_SUBAGENT_STATES.COMPLETED,
        launchSource: 'workflow',
      })

      bgStore.create({
        backgroundRunId: 'bg-sess-2',
        userId: 'user-001',
        sessionId,
        agentType: 'processor',
        status: BACKGROUND_SUBAGENT_STATES.FAILED,
        launchSource: 'workflow',
      })

      const sessionCompleted = bgStore.getBySessionAndStatus(sessionId, BACKGROUND_SUBAGENT_STATES.COMPLETED)
      expect(sessionCompleted).toHaveLength(1)
    })

    it('should query by subagent run ID', () => {
      const subagentRunId = 'subagent-link'

      bgStore.create({
        backgroundRunId: 'bg-sub-1',
        subagentRunId,
        userId: 'user-001',
        agentType: 'analyzer',
        status: BACKGROUND_SUBAGENT_STATES.RUNNING,
        launchSource: 'planner',
      })

      const bySubagent = bgStore.getBySubagentRunId(subagentRunId)
      expect(bySubagent).toHaveLength(1)
      expect(bySubagent[0]?.backgroundRunId).toBe('bg-sub-1')
    })

    it('should support recovery state tracking', () => {
      const bgRunId = 'bg-recovery-test'
      bgStore.create({
        backgroundRunId: bgRunId,
        userId: 'user-001',
        agentType: 'resilient_runner',
        status: BACKGROUND_SUBAGENT_STATES.RUNNING,
        launchSource: 'api',
      })

      // Simulate failure and recovery
      bgStore.updateStatus(bgRunId, BACKGROUND_SUBAGENT_STATES.RECOVERING)
      bgStore.incrementRetryCount(bgRunId)

      const recovering = bgStore.getById(bgRunId)
      expect(recovering?.status).toBe(BACKGROUND_SUBAGENT_STATES.RECOVERING)
      expect(recovering?.retryCount).toBe(1)

      // Save recovery point
      const recoveryPoint = { lastSuccessfulStep: 2, state: 'checkpoint_v2' }
      bgStore.saveRecoveryPoint(bgRunId, recoveryPoint)

      const withRecovery = bgStore.getById(bgRunId)
      expect(withRecovery?.recoveryPoint).toEqual(recoveryPoint)
    })

    it('should track expiration for background runs', () => {
      const bgRunId = 'bg-expire-test'
      const expiresAt = new Date(Date.now() + 3600000).toISOString() // 1 hour from now

      bgStore.create({
        backgroundRunId: bgRunId,
        userId: 'user-001',
        agentType: 'temp_runner',
        status: BACKGROUND_SUBAGENT_STATES.QUEUED,
        launchSource: 'scheduler',
        expiresAt,
      })

      const retrieved = bgStore.getById(bgRunId)
      expect(retrieved?.expiresAt).toBe(expiresAt)
    })

    it('should query by launch source', () => {
      bgStore.create({
        backgroundRunId: 'bg-launch-1',
        userId: 'user-001',
        agentType: 'analyzer',
        status: BACKGROUND_SUBAGENT_STATES.COMPLETED,
        launchSource: 'planner',
      })

      bgStore.create({
        backgroundRunId: 'bg-launch-2',
        userId: 'user-002',
        agentType: 'processor',
        status: BACKGROUND_SUBAGENT_STATES.COMPLETED,
        launchSource: 'planner',
      })

      bgStore.create({
        backgroundRunId: 'bg-launch-3',
        userId: 'user-003',
        agentType: 'analyzer',
        status: BACKGROUND_SUBAGENT_STATES.COMPLETED,
        launchSource: 'trigger',
      })

      const plannerRuns = bgStore.getByLaunchSource('planner')
      expect(plannerRuns).toHaveLength(2)
    })
  })

  describe('WorkflowRun Store', () => {
    it('should create and retrieve workflow run', () => {
      const wfRunId = 'wf-run-001'
      const wfRun = {
        workflowRunId: wfRunId,
        workflowId: 'workflow-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        triggerEventId: 'event-001',
        status: WORKFLOW_RUN_STATES.QUEUED as WorkflowRunState,
        inputData: { param1: 'value1' },
      }

      wfStore.createWorkflowRun(wfRun)

      const retrieved = wfStore.getWorkflowRunById(wfRunId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.workflowId).toBe('workflow-001')
      expect(retrieved?.status).toBe(WORKFLOW_RUN_STATES.QUEUED)
    })

    it('should update workflow status', () => {
      const wfRunId = 'wf-run-002'
      wfStore.createWorkflowRun({
        workflowRunId: wfRunId,
        workflowId: 'workflow-002',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-002',
        status: WORKFLOW_RUN_STATES.QUEUED,
      })

      wfStore.updateWorkflowStatus(wfRunId, WORKFLOW_RUN_STATES.RUNNING)
      expect(wfStore.getWorkflowRunById(wfRunId)?.status).toBe(WORKFLOW_RUN_STATES.RUNNING)

      wfStore.updateWorkflowStatus(wfRunId, WORKFLOW_RUN_STATES.COMPLETED)
      expect(wfStore.getWorkflowRunById(wfRunId)?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED)
    })

    it('should track current step IDs', () => {
      const wfRunId = 'wf-run-003'
      wfStore.createWorkflowRun({
        workflowRunId: wfRunId,
        workflowId: 'workflow-003',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-003',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.updateCurrentSteps(wfRunId, ['step-001', 'step-002'])

      const retrieved = wfStore.getWorkflowRunById(wfRunId)
      expect(retrieved?.currentStepIds).toEqual(['step-001', 'step-002'])
    })

    it('should save workflow output', () => {
      const wfRunId = 'wf-run-004'
      wfStore.createWorkflowRun({
        workflowRunId: wfRunId,
        workflowId: 'workflow-004',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-004',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const output = { result: 'success', data: { count: 42 } }
      wfStore.saveWorkflowOutput(wfRunId, output)
      wfStore.updateWorkflowStatus(wfRunId, WORKFLOW_RUN_STATES.COMPLETED)

      const retrieved = wfStore.getWorkflowRunById(wfRunId)
      expect(retrieved?.outputData).toEqual(output)
      expect(retrieved?.completedAt).toBeDefined()
    })

    it('should query by workflow and time', () => {
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-time-1',
        workflowId: 'workflow-time-test',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.COMPLETED,
      })

      wfStore.createWorkflowRun({
        workflowRunId: 'wf-time-2',
        workflowId: 'workflow-time-test',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.COMPLETED,
      })

      const byWorkflow = wfStore.getWorkflowRunsByWorkflow('workflow-time-test')
      expect(byWorkflow).toHaveLength(2)
    })

    it('should query by owner and status', () => {
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-owner-1',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'owner-specific',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.createWorkflowRun({
        workflowRunId: 'wf-owner-2',
        workflowId: 'wf-002',
        workflowVersion: '1.0.0',
        ownerUserId: 'owner-specific',
        status: WORKFLOW_RUN_STATES.COMPLETED,
      })

      const ownerRunning = wfStore.getWorkflowRunsByOwnerAndStatus('owner-specific', WORKFLOW_RUN_STATES.RUNNING)
      expect(ownerRunning).toHaveLength(1)
      expect(ownerRunning[0]?.workflowRunId).toBe('wf-owner-1')
    })

    it('should query by trigger event', () => {
      const triggerEventId = 'trigger-event-001'
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-trigger-1',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        triggerEventId,
        status: WORKFLOW_RUN_STATES.COMPLETED,
      })

      const byTrigger = wfStore.getWorkflowRunsByTrigger(triggerEventId)
      expect(byTrigger).toHaveLength(1)
      expect(byTrigger[0]?.workflowRunId).toBe('wf-trigger-1')
    })
  })

  describe('WorkflowStepRun Store', () => {
    it('should create and retrieve workflow step run', () => {
      // First create workflow run
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-parent',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const stepRunId = 'step-run-001'
      const stepRun = {
        stepRunId,
        workflowRunId: 'wf-parent',
        stepId: 'step-001',
        stepType: 'agent_run' as const,
        status: WORKFLOW_RUN_STATES.QUEUED as WorkflowRunState,
        inputData: { prompt: 'Hello' },
      }

      wfStore.createStepRun(stepRun)

      const retrieved = wfStore.getStepRunById(stepRunId)
      expect(retrieved).not.toBeNull()
      expect(retrieved?.stepId).toBe('step-001')
      expect(retrieved?.stepType).toBe('agent_run')
    })

    it('should update step status', () => {
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-step-status',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const stepRunId = 'step-run-002'
      wfStore.createStepRun({
        stepRunId,
        workflowRunId: 'wf-step-status',
        stepId: 'step-002',
        stepType: 'tool_call',
        status: WORKFLOW_RUN_STATES.QUEUED,
      })

      wfStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.RUNNING)
      expect(wfStore.getStepRunById(stepRunId)?.status).toBe(WORKFLOW_RUN_STATES.RUNNING)

      wfStore.updateStepStatus(stepRunId, WORKFLOW_RUN_STATES.COMPLETED)
      expect(wfStore.getStepRunById(stepRunId)?.status).toBe(WORKFLOW_RUN_STATES.COMPLETED)
    })

    it('should link step to kernel run', () => {
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-kernel-link',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const stepRunId = 'step-run-003'
      wfStore.createStepRun({
        stepRunId,
        workflowRunId: 'wf-kernel-link',
        stepId: 'step-003',
        stepType: 'agent_run',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.linkStepToKernelRun(stepRunId, 'kernel-123')

      const retrieved = wfStore.getStepRunById(stepRunId)
      expect(retrieved?.kernelRunId).toBe('kernel-123')
    })

    it('should link step to subagent run', () => {
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-subagent-link',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const stepRunId = 'step-run-004'
      wfStore.createStepRun({
        stepRunId,
        workflowRunId: 'wf-subagent-link',
        stepId: 'step-004',
        stepType: 'subagent_run',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.linkStepToSubagentRun(stepRunId, 'subagent-456')

      const retrieved = wfStore.getStepRunById(stepRunId)
      expect(retrieved?.subagentRunId).toBe('subagent-456')
    })

    it('should link step to tool call', () => {
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-tool-link',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const stepRunId = 'step-run-005'
      wfStore.createStepRun({
        stepRunId,
        workflowRunId: 'wf-tool-link',
        stepId: 'step-005',
        stepType: 'tool_call',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.linkStepToToolCall(stepRunId, 'tool-call-789')

      const retrieved = wfStore.getStepRunById(stepRunId)
      expect(retrieved?.toolCallId).toBe('tool-call-789')
    })

    it('should link step to approval', () => {
      wfStore.createWorkflowRun({
        workflowRunId: 'wf-approval-link',
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const stepRunId = 'step-run-006'
      wfStore.createStepRun({
        stepRunId,
        workflowRunId: 'wf-approval-link',
        stepId: 'step-006',
        stepType: 'approval',
        status: WORKFLOW_RUN_STATES.WAITING_FOR_APPROVAL,
      })

      wfStore.linkStepToApproval(stepRunId, 'approval-abc')

      const retrieved = wfStore.getStepRunById(stepRunId)
      expect(retrieved?.approvalId).toBe('approval-abc')
    })

    it('should query steps by workflow and status', () => {
      const wfRunId = 'wf-steps-query'
      wfStore.createWorkflowRun({
        workflowRunId: wfRunId,
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.createStepRun({
        stepRunId: 'step-q1',
        workflowRunId: wfRunId,
        stepId: 'step-001',
        stepType: 'agent_run',
        status: WORKFLOW_RUN_STATES.COMPLETED,
      })

      wfStore.createStepRun({
        stepRunId: 'step-q2',
        workflowRunId: wfRunId,
        stepId: 'step-002',
        stepType: 'tool_call',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.createStepRun({
        stepRunId: 'step-q3',
        workflowRunId: wfRunId,
        stepId: 'step-003',
        stepType: 'agent_run',
        status: WORKFLOW_RUN_STATES.FAILED,
      })

      const completed = wfStore.getStepsByWorkflowAndStatus(wfRunId, WORKFLOW_RUN_STATES.COMPLETED)
      expect(completed).toHaveLength(1)
      expect(completed[0]?.stepRunId).toBe('step-q1')
    })

    it('should query steps by step ID', () => {
      const wfRunId = 'wf-step-id-query'
      wfStore.createWorkflowRun({
        workflowRunId: wfRunId,
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      wfStore.createStepRun({
        stepRunId: 'step-sid-1',
        workflowRunId: wfRunId,
        stepId: 'common-step',
        stepType: 'agent_run',
        status: WORKFLOW_RUN_STATES.COMPLETED,
      })

      wfStore.createStepRun({
        stepRunId: 'step-sid-2',
        workflowRunId: wfRunId,
        stepId: 'common-step',
        stepType: 'agent_run',
        status: WORKFLOW_RUN_STATES.COMPLETED,
      })

      const byStepId = wfStore.getStepsByStepId('common-step')
      expect(byStepId).toHaveLength(2)
    })

    it('should support all step types', () => {
      const wfRunId = 'wf-step-types'
      wfStore.createWorkflowRun({
        workflowRunId: wfRunId,
        workflowId: 'wf-001',
        workflowVersion: '1.0.0',
        ownerUserId: 'user-001',
        status: WORKFLOW_RUN_STATES.RUNNING,
      })

      const stepTypes = ['agent_run', 'subagent_run', 'tool_call', 'approval', 'wait', 'condition'] as const

      stepTypes.forEach((type, idx) => {
        wfStore.createStepRun({
          stepRunId: `step-type-${idx}`,
          workflowRunId: wfRunId,
          stepId: `step-${type}`,
          stepType: type,
          status: WORKFLOW_RUN_STATES.QUEUED,
        })
      })

      const allSteps = wfStore.getStepsByWorkflowRunId(wfRunId)
      expect(allSteps).toHaveLength(6)
    })
  })
})
