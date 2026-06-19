/**
 * Template Loader - Load and process template files.
 *
 * Loads .md template files from filesystem and performs
 * placeholder replacement for runtime variables.
 *
 * @module prompt/template-loader
 */

import { readFileSync, promises as fsPromises } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { PromptTemplateRecord, ResolvedTemplate } from './prompt-template-registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEFAULT_BASE_PATH = join(__dirname, 'templates')

const PLACEHOLDER_REGEX = /\{(\w+)\}/g

export class TemplateLoader {
  private readonly basePath: string

  constructor(basePath?: string) {
    this.basePath = basePath ?? DEFAULT_BASE_PATH
  }

  /**
   * Loads a template file asynchronously and replaces placeholders.
   *
   * @param templateId - Template ID in format "category:name" (e.g., "platform:base")
   * @param variables - Optional key-value pairs for placeholder replacement
   * @returns Template content with placeholders replaced
   * @throws Error if template file not found
   */
  async load(templateId: string, variables?: Record<string, string>): Promise<string> {
    const filePath = this.resolveTemplatePath(templateId)
    const content = await fsPromises.readFile(filePath, 'utf-8')
    return this.replacePlaceholders(content, variables)
  }

  /**
   * Loads a template file synchronously and replaces placeholders.
   *
   * @param templateId - Template ID in format "category:name" (e.g., "platform:base")
   * @param variables - Optional key-value pairs for placeholder replacement
   * @returns Template content with placeholders replaced
   * @throws Error if template file not found
   */
  loadSync(templateId: string, variables?: Record<string, string>): string {
    const filePath = this.resolveTemplatePath(templateId)
    const content = readFileSync(filePath, 'utf-8')
    return this.replacePlaceholders(content, variables)
  }

  /**
   * Processes inline template content with placeholder replacement.
   *
   * Useful for testing without filesystem access.
   *
   * @param content - Template content string
   * @param variables - Optional key-value pairs for placeholder replacement
   * @returns Content with placeholders replaced
   */
  loadFromString(content: string, variables?: Record<string, string>): string {
    return this.replacePlaceholders(content, variables)
  }

  /**
   * Resolves template ID to filesystem path.
   *
   * @param templateId - Template ID in format "category:name"
   * @returns Absolute path to template file
   */
  resolveTemplatePath(templateId: string): string {
    const [category, name] = templateId.split(':')
    if (!category || !name) {
      throw new Error(`Invalid template ID format: "${templateId}". Expected "category:name".`)
    }
    return resolve(this.basePath, category, `${name}.md`)
  }

  /**
   * Replaces {placeholder} patterns in content.
   *
   * @param content - Template content
   * @param variables - Key-value pairs for replacement
   * @returns Content with known placeholders replaced
   */
  private replacePlaceholders(content: string, variables?: Record<string, string>): string {
    if (!variables) {
      return content
    }

    return content.replace(PLACEHOLDER_REGEX, (match, key: string) => {
      return Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
    })
  }

  /**
   * Loads content for an array of resolved template records.
   *
   * Uses inline content if available (for testing), otherwise loads from filesystem.
   *
   * @param records - Array of template records to load
   * @param variables - Optional key-value pairs for placeholder replacement
   * @returns Array of resolved templates with content
   */
  async loadResolvedTemplates(
    records: PromptTemplateRecord[],
    variables?: Record<string, string>,
  ): Promise<ResolvedTemplate[]> {
    const results: ResolvedTemplate[] = []

    for (const record of records) {
      const rawContent = record.content ?? (await this.load(record.id))
      const content = this.replacePlaceholders(rawContent, variables)
      results.push({ record, content })
    }

    return results
  }

  /**
   * Loads content for an array of resolved template records synchronously.
   *
   * Uses inline content if available (for testing), otherwise loads from filesystem.
   *
   * @param records - Array of template records to load
   * @param variables - Optional key-value pairs for placeholder replacement
   * @returns Array of resolved templates with content
   */
  loadResolvedTemplatesSync(
    records: PromptTemplateRecord[],
    variables?: Record<string, string>,
  ): ResolvedTemplate[] {
    const results: ResolvedTemplate[] = []

    for (const record of records) {
      const rawContent = record.content ?? this.loadSync(record.id)
      const content = this.replacePlaceholders(rawContent, variables)
      results.push({ record, content })
    }

    return results
  }
}

export function createTemplateLoader(basePath?: string): TemplateLoader {
  return new TemplateLoader(basePath)
}
