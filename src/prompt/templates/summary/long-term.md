# Long-Term Profile Prompt

Build a long-term user profile from accumulated memory:

1. **Preferences**: What consistent preferences does the user exhibit?
2. **Goals**: What long-term goals or objectives drive the user?
3. **Work Style**: How does the user prefer to work and communicate?
4. **Domain Expertise**: What areas does the user have expertise or interest in?

## Format Requirements

- Profile should be stable and evolve gradually
- Focus on persistent attributes, not transient states
- Exclude session-specific details
- Keep summary under 150 words

## Output Format

Return a JSON object with fields:
- `preferences`: string array of user preferences
- `goals`: string array of long-term goals
- `workStyle`: string array of work style observations
- `domainExpertise`: string array of expertise areas