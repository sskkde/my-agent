#!/usr/bin/env node
/**
 * Token Baseline Measurement Script
 *
 * Measures estimated token counts for 3 LLM paths:
 * - routing_json (Foreground routing)
 * - structured_json (Memory extraction)
 * - function_calling (Kernel/Search function calling)
 *
 * Output: .sisyphus/evidence/pm-1-token-baseline.json
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { PromptTemplateRegistry } from '../src/prompt/prompt-template-registry.js';
import { TemplateLoader } from '../src/prompt/template-loader.js';
import { ModelInputBuilder } from '../src/kernel/model-input/model-input-builder.js';
import type { ModelInputBuildInput, ToolPlaneProjection } from '../src/kernel/model-input/model-input-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Token estimation: ~4 characters per token for English text
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Create builder with real templates
function createBuilder(): ModelInputBuilder {
  const templatesPath = join(__dirname, '../src/prompt/templates');
  const registry = new PromptTemplateRegistry(undefined, templatesPath);
  const loader = new TemplateLoader(templatesPath);
  return new ModelInputBuilder({ templateRegistry: registry, templateLoader: loader });
}

// Typical tool projection for routing_json (Foreground)
function makeRoutingToolProjection(): ToolPlaneProjection {
  return {
    toolIds: [
      'artifact_create',
      'artifact_update',
      'ask_user',
      'status_query',
      'memory_retrieve',
      'transcript_search',
      'plan_patch',
      'docs_search',
      'file_read',
      'file_glob',
      'file_grep',
      'session_list',
      'session_history',
      'web_fetch',
      'web_search',
    ],
    toolSummaries: `
Tool Summaries:
- artifact_create: Create a new artifact (file, document, etc.)
- artifact_update: Update an existing artifact
- ask_user: Ask the user for clarification or input
- status_query: Query status of running tasks
- memory_retrieve: Retrieve relevant memories
- transcript_search: Search conversation transcript
- plan_patch: Modify the execution plan
- docs_search: Search documentation
- file_read: Read file contents
- file_glob: Find files by pattern
- file_grep: Search file contents
- session_list: List available sessions
- session_history: Get session history
- web_fetch: Fetch web content
- web_search: Search the web
`.trim(),
  };
}

// Typical tool projection for function_calling (Kernel/Search)
function makeFunctionCallingToolProjection(): ToolPlaneProjection {
  return {
    toolIds: ['file_read', 'file_glob', 'file_grep', 'web_search', 'web_fetch'],
    tools: [
      {
        type: 'function',
        function: {
          name: 'file_read',
          description: 'Read the contents of a file from the filesystem',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Absolute path to the file' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_glob',
          description: 'Find files matching a glob pattern',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Glob pattern to match' },
              path: { type: 'string', description: 'Directory to search in' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_grep',
          description: 'Search for a pattern in file contents',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: 'Regex pattern to search for' },
              path: { type: 'string', description: 'Directory to search in' },
              include: { type: 'string', description: 'File pattern to include' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_search',
          description: 'Search the web for information',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'web_fetch',
          description: 'Fetch content from a URL',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: 'URL to fetch' },
            },
            required: ['url'],
          },
        },
      },
    ],
  };
}

// Typical tool projection for structured_json (Memory)
function makeStructuredJsonToolProjection(): ToolPlaneProjection {
  return {
    toolIds: ['memory_retrieve'],
  };
}

// Build input for routing_json mode (Foreground)
function makeRoutingJsonInput(): ModelInputBuildInput {
  return {
    mode: 'routing_json',
    agentKind: 'foreground',
    providerFamily: 'openai',
    systemPrompt: 'You are a helpful AI assistant specialized in software development tasks. You have access to various tools for reading files, searching the web, and managing artifacts.',
    routingPrompt: 'Route user messages based on their intent. Use dispatch_tool for simple operations, spawn_planner for complex multi-step tasks, and answer_directly for simple questions.',
    toolProjection: makeRoutingToolProjection(),
    currentUserMessage: 'I need to refactor the authentication module to use OAuth2 instead of the current custom implementation. Can you help me plan this?',
    currentDate: '2026-05-24T10:30:00Z',
    sessionId: 'session_abc123def456',
    runId: 'run_xyz789',
    messageId: 'msg_001',
    requestId: 'req_002',
    contextBundle: {
      pinnedItems: [
        { itemId: 'p1', content: 'Project uses TypeScript with ESM modules', isPinned: true },
        { itemId: 'p2', content: 'Database: SQLite with WAL mode', isPinned: true },
      ],
      orderedItems: [
        { itemId: 'o1', content: 'Current auth: custom JWT implementation in src/auth/' },
        { itemId: 'o2', content: 'Target: OAuth2 with provider abstraction' },
      ],
    },
  };
}

// Build input for structured_json mode (Memory)
function makeStructuredJsonInput(): ModelInputBuildInput {
  return {
    mode: 'structured_json',
    agentKind: 'memory',
    providerFamily: 'openai',
    toolProjection: makeStructuredJsonToolProjection(),
    currentUserMessage: 'Remember that the user prefers TypeScript over JavaScript for all new code.',
    currentDate: '2026-05-24T10:30:00Z',
    sessionId: 'session_abc123def456',
  };
}

// Build input for function_calling mode (Kernel)
function makeFunctionCallingInput(): ModelInputBuildInput {
  return {
    mode: 'function_calling',
    agentKind: 'kernel',
    providerFamily: 'openai',
    systemPrompt: 'You are a kernel agent executing tasks with tool access. Complete the requested operation efficiently.',
    toolProjection: makeFunctionCallingToolProjection(),
    currentUserMessage: 'Find all TypeScript files that import from the auth module and list them.',
    currentDate: '2026-05-24T10:30:00Z',
    sessionId: 'session_abc123def456',
    runId: 'run_xyz789',
    messageId: 'msg_003',
    contextBundle: {
      planView: 'Plan: Step 1 - Search for auth imports\nStep 2 - List matching files\nStep 3 - Report results',
    },
    transcript: [
      { role: 'user', content: 'I need to find all files that use the auth module' },
      { role: 'assistant', content: 'I will search for files importing from the auth module using the file tools.' },
    ],
  };
}

interface TokenReport {
  mode: string;
  segmentA: number;
  segmentB: number;
  segmentC: number;
  segmentD: number;
  total: number;
  unit: string;
}

async function measureMode(
  builder: ModelInputBuilder,
  input: ModelInputBuildInput
): Promise<TokenReport> {
  const result = await builder.build(input);

  const segmentA = estimateTokens(result.segments.staticPrefix);
  const segmentB = estimateTokens(result.segments.tenantProject);
  const segmentC = estimateTokens(result.segments.toolPlane);
  const segmentD = estimateTokens(result.segments.contextBundle);

  return {
    mode: input.mode,
    segmentA,
    segmentB,
    segmentC,
    segmentD,
    total: segmentA + segmentB + segmentC + segmentD,
    unit: 'est_tokens',
  };
}

async function main() {
  console.log('Token Baseline Measurement');
  console.log('===========================\n');

  const builder = createBuilder();
  const reports: TokenReport[] = [];

  // Measure routing_json (Foreground)
  console.log('Measuring routing_json (Foreground routing)...');
  const routingReport = await measureMode(builder, makeRoutingJsonInput());
  reports.push(routingReport);
  console.log(`  Segment A: ${routingReport.segmentA} tokens`);
  console.log(`  Segment B: ${routingReport.segmentB} tokens`);
  console.log(`  Segment C: ${routingReport.segmentC} tokens`);
  console.log(`  Segment D: ${routingReport.segmentD} tokens`);
  console.log(`  Total: ${routingReport.total} tokens\n`);

  // Measure structured_json (Memory)
  console.log('Measuring structured_json (Memory extraction)...');
  const structuredReport = await measureMode(builder, makeStructuredJsonInput());
  reports.push(structuredReport);
  console.log(`  Segment A: ${structuredReport.segmentA} tokens`);
  console.log(`  Segment B: ${structuredReport.segmentB} tokens`);
  console.log(`  Segment C: ${structuredReport.segmentC} tokens`);
  console.log(`  Segment D: ${structuredReport.segmentD} tokens`);
  console.log(`  Total: ${structuredReport.total} tokens\n`);

  // Measure function_calling (Kernel/Search)
  console.log('Measuring function_calling (Kernel/Search function calling)...');
  const functionCallingReport = await measureMode(builder, makeFunctionCallingInput());
  reports.push(functionCallingReport);
  console.log(`  Segment A: ${functionCallingReport.segmentA} tokens`);
  console.log(`  Segment B: ${functionCallingReport.segmentB} tokens`);
  console.log(`  Segment C: ${functionCallingReport.segmentC} tokens`);
  console.log(`  Segment D: ${functionCallingReport.segmentD} tokens`);
  console.log(`  Total: ${functionCallingReport.total} tokens\n`);

  // Write report
  const evidencePath = join(__dirname, '../.sisyphus/evidence');
  mkdirSync(evidencePath, { recursive: true });

  const reportPath = join(evidencePath, 'pm-1-token-baseline.json');
  writeFileSync(reportPath, JSON.stringify(reports, null, 2));

  console.log(`Report written to: ${reportPath}`);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
