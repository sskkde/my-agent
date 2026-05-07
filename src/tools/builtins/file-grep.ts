import type { ToolDefinition, ToolHandler, ToolExecutionResult } from '../types.js';
import type { ToolExecutionContext } from '../types.js';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { resolve, join, extname } from 'path';
import {
  validatePathSafety,
  getWorkspaceRoot,
  GREP_HEAD_LIMIT,
  LARGE_RESULT_THRESHOLD,
  MAX_FILE_READ_BYTES,
  isBinaryByContent,
  BINARY_EXTENSIONS,
} from './safe-paths.js';

export interface FileGrepParams {
  pattern: string;
  path?: string;
  include?: string;
  outputMode?: 'files_with_matches' | 'content' | 'count';
  headLimit?: number;
}

export interface GrepFileMatch {
  file: string;
  matches: number;
}

export interface GrepContentMatch {
  file: string;
  line: number;
  content: string;
}

export interface GrepCountMatch {
  file: string;
  count: number;
}

export type FileGrepResult = 
  | { matches: GrepFileMatch[]; total: number; truncated: boolean; outputMode: 'files_with_matches' }
  | { files: GrepContentMatch[]; total: number; truncated: boolean; outputMode: 'content' }
  | { counts: GrepCountMatch[]; total: number; truncated: boolean; outputMode: 'count' };

function shouldIncludeFile(filename: string, includePattern?: string): boolean {
  if (!includePattern) return true;
  
  const ext = extname(filename);
  if (includePattern.startsWith('*.')) {
    return ext === includePattern.slice(1) || ext === includePattern.slice(2);
  }
  return filename.includes(includePattern);
}

function isBinaryFile(path: string): boolean {
  const ext = extname(path).toLowerCase();
  return BINARY_EXTENSIONS.includes(ext);
}

function searchInFile(
  filePath: string,
  pattern: RegExp,
  outputMode: 'files_with_matches' | 'content' | 'count',
  maxMatches: number,
  currentCount: number
): { result: GrepFileMatch | GrepContentMatch[] | GrepCountMatch | null; count: number } {
  if (currentCount >= maxMatches) {
    return { result: null, count: currentCount };
  }

  if (isBinaryFile(filePath)) {
    return { result: null, count: currentCount };
  }

  let buffer: Buffer;
  try {
    const stats = statSync(filePath);
    if (stats.size > MAX_FILE_READ_BYTES) {
      return { result: null, count: currentCount };
    }
    buffer = readFileSync(filePath);
  } catch {
    return { result: null, count: currentCount };
  }

  if (isBinaryByContent(buffer)) {
    return { result: null, count: currentCount };
  }

  const text = buffer.toString('utf-8');
  const lines = text.split('\n');
  
  if (outputMode === 'files_with_matches') {
    for (const line of lines) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        return { result: { file: filePath, matches: 1 }, count: currentCount + 1 };
      }
    }
    return { result: null, count: currentCount };
  }
  
  if (outputMode === 'count') {
    let count = 0;
    const globalPattern = new RegExp(pattern.source, 'g');
    for (const line of lines) {
      const matches = line.match(globalPattern);
      if (matches) {
        count += matches.length;
      }
    }
    if (count > 0) {
      return { result: { file: filePath, count }, count: currentCount + 1 };
    }
    return { result: null, count: currentCount };
  }
  
  const contentMatches: GrepContentMatch[] = [];
  for (let i = 0; i < lines.length && currentCount + contentMatches.length < maxMatches; i++) {
    pattern.lastIndex = 0;
    if (pattern.test(lines[i]!)) {
      contentMatches.push({
        file: filePath,
        line: i + 1,
        content: lines[i]!.trim(),
      });
    }
  }
  
  return { result: contentMatches.length > 0 ? contentMatches : null, count: currentCount + contentMatches.length };
}

function collectFilesForGrep(
  dir: string,
  workspaceRoot: string,
  includePattern: string | undefined,
  results: string[]
): void {
  let entries: import('fs').Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('fs').Dirent[];
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name as string);
    
    const safetyResult = validatePathSafety(fullPath, workspaceRoot);
    if (!safetyResult.safe) continue;
    
    if (entry.isDirectory()) {
      collectFilesForGrep(fullPath, workspaceRoot, includePattern, results);
    } else if (entry.isFile()) {
      if (shouldIncludeFile(entry.name as string, includePattern)) {
        results.push(safetyResult.relativePath!);
      }
    }
  }
}

