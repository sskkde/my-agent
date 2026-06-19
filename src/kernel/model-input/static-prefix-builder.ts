/**
 * Static Prefix Builder - Assembles Layer 1-4 content from templates.
 *
 * Layer 1-4 form the "static prefix" (Segment A) which is identical
 * across requests for the same agentType+providerFamily+outputContract combination.
 * This is the key to DeepSeek KV Cache optimization.
 *
 * Seven-layer order:
 * - Layer 1: platform:base, platform:safety (platform identity/safety)
 * - Layer 2: provider:{providerFamily} (LLM provider instructions)
 * - Layer 3: agentType:{agentType} (runtime agent class behavior)
 * - Layer 4: outputContract:{outputContract} (output schema contract)
 *
 * @module kernel/model-input/static-prefix-builder
 */

import type { PromptTemplateRegistry, PromptTemplateRecord, SevenLayerInput } from '../../prompt/prompt-template-registry.js'
import type { TemplateLoader } from '../../prompt/template-loader.js'
import { computeTemplateHash } from '../../prompt/template-hash.js'

export interface StaticPrefixResult {
  content: string
  hash: string
}

export class StaticPrefixBuilder {
  constructor(
    private readonly registry: PromptTemplateRegistry,
    private readonly loader: TemplateLoader,
  ) {}

  /**
   * Build the static prefix (Segment A) containing layers 1-4.
   *
   * Uses seven-layer taxonomy resolution for deterministic ordering:
   * platform:base → provider:{provider} → agentType:{type} → outputContract:{contract}
   *
   * Falls back to legacy resolveTemplate when no taxonomy records match
   * (backward compat for tests and agents without taxonomy registration).
   */
  async buildStaticPrefix(sevenLayerInput: SevenLayerInput): Promise<StaticPrefixResult> {
    let templates = this.registry.resolveSevenLayer(sevenLayerInput)
    let layer1to4 = templates.filter((t) => t.layer >= 1 && t.layer <= 4)

    // Fallback: legacy resolveTemplate when no taxonomy records found for layers 3-4
    if (!layer1to4.some((t) => t.layer === 3) && !layer1to4.some((t) => t.layer === 4)) {
      const legacyAgentKind = sevenLayerInput.agentKind ?? sevenLayerInput.agentProfile
      const legacyTemplates = this.registry.resolveTemplate(
        legacyAgentKind,
        sevenLayerInput.providerFamily,
      )
      const legacyLayer1to4 = legacyTemplates.filter((t) => t.layer >= 1 && t.layer <= 4)
      const taxonomyLayers12 = layer1to4.filter((t) => t.layer <= 2)
      const legacyLayers34 = legacyLayer1to4.filter((t) => t.layer >= 3)
      layer1to4 = [...taxonomyLayers12, ...legacyLayers34]
    }

    const templateVars = this.buildTemplateVars(sevenLayerInput)
    const parts: string[] = []

    for (const template of layer1to4) {
      const content = await this.loadTemplateContent(template, templateVars)
      parts.push(content)
    }

    const combined = parts.join('\n\n')
    const hash = computeTemplateHash(combined)

    return { content: combined, hash }
  }

  /**
   * Build template variables from SevenLayerInput for placeholder substitution.
   */
  private buildTemplateVars(input: SevenLayerInput): Record<string, string> {
    return {
      agentKind: input.agentProfile ?? input.agentType,
      providerFamily: input.providerFamily,
      agentType: input.agentType,
      agentProfile: input.agentProfile,
      outputContract: input.outputContract ?? '',
    }
  }

  private async loadTemplateContent(
    template: PromptTemplateRecord,
    variables: Record<string, string>,
  ): Promise<string> {
    if (template.content !== undefined) {
      return this.loader.loadFromString(template.content, variables)
    }

    return this.loader.load(template.id, variables)
  }
}
