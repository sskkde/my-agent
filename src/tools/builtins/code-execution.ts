/**
 * Code Execution Tool
 * 
 * Execute code in JavaScript, TypeScript, or Bash with workspace-bound temp files and cleanup.
 * Does NOT provide a sandbox - uses controlled execution with timeout and output caps.
 */

import type { ToolDefinition, ToolHandler, ToolExecutionResult, ToolExecutionContext } from '../types.js';
import type { ProcessSessionStore } from './process-session-store.js';
import { DEFAULT_EXEC_TIMEOUT_MS, DEFAULT_EXEC_OUTPUT_CHARS } from './command-safety.js';
import { getWorkspaceRoot } from './safe-paths.js';
import { randomBytes } from 'crypto';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

export type CodeLanguage = 'javascript' | 'typescript' | 'bash';

export interface CodeExecutionParams {
  language: CodeLanguage;
  code: string;
  timeoutMs?: number;
  workdir?: string;
  maxOutputChars?: number;
}

export interface CodeExecutionResult {
  language: CodeLanguage;
  status: 'completed' | 'timeout' | 'failed' | 'unavailable';
  exitCode?: number | null;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  unavailableReason?: string;
}

export function createCodeExecutionTool(store: ProcessSessionStore): ToolDefinition {
  const handler: ToolHandler = async (
    params: unknown,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> => {
    const typedParams = params as CodeExecutionParams;
    const startTime = Date.now();
    const workspaceRoot = getWorkspaceRoot();

    if (!typedParams.language || !['javascript', 'typescript', 'bash'].includes(typedParams.language)) {
      return {
        success: false,
        error: {
          code: 'INVALID_LANGUAGE',
          message: 'language must be "javascript", "typescript", or "bash"',
          recoverable: true,
        },
      };
    }

    if (!typedParams.code || typedParams.code.trim().length === 0) {
      return {
        success: false,
        error: {
          code: 'EMPTY_CODE',
          message: 'code cannot be empty',
          recoverable: true,
        },
      };
    }

    const tmpDir = resolve(workspaceRoot, '.my-agent', 'tmp', 'code-execution');
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }

    const randomId = randomBytes(8).toString('hex');
    let tempFile: string;
    let command: string;

    switch (typedParams.language) {
      case 'javascript': {
        tempFile = join(tmpDir, `${randomId}.mjs`);
        writeFileSync(tempFile, typedParams.code, 'utf8');
        command = `node ${tempFile}`;
        break;
      }

      case 'typescript': {
        try {
          require.resolve('tsx');
        } catch {
          return {
            success: true,
            data: {
              language: 'typescript',
              status: 'unavailable',
              stdout: '',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
              durationMs: 0,
              unavailableReason: 'TYPESCRIPT_UNAVAILABLE',
            } as CodeExecutionResult,
            resultPreview: 'TypeScript execution unavailable (tsx not installed)',
          };
        }

        tempFile = join(tmpDir, `${randomId}.ts`);
        writeFileSync(tempFile, typedParams.code, 'utf8');
        command = `npx tsx ${tempFile}`;
        break;
      }

      case 'bash': {
        const bashAvailable = process.env.PATH?.split(':').some(dir => {
          try {
            return existsSync(join(dir, 'bash'));
          } catch {
            return false;
          }
        });

        if (!bashAvailable) {
          return {
            success: true,
            data: {
              language: 'bash',
              status: 'unavailable',
              stdout: '',
              stderr: '',
              stdoutTruncated: false,
              stderrTruncated: false,
              durationMs: 0,
              unavailableReason: 'BASH_UNAVAILABLE',
            } as CodeExecutionResult,
            resultPreview: 'Bash execution unavailable (bash not found in PATH)',
          };
        }

        tempFile = join(tmpDir, `${randomId}.sh`);
        writeFileSync(tempFile, typedParams.code, 'utf8');
        command = `bash ${tempFile}`;
        break;
      }
    }

    const workdir = typedParams.workdir ? resolve(workspaceRoot, typedParams.workdir) : workspaceRoot;
    const timeoutMs = typedParams.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS;
    const maxOutputChars = typedParams.maxOutputChars ?? DEFAULT_EXEC_OUTPUT_CHARS;

    const sessionId = store.start({
      userId: context.userId,
      command,
      workdir,
      env: {},
      timeoutMs,
      maxOutputChars,
    });

    const result = await new Promise<ToolExecutionResult>((resolve) => {
      const checkInterval = setInterval(() => {
        const session = store.get(context.userId, sessionId);
        if (!session) {
          clearInterval(checkInterval);
          resolve({
            success: false,
            error: {
              code: 'SESSION_NOT_FOUND',
              message: 'Process session disappeared',
              recoverable: false,
            },
          });
          return;
        }

        if (session.status !== 'running') {
          clearInterval(checkInterval);
          const durationMs = Date.now() - startTime;
          
          const execResult: CodeExecutionResult = {
            language: typedParams.language,
            status: session.status === 'timeout' ? 'timeout' : 
                   session.status === 'failed' ? 'failed' : 'completed',
            exitCode: session.exitCode,
            stdout: session.output,
            stderr: '',
            stdoutTruncated: session.outputTruncated,
            stderrTruncated: false,
            durationMs,
          };

          store.clear(context.userId, sessionId);
          try {
            if (existsSync(tempFile)) {
              rmSync(tempFile, { force: true });
            }
          } catch {
          }

          const preview = execResult.stdout.slice(0, 200);
          resolve({
            success: session.status === 'completed',
            data: execResult,
            resultPreview: `Execution ${execResult.status}: ${preview}`,
            structuredContent: execResult as unknown as Record<string, unknown>,
          });
        }
      }, 50);
    });

    return result;
  };

  return {
    name: 'code_execution',
    description: 'Execute code in JavaScript (always available), TypeScript (requires tsx), or Bash. Creates temp files in workspace, runs with timeout, and cleans up. NOT a sandbox - runs in the same environment as the agent.',
    category: 'execute',
    sensitivity: 'high',
    requiresPermission: true,
    idempotent: false,
    schema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['javascript', 'typescript', 'bash'],
          description: 'Programming language to execute',
        },
        code: {
          type: 'string',
          description: 'Code to execute',
        },
        timeoutMs: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000, max: 600000)',
        },
        workdir: {
          type: 'string',
          description: 'Working directory (must be within workspace, default: workspace root)',
        },
        maxOutputChars: {
          type: 'number',
          description: 'Maximum output characters per stream (default: 64000)',
        },
      },
      required: ['language', 'code'],
    },
    handler,
  };
}
