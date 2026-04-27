import { describe, it, expect } from 'vitest';
import { createConnectionManager, type ConnectionManager } from '../../../src/storage/connection.js';
import { createMigrationRunner } from '../../../src/storage/migrations.js';
import { createApprovalStore, type ApprovalStore } from '../../../src/storage/approval-store.js';
import { createWaitConditionStore, type WaitConditionStore } from '../../../src/storage/wait-condition-store.js';
import { createBackgroundRunStore, type BackgroundRunStore } from '../../../src/storage/background-run-store.js';
import { createRuntimeActionStore, type RuntimeActionStore } from '../../../src/storage/runtime-action-store.js';
import { createMetricStore } from '../../../src/observability/metric-store.js';
import { createTraceStore } from '../../../src/observability/trace-store.js';
import { createTracingCollector } from '../../../src/observability/tracing.js';

import {
  createApplicationBootstrap,
  createShutdownManager,
  createBootstrapSystem,
  type StartupConfig,
  type RecoveryState,
} from '../../../src/runtime/bootstrap.js';
import { allStoreMigrations } from '../../../src/storage/all-stores-migrations.js';

function createTestConfig(): {
  connection: ConnectionManager;
  config: StartupConfig;
  stores: {
    approvalStore: ApprovalStore;
    waitConditionStore: WaitConditionStore;
    backgroundRunStore: BackgroundRunStore;
    runtimeActionStore: RuntimeActionStore;
  };
} {
  const connection = createConnectionManager(':memory:');
  connection.open();
  const migrations = createMigrationRunner(connection);
  migrations.init();
  migrations.apply(allStoreMigrations);

  const approvalStore = createApprovalStore(connection);
  const waitConditionStore = createWaitConditionStore(connection);
  const backgroundRunStore = createBackgroundRunStore(connection);
  const runtimeActionStore = createRuntimeActionStore(connection);
  const metricStore = createMetricStore(connection);
  const traceStore = createTraceStore(connection);

  const tracingCollector = createTracingCollector({
    traceStore,
    metricStore,
    enabled: true,
    sampleRate: 1.0,
  });

  const config: StartupConfig = {
    connectionManager: connection,
    migrationRunner: migrations,
    tracingCollector,
    approvalStore,
    waitConditionStore,
    backgroundRunStore,
    runtimeActionStore,
    signalHandlers: false,
    shutdownTimeoutMs: 5000,
  };

  return {
    connection,
    config,
    stores: {
      approvalStore,
      waitConditionStore,
      backgroundRunStore,
      runtimeActionStore,
    },
  };
}

