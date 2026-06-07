/**
 * Summary Prompt Builder - Builds LLM prompts for summary generation.
 *
 * This module provides functions to build prompts for generating summaries
 * at different granularity levels: session, daily, weekly, long-term, and atomic-facts.
 *
 * Template Loading:
 * - Each summary type has a corresponding template (summary:session, summary:daily, etc.)
 * - Templates provide the stable rules (what/how to summarize)
 * - Dynamic data (conversation content, time range, etc.) is code-generated
 * - On template load failure: console.warn + graceful fallback to no template rules
 *
 * Usage:
 * This module is designed to be used by summary generation services that
 * call LLM to generate summaries from conversation transcripts or other data.
 *
 * @module memory/summary-prompt-builder
 */

import { createTemplateLoader } from '../prompt/template-loader.js'
import { isPromptMemoryP0Enabled } from '../prompt/feature-flags.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Input data for building a session summary prompt.
 */
export interface SessionSummaryPromptInput {
  /** Session identifier */
  sessionId: string
  /** User identifier */
  userId: string
  /** Conversation transcript or summary text */
  conversationContent: string
  /** Turn count in the session */
  turnCount?: number
  /** Session start time (ISO string) */
  startTime?: string
  /** Session end time (ISO string) */
  endTime?: string
}

/**
 * Input data for building a daily summary prompt.
 */
export interface DailySummaryPromptInput {
  /** User identifier */
  userId: string
  /** Date for the summary (ISO date string) */
  date: string
  /** Session summaries to aggregate */
  sessionSummaries: string[]
  /** Total turn count across sessions */
  totalTurnCount?: number
}

/**
 * Input data for building a weekly summary prompt.
 */
export interface WeeklySummaryPromptInput {
  /** User identifier */
  userId: string
  /** Week start date (ISO date string) */
  weekStartDate: string
  /** Week end date (ISO date string) */
  weekEndDate: string
  /** Daily summaries to aggregate */
  dailySummaries: string[]
}

/**
 * Input data for building a long-term profile prompt.
 */
export interface LongTermProfilePromptInput {
  /** User identifier */
  userId: string
  /** Accumulated memory content */
  memoryContent: string
  /** Previous long-term profile (if any) */
  previousProfile?: string
}

/**
 * Input data for building an atomic facts extraction prompt.
 * Note: This is primarily used via buildLongTermMemoryExtractionPrompt,
 * but this provides a standalone builder for atomic facts specifically.
 */
export interface AtomicFactsPromptInput {
  /** User identifier */
  userId: string
  /** Session identifier */
  sessionId: string
  /** Conversation content to extract facts from */
  conversationContent: string
}

/**
 * Output of a summary prompt builder function.
 */
export interface SummaryPromptOutput {
  /** The built prompt string */
  prompt: string
  /** Whether the template was successfully loaded */
  templateLoaded: boolean
  /** The template ID that was attempted */
  templateId: string
}

// ============================================================================
// Hardcoded Fallbacks
// ============================================================================

const HARDCODED_SESSION_PROMPT = `Generate a concise session-level summary capturing:

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
- \`keyDecisions\`: string array of decision summaries
- \`actionItems\`: string array of pending actions
- \`unresolvedQuestions\`: string array of open questions
- \`currentState\`: brief description of session end state`

const HARDCODED_DAILY_PROMPT = `Generate a daily-level summary spanning multiple sessions from the same day:

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
- \`keyAchievements\`: string array of accomplishments
- \`patternsObserved\`: string array of user patterns
- \`blockers\`: string array of obstacles
- \`crossSessionThemes\`: string array of recurring topics`

const HARDCODED_WEEKLY_PROMPT = `Generate a weekly summary consolidating daily summaries:

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
- \`highLevelProgress\`: string array of milestones
- \`trends\`: string array of identified trends
- \`strategicInsights\`: string array of strategic observations
- \`longPoleIssues\`: string array of persistent blockers`

const HARDCODED_LONG_TERM_PROMPT = `Build a long-term user profile from accumulated memory:

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
- \`preferences\`: string array of user preferences
- \`goals\`: string array of long-term goals
- \`workStyle\`: string array of work style observations
- \`domainExpertise\`: string array of expertise areas`

