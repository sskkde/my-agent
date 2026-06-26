# Output Contract: Search Evidence Schema

<output_contract id="output:search-evidence.schema">

## Contract Identity

Contract ID: `output:search-evidence.schema`
Contract Purpose: Define the output contract for search subagent evidence and answer generation.

## Contract Rules

- The search subagent produces structured evidence (SearchSubagentToolResult) as the tool contract.
- The LLM answer is a plain-text synthesis of search results with inline source citations.
- Answer must not contain fabricated information absent from search results.
- If no relevant results are found, the answer must state this explicitly.
- Evidence fields (originalQuestion, searchQuery, intent, results, extractedFacts) must all be populated.
- The search subagent evidence is not the final user-facing response; the parent agent performs final synthesis.
- Each extracted fact must include a source URL and must be traceable to a returned result.
- Important factual claims should be supported by at least one relevant source result; do not infer beyond snippets/results unless a fetched document explicitly supports the claim.
- For time-sensitive claims, preserve publication/update dates when present or add a freshness warning when dates cannot be verified.
- If sources disagree, preserve the disagreement in warnings or extracted facts rather than forcing a single conclusion.
- Low-confidence or weakly supported facts must be marked as limited evidence and must not be promoted as definitive.

## Schema Reference

See `output:search-evidence.schema` template for the full schema definition.

---

</output_contract>
