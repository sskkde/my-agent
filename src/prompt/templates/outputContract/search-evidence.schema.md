# Output Contract: Search Evidence Schema

<output_contract id="output:search-evidence.schema">

## Contract Rules

- Phase 1 (function_calling): Call the `web_search` tool with a concise query derived from the user's question. Do not generate an answer without searching first.
- Phase 2 (structured_json): Synthesize search results into a plain-text answer with inline source citations. Do not fabricate information absent from results. If no relevant results found, state this explicitly.
- Each extracted fact must include a source URL traceable to a returned result.
- For time-sensitive claims, preserve dates or add a freshness warning.
- If sources disagree, preserve the disagreement rather than forcing a single conclusion.
- Low-confidence facts must be marked as limited evidence, not promoted as definitive.

---

</output_contract>
