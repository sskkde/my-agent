import type { BrowserSearchResult, WebSearchResultItem } from '../types.js'

export function extractDuckDuckGoResults(html: string): BrowserSearchResult {
  if (isCaptchaOrBlocked(html)) {
    return {
      success: false,
      errorCode: 'BROWSER_SEARCH_CAPTCHA',
    }
  }

  const results = parseResultsFromHtml(html)

  if (results.length === 0) {
    return {
      success: false,
      errorCode: 'BROWSER_SEARCH_UNAVAILABLE',
    }
  }

  return {
    success: true,
    results,
    provider: 'duckduckgo-browser',
    endpointHost: 'duckduckgo.com',
  }
}

function isCaptchaOrBlocked(html: string): boolean {
  const captchaIndicators = [
    'captcha',
    'CAPTCHA',
    'Are you a human',
    'unusual traffic',
    'blocked',
    'verify you are human',
  ]

  const lowerHtml = html.toLowerCase()
  return captchaIndicators.some((indicator) => lowerHtml.includes(indicator.toLowerCase()))
}

function parseResultsFromHtml(html: string): WebSearchResultItem[] {
  const results: WebSearchResultItem[] = []

  const resultsContainerMatch = html.match(/<div[^>]*class="results"[^>]*id="links"[^>]*>([\s\S]*?)<\/div>\s*<\/body>/i)
  if (!resultsContainerMatch) {
    return []
  }

  const resultsContainer = resultsContainerMatch[1]
  const articleRegex = /<article[^>]*class="result"[^>]*>([\s\S]*?)<\/article>/gi

  let articleMatch
  while ((articleMatch = articleRegex.exec(resultsContainer)) !== null) {
    const article = articleMatch[1]

    const titleMatch = article.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/i)
    const snippetMatch = article.match(/<p[^>]*class="result__snippet"[^>]*>([^<]*)<\/p>/i)

    if (titleMatch) {
      const url = titleMatch[1]
      const title = titleMatch[2].trim()
      const snippet = snippetMatch ? snippetMatch[1].trim() : ''

      results.push({ title, url, snippet })
    }
  }

  return results
}
