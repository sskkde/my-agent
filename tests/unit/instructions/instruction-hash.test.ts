import { describe, it, expect } from 'vitest';
import { computeInstructionHash } from '../../../src/instructions/instruction-hash.js';
import type { InstructionBlock } from '../../../src/instructions/instruction-types.js';

describe('computeInstructionHash', () => {
  const sampleBlocks: InstructionBlock[] = [
    { source: 'system_prompt', content: 'You are a helpful assistant.', priority: 10 },
    { source: 'routing_prompt', content: 'Route tasks by complexity.', priority: 20 },
  ];

  describe('determinism', () => {
    it('produces same hash for same blocks and tenantId', () => {
      const hash1 = computeInstructionHash(sampleBlocks, 'tenant-1');
      const hash2 = computeInstructionHash(sampleBlocks, 'tenant-1');
      expect(hash1).toBe(hash2);
    });

    it('produces valid SHA-256 hex string', () => {
      const hash = computeInstructionHash(sampleBlocks, 'tenant-1');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('tenant isolation', () => {
    it('produces different hashes for different tenantIds with same blocks', () => {
      const hash1 = computeInstructionHash(sampleBlocks, 'tenant-A');
      const hash2 = computeInstructionHash(sampleBlocks, 'tenant-B');
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hashes even for empty blocks with different tenantIds', () => {
      const hash1 = computeInstructionHash([], 'tenant-A');
      const hash2 = computeInstructionHash([], 'tenant-B');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('block ordering', () => {
    it('produces same hash regardless of block input order', () => {
      const reversedBlocks = [...sampleBlocks].reverse();
      const hash1 = computeInstructionHash(sampleBlocks, 'tenant-1');
      const hash2 = computeInstructionHash(reversedBlocks, 'tenant-1');
      expect(hash1).toBe(hash2);
    });

    it('sorts by priority first, then source name', () => {
      const blockA: InstructionBlock = { source: 'system_prompt', content: 'A', priority: 10 };
      const blockB: InstructionBlock = { source: 'routing_prompt', content: 'B', priority: 20 };
      const blockC: InstructionBlock = { source: 'project_instructions', content: 'C', priority: 20 };

      const ordered = [blockA, blockB, blockC];
      const reversed = [blockC, blockB, blockA];

      const hash1 = computeInstructionHash(ordered, 'tenant-1');
      const hash2 = computeInstructionHash(reversed, 'tenant-1');
      expect(hash1).toBe(hash2);
    });
  });

  describe('content sensitivity', () => {
    it('produces different hashes for different content', () => {
      const blocks1: InstructionBlock[] = [
        { source: 'system_prompt', content: 'Hello', priority: 10 },
      ];
      const blocks2: InstructionBlock[] = [
        { source: 'system_prompt', content: 'World', priority: 10 },
      ];

      const hash1 = computeInstructionHash(blocks1, 'tenant-1');
      const hash2 = computeInstructionHash(blocks2, 'tenant-1');
      expect(hash1).not.toBe(hash2);
    });

    it('produces different hashes for different sources with same content', () => {
      const blocks1: InstructionBlock[] = [
        { source: 'system_prompt', content: 'Same content', priority: 10 },
      ];
      const blocks2: InstructionBlock[] = [
        { source: 'routing_prompt', content: 'Same content', priority: 10 },
      ];

      const hash1 = computeInstructionHash(blocks1, 'tenant-1');
      const hash2 = computeInstructionHash(blocks2, 'tenant-1');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('empty blocks', () => {
    it('produces valid hash for empty blocks array', () => {
      const hash = computeInstructionHash([], 'tenant-1');
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces different hashes for empty vs non-empty blocks', () => {
      const hashEmpty = computeInstructionHash([], 'tenant-1');
      const hashNonEmpty = computeInstructionHash(sampleBlocks, 'tenant-1');
      expect(hashEmpty).not.toBe(hashNonEmpty);
    });
  });
});
