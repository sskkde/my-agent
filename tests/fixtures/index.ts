import { TestClock } from '../helpers/clock.js'
import { IdGenerator } from '../helpers/ids.js'

// Types based on storage model documentation
export interface UserFixture {
  userId: string
  displayName: string
  email: string
  createdAt: string
  updatedAt?: string
}

export interface SessionFixture {
  sessionId: string
  userId: string
  status: 'active' | 'inactive' | 'closed'
  createdAt: string
  updatedAt?: string
}

export interface TranscriptFixture {
  turnId: string
  sessionId: string
  userId: string
  input: {
    inboundEventId?: string
    userMessageSummary?: string
    contentRefs?: string[]
  }
  output: {
    visibleMessages: Array<{
      messageId: string
      role: 'assistant' | 'system_status'
      content: string
    }>
    artifactRefs?: string[]
  }
  runtimeSummary?: {
    foregroundDecisionId?: string
    plannerRunIds?: string[]
    runtimeActionIds?: string[]
    toolCallSummaries?: string[]
    approvalSummaries?: string[]
  }
  eventRange?: {
    startEventId: string
    endEventId: string
  }
  createdAt: string
}

export interface PlanStep {
  stepId: string
  description: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  dependencies?: string[]
}

export interface PlanFixture {
  planId: string
  userId: string
  sessionId?: string
  objective: string
  status:
    | 'draft'
    | 'approved'
    | 'in_execution'
    | 'blocked'
    | 'waiting_for_user'
    | 'waiting_for_approval'
    | 'replanning'
    | 'completed'
    | 'failed'
    | 'abandoned'
  currentVersion: number
  plannerRunIds?: string[]
  steps: PlanStep[]
  constraints?: string[]
  assumptions?: string[]
  createdAt: string
  updatedAt: string
}

export interface ToolResultFixture {
  resultRef: string
  toolCallId: string
  toolName: string
  userId: string
  sessionId?: string
  preview?: string
  rawBlobRef?: string
  structuredContent?: Record<string, unknown>
  sensitivity: 'low' | 'medium' | 'high' | 'restricted'
  createdAt: string
}

export interface ApprovalFixture {
  approvalId: string
  userId: string
  sessionId?: string
  status: 'pending' | 'approved' | 'rejected' | 'expired'
  sourceContext: {
    planId?: string
    workflowRunId?: string
    backgroundRunId?: string
  }
  expiresAt?: string
  createdAt: string
}

export interface BackgroundRunFixture {
  backgroundRunId: string
  userId: string
  sessionId?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  launchSource: string
  subagentRunId?: string
  createdAt: string
  updatedAt?: string
}

// TestFixture class that coordinates clock and ID generation
export class TestFixture {
  constructor(
    private clock: TestClock,
    private idGen: IdGenerator,
  ) {}

  createUser(overrides?: Partial<UserFixture>): UserFixture {
    const now = this.clock.nowISO()
    return {
      userId: this.idGen.user(),
      displayName: 'Test User',
      email: 'test@example.com',
      createdAt: now,
      ...overrides,
    }
  }

  createSession(overrides?: Partial<SessionFixture>): SessionFixture {
    const now = this.clock.nowISO()
    return {
      sessionId: this.idGen.session(),
      userId: this.idGen.user(),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    }
  }

  createTranscript(overrides?: Partial<TranscriptFixture>): TranscriptFixture {
    const now = this.clock.nowISO()
    return {
      turnId: this.idGen.transcript(),
      sessionId: 'sess_001',
      userId: 'user_001',
      input: {
        userMessageSummary: 'Default test message',
      },
      output: {
        visibleMessages: [
          {
            messageId: 'msg_001',
            role: 'assistant',
            content: 'Test response',
          },
        ],
      },
      createdAt: now,
      ...overrides,
    }
  }

  createPlan(overrides?: Partial<PlanFixture>): PlanFixture {
    const now = this.clock.nowISO()
    return {
      planId: this.idGen.plan(),
      userId: 'user_001',
      objective: 'Default test objective',
      status: 'draft',
      currentVersion: 1,
      steps: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    }
  }

  createToolResult(overrides?: Partial<ToolResultFixture>): ToolResultFixture {
    const now = this.clock.nowISO()
    return {
      resultRef: this.idGen.toolResult(),
      toolCallId: 'call_001',
      toolName: 'defaultTool',
      userId: 'user_001',
      sensitivity: 'low',
      createdAt: now,
      ...overrides,
    }
  }

  createApproval(overrides?: Partial<ApprovalFixture>): ApprovalFixture {
    const now = this.clock.nowISO()
    return {
      approvalId: this.idGen.approval(),
      userId: 'user_001',
      status: 'pending',
      sourceContext: {},
      createdAt: now,
      ...overrides,
    }
  }

  createBackgroundRun(overrides?: Partial<BackgroundRunFixture>): BackgroundRunFixture {
    const now = this.clock.nowISO()
    return {
      backgroundRunId: this.idGen.backgroundRun(),
      userId: 'user_001',
      status: 'running',
      launchSource: 'test',
      createdAt: now,
      ...overrides,
    }
  }
}

// Standalone fixture functions for exact ID control
export function createUserFixture(overrides: Partial<UserFixture> & { userId: string }): UserFixture {
  const now = new Date().toISOString()
  return {
    displayName: 'Test User',
    email: 'test@example.com',
    createdAt: now,
    ...overrides,
  }
}

export function createSessionFixture(
  overrides: Partial<SessionFixture> & { sessionId: string; userId: string },
): SessionFixture {
  const now = new Date().toISOString()
  return {
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createTranscriptFixture(
  overrides: Partial<TranscriptFixture> & { turnId: string; sessionId: string; userId: string },
): TranscriptFixture {
  const now = new Date().toISOString()
  return {
    input: {
      userMessageSummary: 'Default test message',
    },
    output: {
      visibleMessages: [
        {
          messageId: 'msg_001',
          role: 'assistant',
          content: 'Test response',
        },
      ],
    },
    createdAt: now,
    ...overrides,
  }
}

export function createPlanFixture(overrides: Partial<PlanFixture> & { planId: string; userId: string }): PlanFixture {
  const now = new Date().toISOString()
  return {
    sessionId: undefined,
    objective: 'Default test objective',
    status: 'draft',
    currentVersion: 1,
    steps: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function createToolResultFixture(
  overrides: Partial<ToolResultFixture> & { resultRef: string; toolCallId: string; toolName: string },
): ToolResultFixture {
  const now = new Date().toISOString()
  return {
    userId: 'user_001',
    sessionId: undefined,
    sensitivity: 'low',
    createdAt: now,
    ...overrides,
  }
}

export function createApprovalFixture(
  overrides: Partial<ApprovalFixture> & { approvalId: string; userId: string },
): ApprovalFixture {
  const now = new Date().toISOString()
  return {
    sessionId: undefined,
    status: 'pending',
    sourceContext: {},
    createdAt: now,
    ...overrides,
  }
}

export function createBackgroundRunFixture(
  overrides: Partial<BackgroundRunFixture> & { backgroundRunId: string; userId: string },
): BackgroundRunFixture {
  const now = new Date().toISOString()
  return {
    sessionId: undefined,
    status: 'running',
    launchSource: 'test',
    createdAt: now,
    ...overrides,
  }
}
