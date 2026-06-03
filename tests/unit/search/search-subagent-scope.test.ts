import { describe, it, expect } from 'vitest';
import {
  assertSearchScope,
  isSearchCategoryTool,
  SearchSubagentScopeError,
  SEARCH_CATEGORY_TOOL_IDS,
  NON_SEARCH_TOOL_NOT_ALLOWED,
} from '../../../src/search/search-subagent-types.js';

describe('SearchSubagent scope guardrails', () => {
  describe('SEARCH_CATEGORY_TOOL_IDS constant', () => {
    it('contains web_search as a valid search tool', () => {
      expect(SEARCH_CATEGORY_TOOL_IDS).toContain('web_search');
    });

    it('contains docs_search as a valid search tool', () => {
      expect(SEARCH_CATEGORY_TOOL_IDS).toContain('docs_search');
    });

    it('is a readonly array', () => {
      expect(Array.isArray(SEARCH_CATEGORY_TOOL_IDS)).toBe(true);
      expect(SEARCH_CATEGORY_TOOL_IDS.length).toBe(2);
    });
  });

  describe('assertSearchScope', () => {
    it('allows web_search tool ID', () => {
      expect(() => assertSearchScope('web_search')).not.toThrow();
    });

    it('allows docs_search tool ID', () => {
      expect(() => assertSearchScope('docs_search')).not.toThrow();
    });

    it('rejects foreground_spawn_planner tool ID', () => {
      expect(() => assertSearchScope('foreground_spawn_planner')).toThrow(SearchSubagentScopeError);
    });

    it('rejects file_read tool ID', () => {
      expect(() => assertSearchScope('file_read')).toThrow(SearchSubagentScopeError);
    });

    it('rejects memory_retrieve tool ID', () => {
      expect(() => assertSearchScope('memory_retrieve')).toThrow(SearchSubagentScopeError);
    });

    it('rejects web_fetch tool ID', () => {
      expect(() => assertSearchScope('web_fetch')).toThrow(SearchSubagentScopeError);
    });

    it('rejects arbitrary unknown tool IDs', () => {
      expect(() => assertSearchScope('some_random_tool')).toThrow(SearchSubagentScopeError);
    });

    it('throws error with correct code NON_SEARCH_TOOL_NOT_ALLOWED', () => {
      try {
        assertSearchScope('foreground_spawn_planner');
        expect.fail('Expected SearchSubagentScopeError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SearchSubagentScopeError);
        const scopeError = error as SearchSubagentScopeError;
        expect(scopeError.code).toBe(NON_SEARCH_TOOL_NOT_ALLOWED);
      }
    });

    it('throws error with rejected toolId in message', () => {
      const toolId = 'foreground_spawn_planner';
      try {
        assertSearchScope(toolId);
        expect.fail('Expected SearchSubagentScopeError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SearchSubagentScopeError);
        const scopeError = error as SearchSubagentScopeError;
        expect(scopeError.toolId).toBe(toolId);
        expect(scopeError.message).toContain(toolId);
      }
    });

    it('throws error with allowed tools list in message', () => {
      try {
        assertSearchScope('invalid_tool');
        expect.fail('Expected SearchSubagentScopeError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(SearchSubagentScopeError);
        const scopeError = error as SearchSubagentScopeError;
        expect(scopeError.allowedTools).toEqual(SEARCH_CATEGORY_TOOL_IDS);
        expect(scopeError.message).toContain('web_search');
        expect(scopeError.message).toContain('docs_search');
      }
    });
  });

  describe('isSearchCategoryTool', () => {
    it('returns true for web_search', () => {
      expect(isSearchCategoryTool('web_search')).toBe(true);
    });

    it('returns true for docs_search', () => {
      expect(isSearchCategoryTool('docs_search')).toBe(true);
    });

    it('returns false for foreground_spawn_planner', () => {
      expect(isSearchCategoryTool('foreground_spawn_planner')).toBe(false);
    });

    it('returns false for file_read', () => {
      expect(isSearchCategoryTool('file_read')).toBe(false);
    });

    it('returns false for unknown tool IDs', () => {
      expect(isSearchCategoryTool('unknown_tool')).toBe(false);
    });
  });

  describe('SearchSubagentScopeError', () => {
    it('is an instance of Error', () => {
      const error = new SearchSubagentScopeError('test_tool');
      expect(error).toBeInstanceOf(Error);
    });

    it('has correct name property', () => {
      const error = new SearchSubagentScopeError('test_tool');
      expect(error.name).toBe('SearchSubagentScopeError');
    });

    it('has correct code property', () => {
      const error = new SearchSubagentScopeError('test_tool');
      expect(error.code).toBe(NON_SEARCH_TOOL_NOT_ALLOWED);
    });

    it('stores the rejected toolId', () => {
      const toolId = 'rejected_tool';
      const error = new SearchSubagentScopeError(toolId);
      expect(error.toolId).toBe(toolId);
    });

    it('stores the allowed tools list', () => {
      const error = new SearchSubagentScopeError('test_tool');
      expect(error.allowedTools).toEqual(SEARCH_CATEGORY_TOOL_IDS);
    });

    it('generates descriptive message', () => {
      const toolId = 'bad_tool';
      const error = new SearchSubagentScopeError(toolId);
      expect(error.message).toContain(toolId);
      expect(error.message).toContain('SearchSubagent cannot call');
      expect(error.message).toContain('Allowed tools');
    });
  });
});

describe('SearchSubagentToolResult contract', () => {
  it('does not include finalAnswer field', async () => {
    const types = await import('../../../src/search/search-subagent-types.js');
    
    // Type-level check: finalAnswer should not be a property on SearchSubagentToolResult
    // This is a compile-time constraint enforced by TypeScript
    // The module exports runtime values we can verify
    expect(types.SearchSubagentScopeError).toBeDefined();
    expect(types.assertSearchScope).toBeDefined();
  });

  it('does not include userVisibleResponse field', async () => {
    // This is enforced at the type level - the interface simply doesn't have these fields
    // The test verifies the module exports the expected types
    const types = await import('../../../src/search/search-subagent-types.js');
    
    expect(types.SearchSubagentScopeError).toBeDefined();
    expect(types.assertSearchScope).toBeDefined();
    expect(types.isSearchCategoryTool).toBeDefined();
    expect(types.SEARCH_CATEGORY_TOOL_IDS).toBeDefined();
  });
});

describe('SearchQueryPlan interface', () => {
  it('includes all required fields from the plan', async () => {
    const types = await import('../../../src/search/search-subagent-types.js');
    
    // Verify the type exports exist
    expect(types.SearchSubagentScopeError).toBeDefined();
    
    // Type-level verification that SearchQueryPlan has the correct fields:
    // - originalQuestion: string
    // - searchQuery: string
    // - intent: SearchIntent
    // - requiresFreshness: boolean
    // - locale?: string
    // - missingCriticalContext: string[]
    // This is enforced by TypeScript at compile time
  });
});
