import type { SummaryStore, SourceRefs } from '../storage/summary-store.js';
import type { TranscriptStore } from '../storage/transcript-store.js';
import type {
  SummaryManager,
  WorkingSummaryRequest,
  WorkingSummary
} from './types.js';

export type { SummaryManager } from './types.js';

export function createSummaryManager(
  summaryStore: SummaryStore,
  _transcriptStore: TranscriptStore
): SummaryManager {
  return {
    generateWorkingSummary,
    validateSourceRefs
  };

  function generateWorkingSummary(request: WorkingSummaryRequest): WorkingSummary {
    if (!validateSourceRefs(request.sourceRefs)) {
      throw new Error(
        'sourceRefs must contain at least one of: transcriptRefs, eventRange, or previousSummaryRefs'
      );
    }

    const summary: WorkingSummary = {
      summaryId: request.summaryId,
      summaryType: 'working_summary',
      userId: request.userId,
      runId: request.runId,
      sessionId: request.sessionId,
      relatedRefs: request.relatedRefs,
      sourceRefs: request.sourceRefs,
      summary: generateSummaryText(request),
      structuredState: request.structuredState,
      status: 'active',
      retrieval: {
        keywords: extractKeywords(request),
        importance: 'medium'
      },
      createdAt: new Date().toISOString()
    };

    summaryStore.save({
      summaryId: summary.summaryId,
      summaryType: summary.summaryType,
      userId: summary.userId,
      sessionId: summary.sessionId,
      runId: summary.runId,
      relatedRefs: summary.relatedRefs,
      sourceRefs: summary.sourceRefs,
      summary: summary.summary,
      structuredState: summary.structuredState,
      status: summary.status,
      retrieval: summary.retrieval,
      createdAt: summary.createdAt
    });

    return summary;
  }

  function validateSourceRefs(sourceRefs: SourceRefs): boolean {
    if (!sourceRefs || typeof sourceRefs !== 'object') {
      return false;
    }

    const hasTranscriptRefs =
      Array.isArray(sourceRefs.transcriptRefs) &&
      sourceRefs.transcriptRefs.length > 0;

    const hasEventRange =
      sourceRefs.eventRange &&
      typeof sourceRefs.eventRange.startEventId === 'string' &&
      typeof sourceRefs.eventRange.endEventId === 'string';

    const hasPreviousSummaryRefs =
      Array.isArray(sourceRefs.previousSummaryRefs) &&
      sourceRefs.previousSummaryRefs.length > 0;

    return hasTranscriptRefs || hasEventRange || hasPreviousSummaryRefs;
  }

  function generateSummaryText(request: WorkingSummaryRequest): string {
    const parts: string[] = [];

    if (request.sourceRefs.transcriptRefs && request.sourceRefs.transcriptRefs.length > 0) {
      parts.push(`Based on ${request.sourceRefs.transcriptRefs.length} transcript references`);
    }

    if (request.sourceRefs.eventRange) {
      parts.push(
        `Covering events from ${request.sourceRefs.eventRange.startEventId} to ${request.sourceRefs.eventRange.endEventId}`
      );
    }

    if (request.sourceRefs.previousSummaryRefs && request.sourceRefs.previousSummaryRefs.length > 0) {
      parts.push(`Building on ${request.sourceRefs.previousSummaryRefs.length} previous summaries`);
    }

    if (request.structuredState) {
      const stateKeys = Object.keys(request.structuredState);
      if (stateKeys.length > 0) {
        parts.push(`State: ${stateKeys.join(', ')}`);
      }
    }

    parts.push(`Turn count: ${request.currentTurnCount}`);

    return parts.join('. ') + '.';
  }

  function extractKeywords(request: WorkingSummaryRequest): string[] {
    const keywords: string[] = [];

    if (request.sessionId) {
      keywords.push('session');
    }

    if (request.structuredState) {
      keywords.push(...Object.keys(request.structuredState));
    }

    if (request.sourceRefs.transcriptRefs) {
      keywords.push('transcript');
    }

    if (request.sourceRefs.previousSummaryRefs) {
      keywords.push('summary');
    }

    return [...new Set(keywords)];
  }
}
