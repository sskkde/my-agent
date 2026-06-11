import DOMPurify from 'dompurify'

/**
 * Sanitizes HTML content for safe display in Markdown contexts.
 * Uses DOMPurify as the final sanitizer to prevent XSS attacks.
 * 
 * @param html - The HTML string to sanitize
 * @returns Sanitized HTML string safe for rendering
 */
export function sanitizeMarkdown(html: string): string {
  // Configure DOMPurify for strict security with Markdown support
  const config = {
    // Allow common safe Markdown elements
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
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
    // Allow safe protocols
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  }
  
  return DOMPurify.sanitize(html, config)
}
