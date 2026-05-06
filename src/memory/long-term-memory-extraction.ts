import * as crypto from 'crypto';
import type { Importance, Sensitivity, Visibility, MemoryEntity, MemoryScope } from '../storage/long-term-memory-store.js';

export type AllowedLongTermMemoryType =
  | 'user_preference'
  | 'user_profile'
  | 'user_safety_rule'
  | 'project_state';

export type ExtractionSourceRefs = {
  transcriptRefs?: string[];
  summaryRefs?: string[];
  extraction?: {
    windowHash: string;
    triggerTurnId: string;
    includedTurnIds: string[];
  };
};

export type ExtractedMemoryCandidate = {
  memoryType: AllowedLongTermMemoryType | string;
  text: string;
  structured?: Record<string, unknown>;
  confidence: number;
  importance: Importance | string;
  sensitivity: Sensitivity;
  keywords: string[];
  entities?: MemoryEntity[];
  scope: MemoryScope;
  sourceRefs: ExtractionSourceRefs;
  discardReason?: string;
};

export type MemoryExtractionWindow = {
  userId: string;
  sessionId: string;
  triggerTurnId: string;
  includedTurnIds: string[];
  windowHash: string;
  sessionMemorySummaryId: string;
  renderedInput: string;
};

export type ValidationResult = {
  valid: boolean;
  reason?: string;
  normalizedCandidate?: ExtractedMemoryCandidate;
};

export type CanonicalizedCandidate = {
  normalizedText: string;
  normalizedStructured?: Record<string, unknown>;
  normalizedEntities?: MemoryEntity[];
};

const VALID_IMPORTANCE: Importance[] = ['low', 'medium', 'high', 'critical'];
const P0_MEMORY_TYPES: AllowedLongTermMemoryType[] = [
  'user_preference',
  'user_profile',
  'user_safety_rule',
  'project_state',
];
const MIN_CONFIDENCE = 0.7;

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }

  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function stableJsonHash(value: unknown): string {
  const sorted = sortObjectKeys(value);
  const json = JSON.stringify(sorted);
  return crypto.createHash('sha256').update(json).digest('hex');
}

export function canonicalizeMemoryCandidate(candidate: ExtractedMemoryCandidate): CanonicalizedCandidate {
  const normalizedText = candidate.text.trim().toLowerCase();
  
  let normalizedStructured: Record<string, unknown> | undefined;
  if (candidate.structured) {
    normalizedStructured = sortObjectKeys(candidate.structured) as Record<string, unknown>;
  }

  let normalizedEntities: MemoryEntity[] | undefined;
  if (candidate.entities && candidate.entities.length > 0) {
    normalizedEntities = [...candidate.entities].sort((a, b) => {
      const typeCompare = a.entityType.localeCompare(b.entityType);
      if (typeCompare !== 0) return typeCompare;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  return {
    normalizedText,
    normalizedStructured,
    normalizedEntities,
  };
}

export function fingerprintMemoryCandidate(userId: string, candidate: ExtractedMemoryCandidate): string {
  const canonical = canonicalizeMemoryCandidate(candidate);
  
  const fingerprintData = {
    userId,
    memoryType: candidate.memoryType,
    normalizedText: canonical.normalizedText,
    normalizedStructured: canonical.normalizedStructured,
    visibility: 'private_user' as const,
    normalizedEntities: canonical.normalizedEntities,
  };

  return stableJsonHash(fingerprintData);
}

export function validateExtractedCandidate(
  candidate: ExtractedMemoryCandidate,
  _window: MemoryExtractionWindow
): ValidationResult {
  if (!P0_MEMORY_TYPES.includes(candidate.memoryType as AllowedLongTermMemoryType)) {
    return {
      valid: false,
      reason: `unsupported_memory_type:${candidate.memoryType}`,
    };
  }

  if (!candidate.sourceRefs.transcriptRefs || candidate.sourceRefs.transcriptRefs.length === 0) {
    return {
      valid: false,
      reason: 'missing_transcript_refs',
    };
  }

  if (!candidate.sourceRefs.extraction?.windowHash) {
    return {
      valid: false,
      reason: 'missing_window_hash',
    };
  }

  if (candidate.confidence < MIN_CONFIDENCE) {
    return {
      valid: false,
      reason: `low_confidence:${candidate.confidence}`,
    };
  }

  if (candidate.sensitivity === 'restricted') {
    return {
      valid: false,
      reason: 'restricted_sensitivity',
    };
  }

  let importance: Importance = 'medium';
  if (VALID_IMPORTANCE.includes(candidate.importance as Importance)) {
    importance = candidate.importance as Importance;
  }

  const normalizedCandidate: ExtractedMemoryCandidate = {
    ...candidate,
    memoryType: candidate.memoryType as AllowedLongTermMemoryType,
    importance,
    scope: {
      visibility: 'private_user' as Visibility,
    },
  };

  return {
    valid: true,
    normalizedCandidate,
  };
}

export function buildLongTermMemoryExtractionPrompt(window: MemoryExtractionWindow): string {
  return `You are a memory extraction system. Analyze the following conversation and extract long-term memories.

CONTEXT:
- User ID: ${window.userId}
- Session ID: ${window.sessionId}
- Window Hash: ${window.windowHash}
- Trigger Turn: ${window.triggerTurnId}
- Included Turns: ${window.includedTurnIds.join(', ')}
- Session Memory Summary ID: ${window.sessionMemorySummaryId || 'none'}

CONVERSATION:
${window.renderedInput}

INSTRUCTIONS:
Extract memories that should be stored long-term. You MUST respond with valid JSON only.

ALLOWED MEMORY TYPES (P0):
- user_preference: User's preferences and choices
- user_profile: User's profile information (role, experience, skills)
- user_safety_rule: Safety rules and constraints for the user
- project_state: Current project state and context

DISCARD THE FOLLOWING:
1. One-off tasks and transient context that won't be relevant later
2. Memory types not in the allowed list above (relationship, routine, workflow_preference, durable_fact, episodic_summary)
3. Information without clear provenance or source in the conversation
4. Low-confidence claims or speculation
5. Sensitive content that should not be stored (passwords, secrets, private keys)

RESPONSE FORMAT (JSON only, no markdown):
{
  "candidates": [
    {
      "memoryType": "user_preference|user_profile|user_safety_rule|project_state",
      "text": "Clear, concise memory text",
      "structured": { ...optional structured data... },
      "confidence": 0.0-1.0,
      "importance": "low|medium|high|critical",
      "sensitivity": "low|medium|high",
      "keywords": ["keyword1", "keyword2"],
      "entities": [
        {
          "entityType": "person|project|workflow|organization",
          "entityId": "optional-id",
          "displayName": "Display Name"
        }
      ],
      "scope": {
        "visibility": "private_user"
      },
      "sourceRefs": {
        "transcriptRefs": ["turn-id-1", "turn-id-2"],
        "extraction": {
          "windowHash": "${window.windowHash}",
          "triggerTurnId": "${window.triggerTurnId}",
          "includedTurnIds": ["turn-id-1", "turn-id-2"]
        }
      },
      "discardReason": "optional reason if this should be discarded"
    }
  ]
}

REQUIREMENTS:
- confidence must be >= 0.7
- sensitivity must NOT be "restricted"
- visibility must be "private_user"
- transcriptRefs must reference actual turns from the conversation
- Include discardReason for any candidate that should not be stored

Respond with JSON only.`;
}
