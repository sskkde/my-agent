export type FeatureFlagPhase = 'shadow' | 'canary' | 'default'

const VALID_PHASES: readonly FeatureFlagPhase[] = ['shadow', 'canary', 'default']

export function getFlagPhase(envVar: string): FeatureFlagPhase | undefined {
  const value = process.env[envVar]
  if (!value) return undefined
  return VALID_PHASES.includes(value as FeatureFlagPhase) ? (value as FeatureFlagPhase) : undefined
}

export function getPromptMemoryP0Phase(): FeatureFlagPhase | undefined {
  return getFlagPhase('PROMPT_MEMORY_P0_PHASE')
}

export function getToolLoopV2Phase(): FeatureFlagPhase | undefined {
  return getFlagPhase('TOOL_LOOP_V2_PHASE')
}

export function isPromptMemoryP0PhaseActive(): boolean {
  const phase = getPromptMemoryP0Phase()
  return phase === 'canary' || phase === 'default'
}

export function isToolLoopV2PhaseActive(): boolean {
  const phase = getToolLoopV2Phase()
  return phase === 'canary' || phase === 'default'
}