const HARDCODED_ATOMIC_FACTS_PROMPT = `Extract atomic, independently-verifiable facts from conversation:

## Requirements for Each Fact

1. **Self-Contained**: Each fact must stand alone without context dependencies
2. **Traceable**: Include source reference (message/timestamp)
3. **Not Transient**: Exclude execution details, commands, temporary values
4. **Verifiable**: Facts should be objectively checkable

## Examples

- Good: "User's preferred programming language is TypeScript"
- Bad: "User ran \`npm install\` at 14:23" (transient)
- Bad: "We discussed the plan" (context-dependent, not atomic)

## Output Format

Return a JSON object with fields:
- \`facts\`: array of objects, each with:
  - \`content\`: the atomic fact string
  - \`sourceRef\`: reference to origin (messageId or timestamp)
  - \`category\`: 'preference' | 'fact' | 'constraint' | 'goal'

Keep each fact under 30 words.`

// ============================================================================
// Prompt Builder Functions
// ============================================================================

/**
 * Builds a prompt for generating a session summary.
 *
 * @param input - Session summary prompt input data
 * @returns Promise resolving to the built prompt and metadata
 */
export async function buildSessionSummaryPrompt(input: SessionSummaryPromptInput): Promise<SummaryPromptOutput> {
  const templateId = 'summary:session'
  let stableRules: string
  let templateLoaded = false

  if (isPromptMemoryP0Enabled()) {
    const templateLoader = createTemplateLoader()
    try {
      stableRules = await templateLoader.load(templateId)
      templateLoaded = true
    } catch (e) {
      console.warn('[summary-prompt-builder] Failed to load summary:session template, using hardcoded fallback', e)
      stableRules = HARDCODED_SESSION_PROMPT
    }
  } else {
    stableRules = HARDCODED_SESSION_PROMPT
  }

  const dynamicData = buildSessionDynamicData(input)
  const prompt = `${stableRules}\n\n${dynamicData}`

  return { prompt, templateLoaded, templateId }
}

/**
 * Builds a prompt for generating a daily summary.
 *
 * @param input - Daily summary prompt input data
 * @returns Promise resolving to the built prompt and metadata
 */
export async function buildDailySummaryPrompt(input: DailySummaryPromptInput): Promise<SummaryPromptOutput> {
  const templateId = 'summary:daily'
  let stableRules: string
  let templateLoaded = false

  if (isPromptMemoryP0Enabled()) {
    const templateLoader = createTemplateLoader()
    try {
      stableRules = await templateLoader.load(templateId)
      templateLoaded = true
    } catch (e) {
      console.warn('[summary-prompt-builder] Failed to load summary:daily template, using hardcoded fallback', e)
      stableRules = HARDCODED_DAILY_PROMPT
    }
  } else {
    stableRules = HARDCODED_DAILY_PROMPT
  }

  const dynamicData = buildDailyDynamicData(input)
  const prompt = `${stableRules}\n\n${dynamicData}`

  return { prompt, templateLoaded, templateId }
}

/**
 * Builds a prompt for generating a weekly summary.
 *
 * @param input - Weekly summary prompt input data
 * @returns Promise resolving to the built prompt and metadata
 */
export async function buildWeeklySummaryPrompt(input: WeeklySummaryPromptInput): Promise<SummaryPromptOutput> {
  const templateId = 'summary:weekly'
  let stableRules: string
  let templateLoaded = false

  if (isPromptMemoryP0Enabled()) {
    const templateLoader = createTemplateLoader()
    try {
      stableRules = await templateLoader.load(templateId)
      templateLoaded = true
    } catch (e) {
      console.warn('[summary-prompt-builder] Failed to load summary:weekly template, using hardcoded fallback', e)
      stableRules = HARDCODED_WEEKLY_PROMPT
    }
  } else {
    stableRules = HARDCODED_WEEKLY_PROMPT
  }

  const dynamicData = buildWeeklyDynamicData(input)
  const prompt = `${stableRules}\n\n${dynamicData}`

  return { prompt, templateLoaded, templateId }
}

/**
 * Builds a prompt for generating a long-term user profile.
 *
 * @param input - Long-term profile prompt input data
 * @returns Promise resolving to the built prompt and metadata
 */
