/**
 * Parses HTML to extract code blocks for React component rendering
 * 
 * This allows us to render code blocks as React components (CodeBlock)
 * while keeping the rest of the markdown as HTML.
 */

export interface CodeBlockSegment {
  type: 'html'
  html: string
}

export interface CodeSegment {
  type: 'code'
  code: string
  language: string | null
}

export type Segment = CodeBlockSegment | CodeSegment

/**
 * Extracts code blocks from HTML, replacing them with placeholders
 * Returns both the modified HTML and extracted code blocks
 */
export function parseCodeBlocks(html: string): Segment[] {
  const segments: Segment[] = []
  
  // Match <pre><code class="language-xxx">...</code></pre> or <pre><code>...</code></pre>
  const codeBlockRegex = /<pre><code(?:\s+class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g
  
  let lastIndex = 0
  let match
  
  while ((match = codeBlockRegex.exec(html)) !== null) {
    // Add HTML before this code block
    if (match.index > lastIndex) {
      const htmlBefore = html.slice(lastIndex, match.index)
      if (htmlBefore) {
        segments.push({ type: 'html', html: htmlBefore })
      }
    }
    
    // Extract language and code
    const language = match[1] || null
    const code = unescapeHtml(match[2])
    
    segments.push({ type: 'code', code, language })
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining HTML
  if (lastIndex < html.length) {
    const htmlAfter = html.slice(lastIndex)
    if (htmlAfter) {
      segments.push({ type: 'html', html: htmlAfter })
    }
  }
  
  // If no code blocks found, return the entire HTML as one segment
  if (segments.length === 0 && html) {
    segments.push({ type: 'html', html })
  }
  
  return segments
}

/**
 * Unescapes HTML entities to get raw code text
 * This ensures copy functionality gets the original code, not HTML-escaped version
 */
function unescapeHtml(html: string): string {
  const htmlEntities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#x27;': "'",
    '&#x2F;': '/',
  }
  
  return html.replace(/&[^;]+;/g, (entity) => {
    return htmlEntities[entity] || entity
  })
}
