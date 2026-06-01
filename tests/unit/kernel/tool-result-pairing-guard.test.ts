import { describe, it, expect } from 'vitest';
import { validateToolResultPairing, ToolResultPairingGuard } from '../../../src/kernel/tool-result-pairing-guard.js';
import type { KernelTranscriptEntry, ToolUseRequest, ToolUseResult } from '../../../src/kernel/types.js';

function makeToolCallEntry(toolCallId: string, toolName: string, iteration = 1): KernelTranscriptEntry {
  return {
    iteration,
    timestamp: new Date().toISOString(),
    type: 'tool_call',
    content: {
      toolCallId,
      toolName,
      params: {},
    } as ToolUseRequest,
  };
}

function makeToolResultEntry(toolCallId: string, result: unknown, iteration = 1): KernelTranscriptEntry {
  return {
    iteration,
    timestamp: new Date().toISOString(),
    type: 'tool_result',
    content: {
      toolCallId,
      result,
    } as ToolUseResult,
  };
}

describe('validateToolResultPairing', () => {
  it('paired calls pass validation', () => {
    const transcript: KernelTranscriptEntry[] = [
      makeToolCallEntry('tc-1', 'file_read'),
      makeToolResultEntry('tc-1', { content: 'file contents' }),
      makeToolCallEntry('tc-2', 'web_search'),
      makeToolResultEntry('tc-2', { results: [] }),
      makeToolCallEntry('tc-3', 'memory_retrieve'),
      makeToolResultEntry('tc-3', { items: [] }),
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('missing result detected', () => {
    const transcript: KernelTranscriptEntry[] = [
      makeToolCallEntry('tc-1', 'file_read'),
      makeToolResultEntry('tc-1', { content: 'file contents' }),
      makeToolCallEntry('tc-2', 'web_search'),
      makeToolResultEntry('tc-2', { results: [] }),
      makeToolCallEntry('tc-3', 'memory_retrieve'),
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('missing_result');
    expect(result.warnings[0].toolCallId).toBe('tc-3');
  });

  it('orphan result detected', () => {
    const transcript: KernelTranscriptEntry[] = [
      makeToolCallEntry('tc-1', 'file_read'),
      makeToolResultEntry('tc-1', { content: 'file contents' }),
      makeToolResultEntry('tc-orphan', { data: 'orphan data' }),
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('orphan_result');
    expect(result.warnings[0].toolCallId).toBe('tc-orphan');
  });

  it('multiple tool calls all paired (EC-5)', () => {
    const transcript: KernelTranscriptEntry[] = [
      makeToolCallEntry('tc-1', 'file_read'),
      makeToolCallEntry('tc-2', 'web_search'),
      makeToolCallEntry('tc-3', 'memory_retrieve'),
      makeToolCallEntry('tc-4', 'docs_search'),
      makeToolCallEntry('tc-5', 'transcript_search'),
      makeToolResultEntry('tc-1', { content: 'file 1' }),
      makeToolResultEntry('tc-2', { results: ['result 2'] }),
      makeToolResultEntry('tc-3', { items: ['item 3'] }),
      makeToolResultEntry('tc-4', { docs: ['doc 4'] }),
      makeToolResultEntry('tc-5', { entries: ['entry 5'] }),
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('empty transcript passes validation', () => {
    const result = validateToolResultPairing([]);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('transcript with no tool entries passes validation', () => {
    const transcript: KernelTranscriptEntry[] = [
      { iteration: 1, timestamp: new Date().toISOString(), type: 'llm_request', content: {} },
      { iteration: 1, timestamp: new Date().toISOString(), type: 'llm_response', content: { content: 'Hello' } },
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('multiple missing results detected', () => {
    const transcript: KernelTranscriptEntry[] = [
      makeToolCallEntry('tc-1', 'file_read'),
      makeToolResultEntry('tc-1', { content: 'file' }),
      makeToolCallEntry('tc-2', 'web_search'),
      makeToolCallEntry('tc-3', 'memory_retrieve'),
      makeToolResultEntry('tc-3', { items: [] }),
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].toolCallId).toBe('tc-2');
  });

  it('multiple orphan results detected', () => {
    const transcript: KernelTranscriptEntry[] = [
      makeToolCallEntry('tc-1', 'file_read'),
      makeToolResultEntry('tc-1', { content: 'file' }),
      makeToolResultEntry('tc-orphan-1', { data: 1 }),
      makeToolResultEntry('tc-orphan-2', { data: 2 }),
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(2);
    const orphanIds = result.warnings.map(w => w.toolCallId);
    expect(orphanIds).toContain('tc-orphan-1');
    expect(orphanIds).toContain('tc-orphan-2');
  });

  it('mixed warnings: missing result and orphan result', () => {
    const transcript: KernelTranscriptEntry[] = [
      makeToolCallEntry('tc-1', 'file_read'),
      makeToolResultEntry('tc-1', { content: 'file' }),
      makeToolCallEntry('tc-missing', 'web_search'),
      makeToolResultEntry('tc-orphan', { data: 'orphan' }),
    ];

    const result = validateToolResultPairing(transcript);

    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(2);
    const types = result.warnings.map(w => w.type);
    expect(types).toContain('missing_result');
    expect(types).toContain('orphan_result');
  });
});

describe('ToolResultPairingGuard', () => {
  it('track then accept produces valid state', () => {
    const guard = new ToolResultPairingGuard();
    guard.trackAssistantToolCalls([
      { toolCallId: 'tc-1', toolName: 'file_read', params: {} },
    ]);
    guard.acceptToolResult({ toolCallId: 'tc-1', result: { content: 'file' } });

    expect(guard.hasPendingCalls()).toBe(false);
    expect(guard.validate().valid).toBe(true);
  });

  it('track with no accept produces missing result on flush', () => {
    const guard = new ToolResultPairingGuard();
    guard.trackAssistantToolCalls([
      { toolCallId: 'tc-1', toolName: 'web_search', params: { query: 'hello' } },
    ]);

    expect(guard.hasPendingCalls()).toBe(true);
    expect(guard.getPendingCallIds()).toEqual(['tc-1']);

    const missing = guard.flushMissingResults('timeout');
    expect(missing).toHaveLength(1);
    expect(missing[0].toolCallId).toBe('tc-1');
    expect(missing[0].result).toBeNull();
    expect(missing[0].error?.code).toBe('MISSING_TOOL_RESULT');
    expect(missing[0].error?.recoverable).toBe(true);
  });

  it('flush clears pending calls', () => {
    const guard = new ToolResultPairingGuard();
    guard.trackAssistantToolCalls([
      { toolCallId: 'tc-1', toolName: 'file_read', params: {} },
      { toolCallId: 'tc-2', toolName: 'web_search', params: {} },
    ]);

    guard.flushMissingResults();
    expect(guard.hasPendingCalls()).toBe(false);
    expect(guard.getPendingCallIds()).toEqual([]);
  });

  it('partial accept then flush generates synthetic for remaining', () => {
    const guard = new ToolResultPairingGuard();
    guard.trackAssistantToolCalls([
      { toolCallId: 'tc-1', toolName: 'file_read', params: {} },
      { toolCallId: 'tc-2', toolName: 'web_search', params: {} },
      { toolCallId: 'tc-3', toolName: 'memory_retrieve', params: {} },
    ]);

    guard.acceptToolResult({ toolCallId: 'tc-1', result: 'file content' });
    guard.acceptToolResult({ toolCallId: 'tc-3', result: { items: [] } });

    expect(guard.hasPendingCalls()).toBe(true);

    const missing = guard.flushMissingResults();
    expect(missing).toHaveLength(1);
    expect(missing[0].toolCallId).toBe('tc-2');
  });

  it('validate returns warnings for pending calls', () => {
    const guard = new ToolResultPairingGuard();
    guard.trackAssistantToolCalls([
      { toolCallId: 'tc-1', toolName: 'file_read', params: {} },
    ]);

    const result = guard.validate();
    expect(result.valid).toBe(false);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].type).toBe('missing_result');
    expect(result.warnings[0].toolCallId).toBe('tc-1');
  });

  it('empty guard is valid', () => {
    const guard = new ToolResultPairingGuard();
    expect(guard.hasPendingCalls()).toBe(false);
    expect(guard.validate().valid).toBe(true);
    expect(guard.flushMissingResults()).toEqual([]);
  });
});
