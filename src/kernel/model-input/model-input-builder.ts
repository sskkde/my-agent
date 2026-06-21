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
 * - routing_tool_call: ForegroundAgent with decide (tool summaries + full schemas for function calling)
 * - structured_json: MemoryExtractor (no tools, JSON response format)
 * - function_calling: AgentKernel/SearchSubagent (tools in request)
 *
 * @module kernel/model-input/model-input-builder
 */

import type { LLMMessage, ToolDefinition as LLMToolDefinition } from '../../llm/types.js'
import type {
  ModelInputBuildInput,
  BuiltModelInput,
  ToolPlaneProjection,
  ContextItemData,
} from './model-input-types.js'
import {
  renderPersonaProjection,
  renderToolSelectionPolicy,
  renderMemoryPolicyProjection,
  renderSummaryLayers,
} from './model-input-types.js'
import { computeTemplateHash } from '../../prompt/template-hash.js'
import { StaticPrefixBuilder } from './static-prefix-builder.js'
import type { PromptTemplateRegistry, PromptTemplateRecord, SevenLayerInput } from '../../prompt/prompt-template-registry.js'
import type { TemplateLoader } from '../../prompt/template-loader.js'
import { normalizeAgentLabel, isKnownAgentLabel } from '../../taxonomy/agent-label-normalizer.js'
import {
  isPromptT5TemplateConsumptionEnabled,
  isPromptT6TemplateConsumptionEnabled,
  isPromptT7TemplateConsumptionEnabled,
} from '../../prompt/feature-flags.js'

export interface ModelInputBuilderDeps {
  templateRegistry: PromptTemplateRegistry
  templateLoader: TemplateLoader
}

export class ModelInputBuilder {
  private readonly staticPrefixBuilder: StaticPrefixBuilder
  private readonly templateRegistry: PromptTemplateRegistry
  private readonly templateLoader: TemplateLoader

  constructor(deps: ModelInputBuilderDeps) {
    this.templateRegistry = deps.templateRegistry
    this.templateLoader = deps.templateLoader
    this.staticPrefixBuilder = new StaticPrefixBuilder(deps.templateRegistry, deps.templateLoader)
  }

  /**
   * Register an agent template dynamically (e.g., for subagent profiles).
   *
   * Allows callers to inject layer-3 templates at runtime without modifying
   * the global registry. Useful for proof-path testing and subagent prompt
   * construction via the seven-layer stack.
   */
  registerAgentTemplate(id: string, record: PromptTemplateRecord): void {
    this.templateRegistry.register(id, record)
  }

