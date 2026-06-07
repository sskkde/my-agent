# P10 Lifecycle Scoring Appendix

> Technical appendix for PM-19 lifecycle scoring implementation
> Created: 2026-05-24

---

## 1. Scoring Formula

```
score = recency × 0.3 + frequency × 0.25 + importance × 0.3 + relevance × 0.15
```

### 1.1 Weight Constants

| Dimension  | Weight | Rationale                                 |
| ---------- | ------ | ----------------------------------------- |
| Recency    | 0.30   | Fresh memories are more actionable        |
| Importance | 0.30   | User-defined priority matters most        |
| Frequency  | 0.25   | Repeatedly accessed memories are valuable |
| Relevance  | 0.15   | Context-specific boost                    |

---

## 2. Dimension Details

### 2.1 Recency (weight: 0.30)

Based on `lifecycle.lastAccessedAt` or `lifecycle.updatedAt`:

| Time Since Access        | Score         |
| ------------------------ | ------------- |
| Last 24 hours            | 1.0           |
| Last 7 days              | 0.8           |
| Last 30 days             | 0.5           |
| Last 90 days             | 0.3           |
| Older than 90 days       | 0.1           |
| No access time available | 0.5 (neutral) |

**Implementation**:

```typescript
const daysSinceAccess = (now.getTime() - accessDate.getTime()) / (1000 * 60 * 60 * 24)

if (daysSinceAccess <= 1) return 1.0
if (daysSinceAccess <= 7) return 0.8
if (daysSinceAccess <= 30) return 0.5
if (daysSinceAccess <= 90) return 0.3
return 0.1
```

### 2.2 Frequency (weight: 0.25)

Based on `retrieval.recallCount`:

| Recall Count | Score |
| ------------ | ----- |
| 0            | 0.1   |
| 1-2          | 0.3   |
| 3-5          | 0.5   |
| 6-10         | 0.7   |
| 10+          | 0.9   |

**Implementation**:

```typescript
if (recallCount === 0) return 0.1
if (recallCount <= 2) return 0.3
if (recallCount <= 5) return 0.5
if (recallCount <= 10) return 0.7
return 0.9
```

### 2.3 Importance (weight: 0.30)

Direct mapping from `memory.importance`:

| Importance | Score |
| ---------- | ----- |
| critical   | 1.0   |
| high       | 0.75  |
| medium     | 0.5   |
| low        | 0.25  |

**Implementation**:

```typescript
const IMPORTANCE_SCORE: Record<Importance, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
}
```

### 2.4 Relevance (weight: 0.15)

Keyword overlap with context query (if provided):

| Scenario                | Score                            |
| ----------------------- | -------------------------------- |
| No contextQuery         | 0.5 (neutral)                    |
| No keywords on memory   | 0.5 (neutral)                    |
| With query and keywords | matchingKeywords / totalKeywords |

**Implementation**:

```typescript
if (!contextQuery || memory.retrieval.keywords.length === 0) {
  return 0.5 // neutral
}

const queryLower = contextQuery.toLowerCase()
const matchingKeywords = memory.retrieval.keywords.filter((keyword) => queryLower.includes(keyword.toLowerCase()))

const ratio = matchingKeywords.length / memory.retrieval.keywords.length
return Math.min(1, Math.max(0, ratio)) // clamp 0-1
```

---

## 3. Recommendation Thresholds

| Score Range | Recommendation      | Description             |
| ----------- | ------------------- | ----------------------- |
| ≥ 0.6       | `active`            | Keep in active recall   |
| ≥ 0.3       | `low_priority`      | Deprioritize but retain |
| < 0.3       | `archive_candidate` | Consider for archival   |

---

## 4. Output Interface

```typescript
interface LifecycleScore {
  score: number // Weighted average 0-1, rounded to 3 decimals
  recommendation: 'active' | 'low_priority' | 'archive_candidate'
  breakdown: {
    recency: number // 0-1 sub-score
    frequency: number // 0-1 sub-score
    importance: number // 0-1 sub-score
    relevance: number // 0-1 sub-score
  }
}
```

---

## 5. Feature Flags

### 5.1 Shadow Mode

```typescript
export function isLifecycleScoringShadowEnabled(): boolean {
  return process.env.LIFECYCLE_SCORING_SHADOW === 'true'
}
```

When `false` (default), scoring logic exists but is not wired into production paths.

### 5.2 Policy Enabled

