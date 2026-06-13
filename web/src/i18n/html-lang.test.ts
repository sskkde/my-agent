/**
 * Static assertion test for HTML language metadata.
 * Verifies that web/index.html declares Chinese language (zh-CN).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('HTML language metadata', () => {
  it('should declare Chinese language (zh-CN) in index.html', () => {
    const htmlPath = resolve(__dirname, '../../index.html')
    const htmlContent = readFileSync(htmlPath, 'utf-8')
    
    // Check for lang="zh-CN" attribute on <html> element
    const langMatch = htmlContent.match(/<html\s+lang="([^"]+)"/)
    expect(langMatch).not.toBeNull()
    expect(langMatch![1]).toBe('zh-CN')
  })
})
