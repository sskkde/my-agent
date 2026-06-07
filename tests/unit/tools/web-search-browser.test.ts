import { describe, it, expect, vi } from 'vitest'
import { readFile } from 'fs/promises'
import { join } from 'path'

const FIXTURES_DIR = join(__dirname, '../../fixtures/web-search')

async function loadHtmlFixture(filename: string): Promise<string> {
  return readFile(join(FIXTURES_DIR, filename), 'utf-8')
}

describe('web-search-browser DuckDuckGo Playwright extractor', () => {
  describe('DOM extraction', () => {
    it('extracts results from DuckDuckGo success HTML', async () => {
      const html = await loadHtmlFixture('duckduckgo-browser-success.html')

      const { extractDuckDuckGoResults } = await import('../../../src/search/browser/duckduckgo-extractor.js')

      const result = extractDuckDuckGoResults(html)

      expect(result.success).toBe(true)
      if (result.success && result.results) {
        expect(result.results).toHaveLength(2)
        expect(result.results[0].title).toBe('SearXNG: A privacy-respecting metasearch engine')
        expect(result.results[0].url).toBe('https://searxng.org/docs/')
        expect(result.results[0].snippet).toContain('metasearch engine')
      }
    })

    it('detects blocked/CAPTCHA page', async () => {
      const html = await loadHtmlFixture('duckduckgo-browser-blocked.html')

      const { extractDuckDuckGoResults } = await import('../../../src/search/browser/duckduckgo-extractor.js')

      const result = extractDuckDuckGoResults(html)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('BROWSER_SEARCH_CAPTCHA')
    })

    it('handles malformed DuckDuckGo DOM', async () => {
      const html = await loadHtmlFixture('duckduckgo-browser-malformed.html')

      const { extractDuckDuckGoResults } = await import('../../../src/search/browser/duckduckgo-extractor.js')

      const result = extractDuckDuckGoResults(html)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('BROWSER_SEARCH_UNAVAILABLE')
    })
  })

  describe('Playwright resource cleanup', () => {
    it('closes browser context on success', async () => {
      const mockContext = {
        newPage: vi.fn().mockResolvedValue({
          goto: vi.fn().mockResolvedValue(undefined),
          content: vi.fn().mockResolvedValue(await loadHtmlFixture('duckduckgo-browser-success.html')),
          close: vi.fn().mockResolvedValue(undefined),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const { searchWithDuckDuckGoBrowser } = await import('../../../src/search/browser/duckduckgo-provider.js')

      await searchWithDuckDuckGoBrowser({
        query: 'test query',
        browser: mockBrowser as unknown as import('playwright').Browser,
        timeoutMs: 5000,
      })

      expect(mockContext.close).toHaveBeenCalled()
    })

    it('closes browser context on error', async () => {
      const mockPage = {
        goto: vi.fn().mockRejectedValue(new Error('Navigation failed')),
        content: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const { searchWithDuckDuckGoBrowser } = await import('../../../src/search/browser/duckduckgo-provider.js')

      await searchWithDuckDuckGoBrowser({
        query: 'test query',
        browser: mockBrowser as unknown as import('playwright').Browser,
        timeoutMs: 5000,
      })

      expect(mockContext.close).toHaveBeenCalled()
    })

    it('closes browser context on timeout', async () => {
      const mockPage = {
        goto: vi.fn().mockImplementation(
          () =>
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Timeout')), 100)
            }),
        ),
        content: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const { searchWithDuckDuckGoBrowser } = await import('../../../src/search/browser/duckduckgo-provider.js')

      await searchWithDuckDuckGoBrowser({
        query: 'test query',
        browser: mockBrowser as unknown as import('playwright').Browser,
        timeoutMs: 50,
      })

      expect(mockContext.close).toHaveBeenCalled()
    })

    it('closes browser context on CAPTCHA detection', async () => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        content: vi.fn().mockResolvedValue(await loadHtmlFixture('duckduckgo-browser-blocked.html')),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const { searchWithDuckDuckGoBrowser } = await import('../../../src/search/browser/duckduckgo-provider.js')

      const result = await searchWithDuckDuckGoBrowser({
        query: 'test query',
        browser: mockBrowser as unknown as import('playwright').Browser,
        timeoutMs: 5000,
      })

      expect(mockContext.close).toHaveBeenCalled()
      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('BROWSER_SEARCH_CAPTCHA')
    })
  })

  describe('Browser backend provider contract', () => {
    it('returns provider: duckduckgo-browser on success', async () => {
      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
        content: vi.fn().mockResolvedValue(await loadHtmlFixture('duckduckgo-browser-success.html')),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue(mockContext),
        close: vi.fn().mockResolvedValue(undefined),
      }

      const { searchWithDuckDuckGoBrowser } = await import('../../../src/search/browser/duckduckgo-provider.js')

      const result = await searchWithDuckDuckGoBrowser({
        query: 'test query',
        browser: mockBrowser as unknown as import('playwright').Browser,
        timeoutMs: 5000,
      })

      expect(result.success).toBe(true)
      expect(result.provider).toBe('duckduckgo-browser')
      expect(result.endpointHost).toBe('duckduckgo.com')
    })
  })
})
