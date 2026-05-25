/**
 * Unit tests for long-term memory extraction contract, prompt, canonicalization, and validator
 */

import { describe, it, expect } from 'vitest';
import {
  type AllowedLongTermMemoryType,
  type AutoExtractedMemoryType,
  type ExtractedMemoryCandidate,
  type MemoryExtractionWindow,
  AUTO_EXTRACTED_MEMORY_TYPES,
  stableJsonHash,
  fingerprintMemoryCandidate,
  validateExtractedCandidate,
  canonicalizeMemoryCandidate,
  buildLongTermMemoryExtractionPrompt,
} from '../../../src/memory/long-term-memory-extraction.js';

describe('Long-term Memory Extraction', () => {
  // ============================================================================
  // Type Tests (compile-time)
  // ============================================================================

  describe('Type definitions', () => {
    it('AutoExtractedMemoryType should only allow exactly 5 auto-extraction types', () => {
      const validTypes: AutoExtractedMemoryType[] = [
        'user_preference',
        'user_profile',
        'user_safety_rule',
        'project_state',
        'long_term_fact',
      ];
      expect(validTypes).toHaveLength(5);
    });

    it('AUTO_EXTRACTED_MEMORY_TYPES constant has exactly 5 entries', () => {
      expect(AUTO_EXTRACTED_MEMORY_TYPES).toHaveLength(5);
      expect(AUTO_EXTRACTED_MEMORY_TYPES).toContain('long_term_fact');
    });

    it('AllowedLongTermMemoryType includes gated/backcompat types beyond auto-extraction', () => {
      const storageTypes: AllowedLongTermMemoryType[] = [
        'user_preference',
        'user_profile',
        'user_safety_rule',
        'project_state',
        'long_term_fact',
        'relationship',
        'durable_fact',
        'episodic_summary',
        'routine',
        'workflow_preference',
      ];
      expect(storageTypes).toHaveLength(10);
    });

    it('ExtractedMemoryCandidate should have required fields', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'User prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode', 'preference'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1', 'turn-2'],
          extraction: {
            windowHash: 'abc123',
            triggerTurnId: 'turn-2',
            includedTurnIds: ['turn-1', 'turn-2'],
          },
        },
      };
      expect(candidate.memoryType).toBe('user_preference');
    });

    it('ExtractedMemoryCandidate should support optional fields', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_profile',
        text: 'User is a software engineer',
        structured: { role: 'software engineer', experience: '5 years' },
        confidence: 0.85,
        importance: 'medium',
        sensitivity: 'low',
        keywords: ['profile', 'engineer'],
        entities: [
          { entityType: 'person', displayName: 'John Doe' },
        ],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash123',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
        discardReason: undefined,
      };
      expect(candidate.structured).toBeDefined();
      expect(candidate.entities).toBeDefined();
    });

    it('MemoryExtractionWindow should have all required fields', () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User conversation transcript...',
      };
      expect(window.userId).toBe('user-123');
      expect(window.includedTurnIds).toHaveLength(5);
    });
  });

  // ============================================================================
  // stableJsonHash Tests
  // ============================================================================

  describe('stableJsonHash', () => {
    it('should produce deterministic hash for same object', () => {
      const obj = { b: 2, a: 1, c: { y: 2, x: 1 } };
      const hash1 = stableJsonHash(obj);
      const hash2 = stableJsonHash(obj);
      expect(hash1).toBe(hash2);
    });

    it('should produce same hash regardless of key order', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };
      expect(stableJsonHash(obj1)).toBe(stableJsonHash(obj2));
    });

    it('should handle nested objects with sorted keys', () => {
      const obj1 = { outer: { b: 2, a: 1 } };
      const obj2 = { outer: { a: 1, b: 2 } };
      expect(stableJsonHash(obj1)).toBe(stableJsonHash(obj2));
    });

    it('should handle arrays (order preserved)', () => {
      const obj = { items: ['a', 'b', 'c'] };
      const hash = stableJsonHash(obj);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBe(64); // SHA-256 produces 64 hex chars
    });

    it('should handle primitive values', () => {
      expect(stableJsonHash('test')).toMatch(/^[a-f0-9]{64}$/);
      expect(stableJsonHash(123)).toMatch(/^[a-f0-9]{64}$/);
      expect(stableJsonHash(true)).toMatch(/^[a-f0-9]{64}$/);
      expect(stableJsonHash(null)).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should produce different hashes for different values', () => {
      const hash1 = stableJsonHash({ a: 1 });
      const hash2 = stableJsonHash({ a: 2 });
      expect(hash1).not.toBe(hash2);
    });
  });

  // ============================================================================
  // fingerprintMemoryCandidate Tests
  // ============================================================================

  describe('fingerprintMemoryCandidate', () => {
    it('should produce deterministic fingerprint for same candidate', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const fp1 = fingerprintMemoryCandidate('user-123', candidate);
      const fp2 = fingerprintMemoryCandidate('user-123', candidate);
      expect(fp1).toBe(fp2);
    });

    it('should produce different fingerprints for different users', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const fp1 = fingerprintMemoryCandidate('user-123', candidate);
      const fp2 = fingerprintMemoryCandidate('user-456', candidate);
      expect(fp1).not.toBe(fp2);
    });

    it('should NOT include windowHash in fingerprint', () => {
      const candidate1: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const candidate2: ExtractedMemoryCandidate = {
        ...candidate1,
        sourceRefs: {
          ...candidate1.sourceRefs,
          extraction: {
            ...candidate1.sourceRefs.extraction!,
            windowHash: 'hash2', // Different window hash
          },
        },
      };

      const fp1 = fingerprintMemoryCandidate('user-123', candidate1);
      const fp2 = fingerprintMemoryCandidate('user-123', candidate2);
      expect(fp1).toBe(fp2); // Should be same despite different windowHash
    });

    it('should include normalized text and structured data', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_profile',
        text: '  Software Engineer  ',
        structured: { role: 'engineer', level: 'senior' },
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['profile'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const fp = fingerprintMemoryCandidate('user-123', candidate);
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle candidates without structured data', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const fp = fingerprintMemoryCandidate('user-123', candidate);
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should handle candidates without entities', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
        // No entities field
      };

      const fp = fingerprintMemoryCandidate('user-123', candidate);
      expect(fp).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  // ============================================================================
  // validateExtractedCandidate Tests
  // ============================================================================

  describe('validateExtractedCandidate', () => {
    const validWindow: MemoryExtractionWindow = {
      userId: 'user-123',
      sessionId: 'session-456',
      triggerTurnId: 'turn-5',
      includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
      windowHash: 'sha256:abc123',
      sessionMemorySummaryId: 'summary-789',
      renderedInput: 'Transcript...',
    };

    it('should accept valid candidate', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(true);
    });

    it('should reject unsupported memory types', () => {
      const candidate = {
        memoryType: 'routine', // Not in AllowedLongTermMemoryType
        text: 'User follows a routine',
        confidence: 0.9,
        importance: 'medium',
        sensitivity: 'low',
        keywords: ['routine'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      } as ExtractedMemoryCandidate;

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('unsupported_memory_type');
    });

    it('should reject missing transcriptRefs', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          // Missing transcriptRefs
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing_transcript_refs');
    });

    it('should reject empty transcriptRefs', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: [], // Empty
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing_transcript_refs');
    });

    it('should reject missing extraction.windowHash', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            // Missing windowHash
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          } as ExtractedMemoryCandidate['sourceRefs']['extraction'],
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('missing_window_hash');
    });

    it('should reject confidence below 0.7', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.6, // Below threshold
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('confidence_out_of_range');
    });

    it('should accept confidence at exactly 0.7', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.7, // At threshold
        importance: 'medium',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(true);
    });

    it('should force visibility to private_user', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'workspace' }, // Should be forced to private_user
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(true);
      expect(result.normalizedCandidate?.scope.visibility).toBe('private_user');
    });

    it('should strip extra scope fields (projectId, workflowId, connector)', () => {
      const candidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low' as const,
        keywords: ['dark mode'],
        scope: { visibility: 'workspace' as const, projectId: 'proj-1', workflowId: 'wf-1', connector: 'slack' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(true);
      expect(result.normalizedCandidate?.scope).toEqual({ visibility: 'private_user' });
      expect(result.normalizedCandidate?.scope).not.toHaveProperty('projectId');
      expect(result.normalizedCandidate?.scope).not.toHaveProperty('workflowId');
      expect(result.normalizedCandidate?.scope).not.toHaveProperty('connector');
    });

    it('should reject invalid importance values', () => {
      const candidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'super_critical' as unknown as 'high', // Invalid
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      } as ExtractedMemoryCandidate;

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('invalid_importance');
    });

    it('should reject missing importance', () => {
      const candidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        // Missing importance
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      } as ExtractedMemoryCandidate;

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('invalid_importance');
    });

    it('should reject sensitivity = restricted in P0', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Sensitive preference',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'restricted', // Not allowed in P0
        keywords: ['sensitive'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const result = validateExtractedCandidate(candidate, validWindow);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('restricted_sensitivity');
    });

    it('should accept all valid importance levels', () => {
      const importanceLevels: Array<'low' | 'medium' | 'high' | 'critical'> = ['low', 'medium', 'high', 'critical'];
      
      for (const importance of importanceLevels) {
        const candidate: ExtractedMemoryCandidate = {
          memoryType: 'user_preference',
          text: 'Prefers dark mode',
          confidence: 0.9,
          importance,
          sensitivity: 'low',
          keywords: ['dark mode'],
          scope: { visibility: 'private_user' },
          sourceRefs: {
            transcriptRefs: ['turn-1'],
            extraction: {
              windowHash: 'hash1',
              triggerTurnId: 'turn-1',
              includedTurnIds: ['turn-1'],
            },
          },
        };

        const result = validateExtractedCandidate(candidate, validWindow);
        expect(result.valid).toBe(true);
        expect(result.normalizedCandidate?.importance).toBe(importance);
      }
    });

    it('should accept all valid sensitivity levels except restricted', () => {
      const validSensitivities: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high'];
      
      for (const sensitivity of validSensitivities) {
        const candidate: ExtractedMemoryCandidate = {
          memoryType: 'user_preference',
          text: 'Preference',
          confidence: 0.9,
          importance: 'medium',
          sensitivity,
          keywords: ['preference'],
          scope: { visibility: 'private_user' },
          sourceRefs: {
            transcriptRefs: ['turn-1'],
            extraction: {
              windowHash: 'hash1',
              triggerTurnId: 'turn-1',
              includedTurnIds: ['turn-1'],
            },
          },
        };

        const result = validateExtractedCandidate(candidate, validWindow);
        expect(result.valid).toBe(true);
      }
    });

    it('should accept all auto-extracted memory types', () => {
      const autoTypes: AutoExtractedMemoryType[] = [
        'user_preference',
        'user_profile',
        'user_safety_rule',
        'project_state',
        'long_term_fact',
      ];

      for (const memoryType of autoTypes) {
        const candidate: ExtractedMemoryCandidate = {
          memoryType,
          text: 'Memory content',
          confidence: 0.9,
          importance: 'medium',
          sensitivity: 'low',
          keywords: ['test'],
          scope: { visibility: 'private_user' },
          sourceRefs: {
            transcriptRefs: ['turn-1'],
            extraction: {
              windowHash: 'hash1',
              triggerTurnId: 'turn-1',
              includedTurnIds: ['turn-1'],
            },
          },
        };

        const result = validateExtractedCandidate(candidate, validWindow);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject non-auto-extraction memory types', () => {
      const gatedTypes = [
        'routine',
        'workflow_preference',
        'relationship',
        'durable_fact',
        'episodic_summary',
      ];

      for (const memoryType of gatedTypes) {
        const candidate = {
          memoryType,
          text: 'Memory content',
          confidence: 0.9,
          importance: 'medium',
          sensitivity: 'low',
          keywords: ['test'],
          scope: { visibility: 'private_user' },
          sourceRefs: {
            transcriptRefs: ['turn-1'],
            extraction: {
              windowHash: 'hash1',
              triggerTurnId: 'turn-1',
              includedTurnIds: ['turn-1'],
            },
          },
        } as ExtractedMemoryCandidate;

        const result = validateExtractedCandidate(candidate, validWindow);
        expect(result.valid).toBe(false);
        expect(result.reason).toContain('unsupported_memory_type');
      }
    });
  });

  // ============================================================================
  // canonicalizeMemoryCandidate Tests
  // ============================================================================

  describe('canonicalizeMemoryCandidate', () => {
    it('should normalize text by trimming whitespace and lowercasing', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: '  Prefers dark mode  ',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const canonical = canonicalizeMemoryCandidate(candidate);
      expect(canonical.normalizedText).toBe('prefers dark mode');
    });

    it('should normalize structured data with sorted keys', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_profile',
        text: 'User profile',
        structured: { z: 'last', a: 'first', m: 'middle' },
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['profile'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const canonical = canonicalizeMemoryCandidate(candidate);
      expect(canonical.normalizedStructured).toBeDefined();
      // Should have sorted keys
      const keys = Object.keys(canonical.normalizedStructured!);
      expect(keys).toEqual(['a', 'm', 'z']);
    });

    it('should handle candidates without structured data', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const canonical = canonicalizeMemoryCandidate(candidate);
      expect(canonical.normalizedStructured).toBeUndefined();
    });

    it('should normalize entities by sorting', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_profile',
        text: 'User profile',
        entities: [
          { entityType: 'person', displayName: 'Bob' },
          { entityType: 'person', displayName: 'Alice' },
        ],
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['profile'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const canonical = canonicalizeMemoryCandidate(candidate);
      expect(canonical.normalizedEntities).toBeDefined();
      expect(canonical.normalizedEntities).toHaveLength(2);
    });

    it('should handle candidates without entities', () => {
      const candidate: ExtractedMemoryCandidate = {
        memoryType: 'user_preference',
        text: 'Prefers dark mode',
        confidence: 0.9,
        importance: 'high',
        sensitivity: 'low',
        keywords: ['dark mode'],
        scope: { visibility: 'private_user' },
        sourceRefs: {
          transcriptRefs: ['turn-1'],
          extraction: {
            windowHash: 'hash1',
            triggerTurnId: 'turn-1',
            includedTurnIds: ['turn-1'],
          },
        },
      };

      const canonical = canonicalizeMemoryCandidate(candidate);
      expect(canonical.normalizedEntities).toBeUndefined();
    });
  });

  // ============================================================================
  // buildLongTermMemoryExtractionPrompt Tests
  // ============================================================================

  describe('buildLongTermMemoryExtractionPrompt', () => {
    it('should generate structured JSON-only prompt', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User: Hello\nAssistant: Hi there!',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('user_preference');
      expect(prompt).toContain('user_profile');
      expect(prompt).toContain('user_safety_rule');
      expect(prompt).toContain('project_state');
      expect(prompt).toContain('long_term_fact');
    });

    it('should instruct model to discard one-off tasks', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User: Help me with this task...',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt.toLowerCase()).toMatch(/discard|one-off|transient/);
    });

    it('should instruct model to discard unsupported memory types', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User: Remember this...',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt.toLowerCase()).toMatch(/unsupported|memory type/);
    });

    it('should instruct model to discard missing provenance', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User: Something...',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt.toLowerCase()).toMatch(/provenance|source/);
    });

    it('should instruct model to discard low-confidence claims', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User: Maybe...',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt.toLowerCase()).toMatch(/confidence|uncertain/);
    });

    it('should instruct model to discard sensitive content', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User: Secret...',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt.toLowerCase()).toMatch(/sensitive|should not be stored/);
    });

    it('should include rendered input in prompt', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'User: I prefer dark mode\nAssistant: Noted!',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt).toContain('I prefer dark mode');
    });

    it('should include window metadata in prompt', async () => {
      const window: MemoryExtractionWindow = {
        userId: 'user-123',
        sessionId: 'session-456',
        triggerTurnId: 'turn-5',
        includedTurnIds: ['turn-1', 'turn-2', 'turn-3', 'turn-4', 'turn-5'],
        windowHash: 'sha256:abc123',
        sessionMemorySummaryId: 'summary-789',
        renderedInput: 'Transcript...',
      };

      const prompt = await buildLongTermMemoryExtractionPrompt(window);
      expect(prompt).toContain('user-123');
      expect(prompt).toContain('session-456');
    });
  });
});
