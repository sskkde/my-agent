import type { RiskLevel } from './types.js';
import { BUILT_IN_TOOLS } from '../api/tool-catalog.js';

export interface ToolRiskPolicy {
  toolName: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  canAutoGrant: boolean;
  auditLevel: 'low' | 'medium' | 'high';
}

const DANGEROUS_CATEGORIES = new Set([
  'write',
  'delete',
  'send',
  'execute',
  'automation',
  'admin',
  'connector',
]);

/**
 * Map a tool's category + sensitivity to a RiskLevel.
 *
 * Priority:
 *   admin/connector + restricted    → critical
 *   dangerous-category  + high      → high
 *   automation          + medium    → high
 *   restricted (non-admin)          → high
 *   read/search/internal + low      → low
 *   medium sensitivity              → medium
 *   high sensitivity (safe cats)    → medium
 */
export function determineRiskLevel(category: string, sensitivity: string): RiskLevel {
  if (sensitivity === 'restricted') {
    return category === 'admin' || category === 'connector' ? 'critical' : 'high';
  }

  if (sensitivity === 'high') {
    return DANGEROUS_CATEGORIES.has(category) ? 'high' : 'medium';
  }

  if (sensitivity === 'medium') {
    return category === 'automation' ? 'high' : 'medium';
  }

  if (sensitivity === 'low') {
    return 'low';
  }

  return 'medium';
}

export function buildDefaultRiskPolicies(): ToolRiskPolicy[] {
  return BUILT_IN_TOOLS.map((tool) => {
    const category: string = tool.category;
    const sensitivity: string = tool.sensitivity;
    const riskLevel = determineRiskLevel(category, sensitivity);
    return {
      toolName: tool.name,
      riskLevel,
      requiresApproval:
        category === 'write' ||
        category === 'delete' ||
        category === 'send' ||
        category === 'execute',
      canAutoGrant:
        sensitivity === 'low' ||
        (sensitivity === 'medium' && category === 'read'),
      auditLevel:
        sensitivity === 'low'
          ? 'low'
          : sensitivity === 'medium'
            ? 'medium'
            : 'high',
    };
  });
}

const defaultPolicies: ToolRiskPolicy[] = buildDefaultRiskPolicies();

export function getToolRiskPolicy(toolName: string): ToolRiskPolicy | undefined {
  return defaultPolicies.find((p) => p.toolName === toolName);
}

export function requiresApprovalByRisk(riskLevel: RiskLevel): boolean {
  return riskLevel === 'high' || riskLevel === 'critical';
}
