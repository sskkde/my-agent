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
  function createToolContext(userId: string = 'user-123', sessionId?: string): ToolExecutionContext {
    return {
      toolCallId: 'test-call-id',
      toolName: 'todolist',
      userId,
      sessionId,
      permissionContext: {
        userId,
        sessionId: sessionId || 'test-session',
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
        sessionId: 'session-123'
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
        sessionId: 'session-123'
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
        format: 'tree'
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
        format: 'markdown'
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
        sessionId: 'empty-session'
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
        sessionId: 'session-123'
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
        sessionId: 'session-123'
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
          todos: [{ id: '1', content: 'Test', status: 'pending' as const, priority: 'high' as const }]
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
          todos: [{ id: '1', content: 'Test', status: 'pending' as const, priority: 'high' as const }]
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
          mode: 'append'
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
            { id: 'todo-2', content: 'Second task', status: 'pending', priority: 'medium' }
          ]
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
          todos: [
            { id: 'todo-1', content: 'Task', status: 'pending', priority: 'high' }
          ]
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
            { id: 'child-1', content: 'Child task', status: 'pending', priority: 'medium', parentId: 'parent-1' }
          ]
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
          todos: [
            { id: 'new-1', content: 'New task', status: 'pending', priority: 'high' }
          ]
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
          todos: [{ id: '1', content: 'Test', status: 'pending' as const, priority: 'high' as const }]
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
          todos: [
            { id: 'todo-1', content: 'Updated task', status: 'completed', priority: 'high' }
          ]
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
            { id: 'todo-2', content: 'Active task', status: 'in_progress', priority: 'medium' }
          ]
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
          todos: [
            { id: 'todo-1', content: 'Cancelled task', status: 'cancelled', priority: 'high' }
          ]
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
          todos: [
            { id: 'todo-1', content: '', status: 'pending', priority: 'low' }
          ]
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
          todos: [
            { id: 'todo-1', content: '', status: 'pending', priority: 'low' }
          ]
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
          todos: [
            { id: 'todo-1', content: 'Task', status: 'pending', priority: 'high' }
          ]
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
          todos: [
            { id: 'todo-1', content: 'Task', status: 'pending', priority: 'high' }
          ]
        }
        
        const result = await tool.handler(params, createToolContext('user-123', 'session-123'))
        
        expect(result.success).toBe(true)
        expect(result.structuredContent).toBeDefined()
        expect(result.structuredContent?.todos).toBeDefined()
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
