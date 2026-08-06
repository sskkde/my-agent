# Output Contract: Search Evidence Schema

<output_contract id="output:search-evidence.schema">

## Contract Rules

- Phase 1 (function_calling): Call the `web_search` tool with a concise keyword-style query
  derived from the user's question. Do not generate an answer without searching first.
  ✅ "LLM training data 2026" ✅ "LLM 训练数据 2026"（用户中文时亦可搜英文）
  ❌ "Tell me about how LLMs are trained"（句子式） ❌ 整句照搬用户消息
- Phase 2 (structured_json): Synthesize search results into a plain-text answer with inline
  source citations. Do not fabricate information absent from results. If no relevant results
  were found, state this explicitly instead of guessing.
- Each extracted fact must include a source URL traceable to a returned result.
- For time-sensitive claims, preserve dates or add a freshness warning.
- If sources disagree, preserve the disagreement rather than forcing a single conclusion.
- Low-confidence facts must be marked as limited evidence, not promoted as definitive.

## Citation Format

- Use inline markdown links with descriptive text: "GPT-5.1 ships with new reasoning
  features [OpenAI](https://platform.openai.com/docs/models)".
- Never use numbered footnotes ([1], [2]) with a trailing sources list.
- Never place a period immediately after a citation link.

---

</output_contract>
