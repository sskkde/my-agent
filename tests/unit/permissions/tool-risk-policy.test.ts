import { describe, it, expect } from 'vitest';
import {
  buildDefaultRiskPolicies,
  getToolRiskPolicy,
  requiresApprovalByRisk,
  determineRiskLevel,
} from '../../../src/permissions/tool-risk-policy.js';
import { BUILT_IN_TOOLS } from '../../../src/api/tool-catalog.js';

describe('buildDefaultRiskPolicies', () => {
  it('returns one policy for each built-in tool', () => {
    const policies = buildDefaultRiskPolicies();
    expect(policies).toHaveLength(BUILT_IN_TOOLS.length);
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
    expect(new Set(names).size).toBe(BUILT_IN_TOOLS.length);
  });
});

describe('getToolRiskPolicy', () => {
  it('returns the correct policy for file_read', () => {
    const policy = getToolRiskPolicy('file_read');
    expect(policy).toBeDefined();
    expect(policy!.toolName).toBe('file_read');
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
    'artifact_create',
    'artifact_update',
    'plan_patch',
    'email_send_draft',
    'calendar_create_event',
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

  it('plan_patch has high risk level (high sensitivity)', () => {
    const policy = getToolRiskPolicy('plan_patch');
    expect(policy).toBeDefined();
    expect(policy!.riskLevel).toBe('high');
    expect(policy!.auditLevel).toBe('high');
  });

  it('email_send_draft has high risk level (high sensitivity)', () => {
    const policy = getToolRiskPolicy('email_send_draft');
    expect(policy).toBeDefined();
    expect(policy!.riskLevel).toBe('high');
    expect(policy!.auditLevel).toBe('high');
  });
});

describe('read tool risk levels', () => {
  const readTools = ['file_read', 'web_fetch', 'status_query'];

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

  it('status_query (low sensitivity) has canAutoGrant=true', () => {
    const policy = getToolRiskPolicy('status_query');
    expect(policy).toBeDefined();
    expect(policy!.canAutoGrant).toBe(true);
  });

  it('file_read (medium sensitivity, read category) has canAutoGrant=true', () => {
    const policy = getToolRiskPolicy('file_read');
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
    expectApproval('artifact_create', true);
    expectApproval('artifact_update', true);
    expectApproval('plan_patch', true);
    expectApproval('email_send_draft', true);
    expectApproval('calendar_create_event', true);
  });

  it('read/search/internal tools do not require approval', () => {
    expectApproval('ask_user', false);
    expectApproval('status_query', false);
    expectApproval('memory_retrieve', false);
    expectApproval('transcript_search', false);
    expectApproval('docs_search', false);
    expectApproval('file_read', false);
    expectApproval('file_glob', false);
    expectApproval('file_grep', false);
    expectApproval('session_list', false);
    expectApproval('session_history', false);
    expectApproval('web_fetch', false);
    expectApproval('web_search', false);
    expectApproval('email_search', false);
    expectApproval('calendar_list', false);
    expectApproval('contacts_search', false);
    expectApproval('docs_read', false);
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
    expect(getToolRiskPolicy('status_query')!.canAutoGrant).toBe(true);
    expect(getToolRiskPolicy('docs_search')!.canAutoGrant).toBe(true);
  });

  it('medium sensitivity read tools can auto-grant', () => {
    expect(getToolRiskPolicy('file_read')!.canAutoGrant).toBe(true);
    expect(getToolRiskPolicy('memory_retrieve')!.canAutoGrant).toBe(true);
    expect(getToolRiskPolicy('web_fetch')!.canAutoGrant).toBe(true);
  });

  it('medium sensitivity non-read tools cannot auto-grant', () => {
    expect(getToolRiskPolicy('transcript_search')!.canAutoGrant).toBe(false);
    expect(getToolRiskPolicy('artifact_create')!.canAutoGrant).toBe(false);
    expect(getToolRiskPolicy('web_search')!.canAutoGrant).toBe(false);
  });

  it('high sensitivity tools cannot auto-grant', () => {
    expect(getToolRiskPolicy('plan_patch')!.canAutoGrant).toBe(false);
    expect(getToolRiskPolicy('email_send_draft')!.canAutoGrant).toBe(false);
  });
});

describe('auditLevel correctness', () => {
  it('low sensitivity → auditLevel low', () => {
    expect(getToolRiskPolicy('status_query')!.auditLevel).toBe('low');
    expect(getToolRiskPolicy('ask_user')!.auditLevel).toBe('low');
  });

  it('medium sensitivity → auditLevel medium', () => {
    expect(getToolRiskPolicy('file_read')!.auditLevel).toBe('medium');
    expect(getToolRiskPolicy('artifact_create')!.auditLevel).toBe('medium');
  });

  it('high sensitivity → auditLevel high', () => {
    expect(getToolRiskPolicy('plan_patch')!.auditLevel).toBe('high');
    expect(getToolRiskPolicy('email_send_draft')!.auditLevel).toBe('high');
  });
});
