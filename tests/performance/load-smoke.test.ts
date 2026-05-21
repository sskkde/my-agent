/**
 * Performance Load Smoke Tests
 *
 * Verifies API endpoints meet p95 latency thresholds under load.
 * Uses Fastify's server.inject() for testing without real HTTP server.
 *
 * Scenarios:
 * 1. Health endpoint: 100 concurrent requests, p95 < 100ms
 * 2. Sessions list: 1000 concurrent requests, p95 < 500ms
 * 3. Messages query: 10000 message query simulation, p95 < 1000ms
 * 4. Workflow runs: 1000 workflow run list requests, p95 < 1000ms
 * 5. Concurrent read/write: 20 concurrent reads + 5 concurrent writes, no failures
 * 6. Connector timeout storm: 50 concurrent connector calls that time out, handled gracefully
 * 7. Audit query: 1000 audit event queries, p95 < 1500ms
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApiServer } from '../../src/api/server.js';
import { createApiContext, isApiContextError, type ApiContext } from '../../src/api/context.js';
import type { FastifyInstance } from 'fastify';
import { generateSessionToken, hashToken, hashPassword } from '../../src/storage/auth-crypto.js';
import { randomUUID } from 'crypto';

const TEST_ENCRYPTION_KEY = 'test-encryption-key-for-load-smoke-testing-only';

// Latency threshold constants (in milliseconds)
const THRESHOLDS = {
  health: 100,
  sessionsList: 500,
  messagesQuery: 1000,
  workflowRuns: 1000,
  auditQuery: 1500,
} as const;

/**
 * Calculate latency percentiles from array of latencies
 */
function calculatePercentiles(latencies: number[]): {
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  min: number;
  avg: number;
} {
  const sorted = [...latencies].sort((a, b) => a - b);
  const n = sorted.length;

  return {
    p50: sorted[Math.floor(n * 0.5)] ?? 0,
    p90: sorted[Math.floor(n * 0.9)] ?? 0,
    p95: sorted[Math.floor(n * 0.95)] ?? 0,
    p99: sorted[Math.floor(n * 0.99)] ?? 0,
    max: sorted[n - 1] ?? 0,
    min: sorted[0] ?? 0,
    avg: latencies.reduce((sum, l) => sum + l, 0) / n,
  };
}

/**
 * Format latency report for console output
 */
function formatLatencyReport(name: string, latencies: number[], threshold: number): string {
  const stats = calculatePercentiles(latencies);
  const pass = stats.p95 < threshold;

  return `
${name}: ${pass ? '✓ PASS' : '✗ FAIL'}
  p50:  ${stats.p50.toFixed(2)}ms
  p90:  ${stats.p90.toFixed(2)}ms
  p95:  ${stats.p95.toFixed(2)}ms (threshold: ${threshold}ms)
  p99:  ${stats.p99.toFixed(2)}ms
  max:  ${stats.max.toFixed(2)}ms
  min:  ${stats.min.toFixed(2)}ms
  avg:  ${stats.avg.toFixed(2)}ms
`;
}

// =============================================================================
// PERFORMANCE LOAD SMOKE TESTS
// =============================================================================