  async build(input: ModelInputBuildInput): Promise<BuiltModelInput> {
    const resolved = this.resolveTaxonomy(input)

    const segmentA = await this.buildSegmentA(resolved, input)
    const segmentB = await this.buildSegmentB(resolved, input)
    const segmentC = await this.buildSegmentC(resolved, input)
    const segmentD = await this.buildSegmentD(resolved, input)

    const messages = this.assembleMessages(segmentA, segmentB, segmentC, segmentD, input)

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
        agentKind: resolved.agentKind,
        agentType: resolved.agentType,
        agentProfile: resolved.agentProfile,
        providerFamily: input.providerFamily,
        messageCount: messages.length,
        outputContract: input.outputContract,
        launchSource: input.launchSource,
      },
    }
  }

  private resolveTaxonomy(input: ModelInputBuildInput): {
    agentType: import('../../context/types.js').AgentType
    agentProfile: string
    agentKind: string
    templateKey: string
  } {
    if (input.agentType && input.agentProfile) {
      return {
        agentType: input.agentType,
        agentProfile: input.agentProfile,
        agentKind: input.agentKind ?? input.agentProfile,
        templateKey: input.agentKind ?? input.agentProfile,
      }
    }

    const legacyKind = input.agentKind ?? input.agentProfile ?? 'kernel'
    if (isKnownAgentLabel(legacyKind)) {
      const normalized = normalizeAgentLabel(legacyKind)
      if (legacyKind === 'kernel' && process.env.NODE_ENV !== 'production') {
        console.warn(
          '[ModelInputBuilder] DEPRECATED agentKind "kernel" resolved via normalizer to agentType=%s, agentProfile=%s. Use explicit agentType+agentProfile instead.',
          normalized.agentType,
          normalized.agentProfile,
        )
      }
      return {
        agentType: input.agentType ?? normalized.agentType,
        agentProfile: input.agentProfile ?? normalized.agentProfile,
        agentKind: legacyKind,
        templateKey: legacyKind,
      }
    }

    return {
      agentType: input.agentType ?? 'main',
      agentProfile: input.agentProfile ?? legacyKind,
      agentKind: legacyKind,
      templateKey: legacyKind,
    }
  }

  private async buildSegmentA(resolved: {
    agentType: import('../../context/types.js').AgentType
    agentProfile: string
  }, input: ModelInputBuildInput) {
    const sevenLayerInput: SevenLayerInput = {
      agentType: resolved.agentType,
      agentProfile: resolved.agentProfile,
      providerFamily: input.providerFamily,
      outputContract: input.outputContract,
    }
    return this.staticPrefixBuilder.buildStaticPrefix(sevenLayerInput)
  }

  private async buildSegmentB(resolved: {
    agentType: import('../../context/types.js').AgentType
    agentProfile: string
    agentKind: string
  }, input: ModelInputBuildInput) {
    // Segment B = B1 + B2 + B3 (stable ordering for hash determinism)
    const b1Parts: string[] = []
    const b2Parts: string[] = []
    const b3Parts: string[] = []

    // B1: systemPrompt — platform-owned agent profile, highest priority
    if (input.systemPrompt) {
      b1Parts.push(input.systemPrompt)
    }

    // B2: routingPrompt + T5 template content — tenant/admin instructions
    if (input.routingPrompt) {
      b2Parts.push(input.routingPrompt)
    }

    if (isPromptT5TemplateConsumptionEnabled()) {
      const t5Content = await this.loadTaxonomyLayer5(resolved, input)
      if (t5Content) {
        b2Parts.push(t5Content)
      }
    }

    // B3: personaProjection — user preferences, constrained, preference-only
    if (input.personaProjection) {
      b3Parts.push(renderPersonaProjection(input.personaProjection))
    }

    const parts: string[] = []

    if (b1Parts.length > 0) {
      parts.push('--- Segment B1: System Prompt (Platform-owned, highest priority) ---')
      parts.push(b1Parts.join('\n\n'))
    }

    if (b2Parts.length > 0) {
      parts.push('--- Segment B2: Routing & Template (Tenant/Admin) ---')
      parts.push(b2Parts.join('\n\n'))
    }

    if (b3Parts.length > 0) {
      parts.push('--- Segment B3: Persona Projection (User Preferences, preference-only) ---')
      parts.push(b3Parts.join('\n\n'))
    }

    const content = parts.join('\n\n')
    const hash = computeTemplateHash(content)

    return { content, hash }
  }

  private async buildSegmentC(resolved: {
    agentType: import('../../context/types.js').AgentType
    agentProfile: string
    agentKind: string
  }, input: ModelInputBuildInput) {
    const projection = input.toolProjection
    const mode = input.mode
    const policy = input.toolSelectionPolicy

    const parts: string[] = []

    if (isPromptT6TemplateConsumptionEnabled()) {
      const t6Content = await this.loadTaxonomyLayer6(resolved, input)
      if (t6Content) {
        parts.push(t6Content)
      }
    }

    if (projection) {
      if (mode === 'routing_json') {
        parts.push(this.renderRoutingToolPlane(projection))
      } else if (mode === 'routing_tool_call') {
        parts.push(this.renderRoutingToolCallPlane(projection))
      } else if (mode === 'function_calling') {
        parts.push(this.renderFunctionCallingToolPlane(projection))
      } else {
        parts.push(this.renderStructuredJsonToolPlane(projection))
      }
    }

    if (policy) {
      parts.push(renderToolSelectionPolicy(policy))
    }

    const content = parts.join('\n\n')
    const hash = computeTemplateHash(content)

    return { content, hash }
  }

  private async buildSegmentD(resolved: {
    agentType: import('../../context/types.js').AgentType
    agentProfile: string
    agentKind: string
  }, input: ModelInputBuildInput) {
    const parts: string[] = []

    parts.push(this.renderSegmentDProvenance(input))

    // 1. Taxonomy template (Layer 7)
    if (isPromptT7TemplateConsumptionEnabled()) {
      const t7Content = await this.loadTaxonomyLayer7(resolved, input)
      if (t7Content) {
        parts.push('--- Taxonomy Template (Layer 7) ---')
        parts.push(t7Content)
      }
    }

    // 2. Memory policy projection
    if (input.memoryPolicyProjection) {
      parts.push('--- Memory Policy ---')
      parts.push(renderMemoryPolicyProjection(input.memoryPolicyProjection))
    }

    // 3. Summary layer projection: prefer top-level strategy projection,
    // fall back to nested contextBundle.summaryLayers for backward compatibility.
    const summaryLayersSource = input.summaryLayers ?? input.contextBundle?.summaryLayers
    if (summaryLayersSource) {
      const rendered = renderSummaryLayers(summaryLayersSource)
      if (rendered) {
        parts.push('--- Summary Layers ---')
        parts.push(rendered)
      }
    }

    // 4. Dynamic fields (stable ordering for hash determinism)
    const dynamicFields: string[] = []
    if (input.currentDate) dynamicFields.push(`Current Date: ${input.currentDate}`)
    if (input.sessionId) dynamicFields.push(`Session ID: ${input.sessionId}`)
    if (input.runId) dynamicFields.push(`Run ID: ${input.runId}`)
    if (input.messageId) dynamicFields.push(`Message ID: ${input.messageId}`)
    if (input.requestId) dynamicFields.push(`Request ID: ${input.requestId}`)
    if (dynamicFields.length > 0) {
      parts.push('--- Dynamic Fields ---')
      parts.push(dynamicFields.join('\n'))
    }

    // 5. Runtime environment
    if (input.runtimeEnvironment && Object.keys(input.runtimeEnvironment).length > 0) {
      parts.push(this.renderRuntimeEnvironment(input.runtimeEnvironment))
    }

    // 6. Context bundle items
    const bundle = input.contextBundle
    if (bundle) {
      if (bundle.pinnedItems && bundle.pinnedItems.length > 0) {
        parts.push(this.renderContextItems('Pinned Context', bundle.pinnedItems))
      }

      if (bundle.orderedItems && bundle.orderedItems.length > 0) {
        parts.push(this.renderContextItems('Context', bundle.orderedItems))
      }

      if (bundle.summaryBlocks && bundle.summaryBlocks.length > 0) {
        parts.push(this.renderContextItems('Summary', bundle.summaryBlocks))
      }

      // 7. Views
      if (bundle.planView) parts.push(bundle.planView)
      if (bundle.workflowStepView) parts.push(bundle.workflowStepView)
      if (bundle.backgroundRunView) parts.push(bundle.backgroundRunView)
      if (bundle.triggerView) parts.push(bundle.triggerView)

      // 8. Transcript
      if (bundle.transcript && bundle.transcript.length > 0) {
        parts.push(this.renderTranscript(bundle.transcript))
      }
    }

    // 9. User message
    if (input.currentUserMessage) {
      parts.push('--- User Message ---')
      parts.push(`User Message: ${input.currentUserMessage}`)
    }

    // 10. Input transcript (for function_calling/routing_tool_call modes)
    if (input.transcript && input.transcript.length > 0) {
      parts.push(this.renderTranscript(input.transcript))
    }

    const content = parts.join('\n\n')
    const hash = computeTemplateHash(content)

    return { content, hash }
  }

  private assembleMessages(
    segmentA: { content: string },
    segmentB: { content: string },
    segmentC: { content: string },
    segmentD: { content: string },
    input: ModelInputBuildInput,
  ): LLMMessage[] {
    const messages: LLMMessage[] = []

    if (segmentA.content) {
      messages.push({ role: 'system', content: segmentA.content })
    }

    if (segmentB.content) {
      messages.push({ role: 'system', content: segmentB.content })
    }

    if (segmentC.content) {
      messages.push({ role: 'system', content: segmentC.content })
    }

    if (segmentD.content) {
      messages.push({ role: 'user', content: segmentD.content })
    }

    if (
      (input.mode === 'function_calling' || input.mode === 'routing_tool_call') &&
      input.transcript &&
      input.transcript.length > 0
    ) {
      for (const msg of input.transcript) {
        messages.push(msg)
      }
    }

    return messages
  }

  private async loadTaxonomyLayer5(
    resolved: { agentProfile: string; agentType: string },
    input: ModelInputBuildInput,
  ): Promise<string | undefined> {
    const templateId = `agentProfile:${resolved.agentProfile}`
    const record = this.templateRegistry.getTemplate(templateId)
    if (!record) return undefined

    const variables = this.buildTemplateVars(resolved, input)
    try {
      if (record.content !== undefined) {
        return this.templateLoader.loadFromString(record.content, variables)
      }
      return await this.templateLoader.load(record.id, variables)
    } catch {
      return undefined
    }
  }

  private async loadTaxonomyLayer6(
    resolved: { agentProfile: string; agentType: string },
    input: ModelInputBuildInput,
  ): Promise<string | undefined> {
    const record = this.templateRegistry.getTemplate('toolProjection:default')
    if (!record) return undefined

    const variables = this.buildTemplateVars(resolved, input)
    try {
      if (record.content !== undefined) {
        return this.templateLoader.loadFromString(record.content, variables)
      }
      return await this.templateLoader.load(record.id, variables)
    } catch {
      return undefined
    }
  }

  private async loadTaxonomyLayer7(
    resolved: { agentProfile: string; agentType: string },
    input: ModelInputBuildInput,
  ): Promise<string | undefined> {
    const record = this.templateRegistry.getTemplate('runtimeContext:default')
    if (!record) return undefined

    const variables = this.buildTemplateVars(resolved, input)
    try {
      if (record.content !== undefined) {
        return this.templateLoader.loadFromString(record.content, variables)
      }
      return await this.templateLoader.load(record.id, variables)
    } catch {
      return undefined
    }
  }

  private buildTemplateVars(
    resolved: { agentProfile: string; agentType: string },
    input: ModelInputBuildInput,
  ): Record<string, string> {
    return {
      agentKind: resolved.agentProfile ?? resolved.agentType,
      providerFamily: input.providerFamily,
      agentType: resolved.agentType,
      agentProfile: resolved.agentProfile,
      outputContract: input.outputContract ?? '',
    }
  }

  private renderRoutingToolPlane(projection: ToolPlaneProjection): string {
    const parts: string[] = []

    parts.push(`Available Tool IDs: ${projection.toolIds.join(', ')}`)

    if (projection.toolSummaries) {
      parts.push(projection.toolSummaries)
    }

    return parts.join('\n\n')
  }

  private renderRoutingToolCallPlane(projection: ToolPlaneProjection): string {
    const parts: string[] = []

    parts.push(`Available Tool IDs: ${projection.toolIds.join(', ')}`)

    if (projection.toolSummaries) {
      parts.push(projection.toolSummaries)
    }

    if (projection.tools && projection.tools.length > 0) {
      for (const tool of projection.tools) {
        parts.push(`Tool: ${tool.function.name}\nDescription: ${tool.function.description}`)
      }
    }

    return parts.join('\n\n')
  }

  private renderFunctionCallingToolPlane(projection: ToolPlaneProjection): string {
    if (!projection.tools || projection.tools.length === 0) {
      return `Available Tool IDs: ${projection.toolIds.join(', ')}`
    }

    const parts: string[] = []

    parts.push(`Available Tool IDs: ${projection.toolIds.join(', ')}`)

    for (const tool of projection.tools) {
      parts.push(`Tool: ${tool.function.name}\nDescription: ${tool.function.description}`)
    }

    return parts.join('\n\n')
  }

  private renderStructuredJsonToolPlane(projection: ToolPlaneProjection): string {
    if (projection.toolIds.length === 0) {
      return ''
    }

    return `Available Tool IDs: ${projection.toolIds.join(', ')}`
  }

  private renderContextItems(label: string, items: ContextItemData[]): string {
    const parts: string[] = [`--- ${label} ---`]

    for (const item of items) {
      const provenance = this.renderItemProvenance(item)
      if (item.isPinned) {
        parts.push(provenance ? `[PINNED] ${provenance} ${item.content}` : `[PINNED] ${item.content}`)
      } else {
        parts.push(provenance ? `${provenance} ${item.content}` : item.content)
      }
    }

    return parts.join('\n')
  }

  private renderSegmentDProvenance(input: ModelInputBuildInput): string {
    const bundle = input.contextBundle
    const firstItem = bundle?.pinnedItems?.[0] ?? bundle?.orderedItems?.[0] ?? bundle?.summaryBlocks?.[0]
    const sourceType = firstItem?.sourceType ?? (bundle?.summaryBlocks && bundle.summaryBlocks.length > 0 ? 'memory' : 'session_history')
    const sourceRef = firstItem?.sourceRef ?? input.messageId ?? input.runId ?? input.sessionId ?? 'current_request'
    const freshnessTs = firstItem?.freshnessTs ?? input.currentDate ?? 'unspecified'
    const invocationSource = bundle?.invocationSource ?? this.defaultInvocationSource(input)

    return [
      '## Provenance',
      `sourceType: ${sourceType}`,
      `sourceRef: ${sourceRef}`,
      `freshnessTs: ${freshnessTs}`,
      `invocationSource: ${invocationSource}`,
      '--- Segment D: Context Bundle (Provenance) ---',
    ].join('\n')
  }

  private defaultInvocationSource(input: ModelInputBuildInput): string {
    if (input.agentType === 'subagent') return 'subagent_runtime'
    if (input.agentType === 'background') return 'background_subagent'
    if (input.agentType === 'workflow_step') return 'workflow_step'
    return 'gateway_intent'
  }

  private renderItemProvenance(item: ContextItemData): string {
    const fields: string[] = []
    if (item.sourceType) fields.push(`sourceType: ${item.sourceType}`)
    if (item.sourceRef) fields.push(`sourceRef: ${item.sourceRef}`)
    if (item.freshnessTs) fields.push(`freshnessTs: ${item.freshnessTs}`)
    return fields.length > 0 ? `[${fields.join('; ')}]` : ''
  }

  private renderTranscript(transcript: LLMMessage[]): string {
    const parts: string[] = ['--- Transcript ---']

    for (const msg of transcript) {
      parts.push(`${msg.role}: ${msg.content}`)
    }

    return parts.join('\n')
  }

  private renderRuntimeEnvironment(env: Record<string, unknown>): string {
    const parts: string[] = ['--- Runtime Environment ---']

    for (const [key, value] of Object.entries(env)) {
      if (value !== undefined && value !== null) {
        parts.push(`${key}: ${String(value)}`)
      }
    }

    return parts.join('\n')
  }
}

export function extractToolsForRequest(input: ModelInputBuildInput): LLMToolDefinition[] | undefined {
  if (input.mode !== 'function_calling' && input.mode !== 'routing_tool_call') {
    return undefined
  }

  if (!input.toolProjection?.tools) {
    return undefined
  }

  return input.toolProjection.tools
}
