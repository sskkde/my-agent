import type { ToolRegistry } from '../types.js';
import type { ArtifactStore } from '../../storage/artifact-store.js';
import type { SummaryStore } from '../../storage/summary-store.js';
import type { TranscriptStore } from '../../storage/transcript-store.js';
import type { PlanStore } from '../../storage/plan-store.js';
import type { ToolResultStore } from '../../storage/tool-result-store.js';
import type { LongTermMemoryStore } from '../../storage/long-term-memory-store.js';
import type { SessionStore } from '../../storage/session-store.js';
import type { ProcessSessionStore } from './process-session-store.js';
import { createArtifactCreateTool } from './artifact-create.js';
import { createArtifactUpdateTool } from './artifact-update.js';
import { createAskUserTool } from './ask-user.js';
import { createStatusQueryTool } from './status-query.js';
import { createMemoryRetrieveTool } from './memory-retrieve.js';
import { createTranscriptSearchTool } from './transcript-search.js';
import { createPlanPatchTool } from './plan-patch.js';
import { createDocsSearchTool } from './docs-search.js';
import { createFileReadTool } from './file-read.js';
import { createFileGlobTool } from './file-glob.js';
import { createFileGrepTool } from './file-grep.js';
import { createFileWriteTool } from './file-write.js';
import { createFileEditTool } from './file-edit.js';
import { createFileApplyPatchTool } from './file-apply-patch.js';
import { createSessionListTool } from './session-list.js';
import { createSessionHistoryTool } from './session-history.js';
import { createWebFetchTool } from './web-fetch.js';
import { createWebSearchTool } from './web-search.js';
import { createMockConnectorTools } from './mock-connector-tools.js';
import { createExecTool, createBashTool } from './exec-tool.js';
import { createProcessTool } from './process-tool.js';
import { createCodeExecutionTool } from './code-execution.js';

export interface BuiltInToolsConfig {
  artifactStore: ArtifactStore;
  summaryStore: SummaryStore;
  transcriptStore: TranscriptStore;
  planStore: PlanStore;
  longTermMemoryStore: LongTermMemoryStore;
  toolResultStore?: ToolResultStore;
  sessionStore: SessionStore;
  processSessionStore?: ProcessSessionStore;
  enableRuntimeTools?: boolean; // default: true
}

export function registerBuiltInTools(
  registry: ToolRegistry,
  config: BuiltInToolsConfig
): void {
  const { artifactStore, summaryStore, transcriptStore, planStore, longTermMemoryStore, toolResultStore, sessionStore, processSessionStore, enableRuntimeTools = true } = config;

  registry.register(createArtifactCreateTool(artifactStore));
  registry.register(createArtifactUpdateTool(artifactStore));
  registry.register(createAskUserTool());
  registry.register(createStatusQueryTool());
  registry.register(createMemoryRetrieveTool(summaryStore, longTermMemoryStore, toolResultStore));
  registry.register(createTranscriptSearchTool(transcriptStore, toolResultStore));
  registry.register(createPlanPatchTool(planStore));
  registry.register(createDocsSearchTool(toolResultStore));
  registry.register(createFileReadTool());
  registry.register(createFileGlobTool());
  registry.register(createFileGrepTool());
  registry.register(createFileWriteTool());
  registry.register(createFileEditTool());
  registry.register(createFileApplyPatchTool());
  registry.register(createSessionListTool(sessionStore));
  registry.register(createSessionHistoryTool(sessionStore, transcriptStore));
  registry.register(createWebFetchTool());
  registry.register(createWebSearchTool());

  // Register runtime tools if enabled
  if (enableRuntimeTools && processSessionStore) {
    registry.register(createExecTool(processSessionStore));
    registry.register(createBashTool(processSessionStore));
    registry.register(createProcessTool(processSessionStore));
    registry.register(createCodeExecutionTool(processSessionStore));
  }

  const mockConnectorTools = createMockConnectorTools().map(tool => ({
    ...tool,
    metadata: {
      ...tool.metadata,
      mock: true,
      executionPlane: 'mock_connector',
      availability: 'mock',
    },
  }));
  mockConnectorTools.forEach(tool => registry.register(tool));
}

export {
  createArtifactCreateTool,
  createArtifactUpdateTool,
  createAskUserTool,
  createStatusQueryTool,
  createMemoryRetrieveTool,
  createTranscriptSearchTool,
  createPlanPatchTool,
  createDocsSearchTool,
  createFileReadTool,
  createFileGlobTool,
  createFileGrepTool,
  createFileWriteTool,
  createFileEditTool,
  createFileApplyPatchTool,
  createSessionListTool,
  createSessionHistoryTool,
  createWebFetchTool,
  createWebSearchTool,
  createMockConnectorTools,
  createExecTool,
  createBashTool,
  createProcessTool,
  createCodeExecutionTool,
};
