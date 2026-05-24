# Daily Summary Prompt

Generate a daily-level summary spanning multiple sessions from the same day:

1. **Key Achievements**: What meaningful progress was made today?
2. **Patterns Observed**: What recurring themes or user preferences emerged?
3. **Blockers Encountered**: What obstacles or challenges slowed progress?
4. **Cross-Session Themes**: What topics carried across multiple sessions?

## Format Requirements

- Synthesize insights across all sessions for the day
- Highlight themes rather than individual events
- Exclude session-specific transient details
- Keep summary under 150 words

## Output Format

Return a JSON object with fields:
- `keyAchievements`: string array of accomplishments
- `patternsObserved`: string array of user patterns
- `blockers`: string array of obstacles
- `crossSessionThemes`: string array of recurring topics