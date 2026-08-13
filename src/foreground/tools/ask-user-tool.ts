/**
 * Ask User Tool
 * Persists an ask_user clarification request and returns a pending status
 * so the model can wait for the user's answer (delivered via a synthetic
 * ask_response turn when the user answers through the API).
 */

import type { AskStore, AskOption, AskRequest } from '../../storage/ask-store.js'
import { ASK_STATES } from '../../storage/ask-store.js'
import { generateId, ASK_ID_PREFIX } from '../../shared/ids.js'
import { createSuccessResult, createErrorResult, type ForegroundToolResult } from './foreground-tool-result.js'

export const ASK_USER_TOOL_ID = 'ask_user'

export interface AskUserInput {
  question: string
  options?: AskOption[]
  multiSelect?: boolean
  context?: string
}

export interface AskUserData {
  askId: string
  status: 'pending'
  question: string
}

export interface AskUserDeps {
  askStore: AskStore
  userId: string
  sessionId: string
  turnId: string
}

export async function handleAskUser(
  deps: AskUserDeps,
  input: AskUserInput,
): Promise<ForegroundToolResult<AskUserData>> {
  const { askStore, userId, sessionId } = deps
  const { question, options, multiSelect, context } = input

  try {
    if (!question || !question.trim()) {
      return createErrorResult<AskUserData>(
        'INVALID_ASK_QUESTION',
        'question is required to ask the user',
        true,
        'Question is required to ask the user.',
      )
    }

    const askId = generateId(ASK_ID_PREFIX)
    const now = new Date().toISOString()

    const ask: AskRequest = askStore.create({
      id: askId,
      userId,
      sessionId,
      status: ASK_STATES.PENDING,
      question,
      options: options ?? null,
      multiSelect: multiSelect ?? false,
      context: context ?? null,
      requestedBy: userId,
      requestedAt: now,
    })

    return createSuccessResult<AskUserData>(
      {
        askId: ask.id,
        status: 'pending',
        question: ask.question,
      },
      `Question sent to the user. Waiting for their answer.`,
      {},
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return createErrorResult<AskUserData>('ASK_STORE_ERROR', errorMessage, true, 'Failed to ask the user.')
  }
}
