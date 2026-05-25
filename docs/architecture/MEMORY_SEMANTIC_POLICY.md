# Memory Semantic Policy

> Version: 1.0.0
> Created: 2026-05-24
> Status: Implemented

---

## Overview

The Memory Semantic Policy defines what memory types are allowed for long-term storage, what content is prohibited, and how ephemeral pattern rejection works. This policy ensures that only meaningful, reusable memories are persisted while transient operational details are discarded.

---

## Storage Types vs Auto-extractable Types

It is important to distinguish between what the storage layer can persist and what the P10 automatic extraction pipeline can extract:

- **Auto-extractable types**: The five P0 types listed below. The LLM extraction pipeline recognizes these types, and `validateMemoryCandidate()` enforces them for `origin: 'auto_extraction'` candidates.
- **Storage-supported (gated) types**: `relationship`, `routine`, `workflow_preference`, `durable_fact`, `episodic_summary`. The storage layer can persist these types via explicit API writes, but the P10 automatic extraction pipeline does not produce them. Enabling auto-extraction for gated types is a P2 decision-gated item that depends on additional infrastructure (entity linking for `relationship`, workflow state tracking for `routine`, etc.).

The auto-extraction whitelist is always enforced for automatic extraction writes. `MEMORY_SEMANTIC_POLICY_ENABLED` controls the additional semantic rejection rules such as ephemeral pattern filtering; it does not widen the auto-extraction type whitelist.

---

## Auto-extractable Memory Types (P0)

P10 automatic extraction supports exactly five auto-extractable memory types. These types are automatically extracted from conversation context by the LLM extraction pipeline:

| Type | Description | Use Case |
|------|-------------|----------|
| `user_preference` | User's preferences and choices | Theme preferences, language settings, workflow preferences |
| `user_profile` | User's profile information | Role, experience level, skills, domain expertise |
| `user_safety_rule` | Safety rules and constraints | Content restrictions, privacy boundaries, security preferences |
| `project_state` | Current project state and context | Active project context, current task focus, project relationships |
| `long_term_fact` | Long-term reusable atomic facts | Traceable, independently referenceable facts |

### Type Definition

```typescript
export type AutoExtractedMemoryType =
  | 'user_preference'
  | 'user_profile'
  | 'user_safety_rule'
  | 'project_state'
  | 'long_term_fact';

export type AllowedLongTermMemoryType =
  | AutoExtractedMemoryType
  | 'relationship'
  | 'durable_fact'
  | 'episodic_summary'
  | 'routine'
  | 'workflow_preference';
```

### Auto-extraction Types Array

```typescript
export const AUTO_EXTRACTED_MEMORY_TYPES: AutoExtractedMemoryType[] = [
  'user_preference',
  'user_profile',
  'user_safety_rule',
  'project_state',
  'long_term_fact',
];

/** @deprecated Use AUTO_EXTRACTED_MEMORY_TYPES instead. */
export const P0_MEMORY_TYPES = AUTO_EXTRACTED_MEMORY_TYPES;
```

---

## Gated Memory Types (Storage-Supported, Not Auto-extractable in P10)

The following memory types are **storage-supported** but **not auto-extractable** in P10. They can be written to storage via explicit API calls but are not automatically extracted by the LLM extraction pipeline:

| Type | Gating Reason |
|------|---------------|
| `relationship` | P2 decision-gated: requires entity linking infrastructure |
| `routine` | P2 decision-gated: workflow state, not long-term memory |
| `workflow_preference` | P2 decision-gated: transient operational preference |
| `durable_fact` | P2 decision-gated: superseded by `long_term_fact` |
| `episodic_summary` | P2 decision-gated: redundant with session summaries |

---

## Ephemeral Pattern Rejection

The Memory Semantic Policy includes 18 ephemeral patterns that identify transient content unsuitable for long-term storage. When `MEMORY_SEMANTIC_POLICY_ENABLED=true`, candidates matching these patterns are rejected.

### Pattern Categories

#### 1. Git Operations (6 patterns)

| Pattern | Matches |
|---------|---------|
| `/commit\s+[a-f0-9]{7,40}/i` | Commit references like "commit abc1234" |
| `/[a-f0-9]{7,40}\.\.\.[a-f0-9]{7,40}/i` | Git range references like "abc1234...def5678" |
| `/\bpush(ed)?\s+(to|origin|branch)/i` | Push operations |
| `/\bmerged?\s+(branch|pr|pull request)/i` | Merge operations |
| `/\b(cloned?|forked?)\s+(from|repo)/i` | Clone/fork operations |
| `/git\s+(add|commit|push|pull|merge|checkout|branch)/i` | Git commands |

#### 2. Package Manager Commands (3 patterns)

| Pattern | Matches |
|---------|---------|
| `/npm\s+run\s+\S+/i` | npm run commands |
| `/yarn\s+\S+/i` | yarn commands |
| `/pnpm\s+\S+/i` | pnpm commands |

#### 3. Development Artifacts (4 patterns)

