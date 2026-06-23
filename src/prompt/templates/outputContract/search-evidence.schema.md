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

## Schema Reference

See `output:search-evidence.schema` template for the full schema definition.

---

</output_contract>
