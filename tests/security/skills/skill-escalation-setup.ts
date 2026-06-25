/**
 * Skill Escalation Security Tests Setup
 *
 * Shared test fixtures for skill escalation security tests.
 */

import type { SkillCatalogEntry } from '../../../src/foreground/effective-skill-ids.js'

export function makeSkillCatalog(): SkillCatalogEntry[] {
  return [
    { id: 'artifact_workflow', category: 'write' },
    { id: 'memory_research', category: 'read' },
    { id: 'session_status', category: 'read' },
    { id: 'documentation_search', category: 'search' },
    { id: 'web_research_guidance', category: 'search' },
    { id: 'admin_config', category: 'admin' },
    { id: 'custom_automation', category: 'automation' },
    { id: 'internal_ops', category: 'internal' },
    { id: 'pptx-generator', category: 'write' },
    { id: 'minimax-xlsx', category: 'read' },
    { id: 'minimax-docx', category: 'write' },
    { id: 'minimax-pdf', category: 'write' },
  ]
}

export const MINIMAX_SKILL_IDS = ['pptx-generator', 'minimax-xlsx', 'minimax-docx', 'minimax-pdf']
