import { describe, it, expect } from 'vitest'
import { parseCodeBlocks } from './parseCodeBlocks'

describe('parseCodeBlocks', () => {
  it('should parse a single code block with language', () => {
    const html = '<pre><code class="language-typescript">const x = 1</code></pre>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      type: 'code',
      code: 'const x = 1',
      language: 'typescript',
    })
  })

  it('should parse a code block without language', () => {
    const html = '<pre><code>plain code</code></pre>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      type: 'code',
      code: 'plain code',
      language: null,
    })
  })

  it('should parse HTML before and after code block', () => {
    const html = '<p>Before</p><pre><code class="language-bash">echo test</code></pre><p>After</p>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({
      type: 'html',
      html: '<p>Before</p>',
    })
    expect(segments[1]).toEqual({
      type: 'code',
      code: 'echo test',
      language: 'bash',
    })
    expect(segments[2]).toEqual({
      type: 'html',
      html: '<p>After</p>',
    })
  })

  it('should unescape HTML entities in code', () => {
    const html = '<pre><code>const x = &lt;div&gt;&amp;&lt;/div&gt;</code></pre>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      type: 'code',
      code: 'const x = <div>&</div>',
      language: null,
    })
  })

  it('should handle multiple code blocks', () => {
    const html = '<pre><code class="language-ts">code1</code></pre><p>text</p><pre><code class="language-js">code2</code></pre>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(3)
    expect(segments[0]).toEqual({
      type: 'code',
      code: 'code1',
      language: 'ts',
    })
    expect(segments[1]).toEqual({
      type: 'html',
      html: '<p>text</p>',
    })
    expect(segments[2]).toEqual({
      type: 'code',
      code: 'code2',
      language: 'js',
    })
  })

  it('should handle empty HTML', () => {
    const segments = parseCodeBlocks('')
    expect(segments).toHaveLength(0)
  })

  it('should handle HTML with no code blocks', () => {
    const html = '<p>Just text</p>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      type: 'html',
      html: '<p>Just text</p>',
    })
  })

  it('should handle code block at start', () => {
    const html = '<pre><code>code</code></pre><p>after</p>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(2)
    expect(segments[0].type).toBe('code')
    expect(segments[1].type).toBe('html')
  })

  it('should handle code block at end', () => {
    const html = '<p>before</p><pre><code>code</code></pre>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(2)
    expect(segments[0].type).toBe('html')
    expect(segments[1].type).toBe('code')
  })

  it('should preserve newlines in code', () => {
    const html = '<pre><code>line1\nline2\nline3</code></pre>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      type: 'code',
      code: 'line1\nline2\nline3',
      language: null,
    })
  })

  it('should handle long single-line code', () => {
    const longCode = 'a'.repeat(500)
    const html = `<pre><code>${longCode}</code></pre>`
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      type: 'code',
      code: longCode,
      language: null,
    })
  })

  it('should handle special characters in language name', () => {
    const html = '<pre><code class="language-c++">int main()</code></pre>'
    const segments = parseCodeBlocks(html)
    
    expect(segments).toHaveLength(1)
    expect(segments[0]).toEqual({
      type: 'code',
      code: 'int main()',
      language: 'c++',
    })
  })

  it('should handle inline code (should not match)', () => {
    const html = '<p>This has <code>inline code</code> in it</p>'
    const segments = parseCodeBlocks(html)
    
    // Inline code should be treated as regular HTML
    expect(segments).toHaveLength(1)
    expect(segments[0].type).toBe('html')
  })
})
