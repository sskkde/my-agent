import type { MemoryExtractionRunStore } from '../storage/memory-extraction-run-store.js';
import type { ExtractedMemoryCandidate, MemoryExtractionWindow } from './long-term-memory-extraction.js';

export type ShadowComparisonPayload = {
  windowHash: string;
  legacyAccepted: ExtractedMemoryCandidate[];
  newAccepted: ExtractedMemoryCandidate[];
  legacyDiscarded: string[];
  newDiscarded: string[];
  diff: 'same' | 'new_accepted_more' | 'legacy_accepted_more' | 'different';
};

export type ExtractionSideResult = {
  candidates: ExtractedMemoryCandidate[];
};

function classifyCandidates(candidates: ExtractedMemoryCandidate[]): {
  accepted: ExtractedMemoryCandidate[];
  discarded: string[];
} {
  const accepted: ExtractedMemoryCandidate[] = [];
  const discarded: string[] = [];

  for (const c of candidates) {
    if (c.discardReason) {
      discarded.push(c.discardReason);
    } else {
      accepted.push(c);
    }
  }

  return { accepted, discarded };
}

function computeDiff(
  legacyCount: number,
  newCount: number,
  legacyTexts: Set<string>,
  newTexts: Set<string>,
): ShadowComparisonPayload['diff'] {
  if (legacyCount === newCount && legacyTexts.size === newTexts.size) {
    const allMatch = [...legacyTexts].every(t => newTexts.has(t));
    if (allMatch) return 'same';
  }

  if (newCount > legacyCount) return 'new_accepted_more';
  if (legacyCount > newCount) return 'legacy_accepted_more';
  return 'different';
}

export function recordShadowExtraction(
  store: MemoryExtractionRunStore,
  window: MemoryExtractionWindow,
  legacyResult: ExtractionSideResult,
  newResult: ExtractionSideResult,
): void {
  const legacyClassified = classifyCandidates(legacyResult.candidates);
  const newClassified = classifyCandidates(newResult.candidates);

  const legacyTexts = new Set(legacyClassified.accepted.map(c => c.text.trim().toLowerCase()));
  const newTexts = new Set(newClassified.accepted.map(c => c.text.trim().toLowerCase()));

  const diff = computeDiff(
    legacyClassified.accepted.length,
    newClassified.accepted.length,
    legacyTexts,
    newTexts,
  );

  const payload: ShadowComparisonPayload = {
    windowHash: window.windowHash,
    legacyAccepted: legacyClassified.accepted,
    newAccepted: newClassified.accepted,
    legacyDiscarded: legacyClassified.discarded,
    newDiscarded: newClassified.discarded,
    diff,
  };

  const shadowWindowHash = `${window.windowHash}:shadow`;

  store.createPending({
    userId: window.userId,
    sessionId: window.sessionId,
    triggerTurnId: window.triggerTurnId,
    windowHash: shadowWindowHash,
    includedTurnIds: window.includedTurnIds,
    sessionMemorySummaryId: window.sessionMemorySummaryId || undefined,
    sourceRefs: {
      triggerTurnId: window.triggerTurnId,
      includedTurnIds: window.includedTurnIds,
      shadowOriginalWindowHash: window.windowHash,
    },
    policyVersion: 'semantic_policy',
    variant: 'shadow',
    shadowComparisonPayload: JSON.stringify(payload),
  });
}

export function isMemorySemanticPolicyEnabled(): boolean {
  return process.env.MEMORY_SEMANTIC_POLICY_ENABLED === 'true';
}