```typescript
export function isLifecyclePolicyEnabled(): boolean {
  return process.env.LIFECYCLE_POLICY_ENABLED === 'true'
}
```

When `true`, memory status transitions are applied based on scores.

---

## 6. Rollout Phases

| Phase               | Env Var                                    | Behavior                                                      |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------- |
| `score_only`        | Default                                    | Score only, no transitions                                    |
| `low_priority_only` | `LIFECYCLE_POLICY_PHASE=low_priority_only` | Transition archive_candidate + score<0.3 → low_priority       |
| `full_rollout`      | `LIFECYCLE_POLICY_PHASE=full_rollout`      | Full lifecycle transitions (active ↔ low_priority ↔ archived) |

### 6.1 Phase Implementation

```typescript
export type LifecyclePolicyPhase = 'score_only' | 'low_priority_only' | 'full_rollout'

export function getLifecyclePolicyPhase(): LifecyclePolicyPhase {
  const phase = process.env.LIFECYCLE_POLICY_PHASE
  if (phase === 'low_priority_only') return 'low_priority_only'
  if (phase === 'full_rollout') return 'full_rollout'
  return 'score_only' // default
}
```

---

## 7. Policy Application

### 7.1 applyLifecyclePolicy Function

```typescript
export function applyLifecyclePolicy(
  score: LifecycleScore,
  memory: LongTermMemoryRecord,
  phase?: LifecyclePolicyPhase,
): { newStatus: MemoryStatus; transitioned: boolean }
```

### 7.2 Transition Rules

| Phase             | Score                    | Current Status | New Status   | Transitioned |
| ----------------- | ------------------------ | -------------- | ------------ | ------------ |
| score_only        | \*                       | \*             | (unchanged)  | false        |
| low_priority_only | < 0.3, archive_candidate | any            | low_priority | true         |
| low_priority_only | other                    | \*             | (unchanged)  | false        |
| full_rollout      | ≥ 0.6, active            | \*             | (unchanged)  | false        |
| full_rollout      | ≥ 0.3, low_priority      | \*             | low_priority | true         |
| full_rollout      | < 0.3, archive_candidate | \*             | archived     | true         |

---

## 8. Shadow Mode Guarantee

### 8.1 Pure Function Design

`LifecycleScorer.score()` is a **pure function**:

- Takes `LongTermMemoryRecord` and optional `contextQuery`
- Returns `LifecycleScore` object
- **NEVER** mutates the input record
- **NEVER** calls store methods
- **NEVER** has side effects

### 8.2 Caller Responsibility

`applyLifecyclePolicy()` returns a **suggested new status**:

- Caller is responsible for writing the new status
- Caller decides when to apply the transition
- Transition is NOT automatic

```typescript
// Shadow mode example
const score = scorer.score(memory, contextQuery)
console.log(`Score: ${score.score}, Recommendation: ${score.recommendation}`)

// If policy enabled, apply transition
const { newStatus, transitioned } = applyLifecyclePolicy(score, memory)
if (transitioned) {
  await store.updateStatus(memory.memoryId, newStatus)
}
```

---

## 9. Testing

### 9.1 Test Coverage

`tests/unit/memory/lifecycle-scoring.test.ts` includes 27 tests:

- Recency scoring (time thresholds)
- Frequency scoring (recall count thresholds)
- Importance scoring (mapping verification)
- Relevance scoring (keyword matching)
- Weight calculation (formula verification)
- Recommendation thresholds
- applyLifecyclePolicy transitions
- Feature flag behavior

### 9.2 Example Test Cases

```typescript
// Recency: last 24 hours → 1.0
const freshMemory = createMemoryWithAccessTime(1); // 1 hour ago
expect(scorer.score(freshMemory).breakdown.recency).toBe(1.0);

// Frequency: 15 recalls → 0.9
const popularMemory = createMemoryWithRecallCount(15);
expect(scorer.score(popularMemory).breakdown.frequency).toBe(0.9);

// Recommendation: score 0.65 → active
const activeScore = { score: 0.65, ... };
expect(activeScore.recommendation).toBe('active');
```

---

## 10. References

- `src/memory/memory-lifecycle-scoring.ts` — LifecycleScorer class, interfaces, feature flags
- `src/storage/long-term-memory-store.ts` — LongTermMemoryRecord type
- `tests/unit/memory/lifecycle-scoring.test.ts` — 27 test cases
