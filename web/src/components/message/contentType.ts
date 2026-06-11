/**
 * Content type detection helper for tool fallback rendering.
 * 
 * This module provides conservative content-type detection that prefers
 * `text/plain` when confidence is low. Explicit `metadata.contentType` wins
 * over sniffing.
 */

export interface ContentMetadata {
  contentType?: string
}

/**
 * Detects content type from string content with optional metadata override.
 * 
 * Priority:
 * 1. Explicit `metadata.contentType` wins over sniffing
 * 2. JSON detection (starts with `{` or `[` and parses successfully)
 * 3. Diff detection (`---`, `+++`, `@@` patterns)
 * 4. Shell output detection (`$`, `#` prompts, common commands)
 * 5. Markdown detection (headings, lists, code fences)
 * 6. Fallback to `text/plain`
 * 
 * @param content - The content string to analyze
 * @param metadata - Optional metadata with explicit contentType
 * @returns Detected content type (MIME type)
 */
export function detectContentType(
  content: string,
  metadata?: ContentMetadata | null
): string {
  // 1. Explicit metadata wins
  if (metadata?.contentType) {
    return metadata.contentType
  }

  // 2. Empty or whitespace-only content
  const trimmed = content.trim()
  if (!trimmed) {
    return 'text/plain'
  }

  // 3. JSON detection - check first before other patterns
  if (isJson(trimmed)) {
    return 'application/json'
  }

  // 4. Diff detection
  if (isDiff(trimmed)) {
    return 'text/x-diff'
  }

  // 5. Shell output detection
  if (isShell(trimmed)) {
    return 'text/x-shell'
  }

  // 6. Markdown detection
  if (isMarkdown(trimmed)) {
    return 'text/markdown'
  }

  // 7. Fallback to plain text
  return 'text/plain'
}

/**
 * Check if content is valid JSON.
 * Must start with `{` or `[` and parse successfully.
 */
function isJson(content: string): boolean {
  // Quick check: must start with { or [
  const firstChar = content[0]
  if (firstChar !== '{' && firstChar !== '[') {
    return false
  }

  // Try to parse as JSON
  try {
    JSON.parse(content)
    return true
  } catch {
    return false
  }
}

/**
 * Check if content is a unified diff.
 * Looks for patterns like `---`, `+++`, `@@` in diff format.
 */
function isDiff(content: string): boolean {
  const lines = content.split('\n')
  
  // Check for unified diff headers
  const hasDiffHeader = lines.some(line => 
    line.startsWith('diff --git ') || 
    line.startsWith('diff -')
  )
  
  if (hasDiffHeader) {
    return true
  }

  // Check for --- and +++ on consecutive lines (unified diff)
  let hasMinus = false
  let hasPlus = false
  let hasHunk = false
  
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      hasMinus = true
    } else if (line.startsWith('+++ ')) {
      hasPlus = true
    } else if (line.startsWith('@@ ')) {
      hasHunk = true
    }
  }

  if ((hasMinus && hasPlus && hasHunk) || (hasPlus && hasHunk)) {
    return true
  }

  return false
}

/**
 * Check if content is shell command output.
 * Detects $, # prompts and common command patterns.
 */
function isShell(content: string): boolean {
  const lines = content.split('\n')
  const firstLine = lines[0]

  const commonCommands = [
    'npm ',
    'yarn ',
    'pnpm ',
    'git ',
    'docker ',
    'kubectl ',
    'cargo ',
    'go ',
    'python ',
    'node ',
    'make ',
    'ls',
    'cd ',
    'cat ',
    'echo ',
    'mkdir ',
    'rm ',
    'cp ',
    'mv ',
    'apt-get ',
    'apt ',
    'sudo ',
    'chmod ',
    'chown ',
    'grep ',
    'find ',
    'awk ',
    'sed ',
    'curl ',
    'wget ',
    'tar ',
    'unzip ',
    'systemctl ',
    'service ',
  ]

  if (firstLine.startsWith('$ ')) {
    return true
  }

  if (firstLine.startsWith('# ')) {
    const afterPrompt = firstLine.slice(2).trim()
    if (commonCommands.some(cmd => afterPrompt.startsWith(cmd))) {
      return true
    }
  }

  if (commonCommands.some(cmd => firstLine.startsWith(cmd))) {
    return true
  }

  return false
}

/**
 * Check if content is Markdown.
 * Detects headings, lists, code fences, links, and emphasis.
 */
function isMarkdown(content: string): boolean {
  const lines = content.split('\n')

  // Check for ATX headings (# at start of line)
  if (lines.some(line => /^#{1,6}\s+\S/.test(line))) {
    return true
  }

  // Check for code fences
  if (content.includes('```') || content.includes('~~~')) {
    return true
  }

  // Check for list items (- or * at start of line)
  if (lines.some(line => /^[-*]\s+\S/.test(line))) {
    return true
  }

  // Check for numbered lists
  if (lines.some(line => /^\d+\.\s+\S/.test(line))) {
    return true
  }

  // Check for links [text](url)
  if (/\[[^\]]+\]\([^)]+\)/.test(content)) {
    return true
  }

  // Check for emphasis patterns (conservative: only if multiple occurrences)
  const boldCount = (content.match(/\*\*[^*]+\*\*/g) || []).length
  const italicCount = (content.match(/(?<!\*)\*[^*]+\*(?!\*)/g) || []).length
  
  if (boldCount >= 1 || italicCount >= 2) {
    return true
  }

  return false
}
