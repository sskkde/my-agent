import { describe, it, expect } from 'vitest';
import {
  buildDefaultRiskPolicies,
  getToolRiskPolicy,
  requiresApprovalByRisk,
  determineRiskLevel,
} from '../../../src/permissions/tool-risk-policy.js';

describe('buildDefaultRiskPolicies', () => {
  it('returns 21 policies for all built-in tools', () => {
    const policies = buildDefaultRiskPolicies();
    expect(policies).toHaveLength(21);
  });

  it('every policy has required fields', () => {
    const policies = buildDefaultRiskPolicies();
    for (const policy of policies) {
      expect(policy.toolName).toBeTruthy();
      expect(['low', 'medium', 'high', 'critical']).toContain(policy.riskLevel);
      expect(typeof policy.requiresApproval).toBe('boolean');
      expect(typeof policy.canAutoGrant).toBe('boolean');
      expect(['low', 'medium', 'high']).toContain(policy.auditLevel);
    }
  });

  it('produces unique tool names', () => {
    const policies = buildDefaultRiskPolicies();
    const names = policies.map((p) => p.toolName);
    expect(new Set(names).size).toBe(21);
  });
});

describe('getToolRiskPolicy', () => {
  it('returns the correct policy for file.read', () => {
    const policy = getToolRiskPolicy('file.read');
    expect(policy).toBeDefined();
    expect(policy!.toolName).toBe('file.read');
    expect(policy!.riskLevel).toBe('medium');
    expect(policy!.requiresApproval).toBe(false);
    expect(policy!.canAutoGrant).toBe(true);
  });

  it('returns undefined for a nonexistent tool', () => {
    expect(getToolRiskPolicy('nonexistent.tool')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getToolRiskPolicy('')).toBeUndefined();
  });
});

describe('write tool risk levels', () => {
  const writeTools = [
    'artifact.create',
    'artifact.update',
    'plan.patch',
    'email.send_draft',
    'calendar.create_event',
  ];

  it.each(writeTools)('%s has riskLevel >= medium', (toolName) => {
    const policy = getToolRiskPolicy(toolName);
    expect(policy).toBeDefined();
    const validLevels: string[] = ['medium', 'high', 'critical'];
    expect(validLevels).toContain(policy!.riskLevel);
  });

  it.each(writeTools)('%s requires approval', (toolName) => {
    const policy = getToolRiskPolicy(toolName);
    expect(policy).toBeDefined();
    expect(policy!.requiresApproval).toBe(true);
  });

  it('plan.patch has high risk level (high sensitivity)', () => {
    const policy = getToolRiskPolicy('plan.patch');
    expect(policy).toBeDefined();
    expect(policy!.riskLevel).toBe('high');
    expect(policy!.auditLevel).toBe('high');
  });

  it('email.send_draft has high risk level (high sensitivity)', () => {
    const policy = getToolRiskPolicy('email.send_draft');
    expect(policy).toBeDefined();
    expect(policy!.riskLevel).toBe('high');
    expect(policy!.auditLevel).toBe('high');
  });
});

describe('read tool risk levels', () => {
  const readTools = ['file.read', 'web.fetch', 'status.query'];

  it.each(readTools)('%s has riskLevel <= medium', (toolName) => {
    const policy = getToolRiskPolicy(toolName);
    expect(policy).toBeDefined();
    const validLevels: string[] = ['low', 'medium'];
    expect(validLevels).toContain(policy!.riskLevel);
  });

  it.each(readTools)('%s does not require approval', (toolName) => {
    const policy = getToolRiskPolicy(toolName);
    expect(policy).toBeDefined();
    expect(policy!.requiresApproval).toBe(false);
  });

  it('status.query (low sensitivity) has canAutoGrant=true', () => {
    const policy = getToolRiskPolicy('status.query');
    expect(policy).toBeDefined();
    expect(policy!.canAutoGrant).toBe(true);
  });

  it('file.read (medium sensitivity, read category) has canAutoGrant=true', () => {
    const policy = getToolRiskPolicy('file.read');
    expect(policy).toBeDefined();
    expect(policy!.canAutoGrant).toBe(true);
  });
});

describe('requiresApprovalByRisk', () => {
  it('critical requires approval', () => {
    expect(requiresApprovalByRisk('critical')).toBe(true);
  });

  it('high requires approval', () => {
    expect(requiresApprovalByRisk('high')).toBe(true);
  });

  it('medium does not require approval', () => {
    expect(requiresApprovalByRisk('medium')).toBe(false);
  });

  it('low does not require approval', () => {
    expect(requiresApprovalByRisk('low')).toBe(false);
  });
});

