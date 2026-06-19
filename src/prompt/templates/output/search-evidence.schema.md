# Search Evidence Output Schema

Response format for search subagent answer generation. Respond with a clear, sourced answer.

## Answer Requirements

- Synthesize information from all search results into a coherent answer
- Cite source URLs inline using markdown links
- If results conflict, note the discrepancy
- If no relevant results found, state that clearly
- Do NOT fabricate information not present in search results
- Keep answers concise (under 500 words unless complexity demands more)

## Output Structure

The search subagent produces a plain-text answer, not JSON. The structured evidence
(SearchSubagentToolResult) is the tool contract; the LLM answer is the human-readable
synthesis that references the evidence.

### Evidence Fields (tool contract)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `originalQuestion` | string | Yes | The original user question |
| `searchQuery` | string | Yes | The query sent to the search provider |
| `intent` | SearchIntent | Yes | Classified search intent |
| `freshness` | boolean | Yes | Whether fresh results were required |
| `results` | WebSearchResultItem[] | Yes | Raw search result items |
| `extractedFacts` | ExtractedFact[] | Yes | Facts extracted from results |
| `warnings` | SearchWarning[] | Yes | Execution warnings |
| `metadata` | SearchSubagentMetadata | Yes | Execution metadata |
| `queryPlan` | SearchQueryPlan | Yes | The executed query plan |

### Answer Format

```
<concise answer with [source](url) citations>
```
