/**
 * Instruction Resolver - Multi-source instruction aggregation for Layer 5.
 * @module instructions/instruction-resolver
 */

import type {
  InstructionBlock,
  InstructionProjection,
  InstructionResolutionParams,
} from './instruction-types.js';
import { INSTRUCTION_PRIORITIES } from './instruction-types.js';
import { computeInstructionHash } from './instruction-hash.js';

/**
 * Resolves instructions from multiple sources into a single projection.
 *
 * Sources (in priority order):
 * 1. AgentConfig.systemPrompt (priority 10) - agent behavior
 * 2. AgentConfig.routingPrompt (priority 20) - routing instructions
 * 3. Future: project-level instructions (priority 30)
 *
 * Tenant Isolation:
 * - Different tenants always produce different instructionHash
 * - Even with identical configs, tenantId difference ensures hash difference
 */
export class InstructionResolver {
  resolve(params: InstructionResolutionParams): InstructionProjection {
    const blocks = this.collectBlocks(params);
    const instructionHash = computeInstructionHash(blocks, params.tenantId);
    return { blocks, instructionHash };
  }

  private collectBlocks(params: InstructionResolutionParams): InstructionBlock[] {
    const blocks: InstructionBlock[] = [];
    const { agentConfig } = params;

    if (agentConfig?.systemPrompt) {
      blocks.push({
        source: 'system_prompt',
        content: agentConfig.systemPrompt,
        priority: INSTRUCTION_PRIORITIES.SYSTEM_PROMPT,
      });
    }

    if (agentConfig?.routingPrompt) {
      blocks.push({
        source: 'routing_prompt',
        content: agentConfig.routingPrompt,
        priority: INSTRUCTION_PRIORITIES.ROUTING_PROMPT,
      });
    }

    return blocks.sort((a, b) => a.priority - b.priority);
  }
}

export function createInstructionResolver(): InstructionResolver {
  return new InstructionResolver();
}
