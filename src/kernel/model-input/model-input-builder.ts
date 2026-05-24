/**
 * Model Input Builder - Core builder that assembles LLM messages from 7 layers.
 *
 * Build order: Layer 1 → 2 → 3 → 4 → 5 → 6 → 7
 *
 * Segment mapping:
 * - Segment A (staticPrefix): Layer 1-4
 * - Segment B (tenantProject): Layer 5
 * - Segment C (toolPlane): Layer 6
 * - Segment D (contextBundle): Layer 7
 *
 * Modes:
 * - routing_json: ForegroundAgent (no tools in request, tool summaries only)
 * - structured_json: MemoryExtractor (no tools, JSON response format)
 * - function_calling: AgentKernel/SearchSubagent (tools in request)
 *
 * @module kernel/model-input/model-input-builder
 */

import type { LLMMessage, ToolDefinition as LLMToolDefinition } from '../../llm/types.js';
import type {
  ModelInputBuildInput,
  BuiltModelInput,
  ToolPlaneProjection,
  ContextItemData,
} from './model-input-types.js';
import { renderPersonaProjection, renderToolSelectionPolicy, renderMemoryPolicyProjection, renderSummaryLayers } from './model-input-types.js';
import { computeTemplateHash } from '../../prompt/template-hash.js';
import { StaticPrefixBuilder } from './static-prefix-builder.js';
import type { PromptTemplateRegistry } from '../../prompt/prompt-template-registry.js';
import type { TemplateLoader } from '../../prompt/template-loader.js';

export interface ModelInputBuilderDeps {
  templateRegistry: PromptTemplateRegistry;
  templateLoader: TemplateLoader;
}

export class ModelInputBuilder {
  private readonly staticPrefixBuilder: StaticPrefixBuilder;

  constructor(deps: ModelInputBuilderDeps) {
    this.staticPrefixBuilder = new StaticPrefixBuilder(deps.templateRegistry, deps.templateLoader);
  }

  async build(input: ModelInputBuildInput): Promise<BuiltModelInput> {
    const segmentA = await this.buildSegmentA(input.agentKind, input.providerFamily);
    const segmentB = this.buildSegmentB(input);
    const segmentC = this.buildSegmentC(input);
    const segmentD = this.buildSegmentD(input);

    const messages = this.assembleMessages(segmentA, segmentB, segmentC, segmentD);

    return {
      messages,
      segments: {
        staticPrefix: segmentA.content,
        tenantProject: segmentB.content,
        toolPlane: segmentC.content,
        contextBundle: segmentD.content,
      },
      segmentHashes: {
        segmentA: segmentA.hash,
        segmentB: segmentB.hash,
        segmentC: segmentC.hash,
        segmentD: segmentD.hash,
      },
      metadata: {
        mode: input.mode,
        agentKind: input.agentKind,
        providerFamily: input.providerFamily,
        messageCount: messages.length,
      },
    };
  }

  private async buildSegmentA(agentKind: string, providerFamily: string) {
    return this.staticPrefixBuilder.buildStaticPrefix(agentKind, providerFamily);
  }

  private buildSegmentB(input: ModelInputBuildInput) {
    const parts: string[] = [];

    if (input.systemPrompt) {
      parts.push(input.systemPrompt);
    }

    if (input.routingPrompt) {
      parts.push(input.routingPrompt);
    }

    if (input.personaProjection) {
      parts.push(renderPersonaProjection(input.personaProjection));
    }

    const content = parts.join('\n\n');
    const hash = computeTemplateHash(content);

    return { content, hash };
  }

  private buildSegmentC(input: ModelInputBuildInput) {
    const projection = input.toolProjection;
    const mode = input.mode;
    const policy = input.toolSelectionPolicy;

    const parts: string[] = [];

    if (projection) {
      if (mode === 'routing_json') {
        parts.push(this.renderRoutingToolPlane(projection));
      } else if (mode === 'function_calling') {
        parts.push(this.renderFunctionCallingToolPlane(projection));
      } else {
        parts.push(this.renderStructuredJsonToolPlane(projection));
      }
    }

    if (policy) {
      parts.push(renderToolSelectionPolicy(policy));
    }

    const content = parts.join('\n\n');
    const hash = computeTemplateHash(content);

    return { content, hash };
  }

