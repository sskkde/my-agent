import type { BrowserSearchResult } from '../types.js';
import { extractDuckDuckGoResults } from './duckduckgo-extractor.js';
import type { Browser, BrowserContext, Page } from 'playwright';

interface DuckDuckGoBrowserSearchParams {
  query: string;
  browser?: Browser;
  timeoutMs?: number;
}

export async function searchWithDuckDuckGoBrowser(
  params: DuckDuckGoBrowserSearchParams
): Promise<BrowserSearchResult> {
  const { query, browser: injectedBrowser, timeoutMs = 10000 } = params;
  
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  
  try {
    if (!injectedBrowser) {
      return {
        success: false,
        errorCode: 'BROWSER_SEARCH_UNAVAILABLE',
      };
    }

    context = await injectedBrowser.newContext();
    page = await context.newPage();
    
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(query)}`;
    
    await page.goto(searchUrl, { timeout: timeoutMs });
    
    const html = await page.content();
    
    const result = extractDuckDuckGoResults(html);
    
    if (result.success && result.results) {
      return {
        success: true,
        results: result.results,
        provider: 'duckduckgo-browser',
        endpointHost: 'duckduckgo.com',
        query,
        total: result.results.length,
      };
    }
    
    return result;
  } catch {
    return {
      success: false,
      errorCode: 'BROWSER_SEARCH_UNAVAILABLE',
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
  }
}
