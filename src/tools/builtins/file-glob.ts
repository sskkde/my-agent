import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { ToolExecutionContext } from '../types.js';
import { readdirSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import {
  validatePathSafety,
  getWorkspaceRoot,
  GLOB_RESULT_CAP,
  LARGE_RESULT_THRESHOLD,
} from './safe-paths.js';

export interface FileGlobParams {
  pattern: string;
  path?: string;
  limit?: number;
}

export interface FileGlobResult {
  files: string[];
  total: number;
  truncated: boolean;
}

interface FileEntry {
  path: string;
  mtime: number;
}

function matchGlobPattern(filename: string, pattern: string): boolean {
  const regex = globToRegex(pattern);
  return regex.test(filename);
}

function globToRegex(pattern: string): RegExp {
  let regexStr = '';
  let i = 0;
  
  while (i < pattern.length) {
    const char = pattern[i];
    
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        regexStr += '.*';
        i += 2;
      } else {
        regexStr += '[^/]*';
        i++;
      }
    } else if (char === '?') {
      regexStr += '[^/]';
      i++;
    } else if (char === '[') {
      let bracketContent = '[';
      i++;
      while (i < pattern.length && pattern[i] !== ']') {
        bracketContent += pattern[i];
        i++;
      }
      bracketContent += ']';
      regexStr += bracketContent;
      i++;
    } else if ('.+^${}()|'.includes(char)) {
      regexStr += '\\' + char;
      i++;
    } else {
      regexStr += char;
      i++;
    }
  }
  
  return new RegExp('^' + regexStr + '$');
}

function collectFiles(
  dir: string,
  basePattern: string,
  workspaceRoot: string,
  results: FileEntry[],
  maxResults: number
): void {
  if (results.length >= maxResults) return;
  
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    
    const fullPath = join(dir, entry.name as string);
    
    const safetyResult = validatePathSafety(fullPath, workspaceRoot);
    if (!safetyResult.safe) continue;
    
    if (entry.isDirectory()) {
      collectFiles(fullPath, basePattern, workspaceRoot, results, maxResults);
    } else if (entry.isFile()) {
      if (matchGlobPattern(entry.name as string, basePattern)) {
        const stats = statSync(fullPath);
        results.push({
          path: safetyResult.relativePath!,
          mtime: stats.mtimeMs,
        });
      }
    }
  }
}

export function createFileGlobTool(): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as FileGlobParams;

    if (!typedParams.pattern) {
      return {
        success: false,
        error: {
          code: 'MISSING_PATTERN',
          message: 'pattern parameter is required',
          recoverable: true,
        },
      };
    }

    const workspaceRoot = getWorkspaceRoot();
    const searchPath = typedParams.path ? resolve(workspaceRoot, typedParams.path) : workspaceRoot;
    
    const pathSafetyResult = validatePathSafety(searchPath, workspaceRoot);
    if (!pathSafetyResult.safe) {
      return {
        success: false,
        error: {
          code: pathSafetyResult.error?.code ?? 'PATH_UNSAFE',
          message: pathSafetyResult.error?.message ?? 'Path validation failed',
          recoverable: false,
        },
      };
    }

    if (!existsSync(searchPath)) {
      return {
        success: false,
        error: {
          code: 'PATH_NOT_FOUND',
          message: `Path not found: ${pathSafetyResult.relativePath}`,
          recoverable: true,
        },
      };
    }

    const stats = statSync(searchPath);
    if (!stats.isDirectory()) {
      return {
        success: false,
        error: {
          code: 'NOT_A_DIRECTORY',
          message: `Path is not a directory: ${pathSafetyResult.relativePath}`,
          recoverable: false,
        },
      };
    }

    const maxLimit = Math.min(typedParams.limit ?? 100, GLOB_RESULT_CAP);
    const results: FileEntry[] = [];
    
    const patternParts = typedParams.pattern.split('/');
    const basePattern = patternParts[patternParts.length - 1] || '*';
    
    collectFiles(searchPath, basePattern, workspaceRoot, results, maxLimit + 1);
    
    results.sort((a, b) => b.mtime - a.mtime);
    
    const truncated = results.length > maxLimit;
    const files = results.slice(0, maxLimit).map(r => r.path);
    
    const result: FileGlobResult = {
      files,
      total: results.length,
      truncated,
    };

    const resultJson = JSON.stringify(result);

    if (resultJson.length > LARGE_RESULT_THRESHOLD && context.stores?.toolExecutionStore) {
      context.stores.toolExecutionStore.saveResult(context.toolCallId, {
        preview: files.slice(0, 10).join('\n'),
        structuredContent: result as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      data: result,
      resultPreview: `Found ${files.length} file(s) matching pattern "${typedParams.pattern}"${truncated ? ' (truncated)' : ''}`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };

  return {
    name: 'file.glob',
    description: 'Find files matching a glob pattern within the workspace',
    category: 'search',
    sensitivity: 'low',
    schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Glob pattern to match files (e.g., "**/*.ts", "*.json")',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: workspace root)',
        },
        limit: {
          type: 'number',
          description: `Maximum number of results (default: 100, max: ${GLOB_RESULT_CAP})`,
        },
      },
      required: ['pattern'],
    },
    handler,
  };
}
