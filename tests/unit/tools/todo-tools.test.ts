import { describe, it, expect } from 'vitest'
import type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../../../src/tools/types.js'

// RED PHASE: These tests expect tool implementations that don't exist yet
// The tools will be implemented in the GREEN phase

// Type definitions for expected tool interfaces
interface TodoItem {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  priority: 'high' | 'medium' | 'low'
  parentId?: string
  children?: TodoItem[]
}

interface TodolistParams {
  sessionId?: string
  format?: 'tree' | 'markdown' | 'flat'
}

interface TodolistResult {
  todos: TodoItem[]
  hierarchicalOutput: string
  totalCount: number
  activeCount: number
  maxDepth: number
}

interface TodowriteParams {
  mode: 'append' | 'replace' | 'update' | 'remove'
  todos: TodoItem[]
  sessionId?: string
}

interface TodowriteResult {
  todos: TodoItem[]
  addedCount?: number
  updatedCount?: number
  removedCount?: number
}

describe('todo-tools (RED PHASE)', () => {
  // Helper to create tool execution context
  function createToolContext(userId: string = 'user-123', sessionId: string = 'test-session'): ToolExecutionContext {
    return {
      toolCallId: 'test-call-id',
      toolName: 'todolist',
      userId,
      sessionId,
      permissionContext: {
        userId,
        sessionId,
      } as any,
      executionStartTime: new Date().toISOString(),
      stores: {
        toolExecutionStore: {
          updateStatus: () => {},
          saveResult: () => {},
        },
      },
    }
  }

  // Helper to validate RuntimeContextDelta structure
  function assertContextDelta(result: ToolExecutionResult, _expectedTodos: TodoItem[]): void {
    expect(result.contextDelta).toBeDefined()
    expect(result.contextDelta?.source).toBe('runtime_note')
    expect(result.contextDelta?.items).toBeDefined()
    expect(Array.isArray(result.contextDelta?.items)).toBe(true)

    // contextDelta should only contain active (non-completed, non-cancelled) todos
    const deltaItems = result.contextDelta?.items || []
    for (const item of deltaItems) {
      expect(item.sourceType).toBe('system_note')
      expect(item.semanticType).toBe('entity_state')
      expect(item.structuredPayload).toBeDefined()

      const todo = item.structuredPayload as unknown as TodoItem
      expect(['pending', 'in_progress']).toContain(todo.status)
    }
  }

  describe('createTodolistTool', () => {
    it('should be defined as a ToolDefinition', async () => {
      // Import the tool - this will fail in RED phase
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')

      const tool: ToolDefinition = createTodolistTool()

      expect(tool.name).toBe('todolist')
      expect(tool.description).toBeDefined()
      expect(tool.category).toBe('read')
      expect(tool.sensitivity).toBe('low')
      expect(tool.schema.type).toBe('object')
      expect(tool.handler).toBeDefined()
    })

    it('should return hierarchical todo list for session', async () => {
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
      const tool = createTodolistTool()

      const params: TodolistParams = {
        sessionId: 'session-123',
      }

      const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

      expect(result.success).toBe(true)
      expect(result.data).toBeDefined()

      const data = result.data as TodolistResult
      expect(data.todos).toBeDefined()
      expect(Array.isArray(data.todos)).toBe(true)
      expect(data.hierarchicalOutput).toBeDefined()
      expect(typeof data.hierarchicalOutput).toBe('string')
    })

    it('should limit hierarchical output to max 3 levels', async () => {
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
      const tool = createTodolistTool()

      const params: TodolistParams = {
        sessionId: 'session-123',
      }

      const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

      expect(result.success).toBe(true)
      const data = result.data as TodolistResult
      expect(data.maxDepth).toBeLessThanOrEqual(3)
    })

    it('should support tree format output', async () => {
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
      const tool = createTodolistTool()

      const params: TodolistParams = {
        sessionId: 'session-123',
        format: 'tree',
      }

      const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

      expect(result.success).toBe(true)
      const data = result.data as TodolistResult
      // Tree format should use indentation for hierarchy
      expect(data.hierarchicalOutput).toMatch(/^(\s*[-•*]|\w)/m)
    })

    it('should support markdown format output', async () => {
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
      const tool = createTodolistTool()

      const params: TodolistParams = {
        sessionId: 'session-123',
        format: 'markdown',
      }

      const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

      expect(result.success).toBe(true)
      const data = result.data as TodolistResult
      // Markdown format should use nested bullets with indentation
      expect(data.hierarchicalOutput).toMatch(/^(\s*[-*]\s|#{1,3}\s)/m)
    })

    it('should return empty list for session with no todos', async () => {
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
      const tool = createTodolistTool()

      const params: TodolistParams = {
        sessionId: 'empty-session',
      }

      const result = await tool.handler(params, createToolContext('user-123', 'empty-session'))

      expect(result.success).toBe(true)
      const data = result.data as TodolistResult
      expect(data.todos).toEqual([])
      expect(data.totalCount).toBe(0)
      expect(data.activeCount).toBe(0)
    })

    it('should return resultPreview with todo summary', async () => {
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
      const tool = createTodolistTool()

      const params: TodolistParams = {
        sessionId: 'session-123',
      }

      const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

      expect(result.success).toBe(true)
      expect(result.resultPreview).toBeDefined()
      expect(typeof result.resultPreview).toBe('string')
    })

    it('should NOT include contextDelta for read operation', async () => {
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
      const tool = createTodolistTool()

      const params: TodolistParams = {
        sessionId: 'session-123',
      }

      const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

      // Read operations should not modify context
      expect(result.contextDelta).toBeUndefined()
    })
  })

  describe('createTodowriteTool', () => {
    it('should be defined as a ToolDefinition', async () => {
      const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')

      const tool: ToolDefinition = createTodowriteTool()

      expect(tool.name).toBe('todowrite')
      expect(tool.description).toBeDefined()
      expect(tool.category).toBe('write')
      expect(tool.sensitivity).toBe('low')
      expect(tool.schema.type).toBe('object')
      expect(tool.handler).toBeDefined()
      expect(tool.schema.required).toContain('mode')
      expect(tool.schema.required).toContain('todos')
    })

    describe('mode validation', () => {
      it('should reject missing mode parameter', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params = {
          todos: [{ id: '1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }

        const result = await tool.handler(params, createToolContext())

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(result.error?.code).toBe('INVALID_PARAMS')
        expect(result.error?.message).toMatch(/mode.*required/i)
      })

      it('should reject invalid mode value', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params = {
          mode: 'invalid_mode',
          todos: [{ id: '1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }

        const result = await tool.handler(params, createToolContext())

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(result.error?.code).toBe('INVALID_PARAMS')
      })

      it('should reject missing todos parameter', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params = {
          mode: 'append',
        }

        const result = await tool.handler(params, createToolContext())

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(result.error?.code).toBe('INVALID_PARAMS')
      })
    })

    describe('append mode', () => {
      it('should add todos to existing list', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'append',
          sessionId: 'session-123',
          todos: [
            { id: 'todo-1', content: 'First task', status: 'pending', priority: 'high' },
            { id: 'todo-2', content: 'Second task', status: 'pending', priority: 'medium' },
          ],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        const data = result.data as TodowriteResult
        expect(data.todos).toHaveLength(2)
        expect(data.addedCount).toBe(2)
      })

      it('should return RuntimeContextDelta with active todos', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'append',
          sessionId: 'session-123',
          todos: [{ id: 'todo-1', content: 'Task', status: 'pending', priority: 'high' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        assertContextDelta(result, params.todos)
      })

      it('should support hierarchical todos with parentId', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'append',
          sessionId: 'session-123',
          todos: [
            { id: 'parent-1', content: 'Parent task', status: 'pending', priority: 'high' },
            { id: 'child-1', content: 'Child task', status: 'pending', priority: 'medium', parentId: 'parent-1' },
          ],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        const data = result.data as TodowriteResult
        expect(data.todos).toHaveLength(2)
      })
    })

    describe('replace mode', () => {
      it('should replace entire todo list', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'replace',
          sessionId: 'session-123',
          todos: [{ id: 'new-1', content: 'New task', status: 'pending', priority: 'high' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        const data = result.data as TodowriteResult
        expect(data.todos).toHaveLength(1)
        expect(data.todos[0].id).toBe('new-1')
      })

      it('should NOT be the implicit default mode', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        // Missing mode should fail validation, not default to replace
        const params = {
          todos: [{ id: '1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }

        const result = await tool.handler(params, createToolContext())

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('INVALID_PARAMS')
      })
    })

    describe('update mode', () => {
      it('should update existing todo status', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'update',
          sessionId: 'session-123',
          todos: [{ id: 'todo-1', content: 'Updated task', status: 'completed', priority: 'high' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        const data = result.data as TodowriteResult
        expect(data.updatedCount).toBe(1)
      })

      it('should exclude completed todos from contextDelta', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'update',
          sessionId: 'session-123',
          todos: [
            { id: 'todo-1', content: 'Completed task', status: 'completed', priority: 'high' },
            { id: 'todo-2', content: 'Active task', status: 'in_progress', priority: 'medium' },
          ],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)

        // contextDelta should only contain active todos
        const deltaItems = result.contextDelta?.items || []
        expect(deltaItems.length).toBe(1) // Only the active task

        const activeTodo = deltaItems[0].structuredPayload as unknown as TodoItem
        expect(activeTodo.status).toBe('in_progress')
      })

      it('should exclude cancelled todos from contextDelta', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'update',
          sessionId: 'session-123',
          todos: [{ id: 'todo-1', content: 'Cancelled task', status: 'cancelled', priority: 'high' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)

        // contextDelta should be empty or undefined for cancelled todos
        const deltaItems = result.contextDelta?.items || []
        expect(deltaItems.length).toBe(0)
      })
    })

    describe('remove mode', () => {
      it('should remove todos by id', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'remove',
          sessionId: 'session-123',
          todos: [{ id: 'todo-1', content: '', status: 'pending', priority: 'low' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        const data = result.data as TodowriteResult
        expect(data.removedCount).toBe(1)
      })

      it('should return updated list in contextDelta after removal', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'remove',
          sessionId: 'session-123',
          todos: [{ id: 'todo-1', content: '', status: 'pending', priority: 'low' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        expect(result.contextDelta).toBeDefined()
      })
    })

    describe('result structure', () => {
      it('should return resultPreview with mutation summary', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'append',
          sessionId: 'session-123',
          todos: [{ id: 'todo-1', content: 'Task', status: 'pending', priority: 'high' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        expect(result.resultPreview).toBeDefined()
        expect(typeof result.resultPreview).toBe('string')
      })

      it('should return structuredContent for LLM consumption', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params: TodowriteParams = {
          mode: 'append',
          sessionId: 'session-123',
          todos: [{ id: 'todo-1', content: 'Task', status: 'pending', priority: 'high' }],
        }

        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))

        expect(result.success).toBe(true)
        expect(result.structuredContent).toBeDefined()
        expect(result.structuredContent?.todos).toBeDefined()
      })
    })
  })

  describe('context-first session and owner derivation', () => {
    function createContextWithAgent(
      opts: {
        userId?: string
        sessionId?: string
        agentId?: string
        agentType?: string
      } = {},
    ): ToolExecutionContext {
      return {
        toolCallId: 'test-call-id',
        toolName: 'todowrite',
        userId: opts.userId ?? 'user-123',
        sessionId: opts.sessionId,
        agentId: opts.agentId,
        agentType: opts.agentType,
        permissionContext: {
          userId: opts.userId ?? 'user-123',
          sessionId: opts.sessionId || 'test-session',
        } as any,
        executionStartTime: new Date().toISOString(),
        stores: {
          toolExecutionStore: {
            updateStatus: () => {},
            saveResult: () => {},
          },
        },
      }
    }

    describe('todowrite context derivation', () => {
      it('should use context.sessionId over params.sessionId', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params = {
          mode: 'append' as const,
          sessionId: 'params-session',
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({ sessionId: 'context-session' })

        const result = await tool.handler(params, ctx)

        expect(result.success).toBe(true)
        expect(result.data).toBeDefined()
      })

      it('should ignore params.sessionId and return INVALID_PARAMS when context.sessionId is missing', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params = {
          mode: 'append' as const,
          sessionId: 'params-session',
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({ sessionId: undefined })

        const result = await tool.handler(params, ctx)

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('INVALID_PARAMS')
        expect(result.error?.recoverable).toBe(true)
      })

      it('should return recoverable INVALID_PARAMS when no session available', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params = {
          mode: 'append' as const,
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({ sessionId: undefined })

        const result = await tool.handler(params, ctx)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(result.error?.code).toBe('INVALID_PARAMS')
        expect(result.error?.recoverable).toBe(true)
      })

      it('should NOT fall back to default-session when session is missing', async () => {
        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool()

        const params = {
          mode: 'append' as const,
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({ sessionId: undefined })

        const result = await tool.handler(params, ctx)

        expect(result.success).toBe(false)
        expect(result.error?.code).toBe('INVALID_PARAMS')
      })

      it('should derive ownerAgentId from context.agentId', async () => {
        const mockStore = {
          findById: () => null,
          findBySessionAndOwner: (_sid: string, _owner: string) => [],
          create: (input: any) => ({
            todoId: input.todoId ?? input.id,
            sessionId: input.sessionId,
            tenantId: 'default',
            content: input.content,
            status: input.status,
            priority: input.priority,
            parentTodoId: input.parentTodoId ?? null,
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          update: () => null,
          remove: () => false,
          replace: (_sid: string, _todos: any[]) => [],
        }

        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool(mockStore as any)

        const params = {
          mode: 'append' as const,
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({
          sessionId: 'sess-1',
          agentId: 'agent.custom-id',
        })

        let capturedOwner = ''
        mockStore.findBySessionAndOwner = (_sid: string, owner: string) => {
          capturedOwner = owner
          return []
        }

        await tool.handler(params, ctx)

        expect(capturedOwner).toBe('agent.custom-id')
      })

      it('should fall back to agentType when agentId is missing', async () => {
        let capturedOwner = ''
        const mockStore = {
          findById: () => null,
          findBySessionAndOwner: (_sid: string, owner: string) => {
            capturedOwner = owner
            return []
          },
          create: (input: any) => ({
            todoId: input.todoId ?? input.id,
            sessionId: input.sessionId,
            tenantId: 'default',
            content: input.content,
            status: input.status,
            priority: input.priority,
            parentTodoId: input.parentTodoId ?? null,
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          update: () => null,
          remove: () => false,
          replace: () => [],
        }

        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool(mockStore as any)

        const params = {
          mode: 'append' as const,
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({
          sessionId: 'sess-1',
          agentType: 'subagent',
        })

        await tool.handler(params, ctx)

        expect(capturedOwner).toBe('subagent')
      })

      it('should default ownerAgentId to foreground.default when neither agentId nor agentType set', async () => {
        let capturedOwner = ''
        const mockStore = {
          findById: () => null,
          findBySessionAndOwner: (_sid: string, owner: string) => {
            capturedOwner = owner
            return []
          },
          create: (input: any) => ({
            todoId: input.todoId ?? input.id,
            sessionId: input.sessionId,
            tenantId: 'default',
            content: input.content,
            status: input.status,
            priority: input.priority,
            parentTodoId: input.parentTodoId ?? null,
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          update: () => null,
          remove: () => false,
          replace: () => [],
        }

        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool(mockStore as any)

        const params = {
          mode: 'append' as const,
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({ sessionId: 'sess-1' })

        await tool.handler(params, ctx)

        expect(capturedOwner).toBe('foreground.default')
      })

      it('should use findBySessionAndOwner for replace mode', async () => {
        let capturedOwner = ''
        const mockStore = {
          findById: () => null,
          findBySessionAndOwner: (_sid: string, owner: string) => {
            capturedOwner = owner
            return []
          },
          create: (input: any) => ({
            todoId: input.todoId ?? input.id,
            sessionId: input.sessionId,
            tenantId: 'default',
            content: input.content,
            status: input.status,
            priority: input.priority,
            parentTodoId: input.parentTodoId ?? null,
            position: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }),
          update: () => null,
          remove: () => false,
          replace: (_sid: string, _todos: any[], owner?: string) => {
            if (owner) capturedOwner = owner
            return []
          },
        }

        const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')
        const tool = createTodowriteTool(mockStore as any)

        const params = {
          mode: 'replace' as const,
          todos: [{ id: 't1', content: 'Test', status: 'pending' as const, priority: 'high' as const }],
        }
        const ctx = createContextWithAgent({
          sessionId: 'sess-1',
          agentId: 'agent.research',
        })

        await tool.handler(params, ctx)

        expect(capturedOwner).toBe('agent.research')
      })
    })

    describe('todolist context derivation', () => {
      it('should use context.sessionId over params.sessionId', async () => {
        const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
        const tool = createTodolistTool()

        const params = { sessionId: 'params-session' }
        const ctx = createContextWithAgent({
          sessionId: 'context-session',
          agentId: 'agent.test',
        })

        const result = await tool.handler(params, ctx)

        expect(result.success).toBe(true)
      })

      it('should return error when no session available', async () => {
        const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
        const tool = createTodolistTool()

        const params = {}
        const ctx = createContextWithAgent({ sessionId: undefined })

        const result = await tool.handler(params, ctx)

        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
        expect(result.error?.code).toBe('INVALID_PARAMS')
        expect(result.error?.recoverable).toBe(true)
      })

      it('should use findBySessionAndOwner with owner from context', async () => {
        let capturedSid = ''
        let capturedOwner = ''
        const mockStore = {
          findById: () => null,
          findBySessionAndOwner: (sid: string, owner: string) => {
            capturedSid = sid
            capturedOwner = owner
            return []
          },
        }

        const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
        const tool = createTodolistTool(mockStore as any)

        const params = {}
        const ctx = createContextWithAgent({
          sessionId: 'sess-1',
          agentId: 'agent.writer',
        })

        await tool.handler(params, ctx)

        expect(capturedSid).toBe('sess-1')
        expect(capturedOwner).toBe('agent.writer')
      })

      it('should isolate todos by owner - different agents see different lists', async () => {
        const allTodos = [
          {
            todoId: 't1',
            sessionId: 's1',
            tenantId: 'default',
            content: 'Agent A todo',
            status: 'pending',
            priority: 'high',
            parentTodoId: null,
            position: 0,
            createdAt: '',
            updatedAt: '',
          },
          {
            todoId: 't2',
            sessionId: 's1',
            tenantId: 'default',
            content: 'Agent B todo',
            status: 'pending',
            priority: 'high',
            parentTodoId: null,
            position: 0,
            createdAt: '',
            updatedAt: '',
          },
        ]

        const mockStore = {
          findById: () => null,
          findBySessionAndOwner: (_sid: string, owner: string) => {
            return allTodos.filter((t) => t.todoId === (owner === 'agent.a' ? 't1' : 't2'))
          },
        }

        const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
        const tool = createTodolistTool(mockStore as any)

        const ctxA = createContextWithAgent({ sessionId: 's1', agentId: 'agent.a' })
        const ctxB = createContextWithAgent({ sessionId: 's1', agentId: 'agent.b' })

        const resultA = await tool.handler({}, ctxA)
        const resultB = await tool.handler({}, ctxB)

        expect((resultA.data as TodolistResult).totalCount).toBe(1)
        expect((resultA.data as TodolistResult).todos[0].content).toBe('Agent A todo')

        expect((resultB.data as TodolistResult).totalCount).toBe(1)
        expect((resultB.data as TodolistResult).todos[0].content).toBe('Agent B todo')
      })

      it('should NOT use shared default-session for missing session', async () => {
        const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
        const tool = createTodolistTool()

        const params = {}
        const ctx = createContextWithAgent({ sessionId: undefined })

        const result = await tool.handler(params, ctx)

        expect(result.success).toBe(false)
      })

      it('should NOT allow params to override owner - context owner always wins', async () => {
        let capturedOwner = ''
        const mockStore = {
          findById: () => null,
          findBySessionAndOwner: (_sid: string, owner: string) => {
            capturedOwner = owner
            return []
          },
        }

        const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')
        const tool = createTodolistTool(mockStore as any)

        const params = {}
        const ctx = createContextWithAgent({
          sessionId: 's1',
          agentId: 'agent.from-context',
        })

        await tool.handler(params, ctx)

        expect(capturedOwner).toBe('agent.from-context')
      })
    })
  })

  describe('tool registration', () => {
    it('should register todolist tool with registry', async () => {
      const { createToolRegistry } = await import('../../../src/tools/tool-registry.js')
      const { createTodolistTool } = await import('../../../src/tools/builtins/todo-list-tool.js')

      const registry = createToolRegistry()
      const tool = createTodolistTool()

      registry.register(tool)

      expect(registry.hasTool('todolist')).toBe(true)
      const registered = registry.getTool('todolist')
      expect(registered?.category).toBe('read')
      expect(registered?.sensitivity).toBe('low')
    })

    it('should register todowrite tool with registry', async () => {
      const { createToolRegistry } = await import('../../../src/tools/tool-registry.js')
      const { createTodowriteTool } = await import('../../../src/tools/builtins/todo-write-tool.js')

      const registry = createToolRegistry()
      const tool = createTodowriteTool()

      registry.register(tool)

      expect(registry.hasTool('todowrite')).toBe(true)
      const registered = registry.getTool('todowrite')
      expect(registered?.category).toBe('write')
      expect(registered?.sensitivity).toBe('low')
    })
  })
})
