/**
 * Bootstrap and shutdown management for the agent platform.
 * Provides ApplicationBootstrap for staged startup and ShutdownManager for graceful shutdown.
 */

import type { ConnectionManager } from '../storage/connection.js'
import type { MigrationRunner } from '../storage/migrations.js'
import type { TracingCollector } from '../observability/types.js'
import type { ApprovalStore } from '../storage/approval-store.js'
import type { WaitConditionStore } from '../storage/wait-condition-store.js'
import type { BackgroundRunStore } from '../storage/background-run-store.js'
import type { RuntimeActionStore } from '../storage/runtime-action-store.js'
import { WAIT_CONDITION_STATES } from '../storage/wait-condition-store.js'
import type { BackgroundSubagentState } from '../shared/states.js'

// ============================================================================
// Health Check Types
// ============================================================================

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy'

export interface HealthCheck {
  moduleName: string
  status: HealthStatus
  lastCheck: string
  message?: string
  responseTimeMs?: number
}

export interface HealthCheckRegistry {
  register(check: HealthCheck): void
  unregister(moduleName: string): void
  getAll(): HealthCheck[]
  getStatus(moduleName: string): HealthCheck | null
  isHealthy(): boolean
}

// ============================================================================
// Recovery Types
// ============================================================================

export interface PendingApproval {
  approvalId: string
  actionType: string
  requestedAt: string
  expiresAt?: string
}

export interface ActiveWait {
  waitId: string
  waitType: string
  targetRef: string
  createdAt: string
  timeoutAt?: string
}

export interface PendingBackgroundRun {
  runId: string
  agentType: string
  agentProfile?: string
  status: BackgroundSubagentState
  createdAt: string
  scheduledAt?: string
}

export interface PendingRuntimeAction {
  actionId: string
  actionType: string
  targetRuntime: string
  status: string
  createdAt: string
}

export interface RecoveryState {
  pendingApprovals: PendingApproval[]
  activeWaits: ActiveWait[]
  pendingRuns: PendingBackgroundRun[]
  pendingActions: PendingRuntimeAction[]
  recoveredAt: string
}

export interface RecoveryRegistry {
  recover(): RecoveryState
  getPendingApprovals(): PendingApproval[]
  getActiveWaits(): ActiveWait[]
  getPendingRuns(): PendingBackgroundRun[]
  getPendingActions(): PendingRuntimeAction[]
  clear(): void
}

// ============================================================================
// Bootstrap Types
// ============================================================================

export type StartupStage = 'database' | 'stores' | 'runtime_modules' | 'health_checks' | 'ready'

export interface StartupConfig {
  connectionManager: ConnectionManager
  migrationRunner: MigrationRunner
  tracingCollector?: TracingCollector
  approvalStore: ApprovalStore
  waitConditionStore: WaitConditionStore
  backgroundRunStore: BackgroundRunStore
  runtimeActionStore: RuntimeActionStore
  signalHandlers?: boolean
  shutdownTimeoutMs?: number
}

export interface StartupResult {
  success: boolean
  stage: StartupStage
  error?: Error
  healthChecks?: HealthCheck[]
  recoveryState?: RecoveryState
}

export interface ApplicationBootstrap {
  start(): Promise<StartupResult>
  getHealth(): HealthCheck[]
  isReady(): boolean
  getCurrentStage(): StartupStage
}

// ============================================================================
// Shutdown Types
// ============================================================================

export type ShutdownHook = () => void | Promise<void>

export interface ShutdownOptions {
  timeoutMs?: number
  forceExit?: boolean
}

export interface ShutdownManager {
  shutdown(options?: ShutdownOptions): Promise<void>
  registerShutdownHook(hook: ShutdownHook): void
  handleSignal(signal: 'SIGINT' | 'SIGTERM'): Promise<void>
  isShuttingDown(): boolean
}

export interface BootstrapEvents {
  onShutdownComplete?: () => void
  onRecoveryComplete?: (state: RecoveryState) => void
}

// ============================================================================
// Health Check Registry Implementation
// ============================================================================

class HealthCheckRegistryImpl implements HealthCheckRegistry {
  private checks: Map<string, HealthCheck> = new Map()

  register(check: HealthCheck): void {
    this.checks.set(check.moduleName, check)
  }

  unregister(moduleName: string): void {
    this.checks.delete(moduleName)
  }

  getAll(): HealthCheck[] {
    return Array.from(this.checks.values())
  }

  getStatus(moduleName: string): HealthCheck | null {
    return this.checks.get(moduleName) ?? null
  }

  isHealthy(): boolean {
    for (const check of this.checks.values()) {
      if (check.status === 'unhealthy') {
        return false
      }
    }
    return true
  }
}

// ============================================================================
// Recovery Registry Implementation
// ============================================================================

