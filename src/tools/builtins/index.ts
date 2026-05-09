import type { ToolRegistry } from '../types.js';
import type { ArtifactStore } from '../../storage/artifact-store.js';
import type { SummaryStore } from '../../storage/summary-store.js';
import type { TranscriptStore } from '../../storage/transcript-store.js';
import type { PlanStore } from '../../storage/plan-store.js';
import type { ToolResultStore } from '../../storage/tool-result-store.js';
import type { LongTermMemoryStore } from '../../storage/long-term-memory-store.js';
import type { SessionStore } from '../../storage/session-store.js';
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
import { createSessionListTool } from './session-list.js';
import { createSessionHistoryTool } from './session-history.js';
import { createWebFetchTool } from './web-fetch.js';
import { createWebSearchTool } from './web-search.js';
import { createMockConnectorTools } from './mock-connector-tools.js';

export interface BuiltInToolsConfig {
  artifactStore: ArtifactStore;
  summaryStore: SummaryStore;
  transcriptStore: TranscriptStore;
  planStore: PlanStore;
  longTermMemoryStore: LongTermMemoryStore;
  toolResultStore?: ToolResultStore;
  sessionStore: SessionStore;
}

export function registerBuiltInTools(
  registry: ToolRegistry,
  config: BuiltInToolsConfig
): void {
  const { artifactStore, summaryStore, transcriptStore, planStore, longTermMemoryStore, toolResultStore, sessionStore } = config;

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
  registry.register(createSessionListTool(sessionStore));
  registry.register(createSessionHistoryTool(sessionStore, transcriptStore));
  registry.register(createWebFetchTool());
  registry.register(createWebSearchTool());

  // Register mock connector tools
  const mockConnectorTools = createMockConnectorTools();
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
  createSessionListTool,
  createSessionHistoryTool,
  createWebFetchTool,
  createWebSearchTool,
  createMockConnectorTools,
};