  private buildSegmentD(input: ModelInputBuildInput) {
    const parts: string[] = [];

    if (input.memoryPolicyProjection) {
      parts.push(renderMemoryPolicyProjection(input.memoryPolicyProjection));
    }

    const bundle = input.contextBundle;
    if (bundle?.summaryLayers) {
      const rendered = renderSummaryLayers(bundle.summaryLayers);
      if (rendered) {
        parts.push(rendered);
      }
    }

    if (input.currentDate) {
      parts.push(`Current Date: ${input.currentDate}`);
    }

    if (input.sessionId) {
      parts.push(`Session ID: ${input.sessionId}`);
    }

    if (input.runId) {
      parts.push(`Run ID: ${input.runId}`);
    }

    if (input.messageId) {
      parts.push(`Message ID: ${input.messageId}`);
    }

    if (input.requestId) {
      parts.push(`Request ID: ${input.requestId}`);
    }

    if (bundle) {
      if (bundle.pinnedItems && bundle.pinnedItems.length > 0) {
        parts.push(this.renderContextItems('Pinned Context', bundle.pinnedItems));
      }

      if (bundle.orderedItems && bundle.orderedItems.length > 0) {
        parts.push(this.renderContextItems('Context', bundle.orderedItems));
      }

      if (bundle.summaryBlocks && bundle.summaryBlocks.length > 0) {
        parts.push(this.renderContextItems('Summary', bundle.summaryBlocks));
      }

      if (bundle.planView) {
        parts.push(bundle.planView);
      }

      if (bundle.workflowStepView) {
        parts.push(bundle.workflowStepView);
      }

      if (bundle.backgroundRunView) {
        parts.push(bundle.backgroundRunView);
      }

      if (bundle.triggerView) {
        parts.push(bundle.triggerView);
      }

      if (bundle.transcript && bundle.transcript.length > 0) {
        parts.push(this.renderTranscript(bundle.transcript));
      }
    }

    if (input.currentUserMessage) {
      parts.push(`User Message: ${input.currentUserMessage}`);
    }

    if (input.transcript && input.transcript.length > 0) {
      parts.push(this.renderTranscript(input.transcript));
    }

    const content = parts.join('\n\n');
    const hash = computeTemplateHash(content);

    return { content, hash };
  }

  private assembleMessages(
    segmentA: { content: string },
    segmentB: { content: string },
    segmentC: { content: string },
    segmentD: { content: string }
  ): LLMMessage[] {
    const messages: LLMMessage[] = [];

    if (segmentA.content) {
      messages.push({ role: 'system', content: segmentA.content });
    }

    if (segmentB.content) {
      messages.push({ role: 'system', content: segmentB.content });
    }

    if (segmentC.content) {
      messages.push({ role: 'system', content: segmentC.content });
    }

    if (segmentD.content) {
      messages.push({ role: 'user', content: segmentD.content });
    }

    return messages;
  }

  private renderRoutingToolPlane(projection: ToolPlaneProjection): string {
    const parts: string[] = [];

    parts.push(`Available Tool IDs: ${projection.toolIds.join(', ')}`);

    if (projection.toolSummaries) {
      parts.push(projection.toolSummaries);
    }

    return parts.join('\n\n');
  }

  private renderFunctionCallingToolPlane(projection: ToolPlaneProjection): string {
    if (!projection.tools || projection.tools.length === 0) {
      return `Available Tool IDs: ${projection.toolIds.join(', ')}`;
    }

    const parts: string[] = [];

    parts.push(`Available Tool IDs: ${projection.toolIds.join(', ')}`);

    for (const tool of projection.tools) {
      parts.push(`Tool: ${tool.function.name}\nDescription: ${tool.function.description}`);
    }

    return parts.join('\n\n');
  }

  private renderStructuredJsonToolPlane(projection: ToolPlaneProjection): string {
    if (projection.toolIds.length === 0) {
      return '';
    }

    return `Available Tool IDs: ${projection.toolIds.join(', ')}`;
  }

  private renderContextItems(label: string, items: ContextItemData[]): string {
    const parts: string[] = [`--- ${label} ---`];

    for (const item of items) {
      if (item.isPinned) {
        parts.push(`[PINNED] ${item.content}`);
      } else {
        parts.push(item.content);
      }
    }

    return parts.join('\n');
  }

  private renderTranscript(transcript: LLMMessage[]): string {
    const parts: string[] = ['--- Transcript ---'];

    for (const msg of transcript) {
      parts.push(`${msg.role}: ${msg.content}`);
    }

    return parts.join('\n');
  }
}

export function extractToolsForRequest(
  input: ModelInputBuildInput
): LLMToolDefinition[] | undefined {
  if (input.mode !== 'function_calling') {
    return undefined;
  }

  if (!input.toolProjection?.tools) {
    return undefined;
  }

  return input.toolProjection.tools;
}