| Pattern | Matches |
|---------|---------|
| `/\.\w+:\d+(:\d+)?/` | File location references like ".ts:42:10" |
| `/\btest\s+(step|case|suite)\b/i` | Test references |
| `/\b(passing|failing)\s+test/i` | Test status mentions |
| `/\bconsole\.(log|warn|error|debug|info)\(/i` | Console logging statements |

#### 4. Release and Deployment (2 patterns)

| Pattern | Matches |
|---------|---------|
| `/\brelease\s+v?\d+\.\d+/i` | Release version mentions |
| `/\bdeploy(ed|ing)?\s+(to|on|at)/i` | Deployment operations |

#### 5. Debug and Trace (3 patterns)

| Pattern | Matches |
|---------|---------|
| `/\bDEBUG\s*=/i` | Debug flag assignments |
| `/\btrace\w*\s*:/i` | Trace configuration |

### Implementation

```typescript
const EPHEMERAL_PATTERNS = [
  /commit\s+[a-f0-9]{7,40}/i,
  /[a-f0-9]{7,40}\.\.\.[a-f0-9]{7,40}/i,
  /npm\s+run\s+\S+/i,
  /yarn\s+\S+/i,
  /pnpm\s+\S+/i,
  /\.\w+:\d+(:\d+)?/,
  /\btest\s+(step|case|suite)\b/i,
  /\b(passing|failing)\s+test/i,
  /\bpush(ed)?\s+(to|origin|branch)/i,
  /\brelease\s+v?\d+\.\d+/i,
  /\bmerged?\s+(branch|pr|pull request)/i,
  /\b(cloned?|forked?)\s+(from|repo)/i,
  /\bdeploy(ed|ing)?\s+(to|on|at)/i,
  /\bconsole\.(log|warn|error|debug|info)\(/i,
  /git\s+(add|commit|push|pull|merge|checkout|branch)/i,
  /\bDEBUG\s*=/i,
  /\btrace\w*\s*:/i,
];

function detectEphemeralPattern(text: string): boolean {
  return EPHEMERAL_PATTERNS.some(pattern => pattern.test(text));
}
```

---

## Feature Flag

### MEMORY_SEMANTIC_POLICY_ENABLED

| Attribute | Value |
|-----------|-------|
| Environment Variable | `MEMORY_SEMANTIC_POLICY_ENABLED` |
| Default | `OFF` (undefined) |
| Purpose | Enable ephemeral pattern rejection and semantic policy enforcement |

When OFF:
- Ephemeral pattern detection is bypassed
- All memory types pass through (legacy behavior)
- No semantic validation applied

When ON:
- Ephemeral patterns are detected and rejected
- Only P0 auto-extractable memory types are accepted by the extraction pipeline
- Gated types (relationship, routine, etc.) remain storage-supported but are not auto-extracted
- Discard reasons are recorded for audit

---

## Validation Rules

### validateMemoryCandidate()

The `validateMemoryCandidate()` function in `src/memory/memory-candidate-types.ts` is the single source of truth for basic memory candidate validation.

#### Validation Checks

| Check | Condition | Error |
|-------|-----------|-------|
| Memory Type | `candidate.memoryType` must be in `P0_MEMORY_TYPES` (auto-extractable types) | `unsupported_memory_type:${type}` |
| Confidence | `0.7 <= confidence <= 1.0` | `confidence_out_of_range:${value}` |
| Keywords | Non-empty array, max 12 items, no empty strings | `keywords_empty`, `keywords_too_many`, `keywords_contain_empty_string` |
| Transcript References | Non-empty `sourceRefs.transcriptRefs` | `missing_transcript_refs` |
| Sensitivity | Must not be `restricted` | `restricted_sensitivity` |
| Importance | Must be in `['low', 'medium', 'high', 'critical']` | `invalid_importance:${value}` |

### validateExtractedCandidate()

The `validateExtractedCandidate()` function in `src/memory/long-term-memory-extraction.ts` performs additional validation:

```typescript
export function validateExtractedCandidate(
  candidate: ExtractedMemoryCandidate,
  _window: MemoryExtractionWindow
): ValidationResult {
  // 1. Base validation via validateMemoryCandidate()
  const baseValidation = validateMemoryCandidate(candidate);
  if (!baseValidation.valid) {
    return { valid: false, reason: baseValidation.errors[0] };
  }

  // 2. Window hash validation
  if (!candidate.sourceRefs.extraction?.windowHash) {
    return { valid: false, reason: 'missing_window_hash' };
  }

  // 3. Ephemeral pattern detection (when policy enabled)
  if (process.env.MEMORY_SEMANTIC_POLICY_ENABLED === 'true' && 
      detectEphemeralPattern(candidate.text)) {
    return { valid: false, reason: 'ephemeral_pattern_detected' };
  }

  // 4. Explicit discard reason
  if (candidate.discardReason) {
    return { valid: false, reason: `discard:${candidate.discardReason}` };
  }

  return { valid: true, normalizedCandidate };
}
```

---

