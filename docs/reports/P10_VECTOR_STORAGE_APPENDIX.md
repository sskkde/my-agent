# P10 Vector Storage Selection Appendix

> Technical appendix for PM-16/PM-17/PM-18 hybrid retrieval implementation
> Created: 2026-05-24

---

## 1. Candidate Backends

### 1.1 Comparison Matrix

| Backend        | Type            | Pros                                            | Cons                                                 |
| -------------- | --------------- | ----------------------------------------------- | ---------------------------------------------------- |
| **SQLite-vss** | Embedded        | Zero infra, same DB, simple setup               | Limited features, SQLite-specific, smaller community |
| **Qdrant**     | Standalone      | Purpose-built, fast, scalable, rich filtering   | Requires separate service, ops overhead              |
| **ChromaDB**   | Embedded/Server | Python native, simple API, good for prototyping | Python dependency, performance at scale concerns     |
| **pgvector**   | PostgreSQL      | Natural fit if already using Postgres, mature   | Requires PostgreSQL, no benefit for SQLite projects  |

### 1.2 Recommendation Criteria

For this project, the following criteria apply:

- **Zero additional infrastructure** preferred (matches SQLite backend)
- **TypeScript/Node.js native** preferred
- **Simple local development** required
- **Production-ready** with active maintenance

### 1.3 P10 Decision

**P10 does NOT select a specific backend**. The abstraction layer enables future selection without code changes.

---

## 2. Abstraction Layer

### 2.1 VectorRetrievalBackend Interface

PM-16 created the following interface in `src/memory/hybrid-retrieval.ts`:

```typescript
export interface VectorRetrievalBackend {
  /**
   * Query for similar memories by embedding vector.
   * @param userId - User ID for tenant isolation
   * @param embedding - Query embedding vector
   * @param limit - Maximum results to return
   * @param tenantId - Optional tenant ID
   * @returns Array of {memoryId, score} sorted by similarity
   */
  query(
    userId: string,
    embedding: Float32Array | number[],
    limit?: number,
    tenantId?: string,
  ): Promise<{ memoryId: string; score: number }[]>

  /**
   * Index a memory record with its embedding.
   * @param record - Memory record to index
   * @param embedding - Optional pre-computed embedding
   */
  index(record: LongTermMemoryRecord, embedding?: Float32Array | number[]): Promise<void>

  /**
   * Remove a memory from the vector index.
   * @param memoryId - Memory ID to remove
   */
  delete(memoryId: string): Promise<void>
}
```

### 2.2 NoOpVectorBackend

A placeholder implementation that returns empty results:

```typescript
export class NoOpVectorBackend implements VectorRetrievalBackend {
  async query(): Promise<{ memoryId: string; score: number }[]> {
    return [] // Always returns empty
  }
  async index(): Promise<void> {}
  async delete(): Promise<void> {}
}
```

This enables the hybrid retrieval flow to work without an actual vector backend.

### 2.3 Feature Flag

```typescript
export function isHybridRetrievalEnabled(): boolean {
  return process.env.HYBRID_RETRIEVAL_ENABLED === 'true'
}
```

When `false` (default), only lexical retrieval is used.

---

## 3. Hybrid Retrieval Flow

### 3.1 Retrieval Strategy Types

```typescript
type RetrievalStrategyType = 'lexical' | 'vector'
```

### 3.2 Orchestrator Logic

The `HybridRetrievalOrchestrator` implements:

1. **Lexical-first**: Always query lexical strategy first
2. **Index integration**: If `HYBRID_RETRIEVAL_ENABLED`, query entity/time indexes
3. **Merge**: Deduplicate by fingerprint (lexical priority)
4. **Vector fallback**: Only if results < `minResults` (default 5)
5. **Sort & limit**: Sort by relevanceScore descending, apply limit

### 3.3 Entity/Time Index (PM-17)

Additional indexes available when `HYBRID_RETRIEVAL_ENABLED=true`:

| Index  | Method                             | Description                           |
| ------ | ---------------------------------- | ------------------------------------- |
| Entity | `store.getByEntityName(name)`      | LIKE match on entity_names JSON array |
| Time   | `store.getByDateRange(start, end)` | Date range on lifecycle.createdAt     |

Entity/time index results receive a `+0.1` relevance boost.

---

## 4. Integration Path

### 4.1 Adding a New Backend

To integrate a new vector backend:

1. **Implement the interface**:

   ```typescript
   class QdrantBackend implements VectorRetrievalBackend {
     async query(userId, embedding, limit, tenantId) {
       // Call Qdrant API
     }
     async index(record, embedding) {
       // Upsert to Qdrant
     }
     async delete(memoryId) {
       // Delete from Qdrant
     }
   }
   ```

2. **Wire into orchestrator**:

   ```typescript
   const vectorBackend = new QdrantBackend(config)
   const vectorStrategy = new VectorRetrievalStrategy(vectorBackend)
   const orchestrator = new HybridRetrievalOrchestrator([lexicalStrategy, vectorStrategy], store)
   ```

3. **Enable feature flag**:

   ```bash
   export HYBRID_RETRIEVAL_ENABLED=true
   ```

4. **Validate with benchmark**:
   ```bash
   npm test -- tests/unit/memory/hybrid-retrieval-lexical-first.test.ts
   ```

### 4.2 Performance Target

- **P95 latency**: ≤ 500ms (hybrid)
- **Lexical-only**: ≤ 100ms (baseline)
- **Vector-only**: Backend dependent

---

## 5. Embedding Strategy

### 5.1 Options

| Approach                       | Pros                  | Cons                    |
| ------------------------------ | --------------------- | ----------------------- |
| Local embedding model (Ollama) | No API cost, privacy  | Hardware requirements   |
| OpenAI embeddings API          | High quality, simple  | API cost per query      |
| OpenRouter embeddings          | Multi-model choice    | API cost, latency       |
| Pre-computed embeddings        | Zero latency at query | Storage overhead, stale |

### 5.2 P10 Decision

P10 does NOT include embedding generation. The `index()` method accepts an optional `embedding` parameter for future use.

---

## 6. Migration Considerations

### 6.1 Schema Changes (PM-17)

Migration v55 adds:

- `long_term_memories.entity_names` TEXT — JSON array of entity names

```sql
ALTER TABLE long_term_memories ADD COLUMN entity_names TEXT DEFAULT '[]';
```

### 6.2 Backfill

When enabling hybrid retrieval:

- Entity names are auto-extracted on save (no backfill needed)
- Existing memories can be re-saved to populate entity_names

---

## 7. References

- `src/memory/hybrid-retrieval.ts` — VectorRetrievalBackend interface, NoOpVectorBackend
- `src/memory/hybrid-retrieval-types.ts` — HybridRecallQuery, HybridRecallItem types
- `src/storage/long-term-memory-store.ts` — getByEntityName, getByDateRange methods
- `migrations/020_add_entity_time_index.sql` — Migration v55