export async function buildLongTermProfilePrompt(input: LongTermProfilePromptInput): Promise<SummaryPromptOutput> {
  const templateId = 'summary:long-term'
  let stableRules: string
  let templateLoaded = false

  if (isPromptMemoryP0Enabled()) {
    const templateLoader = createTemplateLoader()
    try {
      stableRules = await templateLoader.load(templateId)
      templateLoaded = true
    } catch (e) {
      console.warn('[summary-prompt-builder] Failed to load summary:long-term template, using hardcoded fallback', e)
      stableRules = HARDCODED_LONG_TERM_PROMPT
    }
  } else {
    stableRules = HARDCODED_LONG_TERM_PROMPT
  }

  const dynamicData = buildLongTermDynamicData(input)
  const prompt = `${stableRules}\n\n${dynamicData}`

  return { prompt, templateLoaded, templateId }
}

/**
 * Builds a prompt for extracting atomic facts.
 * Note: For memory extraction, prefer buildLongTermMemoryExtractionPrompt
 * which integrates atomic facts rules into the full extraction prompt.
 *
 * @param input - Atomic facts prompt input data
 * @returns Promise resolving to the built prompt and metadata
 */
export async function buildAtomicFactsPrompt(input: AtomicFactsPromptInput): Promise<SummaryPromptOutput> {
  const templateId = 'summary:atomic-facts'
  let stableRules: string
  let templateLoaded = false

  if (isPromptMemoryP0Enabled()) {
    const templateLoader = createTemplateLoader()
    try {
      stableRules = await templateLoader.load(templateId)
      templateLoaded = true
    } catch (e) {
      console.warn('[summary-prompt-builder] Failed to load summary:atomic-facts template, using hardcoded fallback', e)
      stableRules = HARDCODED_ATOMIC_FACTS_PROMPT
    }
  } else {
    stableRules = HARDCODED_ATOMIC_FACTS_PROMPT
  }

  const dynamicData = buildAtomicFactsDynamicData(input)
  const prompt = `${stableRules}\n\n${dynamicData}`

  return { prompt, templateLoaded, templateId }
}

// ============================================================================
// Dynamic Data Builders
// ============================================================================

function buildSessionDynamicData(input: SessionSummaryPromptInput): string {
  const parts: string[] = []

  parts.push(`## Session Context`)
  parts.push(`- Session ID: ${input.sessionId}`)
  parts.push(`- User ID: ${input.userId}`)

  if (input.turnCount !== undefined) {
    parts.push(`- Turn Count: ${input.turnCount}`)
  }

  if (input.startTime) {
    parts.push(`- Start Time: ${input.startTime}`)
  }

  if (input.endTime) {
    parts.push(`- End Time: ${input.endTime}`)
  }

  parts.push(``)
  parts.push(`## Conversation Content`)
  parts.push(input.conversationContent)

  return parts.join('\n')
}

function buildDailyDynamicData(input: DailySummaryPromptInput): string {
  const parts: string[] = []

  parts.push(`## Daily Context`)
  parts.push(`- User ID: ${input.userId}`)
  parts.push(`- Date: ${input.date}`)

  if (input.totalTurnCount !== undefined) {
    parts.push(`- Total Turns: ${input.totalTurnCount}`)
  }

  parts.push(``)
  parts.push(`## Session Summaries`)
  parts.push(input.sessionSummaries.join('\n\n---\n\n'))

  return parts.join('\n')
}

function buildWeeklyDynamicData(input: WeeklySummaryPromptInput): string {
  const parts: string[] = []

  parts.push(`## Weekly Context`)
  parts.push(`- User ID: ${input.userId}`)
  parts.push(`- Week Range: ${input.weekStartDate} to ${input.weekEndDate}`)

  parts.push(``)
  parts.push(`## Daily Summaries`)
  parts.push(input.dailySummaries.join('\n\n---\n\n'))

  return parts.join('\n')
}

function buildLongTermDynamicData(input: LongTermProfilePromptInput): string {
  const parts: string[] = []

  parts.push(`## Profile Context`)
  parts.push(`- User ID: ${input.userId}`)

  if (input.previousProfile) {
    parts.push(``)
    parts.push(`## Previous Profile`)
    parts.push(input.previousProfile)
  }

  parts.push(``)
  parts.push(`## Accumulated Memory`)
  parts.push(input.memoryContent)

  return parts.join('\n')
}

function buildAtomicFactsDynamicData(input: AtomicFactsPromptInput): string {
  const parts: string[] = []

  parts.push(`## Extraction Context`)
  parts.push(`- User ID: ${input.userId}`)
  parts.push(`- Session ID: ${input.sessionId}`)

  parts.push(``)
  parts.push(`## Conversation`)
  parts.push(input.conversationContent)

  return parts.join('\n')
}