## Discard Reasons

The `discardReason` field in `ExtractedMemoryCandidate` allows the LLM to explicitly mark candidates for discard:

```typescript
export type ExtractedMemoryCandidate = {
  // ... other fields
  discardReason?: string;
};
```

### Common Discard Reasons

| Reason | Description |
|--------|-------------|
| `one_off_task` | Transient task not relevant later |
| `transient_context` | Context that won't persist |
| `no_provenance` | Information without clear source |
| `low_confidence` | Speculation or uncertain claim |
| `sensitive_content` | Passwords, secrets, private keys |
| `file_reference` | File names, paths |
| `command_reference` | CLI commands |
| `test_detail` | Test step/case details |
| `release_detail` | Commit/push/release details |
| `workflow_preference` | Collaboration workflow preferences |
| `tool_preference` | Tool usage preferences |
| `formatting_requirement` | One-time formatting needs |
| `execution_detail` | Assistant execution process details |

---

## Shadow Extraction Mechanism

The shadow extraction mechanism allows comparison between legacy and new policy behavior without affecting production data.

### ShadowComparisonPayload

```typescript
export type ShadowComparisonPayload = {
  windowHash: string;
  legacyAccepted: ExtractedMemoryCandidate[];
  newAccepted: ExtractedMemoryCandidate[];
  legacyDiscarded: string[];
  newDiscarded: string[];
  diff: 'same' | 'new_accepted_more' | 'legacy_accepted_more' | 'different';
};
```

### recordShadowExtraction()

The `recordShadowExtraction()` function in `src/memory/shadow-extraction-recorder.ts` records shadow extraction results:

```typescript
export function recordShadowExtraction(
  store: MemoryExtractionRunStore,
  window: MemoryExtractionWindow,
  legacyResult: ExtractionSideResult,
  newResult: ExtractionSideResult,
): void {
  // Classify candidates into accepted/discarded
  const legacyClassified = classifyCandidates(legacyResult.candidates);
  const newClassified = classifyCandidates(newResult.candidates);

  // Compute diff classification
  const diff = computeDiff(
    legacyClassified.accepted.length,
    newClassified.accepted.length,
    new Set(legacyClassified.accepted.map(c => c.text.trim().toLowerCase())),
    new Set(newClassified.accepted.map(c => c.text.trim().toLowerCase())),
  );

  // Store shadow record with variant='shadow'
  store.createPending({
    // ... window fields
    policyVersion: 'semantic_policy',
    variant: 'shadow',
    shadowComparisonPayload: JSON.stringify(payload),
  });
}
```

### Safety Properties

1. **No Production Impact**: Shadow results are NOT written to `LongTermMemoryStore`
2. **Tenant Isolation**: Shadow data follows tenant isolation rules
3. **Variant Tagging**: `variant='shadow'` distinguishes shadow records
4. **Comparison Payload**: Full comparison data available for analysis

---

## Extraction Prompt

The `buildLongTermMemoryExtractionPrompt()` function generates the LLM prompt for memory extraction:

### Discard Instructions

The prompt explicitly instructs the LLM to discard:

1. One-off tasks and transient context
2. Memory types not in the allowed list
3. Information without clear provenance
4. Low-confidence claims or speculation
5. Sensitive content (passwords, secrets, private keys)
6. File names, commands, test steps
7. Commit/push/release details
8. Collaboration workflow preferences
9. Tool usage preferences
10. One-time formatting requirements
11. Assistant execution process details

### Response Format

The LLM must respond with JSON containing:
- `candidates[]` array with memory candidates
- Each candidate includes `discardReason` if it should be discarded
- `confidence >= 0.7`
- `sensitivity != 'restricted'`
- `visibility = 'private_user'`

---

## File References

| File | Lines | Description |
|------|-------|-------------|
| `src/memory/long-term-memory-extraction.ts` | 281 | Core extraction logic, ephemeral patterns, validation |
| `src/memory/memory-candidate-types.ts` | 49 | `validateMemoryCandidate()` function |
| `src/memory/shadow-extraction-recorder.ts` | 101 | Shadow extraction recording |
| `src/storage/memory-extraction-run-store.ts` | - | Storage for extraction runs |

---

## Security Considerations

1. **Tenant Isolation**: All memory operations respect tenant boundaries
2. **Sensitivity Enforcement**: `restricted` sensitivity is always rejected
3. **Provenance Tracking**: All memories must have `transcriptRefs` for audit
4. **Shadow Safety**: Shadow extraction never affects production memory store

---

## Future Extensions (P10.1+)

1. **Expand Auto-extractable Types**: Enable auto-extraction for gated types (relationship, routine, etc.) after required infrastructure is in place
2. **Semantic Layer API**: Add `semanticLayer` filter to memory retrieval
3. **MemorySemanticLayer Type**: Typed semantic layer for memory classification
4. **Additional Ephemeral Patterns**: Extend pattern list based on production data
5. **Confidence Threshold**: Make `MIN_CONFIDENCE` configurable per tenant
