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
})
