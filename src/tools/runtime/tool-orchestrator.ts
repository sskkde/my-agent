import type { ToolCategory, ToolExecutionRequest, ToolExecutionResult, ToolExecutor, ToolRegistry } from '../types.js'

export type ToolUse = ToolExecutionRequest & {
  timeoutMs?: number
}

export interface ToolOrchestratorOptions {
  maxParallelReads?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ToolOrchestratorConfig {
  executor: ToolExecutor
  registry: ToolRegistry
  maxParallelReads?: number
}

export interface ToolOrchestrator {
  executeBatch(toolUses: ToolUse[], options?: ToolOrchestratorOptions): Promise<ToolExecutionResult[]>
}

type TerminalStatus = 'cancelled' | 'timeout' | 'skipped'

type IndexedToolUse = {
  index: number
  toolUse: ToolUse
}

class ToolOrchestratorImpl implements ToolOrchestrator {
  private readonly executor: ToolExecutor
  private readonly registry: ToolRegistry
  private readonly defaultMaxParallelReads: number

  constructor(config: ToolOrchestratorConfig) {
    this.executor = config.executor
    this.registry = config.registry
    this.defaultMaxParallelReads = normalizeConcurrency(config.maxParallelReads ?? 5)
  }

  async executeBatch(toolUses: ToolUse[], options: ToolOrchestratorOptions = {}): Promise<ToolExecutionResult[]> {
    if (toolUses.length === 0) return []

    if (toolUses.length === 1) {
      return [await this.executeWithTerminalPolicy(toolUses[0], options)]
    }

    const results = new Array<ToolExecutionResult>(toolUses.length)
    const readUses: IndexedToolUse[] = []
    const serialUses: IndexedToolUse[] = []

    toolUses.forEach((toolUse, index) => {
      const category = this.registry.getTool(toolUse.toolName)?.category
      if (isReadLikeCategory(category)) {
        readUses.push({ index, toolUse })
      } else {
        serialUses.push({ index, toolUse })
      }
    })

    await Promise.all([
      this.executeReadGroup(readUses, results, options),
      this.executeSerialGroup(serialUses, results, options),
    ])

    return results
  }

  private async executeReadGroup(
    readUses: IndexedToolUse[],
    results: ToolExecutionResult[],
    options: ToolOrchestratorOptions,
  ): Promise<void> {
    const maxParallelReads = normalizeConcurrency(options.maxParallelReads ?? this.defaultMaxParallelReads)
    let nextIndex = 0

    const workers = Array.from({ length: Math.min(maxParallelReads, readUses.length) }, async () => {
      while (nextIndex < readUses.length) {
        const item = readUses[nextIndex]
        nextIndex += 1
        results[item.index] = await this.executeWithTerminalPolicy(item.toolUse, options)
      }
    })

    await Promise.all(workers)
  }

  private async executeSerialGroup(
    serialUses: IndexedToolUse[],
    results: ToolExecutionResult[],
    options: ToolOrchestratorOptions,
  ): Promise<void> {
    let previousWriteFailed = false

    for (const item of serialUses) {
      if (previousWriteFailed) {
        results[item.index] = createSyntheticResult(
          'skipped',
          'SIBLING_WRITE_FAILED',
          'Skipped because an earlier serial tool in the batch failed.',
        )
        continue
      }

      const result = await this.executeWithTerminalPolicy(item.toolUse, options)
      results[item.index] = result

      if (!result.success) {
        previousWriteFailed = true
      }
    }
  }

  private async executeWithTerminalPolicy(
    toolUse: ToolUse,
    options: ToolOrchestratorOptions,
  ): Promise<ToolExecutionResult> {
    if (options.signal?.aborted) {
      return createSyntheticResult('cancelled', 'CANCELLED', 'Tool execution was cancelled before it started.')
    }

    const timeoutMs = toolUse.timeoutMs ?? options.timeoutMs
    const execution = this.executor.execute({ ...toolUse, signal: options.signal })

    if (timeoutMs === undefined) {
      return this.withAbort(execution, options.signal)
    }

    return this.withTimeout(execution, timeoutMs, options.signal)
  }

  private withTimeout(
    execution: Promise<ToolExecutionResult>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<ToolExecutionResult> {
    if (timeoutMs <= 0) {
      return Promise.resolve(createSyntheticResult('timeout', 'TIMEOUT', 'Tool execution timed out.'))
    }

    return new Promise<ToolExecutionResult>((resolve) => {
      if (signal?.aborted) {
        resolve(createSyntheticResult('cancelled', 'CANCELLED', 'Tool execution was cancelled.'))
        return
      }

      const onAbort = () => {
        clearTimeout(timeout)
        resolve(createSyntheticResult('cancelled', 'CANCELLED', 'Tool execution was cancelled.'))
      }
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort)
        resolve(createSyntheticResult('timeout', 'TIMEOUT', `Tool execution timed out after ${timeoutMs}ms.`))
      }, timeoutMs)
      signal?.addEventListener('abort', onAbort, { once: true })

      execution.then(
        (result) => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', onAbort)
          resolve(
            signal?.aborted ? createSyntheticResult('cancelled', 'CANCELLED', 'Tool execution was cancelled.') : result,
          )
        },
        (error: unknown) => {
          clearTimeout(timeout)
          signal?.removeEventListener('abort', onAbort)
          resolve({
            success: false,
            error: {
              code: 'EXECUTION_FAILED',
              message: error instanceof Error ? error.message : String(error),
              recoverable: false,
            },
          })
        },
      )
    })
  }

  private withAbort(execution: Promise<ToolExecutionResult>, signal?: AbortSignal): Promise<ToolExecutionResult> {
    if (!signal) return execution
    if (signal.aborted) {
      return Promise.resolve(createSyntheticResult('cancelled', 'CANCELLED', 'Tool execution was cancelled.'))
    }

    return new Promise<ToolExecutionResult>((resolve) => {
      const onAbort = () => resolve(createSyntheticResult('cancelled', 'CANCELLED', 'Tool execution was cancelled.'))
      signal.addEventListener('abort', onAbort, { once: true })
      execution.then(
        (result) => {
          signal.removeEventListener('abort', onAbort)
          resolve(
            signal.aborted ? createSyntheticResult('cancelled', 'CANCELLED', 'Tool execution was cancelled.') : result,
          )
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort)
          resolve({
            success: false,
            error: {
              code: 'EXECUTION_FAILED',
              message: error instanceof Error ? error.message : String(error),
              recoverable: false,
            },
          })
        },
      )
    })
  }
}

function isReadLikeCategory(category: ToolCategory | undefined): boolean {
  return category === 'read' || category === 'search'
}

function normalizeConcurrency(value: number): number {
  return Math.max(1, Math.floor(value))
}

function createSyntheticResult(status: TerminalStatus, code: string, message: string): ToolExecutionResult {
  return {
    success: false,
    status,
    synthetic: true,
    error: {
      code,
      message,
      recoverable: status !== 'skipped',
    },
  }
}

export function createToolOrchestrator(config: ToolOrchestratorConfig): ToolOrchestrator {
  return new ToolOrchestratorImpl(config)
}
