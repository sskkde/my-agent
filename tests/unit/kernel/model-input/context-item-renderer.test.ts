import { describe, it, expect } from 'vitest';
import { renderContextItem } from '../../../../src/kernel/model-input/context-item-renderer.js';
import type { ContextItemData } from '../../../../src/kernel/model-input/model-input-types.js';

describe('renderContextItem', () => {
  it('maps constraint → system', () => {
    const item: ContextItemData = {
      itemId: 'c1',
      content: 'You must follow this rule',
      semanticType: 'constraint',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'system', content: 'You must follow this rule' });
  });

  it('maps draft → assistant', () => {
    const item: ContextItemData = {
      itemId: 'd1',
      content: 'Draft response here',
      semanticType: 'draft',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'assistant', content: 'Draft response here' });
  });

  it('maps summary → assistant', () => {
    const item: ContextItemData = {
      itemId: 's1',
      content: 'Summary of previous turns',
      semanticType: 'summary',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'assistant', content: 'Summary of previous turns' });
  });

  it('maps plan_view → system', () => {
    const item: ContextItemData = {
      itemId: 'p1',
      content: 'Plan: Step 1 - Analyze',
      semanticType: 'plan_view',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'system', content: 'Plan: Step 1 - Analyze' });
  });

  it('maps workflow_step_view → system', () => {
    const item: ContextItemData = {
      itemId: 'w1',
      content: 'Workflow step: Execute task',
      semanticType: 'workflow_step_view',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'system', content: 'Workflow step: Execute task' });
  });

  it('maps background_run_view → system', () => {
    const item: ContextItemData = {
      itemId: 'b1',
      content: 'Background run: Processing',
      semanticType: 'background_run_view',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'system', content: 'Background run: Processing' });
  });

  it('maps trigger_event → user', () => {
    const item: ContextItemData = {
      itemId: 't1',
      content: 'Trigger: Webhook received',
      semanticType: 'trigger_event',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'user', content: 'Trigger: Webhook received' });
  });

  it('maps instruction → system', () => {
    const item: ContextItemData = {
      itemId: 'i1',
      content: 'You are a helpful assistant',
      semanticType: 'instruction',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'system', content: 'You are a helpful assistant' });
  });

  it('maps fact → user', () => {
    const item: ContextItemData = {
      itemId: 'f1',
      content: 'The sky is blue',
      semanticType: 'fact',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'user', content: 'The sky is blue' });
  });

  it('maps tool_output → tool', () => {
    const item: ContextItemData = {
      itemId: 'to1',
      content: '{"result": 42}',
      semanticType: 'tool_output',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'tool', content: '{"result": 42}' });
  });

  it('defaults to user for unknown semanticType', () => {
    const item: ContextItemData = {
      itemId: 'u1',
      content: 'Unknown type content',
      semanticType: 'something_else',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'user', content: 'Unknown type content' });
  });

  it('defaults to user when semanticType is undefined', () => {
    const item: ContextItemData = {
      itemId: 'u2',
      content: 'No type specified',
    };
    const msg = renderContextItem(item);
    expect(msg).toEqual({ role: 'user', content: 'No type specified' });
  });
});
