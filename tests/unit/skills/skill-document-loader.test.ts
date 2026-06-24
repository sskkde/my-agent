import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { promises as fsPromises } from 'node:fs'
import { join } from 'node:path'
import { createSkillRegistry } from '../../../src/skills/skill-registry.js'
import {
  registerBuiltinSkills,
  ALL_BUILTIN_SKILL_DEFINITIONS,
  BUILTIN_ACTIVE_SKILL_DEFINITIONS,
  DEPRECATED_SKILL_ALIASES,
  resolveSkillAlias,
  isDeprecatedAlias,
} from '../../../src/skills/builtin/manifest.js'
import {
  SkillDocumentLoader,
  createSkillDocumentLoader,
} from '../../../src/skills/skill-document-loader.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BUILTIN_DOCS_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'src',
  'skills',
  'builtin',
  'docs',
)

function makeRegistryWithBuiltinSkills() {
  const registry = createSkillRegistry()
  registerBuiltinSkills(registry)
  return registry
}

// ---------------------------------------------------------------------------
// Manifest tests
// ---------------------------------------------------------------------------

describe('Built-in skill manifest', () => {
  describe('BUILTIN_ACTIVE_SKILL_DEFINITIONS', () => {
    it('contains exactly 5 active documentation skills', () => {
      expect(BUILTIN_ACTIVE_SKILL_DEFINITIONS).toHaveLength(5)
    })

    it('includes all required skill IDs', () => {
      const ids = BUILTIN_ACTIVE_SKILL_DEFINITIONS.map((s) => s.skillId)
      expect(ids).toContain('artifact_workflow')
      expect(ids).toContain('memory_research')
      expect(ids).toContain('session_status')
      expect(ids).toContain('documentation_search')
      expect(ids).toContain('web_research_guidance')
    })

    it('all active skills are enabled', () => {
      for (const skill of BUILTIN_ACTIVE_SKILL_DEFINITIONS) {
        expect(skill.enabled).toBe(true)
      }
    })

    it('all active skills have source builtin', () => {
      for (const skill of BUILTIN_ACTIVE_SKILL_DEFINITIONS) {
        expect(skill.source).toBe('builtin')
      }
    })

    it('all active skills have a documentPath', () => {
      for (const skill of BUILTIN_ACTIVE_SKILL_DEFINITIONS) {
        expect(skill.documentPath).toBeTruthy()
        expect(skill.documentPath).toMatch(/\.md$/)
      }
    })

    it('no active skill has deprecated tag', () => {
      for (const skill of BUILTIN_ACTIVE_SKILL_DEFINITIONS) {
        expect(skill.tags ?? []).not.toContain('deprecated')
      }
    })
  })

  describe('ALL_BUILTIN_SKILL_DEFINITIONS', () => {
    it('includes active skills plus deprecated aliases', () => {
      const activeCount = BUILTIN_ACTIVE_SKILL_DEFINITIONS.length
      const aliasCount = DEPRECATED_SKILL_ALIASES.size
      expect(ALL_BUILTIN_SKILL_DEFINITIONS).toHaveLength(activeCount + aliasCount)
    })

    it('is sorted by skillId', () => {
      const ids = ALL_BUILTIN_SKILL_DEFINITIONS.map((s) => s.skillId)
      const sorted = [...ids].sort()
      expect(ids).toEqual(sorted)
    })

    it('deprecated aliases are disabled', () => {
      const deprecated = ALL_BUILTIN_SKILL_DEFINITIONS.filter((s) =>
        (s.tags ?? []).includes('deprecated'),
      )
      for (const skill of deprecated) {
        expect(skill.enabled).toBe(false)
      }
    })

    it('deprecated aliases have deprecated tag', () => {
      const deprecated = ALL_BUILTIN_SKILL_DEFINITIONS.filter((s) =>
        (s.tags ?? []).includes('deprecated'),
      )
      expect(deprecated.length).toBe(DEPRECATED_SKILL_ALIASES.size)
    })
  })

  describe('DEPRECATED_SKILL_ALIASES', () => {
    it('maps all old tool-like IDs to new documentation IDs', () => {
      expect(DEPRECATED_SKILL_ALIASES.get('artifact_create')).toBe('artifact_workflow')
      expect(DEPRECATED_SKILL_ALIASES.get('artifact_update')).toBe('artifact_workflow')
      expect(DEPRECATED_SKILL_ALIASES.get('ask_user')).toBe('session_status')
      expect(DEPRECATED_SKILL_ALIASES.get('status_query')).toBe('session_status')
      expect(DEPRECATED_SKILL_ALIASES.get('memory_retrieve')).toBe('memory_research')
      expect(DEPRECATED_SKILL_ALIASES.get('transcript_search')).toBe('memory_research')
      expect(DEPRECATED_SKILL_ALIASES.get('plan_patch')).toBe('artifact_workflow')
      expect(DEPRECATED_SKILL_ALIASES.get('docs_search')).toBe('documentation_search')
      expect(DEPRECATED_SKILL_ALIASES.get('web_search')).toBe('web_research_guidance')
    })

    it('has exactly 9 aliases', () => {
      expect(DEPRECATED_SKILL_ALIASES.size).toBe(9)
    })
  })

  describe('resolveSkillAlias', () => {
    it('resolves deprecated IDs to canonical IDs', () => {
      expect(resolveSkillAlias('artifact_create')).toBe('artifact_workflow')
      expect(resolveSkillAlias('web_search')).toBe('web_research_guidance')
      expect(resolveSkillAlias('docs_search')).toBe('documentation_search')
    })

    it('returns the original ID for non-alias IDs', () => {
      expect(resolveSkillAlias('artifact_workflow')).toBe('artifact_workflow')
      expect(resolveSkillAlias('custom_skill')).toBe('custom_skill')
    })
  })

  describe('isDeprecatedAlias', () => {
    it('returns true for deprecated alias IDs', () => {
      expect(isDeprecatedAlias('artifact_create')).toBe(true)
      expect(isDeprecatedAlias('web_search')).toBe(true)
    })

    it('returns false for canonical IDs', () => {
      expect(isDeprecatedAlias('artifact_workflow')).toBe(false)
      expect(isDeprecatedAlias('custom_skill')).toBe(false)
    })
  })

  describe('registerBuiltinSkills', () => {
    it('registers all active and deprecated skills into the registry', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const allSkills = registry.list()
      expect(allSkills).toHaveLength(ALL_BUILTIN_SKILL_DEFINITIONS.length)
    })

    it('is idempotent — calling twice does not throw', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)
      expect(() => registerBuiltinSkills(registry)).not.toThrow()
    })

    it('registers active skills as enabled', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const active = registry.get('artifact_workflow')
      expect(active).not.toBeNull()
      expect(active?.enabled).toBe(true)
    })

    it('registers deprecated aliases as disabled', () => {
      const registry = createSkillRegistry()
      registerBuiltinSkills(registry)

      const alias = registry.get('artifact_create')
      expect(alias).not.toBeNull()
      expect(alias?.enabled).toBe(false)
      expect(alias?.tags).toContain('deprecated')
    })
  })
})

