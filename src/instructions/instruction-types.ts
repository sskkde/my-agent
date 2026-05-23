/**
 * Instruction Types - Type definitions for instruction resolution system (Layer 5 / Segment B).
 * @module instructions/instruction-types
 */

/**
 * The source of an instruction block.
 * - 'system_prompt': AgentConfig.systemPrompt
 * - 'routing_prompt': AgentConfig.routingPrompt
 * - 'project_instructions': Future - project-level instruction overrides
 */
export type InstructionSource = 'system_prompt' | 'routing_prompt' | 'project_instructions';

/** Sorted by priority (lower number = inserted first = higher priority). */
export interface InstructionBlock {
  source: InstructionSource;
  content: string;
  /** Lower = higher priority, inserted first */
  priority: number;
}

/** Resolved instruction projection for Layer 5 with deterministic hash including tenantId. */
export interface InstructionProjection {
  blocks: InstructionBlock[];
  /** Deterministic hash including tenantId for isolation */
  instructionHash: string;
}

/** Parameters for instruction resolution with tenant isolation. */
export interface InstructionResolutionParams {
  /** Required - different tenants produce different hashes */
  tenantId: string;
  projectId?: string;
  agentConfig?: {
    systemPrompt?: string | null;
    routingPrompt?: string | null;
  };
}

/** Default priorities. Lower = higher priority. */
export const INSTRUCTION_PRIORITIES = {
  SYSTEM_PROMPT: 10,
  ROUTING_PROMPT: 20,
  PROJECT_INSTRUCTIONS: 30,
} as const;
