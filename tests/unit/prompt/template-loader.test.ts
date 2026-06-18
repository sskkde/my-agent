import { describe, it, expect, beforeEach } from 'vitest'
import { TemplateLoader, createTemplateLoader } from '../../../src/prompt/template-loader.js'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const TEMPLATES_PATH = join(__dirname, '..', '..', '..', 'src', 'prompt', 'templates')

describe('template-loader', () => {
  let loader: TemplateLoader

  beforeEach(() => {
    loader = new TemplateLoader(TEMPLATES_PATH)
  })

  describe('loadFromString', () => {
    it('replaces single placeholder', () => {
      const content = 'Hello {name}!'
      const result = loader.loadFromString(content, { name: 'World' })
      expect(result).toBe('Hello World!')
    })

    it('replaces multiple placeholders', () => {
      const content = '{greeting} {name}!'
      const result = loader.loadFromString(content, { greeting: 'Hello', name: 'World' })
      expect(result).toBe('Hello World!')
    })

    it('leaves unfilled placeholders unchanged', () => {
      const content = 'Hello {name} from {place}!'
      const result = loader.loadFromString(content, { name: 'World' })
      expect(result).toBe('Hello World from {place}!')
    })

    it('returns original content when no variables provided', () => {
      const content = 'Hello {name}!'
      const result = loader.loadFromString(content)
      expect(result).toBe(content)
    })

    it('returns original content when empty variables provided', () => {
      const content = 'Hello {name}!'
      const result = loader.loadFromString(content, {})
      expect(result).toBe(content)
    })

    it('handles content without placeholders', () => {
      const content = 'Hello World!'
      const result = loader.loadFromString(content, { name: 'Test' })
      expect(result).toBe(content)
    })

    it('replaces same placeholder multiple times', () => {
      const content = '{name} and {name} again'
      const result = loader.loadFromString(content, { name: 'Alice' })
      expect(result).toBe('Alice and Alice again')
    })
  })

  describe('loadSync', () => {
    it('loads platform:base template', () => {
      const content = loader.loadSync('platform:base')
      expect(content).toContain('# Platform Base Template')
    })

    it('loads provider:openai template', () => {
      const content = loader.loadSync('provider:openai')
      expect(content).toContain('# OpenAI Provider Template')
    })

    it('loads agents:foreground template', () => {
      const content = loader.loadSync('agents:foreground')
      expect(content).toContain('# Foreground Agent Template')
    })

    it('throws error for invalid template ID format', () => {
      expect(() => loader.loadSync('invalid')).toThrow('Invalid template ID format')
    })

    it('throws error for missing template', () => {
      expect(() => loader.loadSync('category:nonexistent')).toThrow()
    })

    it('replaces placeholders in loaded template', () => {
      const content = loader.loadSync('platform:base', {
        platformName: 'TestPlatform',
        platformVersion: '1.0.0',
        templateVersion: '2026-01-01',
        schemaVersion: 'v1',
      })
      expect(content).toContain('TestPlatform')
    })
  })

  describe('load (async)', () => {
    it('loads platform:base template asynchronously', async () => {
      const content = await loader.load('platform:base')
      expect(content).toContain('# Platform Base Template')
    })

    it('loads provider:deepseek template', async () => {
      const content = await loader.load('provider:deepseek')
      expect(content).toContain('# DeepSeek Provider Template')
    })

    it('throws error for invalid template ID format', async () => {
      await expect(loader.load('invalid')).rejects.toThrow('Invalid template ID format')
    })

    it('throws error for missing template', async () => {
      await expect(loader.load('category:nonexistent')).rejects.toThrow()
    })
  })

  describe('resolveTemplatePath', () => {
    it('resolves platform:base to correct path', () => {
      const path = loader.resolveTemplatePath('platform:base')
      expect(path).toContain('platform')
      expect(path).toContain('base.md')
    })

    it('resolves provider:openai to correct path', () => {
      const path = loader.resolveTemplatePath('provider:openai')
      expect(path).toContain('provider')
      expect(path).toContain('openai.md')
    })

    it('resolves agents:foreground to correct path', () => {
      const path = loader.resolveTemplatePath('agents:foreground')
      expect(path).toContain('agents')
      expect(path).toContain('foreground.md')
    })

  })

  describe('createTemplateLoader', () => {
    it('creates loader with default path', () => {
      const defaultLoader = createTemplateLoader()
      expect(defaultLoader).toBeInstanceOf(TemplateLoader)
    })

    it('creates loader with custom path', () => {
      const customLoader = createTemplateLoader('/custom/path')
      expect(customLoader).toBeInstanceOf(TemplateLoader)
    })
  })
})
