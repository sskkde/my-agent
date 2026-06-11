/**
 * Applies security policy to anchor tags in HTML content.
 * 
 * External links (https://, http://) receive target="_blank" and rel="noopener noreferrer".
 * Dangerous protocols (javascript:, vbscript:, data:text/html) are removed.
 * Internal/relative links are left unchanged.
 * 
 * @param html - The HTML string to process
 * @returns HTML string with link policy applied
 */
export function applyLinkPolicy(html: string): string {
  // If empty or no anchor tags, return as-is
  if (!html || !html.includes('<a ')) {
    return html
  }

  // Parse HTML in a temporary container
  const tempDiv = document.createElement('div')
  tempDiv.innerHTML = html

  // Find all anchor tags
  const links = tempDiv.querySelectorAll('a')
  
  links.forEach(link => {
    const href = link.getAttribute('href')
    
    // Remove dangerous protocols
    if (href && isDangerousProtocol(href)) {
      link.removeAttribute('href')
      return
    }
    
    // Skip if no href or not an external link
    if (!href || !isExternalLink(href)) {
      return
    }
    
    // Apply target="_blank" for external links
    link.setAttribute('target', '_blank')
    
    // Apply rel="noopener noreferrer" for security
    // Preserve existing rel values and add new ones
    const existingRel = link.getAttribute('rel') || ''
    const relValues = new Set(existingRel.split(/\s+/).filter(Boolean))
    relValues.add('noopener')
    relValues.add('noreferrer')
    link.setAttribute('rel', Array.from(relValues).join(' '))
  })

  return tempDiv.innerHTML
}

/**
 * Checks if a URL uses an external protocol (http:// or https://)
 */
function isExternalLink(href: string): boolean {
  const trimmed = href.trim().toLowerCase()
  return trimmed.startsWith('http://') || trimmed.startsWith('https://')
}

/**
 * Checks if a URL uses a dangerous protocol that should be removed
 */
function isDangerousProtocol(href: string): boolean {
  const trimmed = href.trim().toLowerCase()
  
  // Check for dangerous protocols
  const dangerousProtocols = [
    'javascript:',
    'vbscript:',
    'data:text/html'
  ]
  
  return dangerousProtocols.some(protocol => trimmed.startsWith(protocol))
}
