import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Foreground Prompt Template', () => {
  const templatePath = join(process.cwd(), 'src/prompt/templates/agents/foreground.md')
  const templateContent = readFileSync(templatePath, 'utf-8')

  describe('Route-only prompt contract removed', () => {
    it('should not contain foreground_decide as an output mechanism', () => {
      // The only allowed mention is in a "No" context (e.g., "No foreground_decide output")
      const activeMentions = templateContent
        .split('\n')
        .filter(
          (line) =>
            line.includes('foreground_decide') &&
            !line.includes('No ') &&
            !line.includes('no ') &&
            !line.trim().startsWith('-'),
        )

      expect(activeMentions.length).toBe(0)
    })

    it('should not contain routing JSON as primary output', () => {
      // Check that routing JSON is not mentioned as the output format
      const lines = templateContent.split('\n')
      const routingJsonOutputLines = lines.filter(
        (line) => line.toLowerCase().includes('routing json') && !line.includes('No ') && !line.includes('no '),
      )

      // Should not have any active routing JSON output instructions
      expect(routingJsonOutputLines.length).toBe(0)
    })

    it('should not instruct agent to output structured decision objects', () => {
      // Only check for active instructions, not negative statements
      expect(templateContent).not.toContain('Routing Rules')
      expect(templateContent).not.toContain('Route Selection')
      expect(templateContent).not.toContain('return valid JSON')
    })
  })

  describe('Tool safety prompt present', () => {
    it('should contain projected tools rule', () => {
      expect(templateContent).toContain('projected tools')
      expect(templateContent).toContain('projected tool plane')
    })

    it('should contain tool result fabrication prohibition', () => {
      expect(templateContent).toContain('Never fabricate tool results')
    })

    it('should contain failure handling rules', () => {
      expect(templateContent).toContain('tool fails')
      expect(templateContent).toContain('surface the failure')
    })

    it('should contain approval request guidance', () => {
      expect(templateContent).toContain('risky operations')
      expect(templateContent).toContain('request approval')
      expect(templateContent).toContain('foreground_handle_approval')
    })

    it('should mention specialized tools for different scenarios', () => {
      expect(templateContent).toContain('foreground_spawn_planner')
      expect(templateContent).toContain('foreground_launch_subagent')
      expect(templateContent).toContain('foreground_status_query')
      expect(templateContent).toContain('search_subagent')
    })
  })

  describe('Output contract', () => {
    it('should specify natural language output', () => {
      expect(templateContent).toContain('natural language')
      expect(templateContent).toContain('conversational response')
    })

    it('should explicitly reject JSON output', () => {
      expect(templateContent).toContain('No routing JSON')
      expect(templateContent).toContain('No `foreground_decide` output')
    })
  })

  describe('Prompt structure', () => {
    it('should be concise (under 200 lines)', () => {
      const lineCount = templateContent.split('\n').length
      expect(lineCount).toBeLessThan(200)
    })

    it('should have clear sections', () => {
      expect(templateContent).toContain('## Agent Identity')
      expect(templateContent).toContain('## Tool Usage Rules')
      expect(templateContent).toContain('## Output Contract')
    })
  })
})
