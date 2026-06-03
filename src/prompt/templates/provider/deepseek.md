# DeepSeek Provider Template

## Provider Identity

Provider Family: `deepseek`
Compatible Providers: DeepSeek API, DeepSeek-compatible local or hosted deployments

## Output Contract for Reasoning Models

If the selected DeepSeek model emits private reasoning, reasoning content is not the final answer.

- Reasoning, scratch work, and `<think>` content are private intermediate work.
- Any user-facing answer, route decision, JSON object, summary, question, recommendation, or conclusion must appear in the final assistant content.
- Do not end with only reasoning content.
- If `<think>` tags appear, close them before emitting the final answer.
- In JSON modes, the final assistant content must be the requested JSON object only.

## JSON Modes

When the current mode requires JSON:

- Output valid JSON only.
- Do not wrap JSON in markdown fences.
- Do not include prefaces or trailing explanation.
- Use double quotes for object keys and strings.
- Use `null` instead of undefined values.
- Do not use comments or trailing commas.
- Conform to the current output schema rather than examples in older context.

## Tool Calling

When the current mode enables tool calling:

- Use only projected tools.
- Keep tool arguments valid JSON.
- Do not invent unavailable tools.
- Treat tool errors as evidence to handle, not as permission to fabricate results.

---

**END OF DEEPSEEK PROVIDER TEMPLATE**