describe('individual tool requiresApproval correctness', () => {
  const expectApproval = (toolName: string, expected: boolean) => {
    const policy = getToolRiskPolicy(toolName);
    expect(policy).toBeDefined();
    expect(policy!.requiresApproval).toBe(expected);
  };

  it('write tools require approval', () => {
    expectApproval('artifact.create', true);
    expectApproval('artifact.update', true);
    expectApproval('plan.patch', true);
    expectApproval('email.send_draft', true);
    expectApproval('calendar.create_event', true);
  });

  it('read/search/internal tools do not require approval', () => {
    expectApproval('ask_user', false);
    expectApproval('status.query', false);
    expectApproval('memory.retrieve', false);
    expectApproval('transcript.search', false);
    expectApproval('docs.search', false);
    expectApproval('file.read', false);
    expectApproval('file.glob', false);
    expectApproval('file.grep', false);
    expectApproval('session.list', false);
    expectApproval('session.history', false);
    expectApproval('web.fetch', false);
    expectApproval('web.search', false);
    expectApproval('email.search', false);
    expectApproval('calendar.list', false);
    expectApproval('contacts.search', false);
    expectApproval('docs.read', false);
  });
});

describe('determineRiskLevel', () => {
  it('admin + restricted → critical', () => {
    expect(determineRiskLevel('admin', 'restricted')).toBe('critical');
    expect(determineRiskLevel('connector', 'restricted')).toBe('critical');
  });

  it('restricted on non-admin → high', () => {
    expect(determineRiskLevel('write', 'restricted')).toBe('high');
    expect(determineRiskLevel('read', 'restricted')).toBe('high');
  });

  it('dangerous category + high → high', () => {
    expect(determineRiskLevel('write', 'high')).toBe('high');
    expect(determineRiskLevel('delete', 'high')).toBe('high');
    expect(determineRiskLevel('send', 'high')).toBe('high');
    expect(determineRiskLevel('execute', 'high')).toBe('high');
    expect(determineRiskLevel('automation', 'high')).toBe('high');
  });

  it('safe category + high → medium', () => {
    expect(determineRiskLevel('read', 'high')).toBe('medium');
    expect(determineRiskLevel('search', 'high')).toBe('medium');
    expect(determineRiskLevel('internal', 'high')).toBe('medium');
  });

  it('automation + medium → high', () => {
    expect(determineRiskLevel('automation', 'medium')).toBe('high');
  });

  it('non-automation + medium → medium', () => {
    expect(determineRiskLevel('write', 'medium')).toBe('medium');
    expect(determineRiskLevel('read', 'medium')).toBe('medium');
    expect(determineRiskLevel('search', 'medium')).toBe('medium');
    expect(determineRiskLevel('internal', 'medium')).toBe('medium');
  });

  it('any category + low → low', () => {
    expect(determineRiskLevel('read', 'low')).toBe('low');
    expect(determineRiskLevel('write', 'low')).toBe('low');
    expect(determineRiskLevel('internal', 'low')).toBe('low');
    expect(determineRiskLevel('search', 'low')).toBe('low');
  });

  it('provides a policy for every built-in tool', () => {
    const policies = buildDefaultRiskPolicies();
    const catalogToolNames = new Set(policies.map((p) => p.toolName));
    for (const name of catalogToolNames) {
      const policy = getToolRiskPolicy(name);
      expect(policy).toBeDefined();
      expect(policy!.riskLevel).toBeTruthy();
    }
  });
});

describe('canAutoGrant correctness', () => {
  it('low sensitivity tools can auto-grant', () => {
    expect(getToolRiskPolicy('ask_user')!.canAutoGrant).toBe(true);
    expect(getToolRiskPolicy('status.query')!.canAutoGrant).toBe(true);
    expect(getToolRiskPolicy('docs.search')!.canAutoGrant).toBe(true);
  });

  it('medium sensitivity read tools can auto-grant', () => {
    expect(getToolRiskPolicy('file.read')!.canAutoGrant).toBe(true);
    expect(getToolRiskPolicy('memory.retrieve')!.canAutoGrant).toBe(true);
    expect(getToolRiskPolicy('web.fetch')!.canAutoGrant).toBe(true);
  });

  it('medium sensitivity non-read tools cannot auto-grant', () => {
    expect(getToolRiskPolicy('transcript.search')!.canAutoGrant).toBe(false);
    expect(getToolRiskPolicy('artifact.create')!.canAutoGrant).toBe(false);
    expect(getToolRiskPolicy('web.search')!.canAutoGrant).toBe(false);
  });

  it('high sensitivity tools cannot auto-grant', () => {
    expect(getToolRiskPolicy('plan.patch')!.canAutoGrant).toBe(false);
    expect(getToolRiskPolicy('email.send_draft')!.canAutoGrant).toBe(false);
  });
});

describe('auditLevel correctness', () => {
  it('low sensitivity → auditLevel low', () => {
    expect(getToolRiskPolicy('status.query')!.auditLevel).toBe('low');
    expect(getToolRiskPolicy('ask_user')!.auditLevel).toBe('low');
  });

  it('medium sensitivity → auditLevel medium', () => {
    expect(getToolRiskPolicy('file.read')!.auditLevel).toBe('medium');
    expect(getToolRiskPolicy('artifact.create')!.auditLevel).toBe('medium');
  });

  it('high sensitivity → auditLevel high', () => {
    expect(getToolRiskPolicy('plan.patch')!.auditLevel).toBe('high');
    expect(getToolRiskPolicy('email.send_draft')!.auditLevel).toBe('high');
  });
});
