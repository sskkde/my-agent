import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * Formats message content with lightweight formatting outside [md] blocks
 * and full Markdown inside [md] blocks, with XSS protection.
 * 
 * @param content - The message content to format
 * @param fullMarkdown - If true, parse entire content as markdown (strips [md] tags if present)
 * @returns Sanitized HTML string
 */
export function formatMessageContent(content: string | null | undefined, fullMarkdown = false): string {
  // Handle null/undefined/empty
  if (!content) {
    return ''
  }

  // If fullMarkdown mode, parse entire content as markdown
  if (fullMarkdown) {
    // Strip any [md] and [/md] tags for backward compatibility
    const strippedContent = content.replace(/\[\/?md\]/g, '')
    return sanitizeHtml(processMarkdownBlock(strippedContent))
  }

  // Split content by [md]...[/md] tags
  const parts = splitByMarkdownTags(content)
  
  // Process each part
  const processedParts = parts.map(part => {
    if (part.isMarkdownBlock) {
      // Full Markdown parsing for [md] blocks
      return processMarkdownBlock(part.text)
    } else {
      // Lightweight formatting for plain text
      return processLightweightFormat(part.text)
    }
  })
  
  // Combine all parts
  const combined = processedParts.join('')
  
  // Final sanitization with DOMPurify
  return sanitizeHtml(combined)
}

/**
 * Represents a segment of content
 */
interface ContentPart {
  text: string
  isMarkdownBlock: boolean
}

/**
 * Splits content by [md]...[/md] tags
 */
function splitByMarkdownTags(content: string): ContentPart[] {
  const parts: ContentPart[] = []
  const regex = /\[md\]([\s\S]*?)\[\/md\]/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(content)) !== null) {
    // Add plain text before this match
    if (match.index > lastIndex) {
      parts.push({
        text: content.slice(lastIndex, match.index),
        isMarkdownBlock: false
      })
    }
    
    // Add the markdown block (without tags)
    parts.push({
      text: match[1],
      isMarkdownBlock: true
    })
    
    lastIndex = match.index + match[0].length
  }
  
  // Add remaining plain text
  if (lastIndex < content.length) {
    parts.push({
      text: content.slice(lastIndex),
      isMarkdownBlock: false
    })
  }
  
  // Handle unclosed [md] tag - treat as markdown
  if (parts.length === 0 && content.includes('[md]')) {
    // Check for unclosed [md] tag
    const mdIndex = content.indexOf('[md]')
    if (mdIndex >= 0 && !content.includes('[/md]')) {
      // Content after [md] should be treated as markdown
      if (mdIndex > 0) {
        parts.push({
          text: content.slice(0, mdIndex),
          isMarkdownBlock: false
        })
      }
      parts.push({
        text: content.slice(mdIndex + 4), // Remove [md] tag
        isMarkdownBlock: true
      })
    } else {
      // No [md] tags at all
      parts.push({
        text: content,
        isMarkdownBlock: false
      })
    }
  } else if (parts.length === 0) {
    // No [md] tags at all
    parts.push({
      text: content,
      isMarkdownBlock: false
    })
  }
  
  return parts
}

/**
 * Processes a Markdown block with full features
 */
function processMarkdownBlock(text: string): string {
  // Configure marked for security
  marked.setOptions({
    gfm: true,
    breaks: true
  })
  
  try {
    return marked.parse(text) as string
  } catch (error) {
    // If parsing fails, return escaped text
    return escapeHtml(text)
  }
}

/**
 * Processes plain text with lightweight formatting
 * Only supports: **bold**, *italic*, _italic_, and line breaks
 */
function processLightweightFormat(text: string): string {
  // First escape HTML to prevent XSS
  let processed = escapeHtml(text)
  
  // Apply bold formatting: **text**
  processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  
  // Apply italic formatting: *text* or _text_
  // Need to be careful not to match ** as italic
  processed = processed.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
  processed = processed.replace(/_(.+?)_/g, '<em>$1</em>')
  
  // Convert line breaks to <br>
  processed = processed.replace(/\n/g, '<br>')
  
  return processed
}

/**
 * Escapes HTML entities
 */
function escapeHtml(text: string): string {
  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;'
  }
  
  return text.replace(/[&<>"'/]/g, char => htmlEntities[char] || char)
}

/**
 * Sanitizes HTML with DOMPurify to prevent XSS
 */
function sanitizeHtml(html: string): string {
  // Configure DOMPurify for strict security
  const config = {
    // Allow common safe tags
    ALLOWED_TAGS: [
      // Text formatting
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins',
      // Headings
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      // Lists
      'ul', 'ol', 'li',
      // Code
      'code', 'pre',
      // Links and images
      'a', 'img',
      // Blockquotes
      'blockquote',
      // Horizontal rule
      'hr',
      // Div and span for structure
      'div', 'span',
      // Table elements
      'table', 'thead', 'tbody', 'tr', 'th', 'td'
    ],
    ALLOWED_ATTR: [
      // Links
      'href', 'title', 'target', 'rel',
      // Images
      'src', 'alt', 'width', 'height',
      // Code blocks
      'class',
      // General
      'id'
    ],
    // Additional security options
    ALLOW_DATA_ATTR: false,
    // Remove all JavaScript-related attributes
    FORBID_ATTR: [
      'onclick', 'onerror', 'onload', 'onmouseover', 'onfocus', 'onblur',
      'onsubmit', 'onreset', 'onchange', 'oninput', 'onkeydown', 'onkeyup',
      'onkeypress', 'ondrag', 'ondrop', 'onscroll', 'onwheel'
    ],
    // Remove dangerous tags
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button']
  }
  
  return DOMPurify.sanitize(html, config)
}
