import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js'

export interface AskUserParams {
  question: string
  context?: string
}

export interface AskUserResult {
  status: 'pending_approval'
  question: string
  context?: string
  requestId: string
  timestamp: string
  [key: string]: unknown
}

export function createAskUserTool(): ToolDefinition {
  const handler: ToolHandler = async (params: unknown): Promise<ToolExecutionResult> => {
    const typedParams = params as AskUserParams

    if (!typedParams.question) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: 'Missing required field: question',
          recoverable: true,
        },
      }
    }

    const requestId = `ask_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    const result: AskUserResult = {
      status: 'pending_approval',
      question: typedParams.question,
      context: typedParams.context,
      requestId,
      timestamp: new Date().toISOString(),
    }

    return {
      success: true,
      data: result,
      resultPreview: `Awaiting user response: "${typedParams.question}"`,
      structuredContent: result,
      events: [
        {
          eventType: 'user_question_raised',
          payload: {
            requestId,
            question: typedParams.question,
            context: typedParams.context,
          },
          timestamp: result.timestamp,
        },
      ],
    }
  }

  return {
    name: 'ask_user',
    description: 'Ask the user for clarification or input on a question',
    category: 'internal',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Question to ask the user' },
        context: { type: 'string', description: 'Additional context for the question' },
      },
      required: ['question'],
    },
    handler,
  }
}
