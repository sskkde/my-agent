export interface ReplaySafetyPolicy {
  allowExternalWrites: boolean;
  requireApprovalForSideEffects: boolean;
  redactSensitivePayloads: boolean;
}

export interface ReplaySafetyCheckResult {
  allowed: boolean;
  reason?: string;
  payload: unknown;
}

export const DEFAULT_REPLAY_SAFETY_POLICY: ReplaySafetyPolicy = {
  allowExternalWrites: false,
  requireApprovalForSideEffects: true,
  redactSensitivePayloads: true,
};

const SIDE_EFFECT_INDICATORS = [
  'write',
  'delete',
  'send',
  'update',
  'create',
  'dispatch',
  'external_write',
  'tool_call',
  'connector_access',
  'connector_resource_access',
  'memory_write',
  'memory_delete',
];

const EXTERNAL_WRITE_INDICATORS = [
  'external_write',
  'file_write',
  'database_write',
  'api_write',
  'connector_write',
  'send_email',
  'send_message',
  'create_event',
  'create_doc',
  'update_doc',
];

const SENSITIVE_FIELD_PATTERNS = [
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'credential',
  'authorization',
  'private',
  'sensitive',
];

export class ReplaySafetyGuard {
  private readonly policy: ReplaySafetyPolicy;

  constructor(policy: Partial<ReplaySafetyPolicy> = {}) {
    this.policy = { ...DEFAULT_REPLAY_SAFETY_POLICY, ...policy };
  }

  check(actionType: string, payload: unknown): ReplaySafetyCheckResult {
    const normalizedAction = actionType.toLowerCase();
    const redactedPayload = this.policy.redactSensitivePayloads
      ? this.redactSensitivePayload(payload)
      : payload;

    if (!this.policy.allowExternalWrites && this.isExternalWrite(normalizedAction, payload)) {
      return {
        allowed: false,
        reason: 'External write operation blocked by default replay safety policy',
        payload: redactedPayload,
      };
    }

    if (this.policy.requireApprovalForSideEffects && this.isSideEffect(normalizedAction, payload)) {
      return {
        allowed: false,
        reason: 'Side-effect replay requires explicit approval by default',
        payload: redactedPayload,
      };
    }

    return { allowed: true, payload: redactedPayload };
  }

  redactSensitivePayload<T>(payload: T): T {
    if (Array.isArray(payload)) {
      return payload.map((item) => this.redactSensitivePayload(item)) as T;
    }

    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      const normalizedKey = key.toLowerCase();
      if (SENSITIVE_FIELD_PATTERNS.some((pattern) => normalizedKey.includes(pattern))) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = this.redactSensitivePayload(value);
      }
    }

    return redacted as T;
  }

  private isExternalWrite(actionType: string, payload: unknown): boolean {
    const haystack = `${actionType} ${this.stringifyPayload(payload)}`.toLowerCase();
    return EXTERNAL_WRITE_INDICATORS.some((indicator) => haystack.includes(indicator));
  }

  private isSideEffect(actionType: string, payload: unknown): boolean {
    const haystack = `${actionType} ${this.stringifyPayload(payload)}`.toLowerCase();
    return SIDE_EFFECT_INDICATORS.some((indicator) => haystack.includes(indicator));
  }

  private stringifyPayload(payload: unknown): string {
    try {
      return JSON.stringify(payload);
    } catch {
      return '';
    }
  }
}

export function createReplaySafetyGuard(
  policy?: Partial<ReplaySafetyPolicy>
): ReplaySafetyGuard {
  return new ReplaySafetyGuard(policy);
}