export function createFileGrepTool(): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as FileGrepParams;

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

    let searchPattern: RegExp;
    try {
      searchPattern = new RegExp(typedParams.pattern);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid regex pattern';
      return {
        success: false,
        error: {
          code: 'INVALID_PATTERN',
          message: `Invalid regex pattern: ${message}`,
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

    const outputMode = typedParams.outputMode ?? 'files_with_matches';
    const maxLimit = Math.min(typedParams.headLimit ?? 250, GREP_HEAD_LIMIT);
    
    const filesToSearch: string[] = [];
    collectFilesForGrep(searchPath, workspaceRoot, typedParams.include, filesToSearch);
    
    let totalResults = 0;
    
    if (outputMode === 'files_with_matches') {
      const matches: GrepFileMatch[] = [];
      
      for (const file of filesToSearch) {
        if (totalResults >= maxLimit) break;
        
        const fullPath = resolve(workspaceRoot, file);
        const { result, count } = searchInFile(fullPath, searchPattern, outputMode, maxLimit, totalResults);
        
        if (result) {
          matches.push(result as GrepFileMatch);
          totalResults = count;
        }
      }
      
      const result: FileGrepResult = {
        matches,
        total: matches.length,
        truncated: totalResults >= maxLimit,
        outputMode: 'files_with_matches',
      };
      
      return {
        success: true,
        data: result,
        resultPreview: `Found ${matches.length} file(s) containing pattern "${typedParams.pattern}"${result.truncated ? ' (truncated)' : ''}`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    
    if (outputMode === 'count') {
      const counts: GrepCountMatch[] = [];
      
      for (const file of filesToSearch) {
        if (totalResults >= maxLimit) break;
        
        const fullPath = resolve(workspaceRoot, file);
        const { result, count } = searchInFile(fullPath, searchPattern, outputMode, maxLimit, totalResults);
        
        if (result) {
          counts.push(result as GrepCountMatch);
          totalResults = count;
        }
      }
      
      const result: FileGrepResult = {
        counts,
        total: counts.length,
        truncated: totalResults >= maxLimit,
        outputMode: 'count',
      };
      
      return {
        success: true,
        data: result,
        resultPreview: `Counted matches in ${counts.length} file(s) for pattern "${typedParams.pattern}"${result.truncated ? ' (truncated)' : ''}`,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    }
    
    const files: GrepContentMatch[] = [];
    
    for (const file of filesToSearch) {
      if (totalResults >= maxLimit) break;
      
      const fullPath = resolve(workspaceRoot, file);
      const { result, count } = searchInFile(fullPath, searchPattern, outputMode, maxLimit, totalResults);
      
      if (result) {
        files.push(...(result as GrepContentMatch[]));
        totalResults = count;
      }
    }
    
    const result: FileGrepResult = {
      files,
      total: files.length,
      truncated: totalResults >= maxLimit,
      outputMode: 'content',
    };
    
    const resultJson = JSON.stringify(result);

    if (resultJson.length > LARGE_RESULT_THRESHOLD && context.stores?.toolExecutionStore) {
      context.stores.toolExecutionStore.saveResult(context.toolCallId, {
        preview: files.slice(0, 10).map(f => `${f.file}:${f.line}`).join('\n'),
        structuredContent: result as unknown as Record<string, unknown>,
      });
    }

    return {
      success: true,
      data: result,
      resultPreview: `Found ${files.length} match(es) for pattern "${typedParams.pattern}"${result.truncated ? ' (truncated)' : ''}`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  };

  return {
    name: 'file.grep',
    description: 'Search for pattern matches in files within the workspace',
    category: 'search',
    sensitivity: 'medium',
    schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regex pattern to search for in file contents',
        },
        path: {
          type: 'string',
          description: 'Directory to search in (default: workspace root)',
        },
        include: {
          type: 'string',
          description: 'File pattern to include (e.g., "*.ts", "*.json")',
        },
        outputMode: {
          type: 'string',
          enum: ['files_with_matches', 'content', 'count'],
          description: 'Output format: files_with_matches (default), content, or count',
        },
        headLimit: {
          type: 'number',
          description: `Maximum number of results (default: 250, max: ${GREP_HEAD_LIMIT})`,
        },
      },
      required: ['pattern'],
    },
    handler,
  };
}
