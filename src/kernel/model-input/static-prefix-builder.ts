/**
 * Static Prefix Builder - Assembles Layer 1-4 content from templates.
 *
 * Layer 1-4 form the "static prefix" (Segment A) which is identical
 * across requests for the same agentKind+providerFamily combination.
 * This is the key to DeepSeek KV Cache optimization.
 *
 * @module kernel/model-input/static-prefix-builder
 */

import type { PromptTemplateRegistry, PromptTemplateRecord } from '../../prompt/prompt-template-registry.js';
import type { TemplateLoader } from '../../prompt/template-loader.js';
import { computeTemplateHash } from '../../prompt/template-hash.js';

export interface StaticPrefixResult {
  content: string;
  hash: string;
}

export class StaticPrefixBuilder {
  constructor(
    private readonly registry: PromptTemplateRegistry,
    private readonly loader: TemplateLoader
  ) {}

  async buildStaticPrefix(agentKind: string, providerFamily: string): Promise<StaticPrefixResult> {
    const templates = this.registry.resolveTemplate(agentKind, providerFamily);
    const layer1to4 = templates.filter((t) => t.layer >= 1 && t.layer <= 4);

    const parts: string[] = [];

    for (const template of layer1to4) {
      const content = await this.loadTemplateContent(template, agentKind, providerFamily);
      parts.push(content);
    }

    const combined = parts.join('\n\n');
    const hash = computeTemplateHash(combined);

    return { content: combined, hash };
  }

  private async loadTemplateContent(
    template: PromptTemplateRecord,
    agentKind: string,
    providerFamily: string
  ): Promise<string> {
    if (template.content !== undefined) {
      return this.loader.loadFromString(template.content, { agentKind, providerFamily });
    }

    return this.loader.load(template.id, { agentKind, providerFamily });
  }
}
