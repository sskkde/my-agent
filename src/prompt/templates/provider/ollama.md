# Ollama Provider Template

## Provider Identity

Provider Family: `ollama`
Compatible Providers: Ollama local inference server

## Output Contract

Follow the current mode and output schema exactly.

When the current mode requires JSON:

- Output valid JSON only.
- Do not wrap JSON in markdown fences.
- Do not include prefaces or trailing explanation.
- Include all required fields.
- Use `null` only when the schema allows it.

When the current mode allows natural language:

- Answer directly and concisely.
- Separate facts, assumptions, and recommendations when uncertainty matters.

## Local Inference Notes

- Response quality depends on the locally loaded model.
- For complex reasoning tasks, prefer larger models when available.
- Token limits are determined by the model's context window.

---

**END OF OLLAMA PROVIDER TEMPLATE**
