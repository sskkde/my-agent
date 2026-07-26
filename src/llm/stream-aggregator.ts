/**
 * Stream response aggregator
 * Accumulates provider stream chunks (text + tool_call deltas) into a final LLMResponse.
 */

import type { LLMFinishReason, LLMResponse, LLMStreamChunk, ToolCall } from './types.js'

interface PartialToolCall {
  id?: string
  name?: string
  arguments: string
}

/**
 * Mutable accumulator for one streaming completion.
 * Call `apply` for each LLMStreamChunk, then `toResponse` when the stream ends.
 */
export class StreamResponseAggregator {
  private readonly contentParts: string[] = []
  private readonly toolCallsByIndex = new Map<number, PartialToolCall>()
  private finishReason: LLMFinishReason = 'stop'
  private providerId = 'unknown'
  private model: string | undefined

  apply(chunk: LLMStreamChunk): void {
    this.providerId = chunk.providerId
    if (chunk.model !== undefined) {
      this.model = chunk.model
    }

    switch (chunk.kind) {
      case 'text':
        if (chunk.delta.length > 0) {
          this.contentParts.push(chunk.delta)
        }
        return
      case 'reasoning':
        // T3 will accumulate reasoning into a separate field + expose via toResponse.
        // Until then, reasoning MUST NOT be merged into contentParts (assistant isolation).
        return
      case 'tool_call_delta':
        this.applyToolCallDelta(chunk)
        return
      case 'finish':
        this.finishReason = chunk.finishReason
        return
      default: {
        const _exhaustive: never = chunk
        return _exhaustive
      }
    }
  }

  private applyToolCallDelta(
    chunk: Extract<LLMStreamChunk, { kind: 'tool_call_delta' }>,
  ): void {
    const existing = this.toolCallsByIndex.get(chunk.index) ?? { arguments: '' }
    if (chunk.id !== undefined && chunk.id.length > 0) {
      existing.id = chunk.id
    }
    if (chunk.name !== undefined && chunk.name.length > 0) {
      existing.name = chunk.name
    }
    if (chunk.argumentsDelta !== undefined && chunk.argumentsDelta.length > 0) {
      existing.arguments += chunk.argumentsDelta
    }
    this.toolCallsByIndex.set(chunk.index, existing)
  }

  get content(): string {
    return this.contentParts.join('')
  }

  get hasContent(): boolean {
    return this.contentParts.length > 0
  }

  get hasToolCalls(): boolean {
    return this.toolCallsByIndex.size > 0
  }

  get lastProviderId(): string {
    return this.providerId
  }

  /** True when the stream produced nothing useful (no text and no tool calls). */
  get isEmpty(): boolean {
    return !this.hasContent && !this.hasToolCalls
  }

  /**
   * Build finalized ToolCall list sorted by stream index.
   * Incomplete entries (missing id or name) are dropped.
   */
  buildToolCalls(): ToolCall[] | undefined {
    if (this.toolCallsByIndex.size === 0) {
      return undefined
    }

    const indices = [...this.toolCallsByIndex.keys()].sort((a, b) => a - b)
    const toolCalls: ToolCall[] = []

    for (const index of indices) {
      const partial = this.toolCallsByIndex.get(index)
      if (!partial) continue
      const id = partial.id
      const name = partial.name
      if (!id || !name) continue
      toolCalls.push({
        id,
        type: 'function',
        function: {
          name,
          arguments: partial.arguments.length > 0 ? partial.arguments : '{}',
        },
      })
    }

    return toolCalls.length > 0 ? toolCalls : undefined
  }

  /**
   * Produce a complete LLMResponse from accumulated stream state.
   * If tool calls exist and finishReason is still default stop, promote to tool_calls.
   */
  toResponse(requestModel: string): LLMResponse {
    const toolCalls = this.buildToolCalls()
    let finishReason = this.finishReason
    if (toolCalls && toolCalls.length > 0 && finishReason === 'stop') {
      finishReason = 'tool_calls'
    }

    return {
      id: `stream-${Date.now()}`,
      model: this.model ?? requestModel,
      content: this.content,
      role: 'assistant',
      ...(toolCalls ? { toolCalls } : {}),
      finishReason,
      createdAt: new Date().toISOString(),
    }
  }
}