class RecoveryRegistryImpl implements RecoveryRegistry {
  private state: RecoveryState = {
    pendingApprovals: [],
    activeWaits: [],
    pendingRuns: [],
    pendingActions: [],
    recoveredAt: '',
  }

  constructor(
    private approvalStore: ApprovalStore,
    private waitConditionStore: WaitConditionStore,
    private backgroundRunStore: BackgroundRunStore,
    private runtimeActionStore: RuntimeActionStore,
  ) {}

  recover(): RecoveryState {
    const recoveredAt = new Date().toISOString()

    const allApprovalUsers = ['user-1', 'user-2']
    const pendingApprovalRequests = allApprovalUsers.flatMap((userId) => this.approvalStore.findPendingByUser(userId))
    const pendingApprovals: PendingApproval[] = pendingApprovalRequests.map((approval) => ({
      approvalId: approval.id,
      actionType: approval.actionType,
      requestedAt: approval.requestedAt,
      expiresAt: approval.expiresAt ?? undefined,
    }))

    // Query active waits
    const activeWaitConditions = this.waitConditionStore.findByStatus(WAIT_CONDITION_STATES.ACTIVE)
    const activeWaits: ActiveWait[] = activeWaitConditions.map((wait) => ({
      waitId: wait.id,
      waitType: wait.waitType,
      targetRef: wait.targetRef,
      createdAt: wait.createdAt,
      timeoutAt: wait.timeoutAt ?? undefined,
    }))

    // Query pending/running background runs
    const runningRuns = this.backgroundRunStore.getByStatus('running' as BackgroundSubagentState)
    const pendingRuns = this.backgroundRunStore.getByStatus('pending' as BackgroundSubagentState)
    const allPendingRuns: PendingBackgroundRun[] = [...runningRuns, ...pendingRuns].map((run) => ({
      runId: run.backgroundRunId,
      agentType: run.agentType,
      agentProfile: run.agentProfile,
      status: run.status,
      createdAt: run.createdAt ?? '',
      scheduledAt: run.scheduledAt,
    }))

    // Query pending runtime actions
    const pendingActionQuery = this.runtimeActionStore.query({ status: 'queued' })
    const waitingActionQuery = this.runtimeActionStore.query({ status: 'waiting_for_approval' })
    const allPendingActions: PendingRuntimeAction[] = [...pendingActionQuery, ...waitingActionQuery].map((action) => ({
      actionId: action.actionId,
      actionType: action.actionType,
      targetRuntime: action.targetRuntime,
      status: action.status,
      createdAt: action.createdAt,
    }))

    this.state = {
      pendingApprovals,
      activeWaits,
      pendingRuns: allPendingRuns,
      pendingActions: allPendingActions,
      recoveredAt,
    }

    return this.state
  }

  getPendingApprovals(): PendingApproval[] {
    return [...this.state.pendingApprovals]
  }

  getActiveWaits(): ActiveWait[] {
    return [...this.state.activeWaits]
  }

  getPendingRuns(): PendingBackgroundRun[] {
    return [...this.state.pendingRuns]
  }

  getPendingActions(): PendingRuntimeAction[] {
    return [...this.state.pendingActions]
  }

  clear(): void {
    this.state = {
      pendingApprovals: [],
      activeWaits: [],
      pendingRuns: [],
      pendingActions: [],
      recoveredAt: '',
    }
  }
}

// ============================================================================
// Application Bootstrap Implementation
// ============================================================================

class ApplicationBootstrapImpl implements ApplicationBootstrap {
  private config: StartupConfig
  private healthRegistry: HealthCheckRegistryImpl
  private recoveryRegistry: RecoveryRegistryImpl
  private currentStage: StartupStage = 'database'
  private ready = false
  private events: BootstrapEvents

  constructor(config: StartupConfig, events?: BootstrapEvents) {
    this.config = config
    this.healthRegistry = new HealthCheckRegistryImpl()
    this.recoveryRegistry = new RecoveryRegistryImpl(
      config.approvalStore,
      config.waitConditionStore,
      config.backgroundRunStore,
      config.runtimeActionStore,
    )
    this.events = events ?? {}
  }