// ---------------------------------------------------------------------------
// SkillDocumentLoader tests
// ---------------------------------------------------------------------------

describe('SkillDocumentLoader', () => {
  let registry: ReturnType<typeof createSkillRegistry>
  let loader: SkillDocumentLoader

  beforeEach(() => {
    registry = makeRegistryWithBuiltinSkills()
    loader = createSkillDocumentLoader({
      basePath: BUILTIN_DOCS_PATH,
      registry,
    })
  })

  afterEach(() => {
    loader.clearCache()
  })

  describe('loadSkillDocument (async)', () => {
    it('loads a markdown document for a valid skill ID', async () => {
      const content = await loader.loadSkillDocument('artifact_workflow')

      expect(content).toBeTruthy()
      expect(content).toContain('# Artifact Workflow')
    })

    it('loads different documents for different skills', async () => {
      const artifact = await loader.loadSkillDocument('artifact_workflow')
      const memory = await loader.loadSkillDocument('memory_research')

      expect(artifact).toContain('Artifact Workflow')
      expect(memory).toContain('Memory Research')
      expect(artifact).not.toBe(memory)
    })

    it('caches documents — second call does not re-read file', async () => {
      const spy = vi.spyOn(fsPromises, 'readFile')

      await loader.loadSkillDocument('session_status')
      await loader.loadSkillDocument('session_status')

      expect(spy).toHaveBeenCalledTimes(1)
      spy.mockRestore()
    })

    it('resolves deprecated alias to canonical document', async () => {
      const aliasContent = await loader.loadSkillDocument('artifact_create')
      const canonicalContent = await loader.loadSkillDocument('artifact_workflow')

      expect(aliasContent).toBe(canonicalContent)
      expect(aliasContent).toContain('# Artifact Workflow')
    })

    it('throws SkillDocumentLoaderError for unknown skill in registry mode', async () => {
      await expect(loader.loadSkillDocument('nonexistent_skill')).rejects.toThrow(
        /Skill not found in registry/,
      )
    })

    it('loads all 5 required documentation files', async () => {
      const ids = [
        'artifact_workflow',
        'memory_research',
        'session_status',
        'documentation_search',
        'web_research_guidance',
      ]

      for (const id of ids) {
        const content = await loader.loadSkillDocument(id)
        expect(content).toBeTruthy()
        expect(content.length).toBeGreaterThan(0)
      }
    })
  })

  describe('loadSkillDocumentSync', () => {
    it('loads a markdown document synchronously', () => {
      const content = loader.loadSkillDocumentSync('artifact_workflow')

      expect(content).toBeTruthy()
      expect(content).toContain('# Artifact Workflow')
    })

    it('caches documents — second sync call returns cached content', () => {
      const freshLoader = createSkillDocumentLoader({
        basePath: BUILTIN_DOCS_PATH,
        registry: makeRegistryWithBuiltinSkills(),
      })

      expect(freshLoader.isCached('session_status')).toBe(false)

      const first = freshLoader.loadSkillDocumentSync('session_status')
      expect(freshLoader.isCached('session_status')).toBe(true)

      const second = freshLoader.loadSkillDocumentSync('session_status')
      expect(first).toBe(second)
    })

    it('resolves deprecated alias synchronously', () => {
      const aliasContent = loader.loadSkillDocumentSync('web_search')
      const canonicalContent = loader.loadSkillDocumentSync('web_research_guidance')

      expect(aliasContent).toBe(canonicalContent)
      expect(aliasContent).toContain('# Web Research Guidance')
    })

    it('throws for unknown skill in registry mode', () => {
      expect(() => loader.loadSkillDocumentSync('nonexistent_skill')).toThrow(
        /Skill not found in registry/,
      )
    })
  })

  describe('loadSkillDocuments (batch)', () => {
    it('loads multiple documents in a batch', async () => {
      const results = await loader.loadSkillDocuments([
        'artifact_workflow',
        'memory_research',
        'session_status',
      ])

      expect(results.size).toBe(3)
      expect(results.get('artifact_workflow')).toContain('Artifact Workflow')
      expect(results.get('memory_research')).toContain('Memory Research')
      expect(results.get('session_status')).toContain('Session Status')
    })

    it('skips skills that cannot be loaded', async () => {
      const results = await loader.loadSkillDocuments([
        'artifact_workflow',
        'nonexistent_skill',
      ])

      expect(results.size).toBe(1)
      expect(results.has('nonexistent_skill')).toBe(false)
    })

    it('returns empty map for empty input', async () => {
      const results = await loader.loadSkillDocuments([])
      expect(results.size).toBe(0)
    })
  })

  describe('resolveDocumentPath', () => {
    it('resolves to the correct file path for a canonical skill', () => {
      const path = loader.resolveDocumentPath('artifact_workflow')
      expect(path).toContain('artifact_workflow.md')
    })

    it('resolves deprecated alias to canonical document path', () => {
      const aliasPath = loader.resolveDocumentPath('docs_search')
      const canonicalPath = loader.resolveDocumentPath('documentation_search')
      expect(aliasPath).toBe(canonicalPath)
    })

    it('throws for unknown skill in registry mode', () => {
      expect(() => loader.resolveDocumentPath('nonexistent')).toThrow(
        /Skill not found in registry/,
      )
    })
  })

  describe('without registry', () => {
    it('loads document by skillId as filename', async () => {
      const noRegistryLoader = createSkillDocumentLoader({
        basePath: BUILTIN_DOCS_PATH,
      })

      const content = await noRegistryLoader.loadSkillDocument('artifact_workflow')
      expect(content).toContain('# Artifact Workflow')
    })

    it('resolves path as <basePath>/<skillId>.md', () => {
      const noRegistryLoader = createSkillDocumentLoader({
        basePath: BUILTIN_DOCS_PATH,
      })

      const path = noRegistryLoader.resolveDocumentPath('memory_research')
      expect(path).toContain('memory_research.md')
    })
  })

  describe('clearCache', () => {
    it('clears the cache so next load re-reads the file', async () => {
      const spy = vi.spyOn(fsPromises, 'readFile')

      await loader.loadSkillDocument('artifact_workflow')
      expect(spy).toHaveBeenCalledTimes(1)

      loader.clearCache()

      await loader.loadSkillDocument('artifact_workflow')
      expect(spy).toHaveBeenCalledTimes(2)

      spy.mockRestore()
    })

    it('isCached returns false after clearCache', async () => {
      await loader.loadSkillDocument('artifact_workflow')
      expect(loader.isCached('artifact_workflow')).toBe(true)

      loader.clearCache()
      expect(loader.isCached('artifact_workflow')).toBe(false)
    })
  })

  describe('lazy loading — list/catalog does not read documents', () => {
    it('registry.list() returns metadata without reading any document files', () => {
      const spy = vi.spyOn(require('node:fs'), 'readFileSync')
      vi.spyOn(fsPromises, 'readFile')

      const skills = registry.list()

      expect(skills.length).toBeGreaterThan(0)
      expect(spy).not.toHaveBeenCalled()
      expect(fsPromises.readFile).not.toHaveBeenCalled()

      spy.mockRestore()
      vi.restoreAllMocks()
    })

    it('registry.list() returns SkillDefinitions with documentPath but no document content', () => {
      const skills = registry.list()

      for (const skill of skills) {
        expect(skill.documentPath).toBeTruthy()
        // SkillDefinition has no 'content' field — it is metadata only.
        expect((skill as unknown as Record<string, unknown>).content).toBeUndefined()
      }
    })
  })
})

