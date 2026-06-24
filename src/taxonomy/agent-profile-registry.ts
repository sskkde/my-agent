import type { AgentType } from '../context/types.js'

// ---------------------------------------------------------------------------
// AgentProfile: configurable capability/persona label
// ---------------------------------------------------------------------------

export interface AgentProfile {
  id: string
  displayName: string
  description?: string
  allowedAgentTypes: AgentType[]
  promptTemplateIds: string[]
  defaultToolIds: string[]
  /** Default skill IDs — intersected with AgentType envelope at runtime. */
  defaultSkillIds?: string[]
  defaultModel?: string
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  ownerScope: 'system' | 'user' | 'workspace'
}

// ---------------------------------------------------------------------------
// AgentProfileRegistry
// ---------------------------------------------------------------------------

export interface AgentProfileRegistry {
  register(profile: AgentProfile): void
  get(profileId: string): AgentProfile | undefined
  list(): AgentProfile[]
  assertAllowed(profileId: string): AgentProfile
}

export function createAgentProfileRegistry(): AgentProfileRegistry {
  const profiles = new Map<string, AgentProfile>()

  return {
    register(profile: AgentProfile): void {
      if (profiles.has(profile.id)) {
        throw new Error(`Agent profile already registered: "${profile.id}"`)
      }
      profiles.set(profile.id, profile)
    },

    get(profileId: string): AgentProfile | undefined {
      return profiles.get(profileId)
    },

    list(): AgentProfile[] {
      return [...profiles.values()]
    },

    assertAllowed(profileId: string): AgentProfile {
      const profile = profiles.get(profileId)
      if (!profile) {
        throw new Error(`Unknown agent profile: "${profileId}"`)
      }
      return profile
    },
  }
}

// ---------------------------------------------------------------------------
// System profiles
// ---------------------------------------------------------------------------

const defaultMain: AgentProfile = {
  id: 'default_main',
  displayName: 'Default Main',
  description: 'Default main agent profile. Maps from legacy kernel.',
  allowedAgentTypes: ['main'],
  promptTemplateIds: ['agentProfile:default_main'],
  defaultToolIds: [],
  defaultSkillIds: ['memory_research', 'session_status', 'documentation_search', 'web_research_guidance'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const foreground: AgentProfile = {
  id: 'foreground',
  displayName: 'Foreground',
  description: 'User-facing foreground agent profile.',
  allowedAgentTypes: ['main'],
  promptTemplateIds: ['agentProfile:foreground'],
  defaultToolIds: ['foreground_spawn_planner', 'foreground_launch_subagent', 'foreground_status_query'],
  defaultSkillIds: ['session_status', 'documentation_search', 'web_research_guidance'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const planner: AgentProfile = {
  id: 'planner',
  displayName: 'Planner',
  description: 'Task planning and orchestration profile.',
  allowedAgentTypes: ['subagent', 'workflow_step'],
  promptTemplateIds: ['agentProfile:planner', 'outputContract:planner.schema'],
  defaultToolIds: ['ask_user', 'plan_patch'],
  defaultSkillIds: ['artifact_workflow', 'memory_research', 'session_status', 'documentation_search', 'web_research_guidance'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const memory: AgentProfile = {
  id: 'memory',
  displayName: 'Memory',
  description: 'Background memory extraction and management profile.',
  allowedAgentTypes: ['background'],
  promptTemplateIds: ['agentProfile:memory', 'outputContract:memory-candidate.schema'],
  defaultToolIds: ['transcript_search', 'memory_retrieve'],
  defaultSkillIds: ['memory_research', 'session_status', 'documentation_search'],
  riskLevel: 'high',
  ownerScope: 'system',
}

const search: AgentProfile = {
  id: 'search',
  displayName: 'Search',
  description: 'Search capabilities profile for subagent or background use.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:search'],
  defaultToolIds: ['web_search', 'docs_search'],
  defaultSkillIds: ['documentation_search', 'web_research_guidance'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const documentProcessor: AgentProfile = {
  id: 'document_processor',
  displayName: 'Document Processor',
  description: 'Document processing: text extraction, summarization, analysis.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:document_processor'],
  defaultToolIds: ['file_read', 'file_glob', 'file_grep', 'docs_search', 'artifact_create', 'artifact_update'],
  defaultSkillIds: ['documentation_search'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const imageProcessor: AgentProfile = {
  id: 'image_processor',
  displayName: 'Image Processor',
  description: 'Image processing: visual understanding, description, analysis.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:image_processor'],
  defaultToolIds: ['file_read', 'artifact_create', 'artifact_update'],
  defaultSkillIds: ['documentation_search'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const dataProcessor: AgentProfile = {
  id: 'data_processor',
  displayName: 'Data Processor',
  description: 'Structured data processing: conversion, analysis, formatting.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:data_processor'],
  defaultToolIds: ['file_read', 'file_glob', 'artifact_create', 'artifact_update'],
  defaultSkillIds: ['documentation_search'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const audioProcessor: AgentProfile = {
  id: 'audio_processor',
  displayName: 'Audio Processor',
  description: 'Audio processing: transcription, analysis, content extraction.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:audio_processor'],
  defaultToolIds: ['file_read', 'artifact_create', 'artifact_update'],
  defaultSkillIds: ['documentation_search'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const codeProcessor: AgentProfile = {
  id: 'code_processor',
  displayName: 'Code Processor',
  description: 'Code processing: analysis, refactoring suggestions, generation.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:code_processor'],
  defaultToolIds: ['file_read', 'file_glob', 'file_grep', 'artifact_create', 'artifact_update'],
  defaultSkillIds: ['documentation_search'],
  riskLevel: 'high',
  ownerScope: 'system',
}

const researchProcessor: AgentProfile = {
  id: 'research_processor',
  displayName: 'Research Processor',
  description: 'Deep research retrieval: multi-source aggregation, analysis, reports.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:research_processor'],
  defaultToolIds: ['web_search', 'web_fetch', 'docs_search', 'artifact_create', 'artifact_update'],
  defaultSkillIds: ['documentation_search', 'web_research_guidance'],
  riskLevel: 'medium',
  ownerScope: 'system',
}

const searchProcessor: AgentProfile = {
  id: 'search_processor',
  displayName: 'Search Processor',
  description: 'Quick web search and summarization.',
  allowedAgentTypes: ['subagent', 'background'],
  promptTemplateIds: ['agentProfile:search_processor'],
  defaultToolIds: ['web_search'],
  defaultSkillIds: ['documentation_search', 'web_research_guidance'],
  riskLevel: 'low',
  ownerScope: 'system',
}

const SYSTEM_PROFILES: readonly AgentProfile[] = [
  defaultMain,
  foreground,
  planner,
  memory,
  search,
  documentProcessor,
  imageProcessor,
  dataProcessor,
  audioProcessor,
  codeProcessor,
  researchProcessor,
  searchProcessor,
]

export function registerSystemProfiles(registry: AgentProfileRegistry): void {
  for (const profile of SYSTEM_PROFILES) {
    registry.register(profile)
  }
}
