# Atomic Facts Extraction Prompt

Extract atomic, independently-verifiable facts from conversation:

## Requirements for Each Fact

1. **Self-Contained**: Each fact must stand alone without context dependencies
2. **Traceable**: Include source reference (message/timestamp)
3. **Not Transient**: Exclude execution details, commands, temporary values
4. **Verifiable**: Facts should be objectively checkable

## Examples

- Good: "User's preferred programming language is TypeScript"
- Bad: "User ran `npm install` at 14:23" (transient)
- Bad: "We discussed the plan" (context-dependent, not atomic)

## Output Format

Return a JSON object with fields:
- `facts`: array of objects, each with:
  - `content`: the atomic fact string
  - `sourceRef`: reference to origin (messageId or timestamp)
  - `category`: 'preference' | 'fact' | 'constraint' | 'goal'

Keep each fact under 30 words.