// ---------------------------------------------------------------------------
// Markdown content safety — no executable code blocks
// ---------------------------------------------------------------------------

describe('Built-in skill markdown safety', () => {
  const loader = createSkillDocumentLoader({
    basePath: BUILTIN_DOCS_PATH,
    registry: makeRegistryWithBuiltinSkills(),
  })

  const ACTIVE_SKILL_IDS = BUILTIN_ACTIVE_SKILL_DEFINITIONS.map((s) => s.skillId)

  for (const skillId of ACTIVE_SKILL_IDS) {
    it(`${skillId}.md contains no fenced code blocks with shell/bash/js/ts`, async () => {
      const content = await loader.loadSkillDocument(skillId)

      // No fenced code blocks with executable language tags.
      expect(content).not.toMatch(/```(bash|sh|shell|javascript|js|typescript|ts|python|py|ruby|go|rust|exec)\b/)
    })

    it(`${skillId}.md contains no handler/script/function definitions`, async () => {
      const content = await loader.loadSkillDocument(skillId)

      // No executable code patterns (function defs, arrow funcs, imports, requires).
      expect(content).not.toMatch(/function\s+\w+\s*\(/)
      expect(content).not.toMatch(/=>\s*[{(]/)
      expect(content).not.toMatch(/^\s*(import|require|const|let|var)\s/m)
      expect(content).not.toMatch(/\bnew\s+\w+\s*\(/)
    })
  }
})