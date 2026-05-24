# Session Summary Prompt

Generate a concise session-level summary capturing:

1. **Key Decisions**: What important decisions were made or confirmed?
2. **Action Items**: What tasks or actions need follow-up?
3. **Unresolved Questions**: What topics remain unclear or need more discussion?
4. **Current State**: What is the immediate context and working context at session end?

## Format Requirements

- Keep summary under 150 words
- Focus on actionable information
- Exclude transient details (commands, temporary file paths)
- Preserve user intent and reasoning

## Output Format

Return a JSON object with fields:
- `keyDecisions`: string array of decision summaries
- `actionItems`: string array of pending actions
- `unresolvedQuestions`: string array of open questions
- `currentState`: brief description of session end state