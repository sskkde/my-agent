# Weekly Summary Prompt

Generate a weekly summary consolidating daily summaries:

1. **High-Level Progress**: What major milestones were achieved this week?
2. **Trends Identified**: What patterns emerged across multiple days?
3. **Strategic Insights**: What strategic observations about user goals?
4. **Long-Pole Issues**: What persistent blockers remain unresolved?

## Format Requirements

- Focus on strategic-level observations
- Identify trends and patterns across days
- Exclude daily-level details
- Keep summary under 150 words

## Output Format

Return a JSON object with fields:
- `highLevelProgress`: string array of milestones
- `trends`: string array of identified trends
- `strategicInsights`: string array of strategic observations
- `longPoleIssues`: string array of persistent blockers