describe('Startup and Recovery Integration', () => {
  describe('ApplicationBootstrap', () => {
    it('should start with staged startup order', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);

      expect(bootstrap.getCurrentStage()).toBe('database');
      expect(bootstrap.isReady()).toBe(false);

      const result = await bootstrap.start();

      expect(result.success).toBe(true);
      expect(result.stage).toBe('ready');
      expect(bootstrap.isReady()).toBe(true);
      expect(bootstrap.getCurrentStage()).toBe('ready');
    });

    it('should get health status of all modules', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);
      await bootstrap.start();

      const health = bootstrap.getHealth();

      expect(health).toBeInstanceOf(Array);
      expect(health.length).toBeGreaterThanOrEqual(4);

      const databaseHealth = health.find(h => h.moduleName === 'database');
      expect(databaseHealth).toBeDefined();
      expect(databaseHealth?.status).toBe('healthy');

      const storesHealth = health.find(h => h.moduleName === 'stores');
      expect(storesHealth).toBeDefined();
      expect(storesHealth?.status).toBe('healthy');

      const appHealth = health.find(h => h.moduleName === 'application');
      expect(appHealth).toBeDefined();
      expect(appHealth?.status).toBe('healthy');
    });

    it('should include health check properties', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);
      const result = await bootstrap.start();

      const health = result.healthChecks ?? [];

      for (const check of health) {
        expect(check.moduleName).toBeDefined();
        expect(check.status).toMatch(/^(healthy|degraded|unhealthy)$/);
        expect(check.lastCheck).toBeDefined();
      }

      const dbHealth = health.find(h => h.moduleName === 'database');
      expect(dbHealth?.message).toBeDefined();
      expect(typeof dbHealth?.responseTimeMs).toBe('number');
      expect(dbHealth?.responseTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should return health check with timestamp', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);
      await bootstrap.start();

      const beforeCheck = Date.now();
      const health = bootstrap.getHealth();
      const afterCheck = Date.now();

      const dbHealth = health.find(h => h.moduleName === 'database');
      const checkTime = new Date(dbHealth!.lastCheck).getTime();
      expect(checkTime).toBeGreaterThanOrEqual(beforeCheck - 1000);
      expect(checkTime).toBeLessThanOrEqual(afterCheck + 1000);
    });
  });

  describe('Recovery on restart', () => {
    it('should recover pending approvals', async () => {
      const { config, stores } = createTestConfig();
      const { approvalStore } = stores;

      approvalStore.create({
        id: 'approval-1',
        userId: 'user-1',
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'test_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

      approvalStore.create({
        id: 'approval-2',
        userId: 'user-2',
        sessionId: 'session-2',
        status: 'pending',
        actionType: 'another_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });

      const bootstrap = createApplicationBootstrap(config);
      const result = await bootstrap.start();

      expect(result.success).toBe(true);
      expect(result.recoveryState).toBeDefined();
      expect(result.recoveryState?.pendingApprovals.length).toBe(2);

      const approval1 = result.recoveryState?.pendingApprovals.find(a => a.approvalId === 'approval-1');
      expect(approval1).toBeDefined();
      expect(approval1?.actionType).toBe('test_action');
    });

    it('should recover active waits', async () => {
      const { config, stores } = createTestConfig();
      const { waitConditionStore } = stores;

      waitConditionStore.create({
        id: 'wait-1',
        waitType: 'event',
        conditionPattern: 'test.event',
        targetType: 'workflow',
        targetRef: 'wf-1',
        status: 'active',
        timeoutAt: new Date(Date.now() + 3600000).toISOString(),
      });

      waitConditionStore.create({
        id: 'wait-2',
        waitType: 'signal',
        conditionPattern: 'test.signal',
        targetType: 'background_run',
        targetRef: 'br-1',
        status: 'active',
      });

      const bootstrap = createApplicationBootstrap(config);
      const result = await bootstrap.start();

      expect(result.success).toBe(true);
      expect(result.recoveryState?.activeWaits.length).toBe(2);

      const wait1 = result.recoveryState?.activeWaits.find(w => w.waitId === 'wait-1');
      expect(wait1).toBeDefined();
      expect(wait1?.waitType).toBe('event');
      expect(wait1?.timeoutAt).toBeDefined();
    });

    it('should recover running background runs', async () => {
      const { config, stores } = createTestConfig();
      const { backgroundRunStore } = stores;

      backgroundRunStore.create({
        backgroundRunId: 'run-1',
        userId: 'user-1',
        agentType: 'worker',
        status: 'running',
        launchSource: 'scheduler',
      });

      const bootstrap = createApplicationBootstrap(config);
      const result = await bootstrap.start();

      expect(result.success).toBe(true);
      expect(result.recoveryState?.pendingRuns.length).toBe(1);

      const run1 = result.recoveryState?.pendingRuns.find(r => r.runId === 'run-1');
      expect(run1).toBeDefined();
      expect(run1?.status).toBe('running');
      expect(run1?.agentType).toBe('worker');
    });

    it('should recover pending runtime actions', async () => {
      const { config, stores } = createTestConfig();
      const { runtimeActionStore } = stores;

      runtimeActionStore.save({
        actionId: 'action-1',
        actionType: 'dispatch',
        source: { sourceModule: 'gateway', sourceAction: 'test' },
        targetRuntime: 'kernel',
        targetAction: 'execute',
        payload: { test: true },
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      runtimeActionStore.save({
        actionId: 'action-2',
        actionType: 'approve',
        source: { sourceModule: 'gateway', sourceAction: 'test' },
        targetRuntime: 'permission',
        targetAction: 'check',
        payload: { resource: 'test' },
        status: 'waiting_for_approval',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const bootstrap = createApplicationBootstrap(config);
      const result = await bootstrap.start();

      expect(result.success).toBe(true);
      expect(result.recoveryState?.pendingActions.length).toBe(2);

      const action1 = result.recoveryState?.pendingActions.find(a => a.actionId === 'action-1');
      expect(action1).toBeDefined();
      expect(action1?.status).toBe('queued');
    });

    it('should include recovery timestamp', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);
      const result = await bootstrap.start();

      expect(result.recoveryState?.recoveredAt).toBeDefined();
      const recoveredAt = new Date(result.recoveryState!.recoveredAt);
      expect(recoveredAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should emit onRecoveryComplete event', async () => {
      const { config } = createTestConfig();
      let recoveredState: RecoveryState | undefined;
      const bootstrap = createApplicationBootstrap(config, {
        onRecoveryComplete: (state) => {
          recoveredState = state;
        },
      });

      await bootstrap.start();

      expect(recoveredState).toBeDefined();
      expect(recoveredState?.recoveredAt).toBeDefined();
    });
  });

  describe('ShutdownManager', () => {
    it('should register and call shutdown hooks', async () => {
      const { config, connection } = createTestConfig();
      const shutdown = createShutdownManager(config);
      let hookCalled = false;

      shutdown.registerShutdownHook(() => {
        hookCalled = true;
      });

      await shutdown.shutdown();

      expect(hookCalled).toBe(true);
      connection.close();
    });

    it('should handle multiple shutdown hooks', async () => {
      const { config, connection } = createTestConfig();
      const shutdown = createShutdownManager(config);
      const hookCalls: number[] = [];

      shutdown.registerShutdownHook(() => {
        hookCalls.push(1);
      });
      shutdown.registerShutdownHook(() => {
        hookCalls.push(2);
      });
      shutdown.registerShutdownHook(() => {
        hookCalls.push(3);
      });

      await shutdown.shutdown();

      expect(hookCalls).toEqual([1, 2, 3]);
      connection.close();
    });

    it('should handle async shutdown hooks', async () => {
      const { config, connection } = createTestConfig();
      const shutdown = createShutdownManager(config);
      let asyncCompleted = false;

      shutdown.registerShutdownHook(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        asyncCompleted = true;
      });

      await shutdown.shutdown();

      expect(asyncCompleted).toBe(true);
      connection.close();
    });

    it('should not fail if a shutdown hook throws', async () => {
      const { config, connection } = createTestConfig();
      const shutdown = createShutdownManager(config);
      let secondHookCalled = false;

      shutdown.registerShutdownHook(() => {
        throw new Error('Hook error');
      });
      shutdown.registerShutdownHook(() => {
        secondHookCalled = true;
      });

      await shutdown.shutdown();

      expect(secondHookCalled).toBe(true);
      connection.close();
    });

    it('should close database on shutdown', async () => {
      const { config, connection } = createTestConfig();
      const shutdown = createShutdownManager(config);

      expect(connection.isOpen()).toBe(true);

      await shutdown.shutdown();

      expect(connection.isOpen()).toBe(false);
    });

    it('should track shutting down state', async () => {
      const { config, connection } = createTestConfig();
      const shutdown = createShutdownManager(config);

      expect(shutdown.isShuttingDown()).toBe(false);

      const shutdownPromise = shutdown.shutdown();
      expect(shutdown.isShuttingDown()).toBe(true);

      await shutdownPromise;
      expect(shutdown.isShuttingDown()).toBe(false);
      connection.close();
    });

    it('should drain pending queue during shutdown', async () => {
      const { config, connection, stores } = createTestConfig();
      const { runtimeActionStore } = stores;

      runtimeActionStore.save({
        actionId: 'action-1',
        actionType: 'test',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'kernel',
        targetAction: 'test',
        payload: {},
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      runtimeActionStore.save({
        actionId: 'action-2',
        actionType: 'test',
        source: { sourceModule: 'gateway' },
        targetRuntime: 'kernel',
        targetAction: 'test',
        payload: {},
        status: 'queued',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const queuedBefore = runtimeActionStore.query({ status: 'queued' });
      expect(queuedBefore.length).toBe(2);

      const shutdown = createShutdownManager(config);

      shutdown.registerShutdownHook(() => {
        const pendingActions = runtimeActionStore.query({ status: 'queued' });
        for (const action of pendingActions) {
          runtimeActionStore.updateStatus(
            action.actionId,
            'cancelled',
            'Cancelled during shutdown'
          );
        }
      });

      await shutdown.shutdown();

      expect(connection.isOpen()).toBe(false);
    });

    it('should mark in-flight work for recovery on shutdown', async () => {
      const { config, connection, stores } = createTestConfig();
      const { backgroundRunStore } = stores;

      backgroundRunStore.create({
        backgroundRunId: 'run-1',
        userId: 'user-1',
        agentType: 'worker',
        status: 'running',
        launchSource: 'test',
      });

      let recoveryPointSaved = false;
      const shutdown = createShutdownManager(config);
      shutdown.registerShutdownHook(() => {
        const run = backgroundRunStore.getById('run-1');
        if (run?.recoveryPoint) {
          recoveryPointSaved = true;
        }
      });

      await shutdown.shutdown();

      expect(recoveryPointSaved).toBe(true);
      connection.close();
    }, 10000);

    it('should emit onShutdownComplete event', async () => {
      const { config, connection } = createTestConfig();
      let shutdownComplete = false;
      const shutdown = createShutdownManager(config, {
        onShutdownComplete: () => {
          shutdownComplete = true;
        },
      });

      await shutdown.shutdown();

      expect(shutdownComplete).toBe(true);
      connection.close();
    });
  });

  describe('Integration - Startup and Shutdown', () => {
    it('should complete full startup and shutdown cycle', async () => {
      const { config, connection } = createTestConfig();
      const { bootstrap, shutdown } = createBootstrapSystem(config);

      const startResult = await bootstrap.start();
      expect(startResult.success).toBe(true);
      expect(bootstrap.isReady()).toBe(true);

      await shutdown.shutdown();
      expect(connection.isOpen()).toBe(false);
    });

    it('should recover state after simulated restart', async () => {
      const { config, stores } = createTestConfig();
      const { bootstrap: bootstrap1 } = createBootstrapSystem(config);
      await bootstrap1.start();

      stores.approvalStore.create({
        id: 'approval-pending',
        userId: 'user-1',
        sessionId: 'session-1',
        status: 'pending',
        actionType: 'critical_action',
        requestedBy: 'system',
        requestedAt: new Date().toISOString(),
      });

      stores.backgroundRunStore.create({
        backgroundRunId: 'run-pending',
        userId: 'user-1',
        agentType: 'processor',
        status: 'running',
        launchSource: 'workflow',
      });

      const bootstrap2 = createApplicationBootstrap(config);
      const result = await bootstrap2.start();

      expect(result.recoveryState?.pendingApprovals.length).toBe(1);
      expect(result.recoveryState?.pendingApprovals[0]?.approvalId).toBe('approval-pending');
      expect(result.recoveryState?.pendingRuns.length).toBe(1);
      expect(result.recoveryState?.pendingRuns[0]?.runId).toBe('run-pending');
    });
  });

  describe('Health Checks', () => {
    it('should detect healthy database', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);
      await bootstrap.start();

      const health = bootstrap.getHealth();
      const dbHealth = health.find(h => h.moduleName === 'database');

      expect(dbHealth?.status).toBe('healthy');
    });

    it('should return fresh health status on each call', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);
      await bootstrap.start();

      const health1 = bootstrap.getHealth();
      const timestamp1 = health1.find(h => h.moduleName === 'database')?.lastCheck;

      await new Promise(resolve => setTimeout(resolve, 10));

      const health2 = bootstrap.getHealth();
      const timestamp2 = health2.find(h => h.moduleName === 'database')?.lastCheck;

      expect(timestamp2).not.toBe(timestamp1);
    });
  });

  describe('Signal Handling', () => {
    it('should handle SIGINT signal', async () => {
      const { config } = createTestConfig();
      const shutdown = createShutdownManager({
        ...config,
        signalHandlers: false,
      });

      let shutdownCalled = false;
      shutdown.registerShutdownHook(() => {
        shutdownCalled = true;
      });

      await shutdown.handleSignal('SIGINT');

      expect(shutdownCalled).toBe(true);
    });

    it('should handle SIGTERM signal', async () => {
      const { config } = createTestConfig();
      const shutdown = createShutdownManager({
        ...config,
        signalHandlers: false,
      });

      let shutdownCalled = false;
      shutdown.registerShutdownHook(() => {
        shutdownCalled = true;
      });

      await shutdown.handleSignal('SIGTERM');

      expect(shutdownCalled).toBe(true);
    });
  });

  describe('Factory Functions', () => {
    it('should create bootstrap and shutdown with factory', () => {
      const { config } = createTestConfig();
      const system = createBootstrapSystem(config);

      expect(system.bootstrap).toBeDefined();
      expect(system.shutdown).toBeDefined();
    });

    it('should create independent bootstrap instance', () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);

      expect(bootstrap.start).toBeDefined();
      expect(bootstrap.getHealth).toBeDefined();
      expect(bootstrap.isReady).toBeDefined();
      expect(bootstrap.getCurrentStage).toBeDefined();
    });

    it('should create independent shutdown manager', () => {
      const { config } = createTestConfig();
      const shutdown = createShutdownManager(config);

      expect(shutdown.shutdown).toBeDefined();
      expect(shutdown.registerShutdownHook).toBeDefined();
      expect(shutdown.handleSignal).toBeDefined();
      expect(shutdown.isShuttingDown).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle concurrent shutdown calls', async () => {
      const { config, connection } = createTestConfig();
      const shutdown = createShutdownManager(config);

      const promise1 = shutdown.shutdown();
      const promise2 = shutdown.shutdown();

      await Promise.all([promise1, promise2]);

      expect(connection.isOpen()).toBe(false);
    });

    it('should handle startup stage tracking', async () => {
      const { config } = createTestConfig();
      const bootstrap = createApplicationBootstrap(config);

      expect(bootstrap.getCurrentStage()).toBe('database');

      await bootstrap.start();

      expect(bootstrap.getCurrentStage()).toBe('ready');
    });

    it('should return error details on startup failure', async () => {
      const connection = createConnectionManager(':memory:');
      connection.open();
      connection.close();

      const configWithoutTracing: StartupConfig = {
        connectionManager: connection,
        migrationRunner: createMigrationRunner(connection),
        approvalStore: createApprovalStore(connection),
        waitConditionStore: createWaitConditionStore(connection),
        backgroundRunStore: createBackgroundRunStore(connection),
        runtimeActionStore: createRuntimeActionStore(connection),
        signalHandlers: false,
      };

      const bootstrap = createApplicationBootstrap(configWithoutTracing);
      const result = await bootstrap.start();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
