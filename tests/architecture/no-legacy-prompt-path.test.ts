/**
 * Architecture Regression Test: No Legacy Prompt Path
 *
 * This test ensures that legacy prompt-builder and prompt-registry files
 * and their imports are permanently removed from the codebase.
 *
 * These tests serve as a safety net to prevent accidental reintroduction
 * of the legacy prompt path after the cleanup work in Task 8.
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

/**
 * Recursively walk a directory and yield all TypeScript files.
 */
function* walkDirectory(dir: string): Generator<string> {
  const entries = readdirSync(dir)
  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      yield* walkDirectory(fullPath)
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      yield fullPath
    }
  }
}

/**
 * Extract import paths from a TypeScript file content.
 */
function extractImports(content: string): Array<{ path: string; line: number }> {
  const imports: Array<{ path: string; line: number }> = []
  const lines = content.split('\n')
  const importRegex = /from\s+['"]([^'"]+)['"];?$/

  for (let i = 0; i < lines.length; i++) {
    const match = importRegex.exec(lines[i])
    if (match) {
      imports.push({ path: match[1], line: i + 1 })
    }
  }

  return imports
}

describe('No Legacy Prompt Path', () => {
  const rootDir = process.cwd()
  const srcDir = join(rootDir, 'src')

  describe('Deleted Files', () => {
    it('prompt-builder.ts does NOT exist', () => {
      const filePath = join(srcDir, 'agents', 'prompt-builder.ts')
      expect(existsSync(filePath)).toBe(false)
    })

    it('prompt-registry.ts does NOT exist', () => {
      const filePath = join(srcDir, 'agents', 'prompt-registry.ts')
      expect(existsSync(filePath)).toBe(false)
    })
  })

  describe('No Legacy Imports', () => {
    it('no file imports from prompt-builder.js', () => {
      const violations: Array<{ file: string; line: number; importPath: string }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const imports = extractImports(content)

        for (const { path: importPath, line } of imports) {
          if (
            importPath.includes('prompt-builder.js') ||
            importPath.includes('prompt-builder.ts') ||
            importPath.endsWith('/prompt-builder') ||
            importPath.includes('/agents/prompt-builder')
          ) {
            violations.push({
              file: relativePath,
              line,
              importPath,
            })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line} imports '${v.importPath}'`).join('\n')
        throw new Error(`Found ${violations.length} file(s) importing from prompt-builder:\n${formatted}`)
      }

      expect(violations).toHaveLength(0)
    })

    it('no file imports from prompt-registry.js', () => {
      const violations: Array<{ file: string; line: number; importPath: string }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const imports = extractImports(content)

        for (const { path: importPath, line } of imports) {
          if (
            importPath.includes('prompt-registry.js') ||
            importPath.includes('prompt-registry.ts') ||
            importPath.endsWith('/prompt-registry') ||
            importPath.includes('/agents/prompt-registry')
          ) {
            violations.push({
              file: relativePath,
              line,
              importPath,
            })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line} imports '${v.importPath}'`).join('\n')
        throw new Error(`Found ${violations.length} file(s) importing from prompt-registry:\n${formatted}`)
      }

      expect(violations).toHaveLength(0)
    })
  })

  describe('No Legacy Function References', () => {
    it('no file contains buildRoutingMessages', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('buildRoutingMessages')) {
            violations.push({
              file: relativePath,
              line: i + 1,
            })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(`Found ${violations.length} file(s) containing 'buildRoutingMessages':\n${formatted}`)
      }

      expect(violations).toHaveLength(0)
    })

    it('no file contains getPromptForAgent', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('getPromptForAgent')) {
            violations.push({
              file: relativePath,
              line: i + 1,
            })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(`Found ${violations.length} file(s) containing 'getPromptForAgent':\n${formatted}`)
      }

      expect(violations).toHaveLength(0)
    })
  })

  describe('Foreground Agent Clean', () => {
    it('does NOT contain MODEL_INPUT_BUILDER_ENABLED', () => {
      const filePath = join(srcDir, 'foreground', 'foreground-agent.ts')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).not.toContain('MODEL_INPUT_BUILDER_ENABLED')
    })

    it('does NOT contain MODEL_INPUT_SHADOW_MODE', () => {
      const filePath = join(srcDir, 'foreground', 'foreground-agent.ts')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).not.toContain('MODEL_INPUT_SHADOW_MODE')
    })

    it('does NOT contain MODEL_INPUT_LEGACY_FALLBACK', () => {
      const filePath = join(srcDir, 'foreground', 'foreground-agent.ts')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).not.toContain('MODEL_INPUT_LEGACY_FALLBACK')
    })

    it('does NOT contain callLLMRouter(', () => {
      const filePath = join(srcDir, 'foreground', 'foreground-agent.ts')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).not.toContain('callLLMRouter(')
    })
  })

  describe('New Path Preserved', () => {
    it('prompt-template-registry.ts exists (new path)', () => {
      const filePath = join(srcDir, 'prompt', 'prompt-template-registry.ts')
      expect(existsSync(filePath)).toBe(true)
    })
  })

  // ─── Taxonomy Boundary Enforcement ───────────────────────────────────────────
  //
  // Prevents re-introduction of legacy `agentKind: 'kernel'` prompt paths and
  // free-form `agentType: string` fields outside approved compatibility modules.
  //
  // Allowed files are the normalizer, compat bridge, template registry, and
  // label normalizer — the only places where legacy strings may appear.

  describe('No New agentKind: kernel Usage', () => {
    /**
     * Files that are approved to contain `agentKind: 'kernel'`:
     * - prompt-template-registry.ts: defines legacy template records for backward compat
     * - model-input-builder.ts: normalizer that resolves legacy kernel → main/default_main
     * - agent-kernel.ts: deprecated compat bridge kept for template resolution
     * - agent-label-normalizer.ts: maps legacy 'kernel' label to new taxonomy
     */
    const AGENT_KIND_KERNEL_ALLOWLIST = [
      'src/prompt/prompt-template-registry.ts',
      'src/kernel/model-input/model-input-builder.ts',
      'src/kernel/agent-kernel.ts',
      'src/taxonomy/agent-label-normalizer.ts',
    ]

    it('no src/ file uses agentKind: "kernel" outside normalizer/compat modules', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        if (AGENT_KIND_KERNEL_ALLOWLIST.some((allowed) => relativePath.endsWith(allowed))) {
          continue
        }

        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (/agentKind\s*:\s*['"]kernel['"]/.test(lines[i])) {
            violations.push({ file: relativePath, line: i + 1 })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(
          `Found ${violations.length} file(s) with agentKind: 'kernel' outside normalizer/compat modules:\n${formatted}\n` +
          `Use agentType + agentProfile from the seven-layer taxonomy instead.\n` +
          `Allowed files: ${AGENT_KIND_KERNEL_ALLOWLIST.join(', ')}`,
        )
      }

      expect(violations).toHaveLength(0)
    })
  })

  describe('No New Free-form agentType: string', () => {
    /**
     * Files that are approved to use `agentType: string` (free-form string type):
     * - subagents/registry.ts: SubagentDefinition.agentType is a profile label, not AgentType
     * - subagents/action-mapper.ts: maps profile labels to actions
     * - subagents/provider-policy.ts: stores per-profile provider preferences
     * - subagents/background-runtime.ts: background run config with profile label
     * - api/routes/subagents.ts: API route params carry profile labels
     * - foreground/tools/subagent-launch-tool.ts: resolves profile label at launch
     * - storage/background-run-store.ts: DB schema stores profile label
     * - storage/subagent-run-store.ts: DB schema stores profile label
     * - runtime/bootstrap.ts: bootstrap config with profile label
     * - prompt/prompt-template-registry.ts: SevenLayerInput.agentType is a compat field
     */
    const AGENT_TYPE_STRING_ALLOWLIST = [
      'src/subagents/registry.ts',
      'src/subagents/action-mapper.ts',
      'src/subagents/provider-policy.ts',
      'src/subagents/background-runtime.ts',
      'src/api/routes/subagents.ts',
      'src/foreground/tools/subagent-launch-tool.ts',
      'src/storage/background-run-store.ts',
      'src/storage/subagent-run-store.ts',
      'src/runtime/bootstrap.ts',
      'src/prompt/prompt-template-registry.ts',
      'src/kernel/model-input/model-input-builder.ts',
    ]

    it('no src/ file uses agentType: string outside approved compat modules', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        if (AGENT_TYPE_STRING_ALLOWLIST.some((allowed) => relativePath.endsWith(allowed))) {
          continue
        }

        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (/agentType\s*:\s*string/.test(lines[i])) {
            violations.push({ file: relativePath, line: i + 1 })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(
          `Found ${violations.length} file(s) with free-form agentType: string outside compat modules:\n${formatted}\n` +
          `Use the AgentType union from context/types.ts instead of free-form string.\n` +
          `Allowed files: ${AGENT_TYPE_STRING_ALLOWLIST.join(', ')}`,
        )
      }

      expect(violations).toHaveLength(0)
    })
  })

  // ─── Prompt Migration Guards ────────────────────────────────────────────────
  //
  // Prevents re-introduction of legacy prompt functions and stale template paths
  // after the prompt migration alignment.

  describe('No buildSystemPrompt in src/', () => {
    it('no src/ file defines or exports buildSystemPrompt', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          // Match function declarations, exports, and method definitions
          if (/function\s+buildSystemPrompt|export\s+.*buildSystemPrompt|buildSystemPrompt\s*\(/.test(lines[i])) {
            violations.push({ file: relativePath, line: i + 1 })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(
          `Found ${violations.length} file(s) with buildSystemPrompt in src/:\n${formatted}\n` +
          `buildSystemPrompt() was removed during the prompt migration. Use ModelInputBuilder.build() instead.`,
        )
      }

      expect(violations).toHaveLength(0)
    })
  })

  describe('No Stale Prompt Template Paths', () => {
    it('no src/ file references agents/prompt-builder or agents/prompt-registry as template paths', () => {
      const violations: Array<{ file: string; line: number; match: string }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          // Match stale template path references (not imports, but string literals)
          if (/['"`]agents\/prompt-builder['"`]|['"`]agents\/prompt-registry['"`]/.test(lines[i])) {
            violations.push({ file: relativePath, line: i + 1, match: lines[i].trim() })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}: ${v.match}`).join('\n')
        throw new Error(
          `Found ${violations.length} file(s) with stale template path references:\n${formatted}\n` +
          `Legacy template paths 'agents/prompt-builder' and 'agents/prompt-registry' are removed.`,
        )
      }

      expect(violations).toHaveLength(0)
    })

    it('no src/ file references buildSystemPrompt as a string in comments or docs', () => {
      const violations: Array<{ file: string; line: number }> = []

      for (const filePath of walkDirectory(srcDir)) {
        const relativePath = relative(rootDir, filePath).replace(/\\/g, '/')
        const content = readFileSync(filePath, 'utf-8')
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          // Skip test files (they legitimately reference buildSystemPrompt for parity tests)
          if (relativePath.includes('/tests/')) continue
          // Match references in comments or strings that suggest active use
          if (/call\s+buildSystemPrompt|use\s+buildSystemPrompt|invoke\s+buildSystemPrompt/i.test(lines[i])) {
            violations.push({ file: relativePath, line: i + 1 })
          }
        }
      }

      if (violations.length > 0) {
        const formatted = violations.map((v) => `  - ${v.file}:${v.line}`).join('\n')
        throw new Error(
          `Found ${violations.length} file(s) referencing buildSystemPrompt as active usage:\n${formatted}\n` +
          `buildSystemPrompt() is removed. Use ModelInputBuilder.build() instead.`,
        )
      }

      expect(violations).toHaveLength(0)
    })
  })

  describe('Architecture Docs Alignment', () => {
    it('MODEL_INPUT_ARCHITECTURE.md documents four modes (not three)', () => {
      const filePath = join(rootDir, 'docs', 'architecture', 'MODEL_INPUT_ARCHITECTURE.md')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('Four Modes')
      expect(content).toContain('routing_tool_call')
      // Should NOT claim only three modes
      expect(content).not.toMatch(/## Three Modes/)
    })

    it('MODEL_INPUT_ARCHITECTURE.md documents B1/B2/B3 sub-sections', () => {
      const filePath = join(rootDir, 'docs', 'architecture', 'MODEL_INPUT_ARCHITECTURE.md')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('B1')
      expect(content).toContain('B2')
      expect(content).toContain('B3')
    })

    it('MODEL_INPUT_ARCHITECTURE.md documents T5/T6/T7 taxonomy layers', () => {
      const filePath = join(rootDir, 'docs', 'architecture', 'MODEL_INPUT_ARCHITECTURE.md')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('T5')
      expect(content).toContain('T6')
      expect(content).toContain('T7')
    })

    it('MODEL_INPUT_ARCHITECTURE.md documents top-level summaryLayers', () => {
      const filePath = join(rootDir, 'docs', 'architecture', 'MODEL_INPUT_ARCHITECTURE.md')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('summaryLayers')
      expect(content).toContain('top-level')
    })

    it('MODEL_INPUT_ARCHITECTURE.md uses agentType + agentProfile (not agentKind as canonical)', () => {
      const filePath = join(rootDir, 'docs', 'architecture', 'MODEL_INPUT_ARCHITECTURE.md')
      const content = readFileSync(filePath, 'utf-8')
      expect(content).toContain('agentType')
      expect(content).toContain('agentProfile')
    })
  })
})