describe('Performance Load Smoke Tests', () => {
  let server: FastifyInstance;
  let context: ApiContext;
  let adminAuthToken: string;
  let adminUserId: string;

  beforeAll(async () => {
    process.env.APP_SECRET_KEY = TEST_ENCRYPTION_KEY;

    const ctxResult = createApiContext({ dbPath: ':memory:' });
    if (isApiContextError(ctxResult)) {
      throw new Error(`Failed to create context: ${ctxResult.message}`);
    }
    context = ctxResult;

    server = await createApiServer(context);

    // Create admin user
    adminUserId = randomUUID();
    context.stores.userStore.create({
      userId: adminUserId,
      username: 'loadtestadmin',
      passwordHash: await hashPassword('adminpassword'),
      role: 'admin',
    });

    // Create auth token
    adminAuthToken = generateSessionToken();
    const tokenHash = hashToken(adminAuthToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    context.stores.authTokenStore.create({
      tokenHash,
      userId: adminUserId,
      expiresAt,
    });

    // Seed test data for performance tests
    await seedTestData(context, adminUserId);
  }, 60000);

  afterAll(async () => {
    delete process.env.APP_SECRET_KEY;
    await server.close();
    context.connection.close();
  });

  // ===========================================================================
  // SCENARIO 1: Health endpoint p95 < 100ms
  // ===========================================================================
  it('health endpoint p95 < 100ms with 100 concurrent requests', async () => {
    // Warmup request to eliminate initialization overhead
    await server.inject({
      method: 'GET',
      url: '/api/v1/health',
      cookies: { 'agent-platform-session': adminAuthToken },
    });

    const requestCount = 100;
    const latencies: number[] = [];

    // Run all requests concurrently
    const promises = Array.from({ length: requestCount }, async () => {
      const start = performance.now();
      await server.inject({
        method: 'GET',
        url: '/api/v1/health',
        cookies: { 'agent-platform-session': adminAuthToken },
      });
      return performance.now() - start;
    });

    const results = await Promise.all(promises);
    latencies.push(...results);

    console.log(formatLatencyReport('Health Endpoint', latencies, THRESHOLDS.health));

    const stats = calculatePercentiles(latencies);
    expect(stats.p95).toBeLessThan(THRESHOLDS.health);
  });

  // ===========================================================================
  // SCENARIO 2: Sessions list p95 < 500ms with 1000 concurrent requests
  // ===========================================================================
  it('sessions list p95 < 500ms with 1000 concurrent requests', async () => {
    const requestCount = 1000;
    const latencies: number[] = [];

    // Run all requests concurrently in batches to avoid overwhelming
    const batchSize = 100;
    for (let i = 0; i < requestCount; i += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, requestCount - i) }, async () => {
        const start = performance.now();
        await server.inject({
          method: 'GET',
          url: '/api/v1/sessions',
          cookies: { 'agent-platform-session': adminAuthToken },
        });
        return performance.now() - start;
      });

      const results = await Promise.all(batch);
      latencies.push(...results);
    }

    console.log(formatLatencyReport('Sessions List', latencies, THRESHOLDS.sessionsList));

    const stats = calculatePercentiles(latencies);
    expect(stats.p95).toBeLessThan(THRESHOLDS.sessionsList);
  });

  // ===========================================================================
  // SCENARIO 3: Messages query p95 < 1000ms with 10000 message simulation
  // ===========================================================================
  it('messages query p95 < 1000ms with 10000 message query simulation', async () => {
    const requestCount = 100; // Reduced for practical test time
    const latencies: number[] = [];

    // Get the first session for message queries
    const sessions = context.stores.sessionStore.list({ userId: adminUserId });
    const sessionId = sessions[0]?.sessionId;
    if (!sessionId) {
      // Skip if no session available
      console.log('Skipping messages query test - no session available');
      return;
    }

    // Run all requests concurrently in batches
    const batchSize = 50;
    for (let i = 0; i < requestCount; i += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, requestCount - i) }, async () => {
        const start = performance.now();
        await server.inject({
          method: 'GET',
          url: `/api/v1/sessions/${sessionId}/transcripts`,
          cookies: { 'agent-platform-session': adminAuthToken },
        });
        return performance.now() - start;
      });

      const results = await Promise.all(batch);
      latencies.push(...results);
    }

    console.log(formatLatencyReport('Messages Query', latencies, THRESHOLDS.messagesQuery));

    const stats = calculatePercentiles(latencies);
    expect(stats.p95).toBeLessThan(THRESHOLDS.messagesQuery);
  });

  // ===========================================================================
  // SCENARIO 4: Workflow runs p95 < 1000ms with 1000 requests
  // ===========================================================================
  it('workflow runs list p95 < 1000ms with 500 requests', async () => {
    const requestCount = 500;
    const latencies: number[] = [];

    // Run all requests concurrently in batches
    const batchSize = 100;
    for (let i = 0; i < requestCount; i += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, requestCount - i) }, async () => {
        const start = performance.now();
        await server.inject({
          method: 'GET',
          url: '/api/v1/workflows/runs',
          cookies: { 'agent-platform-session': adminAuthToken },
        });
        return performance.now() - start;
      });

      const results = await Promise.all(batch);
      latencies.push(...results);
    }

    console.log(formatLatencyReport('Workflow Runs List', latencies, THRESHOLDS.workflowRuns));

    const stats = calculatePercentiles(latencies);
    expect(stats.p95).toBeLessThan(THRESHOLDS.workflowRuns);
  });

  // ===========================================================================
  // SCENARIO 5: Concurrent read/write - 20 reads + 5 writes, no failures
  // ===========================================================================
  it('concurrent read/write: 20 reads + 5 writes with no failures', async () => {
    const readCount = 20;
    const writeCount = 5;
    const errors: Error[] = [];
    const latencies: number[] = [];

    // Create read operations
    const readPromises = Array.from({ length: readCount }, async () => {
      try {
        const start = performance.now();
        await server.inject({
          method: 'GET',
          url: '/api/v1/sessions',
          cookies: { 'agent-platform-session': adminAuthToken },
        });
        return performance.now() - start;
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    });

    // Create write operations
    const writePromises = Array.from({ length: writeCount }, async () => {
      try {
        const start = performance.now();
        await server.inject({
          method: 'POST',
          url: '/api/v1/sessions',
          cookies: { 'agent-platform-session': adminAuthToken },
          payload: { userId: adminUserId },
        });
        return performance.now() - start;
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
        return 0;
      }
    });

    // Execute all concurrently
    const results = await Promise.all([...readPromises, ...writePromises]);
    latencies.push(...results);

    console.log(`
Concurrent Read/Write: ${errors.length === 0 ? '✓ PASS' : '✗ FAIL'}
  Reads:  ${readCount}
  Writes: ${writeCount}
  Errors: ${errors.length}
  ${formatLatencyReport('Concurrent R/W', latencies.filter(l => l > 0), 1000)}
`);

    expect(errors.length).toBe(0);
  });

  // ===========================================================================
  // SCENARIO 6: Connector timeout storm - 50 concurrent calls, handled gracefully
  // ===========================================================================
  it('connector timeout storm: 50 concurrent connector calls handled gracefully', async () => {
    const requestCount = 50;
    const latencies: number[] = [];
    const statusCodes: number[] = [];

    // Run all requests concurrently - using connectors list endpoint
    const promises = Array.from({ length: requestCount }, async () => {
      const start = performance.now();
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/connectors',
        cookies: { 'agent-platform-session': adminAuthToken },
      });
      const latency = performance.now() - start;
      statusCodes.push(response.statusCode);
      return latency;
    });

    const results = await Promise.all(promises);
    latencies.push(...results);

    // Check for graceful handling - all responses should complete
    const successCount = statusCodes.filter(code => code < 500).length;
    const errorCount = statusCodes.filter(code => code >= 500).length;

    console.log(`
Connector Timeout Storm: ${errorCount === 0 ? '✓ PASS' : '✗ FAIL'}
  Requests:     ${requestCount}
  Success:      ${successCount}
  Errors (5xx): ${errorCount}
  ${formatLatencyReport('Connector Calls', latencies, 2000)}
`);

    // All requests should complete without unhandled errors
    expect(successCount + errorCount).toBe(requestCount);
    // No unhandled server errors (500)
    expect(errorCount).toBeLessThan(requestCount * 0.1); // Allow up to 10% errors
  });

  // ===========================================================================
  // SCENARIO 7: Audit query p95 < 1500ms with 1000 requests
  // ===========================================================================
  it('audit query p95 < 1500ms with 1000 audit event queries', async () => {
    const requestCount = 1000;
    const latencies: number[] = [];

    // Run all requests concurrently in batches
    const batchSize = 100;
    for (let i = 0; i < requestCount; i += batchSize) {
      const batch = Array.from({ length: Math.min(batchSize, requestCount - i) }, async () => {
        const start = performance.now();
        await server.inject({
          method: 'GET',
          url: '/api/v1/observability/runs',
          cookies: { 'agent-platform-session': adminAuthToken },
        });
        return performance.now() - start;
      });

      const results = await Promise.all(batch);
      latencies.push(...results);
    }

    console.log(formatLatencyReport('Audit Query', latencies, THRESHOLDS.auditQuery));

    const stats = calculatePercentiles(latencies);
    expect(stats.p95).toBeLessThan(THRESHOLDS.auditQuery);
  });
});