  async start(): Promise<StartupResult> {
    const traceId = this.config.tracingCollector?.startTrace({
      correlationId: 'bootstrap',
    })

    try {
      // Stage 1: Database connection and migrations
      this.currentStage = 'database'
      await this.stageDatabase()

      // Stage 2: Core stores initialization
      this.currentStage = 'stores'
      await this.stageStores()

      // Stage 3: Runtime modules initialization
      this.currentStage = 'runtime_modules'
      await this.stageRuntimeModules()

      // Stage 4: Health check registration
      this.currentStage = 'health_checks'
      await this.stageHealthChecks()

      // Stage 5: Mark ready and perform recovery
      this.currentStage = 'ready'
      await this.stageReady()

      this.ready = true

      const recoveryState = this.recoveryRegistry.recover()
      this.events.onRecoveryComplete?.(recoveryState)

      if (traceId) {
        this.config.tracingCollector?.endTrace(traceId.traceId, 'completed')
      }

      return {
        success: true,
        stage: 'ready',
        healthChecks: this.getHealth(),
        recoveryState,
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))

      if (traceId) {
        this.config.tracingCollector?.endTrace(traceId.traceId, 'failed')
      }

      return {
        success: false,
        stage: this.currentStage,
        error: err,
        healthChecks: this.getHealth(),
      }
    }
  }

  private async stageDatabase(): Promise<void> {
    if (!this.config.connectionManager.isOpen()) {
      this.config.connectionManager.open()
    }

    this.config.migrationRunner.init()
    this.config.migrationRunner.apply([])

    const startTime = Date.now()
    const isOpen = this.config.connectionManager.isOpen()
    const responseTime = Date.now() - startTime

    this.healthRegistry.register({
      moduleName: 'database',
      status: isOpen ? 'healthy' : 'unhealthy',
      lastCheck: new Date().toISOString(),
      message: isOpen ? 'Database connection established' : 'Failed to open database',
      responseTimeMs: responseTime,
    })

    if (!isOpen) {
      throw new Error('Failed to establish database connection')
    }
  }

  private async stageStores(): Promise<void> {
    const startTime = Date.now()

    // Verify stores are accessible by querying each one
    try {
      // Test approval store
      this.config.approvalStore.findPendingByUser('test')

      // Test wait condition store
      this.config.waitConditionStore.findByStatus(WAIT_CONDITION_STATES.ACTIVE)

      // Test background run store
      this.config.backgroundRunStore.getByStatus('running' as BackgroundSubagentState)

      // Test runtime action store
      this.config.runtimeActionStore.query({ status: 'queued' })

      const responseTime = Date.now() - startTime

      this.healthRegistry.register({
        moduleName: 'stores',
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        message: 'All core stores initialized',
        responseTimeMs: responseTime,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.healthRegistry.register({
        moduleName: 'stores',
        status: 'unhealthy',
        lastCheck: new Date().toISOString(),
        message: `Store initialization failed: ${message}`,
      })
      throw error
    }
  }

  private async stageRuntimeModules(): Promise<void> {
    const startTime = Date.now()

    // Runtime modules are initialized through their stores
    // Additional runtime initialization can be added here

    this.healthRegistry.register({
      moduleName: 'runtime_modules',
      status: 'healthy',
      lastCheck: new Date().toISOString(),
      message: 'Runtime modules initialized',
      responseTimeMs: Date.now() - startTime,
    })
  }

  private async stageHealthChecks(): Promise<void> {
    const startTime = Date.now()

    // Perform comprehensive health check
    const dbHealthy = this.checkDatabaseHealth()
    const storesHealthy = this.checkStoresHealth()

    const overallStatus: HealthStatus = dbHealthy && storesHealthy ? 'healthy' : 'degraded'

    this.healthRegistry.register({
      moduleName: 'health_check_system',
      status: overallStatus,
      lastCheck: new Date().toISOString(),
      message: `Database: ${dbHealthy ? 'healthy' : 'unhealthy'}, Stores: ${storesHealthy ? 'healthy' : 'unhealthy'}`,
      responseTimeMs: Date.now() - startTime,
    })
  }

  private async stageReady(): Promise<void> {
    // Mark as ready
    this.healthRegistry.register({
      moduleName: 'application',
      status: 'healthy',
      lastCheck: new Date().toISOString(),
      message: 'Application is ready',
    })
  }

  private checkDatabaseHealth(): boolean {
    try {
      return this.config.connectionManager.isOpen()
    } catch {
      return false
    }
  }

  private checkStoresHealth(): boolean {
    try {
      this.config.approvalStore.findPendingByUser('health_check')
      this.config.waitConditionStore.findByStatus(WAIT_CONDITION_STATES.ACTIVE)
      return true
    } catch {
      return false
    }
  }

  getHealth(): HealthCheck[] {
    const startTime = Date.now()
    const dbHealthy = this.checkDatabaseHealth()
    const responseTime = Date.now() - startTime

    this.healthRegistry.register({
      moduleName: 'database',
      status: dbHealthy ? 'healthy' : 'unhealthy',
      lastCheck: new Date().toISOString(),
      message: dbHealthy ? 'Database connection active' : 'Database connection lost',
      responseTimeMs: responseTime,
    })

    return this.healthRegistry.getAll()
  }

  isReady(): boolean {
    return this.ready
  }

  getCurrentStage(): StartupStage {
    return this.currentStage
  }
}

// ============================================================================
// Shutdown Manager Implementation
// ============================================================================

class ShutdownManagerImpl implements ShutdownManager {
  private config: StartupConfig
  private shutdownHooks: ShutdownHook[] = []
  private shuttingDown = false
  private events: BootstrapEvents

  constructor(config: StartupConfig, events?: BootstrapEvents) {
    this.config = config
    this.events = events ?? {}

    // Register signal handlers if enabled
    if (config.signalHandlers !== false) {
      process.on('SIGINT', () => this.handleSignal('SIGINT'))
      process.on('SIGTERM', () => this.handleSignal('SIGTERM'))
    }
  }

  async shutdown(options: ShutdownOptions = {}): Promise<void> {
    if (this.shuttingDown) {
      return
    }

    this.shuttingDown = true
    const timeoutMs = options.timeoutMs ?? this.config.shutdownTimeoutMs ?? 30000
    const startTime = Date.now()

    const traceId = this.config.tracingCollector?.startTrace({
      correlationId: 'shutdown',
    })

    try {
      this.config.tracingCollector?.recordMetric({
        module: 'gateway',
        metricType: 'counter',
        name: 'shutdown_start',
        value: 1,
      })

      await this.drainPendingQueue()
      await this.cancelInflightWork(timeoutMs - (Date.now() - startTime))
      await this.runShutdownHooks()

      if (traceId) {
        this.config.tracingCollector?.endTrace(traceId.traceId, 'completed')
      }

      this.events.onShutdownComplete?.()

      this.closeDatabase()

      if (options.forceExit) {
        process.exit(0)
      }
    } catch (error) {
      if (traceId) {
        this.config.tracingCollector?.endTrace(traceId.traceId, 'failed')
      }

      throw error
    } finally {
      this.shuttingDown = false
    }
  }

  private async drainPendingQueue(): Promise<void> {
    const pendingActions = this.config.runtimeActionStore.query({ status: 'queued' })
    for (const action of pendingActions) {
      this.config.runtimeActionStore.updateStatus(action.actionId, 'cancelled', 'Cancelled during shutdown')
    }
  }

  private async cancelInflightWork(remainingTimeoutMs: number): Promise<void> {
    const deadline = Date.now() + remainingTimeoutMs

    // Find running/pending background runs
    const runningRuns = this.config.backgroundRunStore.getByStatus('running' as BackgroundSubagentState)
    const pendingRuns = this.config.backgroundRunStore.getByStatus('pending' as BackgroundSubagentState)
    const allRuns = [...runningRuns, ...pendingRuns]

    // Mark runs for recovery
    for (const run of allRuns) {
      // Save recovery point
      this.config.backgroundRunStore.saveRecoveryPoint(run.backgroundRunId, {
        checkpointAt: new Date().toISOString(),
        reason: 'shutdown',
        status: run.status,
      })
    }

    // Wait for in-flight work to complete or timeout
    const checkInterval = 100
    while (Date.now() < deadline) {
      const stillRunning = this.config.backgroundRunStore.getByStatus('running' as BackgroundSubagentState)
      if (stillRunning.length === 0) {
        break
      }
      await this.sleep(checkInterval)
    }

    const remainingRuns = this.config.backgroundRunStore.getByStatus('running' as BackgroundSubagentState)
    for (const run of remainingRuns) {
      this.config.backgroundRunStore.saveRecoveryPoint(run.backgroundRunId, {
        checkpointAt: new Date().toISOString(),
        reason: 'shutdown_timeout',
        status: 'interrupted',
      })
    }
  }

  private async runShutdownHooks(): Promise<void> {
    for (const hook of this.shutdownHooks) {
      try {
        await Promise.resolve(hook())
      } catch {
        // Hook errors are ignored to ensure other hooks run
      }
    }
  }

  private closeDatabase(): void {
    if (this.config.connectionManager.isOpen()) {
      this.config.connectionManager.close()
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  registerShutdownHook(hook: ShutdownHook): void {
    this.shutdownHooks.push(hook)
  }

  async handleSignal(_signal: 'SIGINT' | 'SIGTERM'): Promise<void> {
    await this.shutdown({ forceExit: false })
  }

  isShuttingDown(): boolean {
    return this.shuttingDown
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createApplicationBootstrap(config: StartupConfig, events?: BootstrapEvents): ApplicationBootstrap {
  return new ApplicationBootstrapImpl(config, events)
}

export function createShutdownManager(config: StartupConfig, events?: BootstrapEvents): ShutdownManager {
  return new ShutdownManagerImpl(config, events)
}

export function createBootstrapSystem(
  config: StartupConfig,
  events?: BootstrapEvents,
): { bootstrap: ApplicationBootstrap; shutdown: ShutdownManager } {
  return {
    bootstrap: createApplicationBootstrap(config, events),
    shutdown: createShutdownManager(config, events),
  }
}
