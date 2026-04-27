import type { ToolRegistry } from '../types.js';
import type { ArtifactStore } from '../../storage/artifact-store.js';
import type { SummaryStore } from '../../storage/summary-store.js';
import type { TranscriptStore } from '../../storage/transcript-store.js';
import type { PlanStore } from '../../storage/plan-store.js';
import type { ToolResultStore } from '../../storage/tool-result-store.js';
import { createArtifactCreateTool } from './artifact-create.js';
import { createArtifactUpdateTool } from './artifact-update.js';
import { createAskUserTool } from './ask-user.js';
import { createStatusQueryTool } from './status-query.js';
import { createMemoryRetrieveTool } from './memory-retrieve.js';
import { createTranscriptSearchTool } from './transcript-search.js';
import { createPlanPatchTool } from './plan-patch.js';
import { createDocsSearchTool } from './docs-search.js';

export interface BuiltInToolsConfig {
  artifactStore: ArtifactStore;
  summaryStore: SummaryStore;
  transcriptStore: TranscriptStore;
  planStore: PlanStore;
  toolResultStore?: ToolResultStore;
}

export function registerBuiltInTools(
  registry: ToolRegistry,
  config: BuiltInToolsConfig
): void {
  const { artifactStore, summaryStore, transcriptStore, planStore, toolResultStore } = config;

  registry.register(createArtifactCreateTool(artifactStore));
  registry.register(createArtifactUpdateTool(artifactStore));
  registry.register(createAskUserTool());
  registry.register(createStatusQueryTool());
  registry.register(createMemoryRetrieveTool(summaryStore, toolResultStore));
  registry.register(createTranscriptSearchTool(transcriptStore, toolResultStore));
  registry.register(createPlanPatchTool(planStore));
  registry.register(createDocsSearchTool(toolResultStore));
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
};
