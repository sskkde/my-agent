import type { RiskLevel } from './types.js'
import type { CanonicalToolCatalogEntry } from '../tools/tool-catalog.js'
import { getFallbackToolCatalog } from '../tools/tool-catalog.js'

export interface ToolRiskPolicy {
  toolName: string
  riskLevel: RiskLevel
  requiresApproval: boolean
  canAutoGrant: boolean
  auditLevel: 'low' | 'medium' | 'high'
}

const DANGEROUS_CATEGORIES = new Set(['write', 'delete', 'send', 'execute', 'automation', 'admin', 'connector'])

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
    return category === 'admin' || category === 'connector' ? 'critical' : 'high'
  }

  if (sensitivity === 'high') {
    return DANGEROUS_CATEGORIES.has(category) ? 'high' : 'medium'
  }

  if (sensitivity === 'medium') {
    return category === 'automation' ? 'high' : 'medium'
  }

  if (sensitivity === 'low') {
    return 'low'
  }

  return 'medium'
}

export function buildRiskPoliciesFromCatalog(entries: CanonicalToolCatalogEntry[]): ToolRiskPolicy[] {
  return entries.map((entry) => {
    const riskLevel = determineRiskLevel(entry.category, entry.sensitivity)
    return {
      toolName: entry.name,
      riskLevel,
      requiresApproval:
        entry.category === 'write' ||
        entry.category === 'delete' ||
        entry.category === 'send' ||
        entry.category === 'execute' ||
        entry.requiresPermission === true,
      canAutoGrant: entry.sensitivity === 'low' || (entry.sensitivity === 'medium' && entry.category === 'read'),
      auditLevel: entry.sensitivity === 'low' ? 'low' : entry.sensitivity === 'medium' ? 'medium' : 'high',
    }
  })
}

export function buildDefaultRiskPolicies(): ToolRiskPolicy[] {
  return buildRiskPoliciesFromCatalog(getFallbackToolCatalog())
}

const defaultPolicies: ToolRiskPolicy[] = buildDefaultRiskPolicies()

export function getToolRiskPolicy(toolName: string): ToolRiskPolicy | undefined {
  return defaultPolicies.find((p) => p.toolName === toolName)
}

export function requiresApprovalByRisk(riskLevel: RiskLevel): boolean {
  return riskLevel === 'high' || riskLevel === 'critical'
}