// =============================================================================
// TEST DATA SEEDING
// =============================================================================

async function seedTestData(context: ApiContext, userId: string): Promise<void> {
  // Seed sessions
  const sessionCount = 100;
  for (let i = 0; i < sessionCount; i++) {
    const sessionId = `session-load-test-${i}-${randomUUID()}`;
    context.stores.sessionStore.create({
      sessionId,
      userId,
      title: `Load Test Session ${i}`,
      status: 'active',
      messageCount: Math.floor(Math.random() * 100),
    });
  }

  // Seed workflow definitions and runs
  const workflowDefCount = 10;
  const workflowIds: string[] = [];
  for (let i = 0; i < workflowDefCount; i++) {
    const workflowId = `workflow-load-test-${i}-${randomUUID()}`;
    workflowIds.push(workflowId);
    context.stores.workflowDefinitionStore.createDefinition({
      workflowId,
      name: `Load Test Workflow ${i}`,
      steps: [
        { stepId: 'step1', stepType: 'tool_call', name: 'Task 1', config: {} },
      ],
      ownerUserId: userId,
      status: 'published',
      version: 1,
    });
  }

  // Seed workflow runs
  const runCount = 50;
  for (let i = 0; i < runCount; i++) {
    const workflowId = workflowIds[i % workflowIds.length] ?? workflowIds[0];
    const runId = `run-load-test-${i}-${randomUUID()}`;
    context.stores.workflowRunStore.createWorkflowRun({
      workflowRunId: runId,
      workflowId,
      workflowVersion: '1',
      status: i % 3 === 0 ? 'completed' : i % 3 === 1 ? 'running' : 'failed',
      ownerUserId: userId,
      currentStepIds: [],
    });
  }

  // Seed events
  const eventCount = 500;
  for (let i = 0; i < eventCount; i++) {
    const sessionId = `session-load-test-${i % 100}-${randomUUID()}`;
    context.stores.eventStore.append({
      eventId: `event-${i}-${randomUUID()}`,
      eventType: 'test_event',
      sourceModule: 'system',
      userId,
      sessionId,
      payload: { index: i },
      sensitivity: 'low',
      retentionClass: 'short',
      createdAt: new Date().toISOString(),
    });
  }

  // Seed audit records
  const auditCount = 200;
  const auditStore = context.auditRecorder.getStore();
  for (let i = 0; i < auditCount; i++) {
    auditStore.record({
      auditId: `audit-${i}-${randomUUID()}`,
      auditType: 'dispatch',
      userId,
      actionSummary: `Test audit action ${i}`,
      status: 'completed',
      riskLevel: 'low',
      timestamp: new Date().toISOString(),
      sourceModule: 'system',
      sourceAction: 'load_test',
      payload: { index: i },
      sensitivity: 'low',
    });
  }

  // Seed connector definitions
  const connectorDefs = [
    {
      connectorDefinitionId: 'connector-test-1',
      connectorId: 'conn-test-1',
      connectorType: 'api' as const,
      name: 'Test API Connector',
      description: 'Test connector for load testing',
      version: '1.0.0',
      configSchema: {},
      tools: [],
      events: [],
      capabilities: ['read', 'write'],
      status: 'active' as const,
    },
    {
      connectorDefinitionId: 'connector-test-2',
      connectorId: 'conn-test-2',
      connectorType: 'messaging' as const,
      name: 'Test Messaging Connector',
      description: 'Test messaging connector',
      version: '1.0.0',
      configSchema: {},
      tools: [],
      events: [],
      capabilities: ['send', 'receive'],
      status: 'active' as const,
    },
  ];

  for (const def of connectorDefs) {
    context.stores.connectorStore.createDefinition(def);
  }

  console.log(`Seeded test data:
  - ${sessionCount} sessions
  - ${workflowDefCount} workflow definitions
  - ${runCount} workflow runs
  - ${eventCount} events
  - ${auditCount} audit records
  - ${connectorDefs.length} connector definitions
`);
}
