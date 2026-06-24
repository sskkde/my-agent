/**
 * Skill Document Loader — lazily loads markdown documents for skills.
 *
 * Follows the same pattern as `src/prompt/template-loader.ts`:
 * - Constructor accepts an optional base path (defaults to the built-in docs
 *   directory resolved via `import.meta.url`).
 * - `loadSkillDocument(skillId)` reads the file asynchronously.
 * - `loadSkillDocumentSync(skillId)` reads synchronously.
 * - A `SkillRegistry` can be provided so the loader resolves deprecated
 *   aliases to their canonical document path before reading.
 *
 * The loader caches loaded documents in memory so repeated calls for the
 * same skill do not re-read the file. The cache can be cleared via
 * `clearCache()`.
 *
 * List/catalog operations on the registry never touch this loader — they
 * return metadata only. Document reads happen exclusively through
 * `loadSkillDocument()` or projection paths.
 *
 * @module skills/skill-document-loader
 */

import { readFileSync, promises as fsPromises } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SkillRegistry, SkillDefinition } from './types.js'
import { resolveSkillAlias } from './builtin/manifest.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const DEFAULT_BASE_PATH = join(__dirname, 'builtin', 'docs')

export class SkillDocumentLoaderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'SkillDocumentLoaderError'
  }
}

export class SkillDocumentLoader {
  private readonly basePath: string
  private readonly registry: SkillRegistry | null
  private readonly cache: Map<string, string> = new Map()

  constructor(options: { basePath?: string; registry?: SkillRegistry } = {}) {
    this.basePath = options.basePath ?? DEFAULT_BASE_PATH
    this.registry = options.registry ?? null
  }

  /**
   * Loads the markdown document for a skill asynchronously.
   *
   * If a registry was provided, the skill ID is resolved through the
   * registry to obtain the correct `documentPath`. Deprecated aliases
   * are resolved to their canonical document.
   *
   * @param skillId - The skill ID whose document to load.
   * @returns The markdown content as a string.
   * @throws SkillDocumentLoaderError if the skill is not found in the
   *   registry (when a registry is provided) or the file cannot be read.
   */
  async loadSkillDocument(skillId: string): Promise<string> {
    const cached = this.cache.get(skillId)
    if (cached !== undefined) {
      return cached
    }

    const filePath = this.resolveDocumentPath(skillId)
    const content = await fsPromises.readFile(filePath, 'utf-8')
    this.cache.set(skillId, content)
    return content
  }

  /**
   * Loads the markdown document for a skill synchronously.
   *
   * @param skillId - The skill ID whose document to load.
   * @returns The markdown content as a string.
   * @throws SkillDocumentLoaderError if the skill is not found or the
   *   file cannot be read.
   */
  loadSkillDocumentSync(skillId: string): string {
    const cached = this.cache.get(skillId)
    if (cached !== undefined) {
      return cached
    }

    const filePath = this.resolveDocumentPath(skillId)
    const content = readFileSync(filePath, 'utf-8')
    this.cache.set(skillId, content)
    return content
  }

  /**
   * Loads documents for multiple skills in a single batch.
   *
   * Only loads documents for skills that exist in the registry (when
   * provided). Skills not found are skipped silently — the caller
   * should validate IDs beforehand if needed.
   *
   * @param skillIds - Array of skill IDs to load.
   * @returns Map of skillId to document content.
   */
  async loadSkillDocuments(
    skillIds: readonly string[],
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>()
    for (const skillId of skillIds) {
      try {
        const content = await this.loadSkillDocument(skillId)
        results.set(skillId, content)
      } catch {
        // Skip skills whose documents cannot be loaded.
      }
    }
    return results
  }

  /**
   * Resolves a skill ID to the filesystem path of its markdown document.
   *
   * When a registry is provided:
   * 1. Resolve deprecated alias to canonical ID.
   * 2. Look up the SkillDefinition in the registry.
   * 3. Use the definition's `documentPath` (relative to basePath).
   *
   * When no registry is provided, the skillId is used directly as the
   * filename: `<basePath>/<skillId>.md`.
   *
   * @param skillId - The skill ID to resolve.
   * @returns Absolute path to the markdown file.
   * @throws SkillDocumentLoaderError if the skill is not in the registry.
   */
  resolveDocumentPath(skillId: string): string {
    if (this.registry) {
      const canonicalId = resolveSkillAlias(skillId)
      const definition: SkillDefinition | null = this.registry.get(canonicalId)
      if (!definition) {
        throw new SkillDocumentLoaderError(
          'SKILL_NOT_FOUND',
          `Skill not found in registry: "${skillId}" (resolved to "${canonicalId}").`,
        )
      }
      return resolve(this.basePath, definition.documentPath)
    }

    return resolve(this.basePath, `${skillId}.md`)
  }

  /**
   * Clears the in-memory document cache.
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Returns whether a document is currently cached.
   */
  isCached(skillId: string): boolean {
    return this.cache.has(skillId)
  }
}

export function createSkillDocumentLoader(
  options: { basePath?: string; registry?: SkillRegistry } = {},
): SkillDocumentLoader {
  return new SkillDocumentLoader(options)
}