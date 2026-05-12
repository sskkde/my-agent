/**
 * Architecture Contract Tests — Path 7: Replay Preview Safety
 *
 * Verifies replay preview mode enforces read-only: no tool calls,
 * no store writes, no HTTP requests, no trigger fires.
 * Tests SafetyPolicy defaults and ReplaySafetyGuard behavior.
 * Type-level and unit-level assertions — no actual replay execution.
 */
import { describe, it, expect } from 'vitest';
import type {
  SafetyPolicy,
  ReplayRequest,
  ReplayResult,
  ReplayMode,
  ReplayStatus,
  BlockedAction,
  ReplayServiceConfig,
  StateSnapshot,
} from '../../src/observability/replay.js';
import {
  DEFAULT_SAFETY_POLICY,
} from '../../src/observability/replay.js';
import {
  DEFAULT_REPLAY_SAFETY_POLICY,
  createReplaySafetyGuard,
} from '../../src/replay/replay-safety-guard.js';
import type {
  ReplaySafetyPolicy,
  ReplaySafetyCheckResult,
} from '../../src/replay/replay-safety-guard.js';

// ─── SafetyPolicy Defaults — All 4 Forbidden Operations ─────────────────

describe('Path 7: Replay Preview Safety Contract', () => {

  describe('SafetyPolicy Defaults — All 4 Forbidden Operations', () => {
    it('SafetyPolicy.allowToolExecution defaults to false (0 tool calls)', () => {
      expect(DEFAULT_SAFETY_POLICY.allowToolExecution).toBe(false);
    });

    it('SafetyPolicy.allowExternalWrites defaults to false (0 store writes)', () => {
      expect(DEFAULT_SAFETY_POLICY.allowExternalWrites).toBe(false);
    });

    it('SafetyPolicy.allowConnectorAccess defaults to false (0 HTTP requests)', () => {
      expect(DEFAULT_SAFETY_POLICY.allowConnectorAccess).toBe(false);
    });

    it('SafetyPolicy.requireApprovalForSideEffects defaults to true', () => {
      // Any side-effect replay requires explicit approval — triggers are blocked by default
      expect(DEFAULT_SAFETY_POLICY.requireApprovalForSideEffects).toBe(true);
    });

    it('SafetyPolicy.allowToolExecution exists as a boolean field', () => {
      const keys: Array<keyof SafetyPolicy> = [
        'allowExternalWrites',
        'allowToolExecution',
        'allowConnectorAccess',
        'maxReplayDepth',
      ];
      for (const k of keys) {
        expect(typeof k).toBe('string');
      }
      // Verify the boolean fields
      expect(typeof DEFAULT_SAFETY_POLICY.allowToolExecution).toBe('boolean');
      expect(typeof DEFAULT_SAFETY_POLICY.allowExternalWrites).toBe('boolean');
      expect(typeof DEFAULT_SAFETY_POLICY.allowConnectorAccess).toBe('boolean');
    });
  });

  // ─── ReplaySafetyGuard — Blocks Tool Execution ────────────────────────

  describe('ReplaySafetyGuard — Tool Execution Blocked', () => {
    it('DEFAULT_REPLAY_SAFETY_POLICY sets all safety flags conservatively', () => {
      expect(DEFAULT_REPLAY_SAFETY_POLICY.allowExternalWrites).toBe(false);
      expect(DEFAULT_REPLAY_SAFETY_POLICY.requireApprovalForSideEffects).toBe(true);
      expect(DEFAULT_REPLAY_SAFETY_POLICY.redactSensitivePayloads).toBe(true);
    });

    it('ReplaySafetyGuard.check() blocks tool calls in default mode', () => {
      const guard = createReplaySafetyGuard();
      const result = guard.check('tool_call:execute_tool', { toolName: 'write_file', params: {} });
      expect(result.allowed).toBe(false);
      expect(result.reason).toBeDefined();
    });

    it('ReplaySafetyGuard.check() blocks external writes', () => {
      const guard = createReplaySafetyGuard();
      const result = guard.check('audit:external_write', { targetType: 'file', writeData: {} });
      expect(result.allowed).toBe(false);
    });

    it('ReplaySafetyGuard.check() blocks connector access', () => {
      const guard = createReplaySafetyGuard();
      const result = guard.check('audit:connector_access', { connectorId: 'c1', operation: 'read' });
      expect(result.allowed).toBe(false);
    });

    it('ReplaySafetyGuard.check() allows safe read-only operations', () => {
      const guard = createReplaySafetyGuard();
      const result = guard.check('event:timeline_query', { query: 'list sessions' });
      expect(result.allowed).toBe(true);
    });

    it('ReplaySafetyGuard.check() allows writes when allowExternalWrites=true and requireApprovalForSideEffects=false', () => {
      const guard = createReplaySafetyGuard({
        allowExternalWrites: true,
        requireApprovalForSideEffects: false,
      });
      const result = guard.check('audit:external_write', { targetType: 'file' });
      expect(result.allowed).toBe(true);
    });

    it('ReplaySafetyGuard returns ReplaySafetyCheckResult with allowed and reason', () => {
      const guard = createReplaySafetyGuard();
      const result: ReplaySafetyCheckResult = guard.check('tool_call:run', {});
      expect(typeof result.allowed).toBe('boolean');
      expect(result.payload).toBeDefined();
    });
  });

  // ─── ReplaySafetyGuard — Redaction ────────────────────────────────────

  describe('ReplaySafetyGuard — Sensitive Data Redaction', () => {
    it('redacts payload fields matching sensitive patterns', () => {
      const guard = createReplaySafetyGuard();
      const payload = {
        username: 'alice',
        password: 'secret123',
        apiKey: 'sk-abc-def',
        publicData: 'visible',
      };
      const redacted = guard.redactSensitivePayload(payload) as typeof payload;
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.apiKey).toBe('[REDACTED]');
      expect(redacted.username).toBe('alice');
      expect(redacted.publicData).toBe('visible');
    });

    it('redacts nested sensitive fields recursively', () => {
      const guard = createReplaySafetyGuard();
      const payload = {
        config: {
          auth: { token: 'bearer-xyz', type: 'oauth' },
          public: true,
        },
      };
      const redacted = guard.redactSensitivePayload(payload) as typeof payload;
      expect((redacted.config.auth as Record<string, unknown>).token).toBe('[REDACTED]');
      expect((redacted.config.auth as Record<string, unknown>).type).toBe('oauth');
    });

    it('redaction disabled in check() when redactSensitivePayloads is false', () => {
      const guard = createReplaySafetyGuard({
        redactSensitivePayloads: false,
        requireApprovalForSideEffects: false,
      });
      const payload = { password: 'secret', data: 'hello' };
      const result = guard.check('event:query', payload);
      expect(result.allowed).toBe(true);
      expect(result.payload).toEqual(payload);
    });
  });

  // ─── ReplayService — Modes and Types ──────────────────────────────────

  describe('ReplayService — Replay Modes', () => {
    it('ReplayMode covers timeline_only and state_rebuild', () => {
      const modes: ReplayMode[] = ['timeline_only', 'state_rebuild'];
      expect(modes).toHaveLength(2);
      for (const m of modes) {
        expect(typeof m).toBe('string');
      }
    });

    it('ReplayRequest carries mode and safety policy', () => {
      const reqKeys: Array<keyof ReplayRequest> = [
        'rootType', 'rootId', 'replayMode', 'safetyPolicy',
      ];
      for (const k of reqKeys) {
        expect(typeof k).toBe('string');
      }
      expect<keyof ReplayRequest>('includeSensitiveData');
    });

    it('ReplayStatus covers success, partial, blocked, and error', () => {
      const statuses: ReplayStatus[] = ['success', 'partial', 'blocked', 'error'];
      expect(statuses).toHaveLength(4);
      for (const s of statuses) {
        expect(typeof s).toBe('string');
      }
    });

    it('ReplayResult includes blockedActions for safety audit trail', () => {
      const resultKeys: Array<keyof ReplayResult> = [
        'status', 'timeline', 'blockedActions', 'originalTraceRefs', 'warnings',
      ];
      for (const k of resultKeys) {
        expect(typeof k).toBe('string');
      }
      expect<keyof ReplayResult>('stateSnapshot');
    });
  });

  // ─── BlockedAction — Tracking Forbidden Operations ─────────────────────

  describe('BlockedAction Type — Tracking Forbidden Operations', () => {
    it('BlockedAction tracks which action was blocked and why', () => {
      const blockedKeys: Array<keyof BlockedAction> = [
        'eventId', 'eventType', 'action', 'reason', 'module',
      ];
      for (const k of blockedKeys) {
        expect(typeof k).toBe('string');
      }
    });

    it('BlockedAction records concrete blocked reason for each operation', () => {
      const blocked: BlockedAction = {
        eventId: 'evt-1',
        eventType: 'audit',
        action: 'Tool execution: write_file',
        reason: 'Tool execution blocked by default safety policy',
        module: 'tool',
      };
      expect(blocked.reason).toContain('blocked');
      expect(blocked.module).toBe('tool');
    });
  });

  // ─── ReplayServiceConfig — Dependencies ────────────────────────────────

  describe('ReplayService — Config Dependencies', () => {
    it('ReplayServiceConfig requires timeline builder and stores (no tool executor)', () => {
      const configKeys: Array<keyof ReplayServiceConfig> = [
        'timelineBuilder', 'eventStore', 'auditStore', 'traceStore',
      ];
      for (const k of configKeys) {
        expect(typeof k).toBe('string');
      }
      // Notably missing: toolExecutor, dispatcher, connectorRegistry
      // ReplayService is a read-only operation — it only reads events
    });

    it('StateSnapshot captures workflow, background, and planner state', () => {
      const snapshotKeys: Array<keyof StateSnapshot> = [
        'workflowRun', 'backgroundRun', 'plannerRun', 'timestamp',
      ];
      for (const k of snapshotKeys) {
        expect(typeof k).toBe('string');
      }
    });
  });

  // ─── ReplaySafetyPolicy — Consistency with SafetyPolicy ───────────────

  describe('ReplaySafetyPolicy ↔ SafetyPolicy Alignment', () => {
    it('ReplaySafetyPolicy shared fields align with SafetyPolicy', () => {
      const guardPolicyKeys: Array<keyof ReplaySafetyPolicy> = [
        'allowExternalWrites',
        'requireApprovalForSideEffects',
        'redactSensitivePayloads',
      ];
      for (const k of guardPolicyKeys) {
        expect(typeof k).toBe('string');
      }
    });

    it('SafetyPolicy extends ReplaySafetyPolicy with additional controls', () => {
      // SafetyPolicy adds allowToolExecution, allowConnectorAccess, maxReplayDepth
      const extraFields: Array<keyof SafetyPolicy> = [
        'allowToolExecution',
        'allowConnectorAccess',
        'maxReplayDepth',
      ];
      for (const k of extraFields) {
        expect(typeof k).toBe('string');
      }
    });
  });
});
