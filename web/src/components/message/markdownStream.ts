/**
 * Streaming Markdown repair utilities.
 *
 * During token-by-token streaming, the accumulated text often contains
 * incomplete Markdown constructs (unclosed code fences, incomplete links,
 * orphaned emphasis markers). Passing this directly to a Markdown parser
 * can produce broken or unsafe HTML.
 *
 * This module provides a conservative `repairIncompleteMarkdown` function
 * that patches only the minimal set of structural problems so the text
 * can be safely rendered at every streaming tick.
 *
 * IMPORTANT: This function does NOT sanitize HTML. DOMPurify must still
 * run as a separate final step.
 */

/**
 * Repairs incomplete Markdown constructs in streaming text so it can be
 * safely parsed and rendered without producing broken HTML.
 *
 * Handles:
 * - Unclosed fenced code blocks (``` ... → ``` ... ```)
 * - Incomplete links `[text](url` without closing `)`
 * - Unclosed bold markers (`**text` → `**text**`)
 * - Unclosed italic markers (`*text` → `*text*`)
 *
 * @param text - The raw streaming text accumulated so far
 * @returns Repaired text safe for Markdown parsing
 */
export function repairIncompleteMarkdown(text: string): string {
  if (!text) {
    return ''
  }

  let result = text

  // 1. Balance fenced code blocks
  result = balanceCodeFences(result)

  // 2. Neutralize incomplete links
  result = neutralizeIncompleteLinks(result)

  // 3. Close orphaned emphasis markers
  result = closeOrphanedEmphasis(result)

  return result
}

/**
 * Ensures fenced code blocks are balanced.
 *
 * Counts ``` occurrences. If the count is odd, appends a closing fence
 * so the Markdown parser doesn't consume the rest of the document as code.
 */
function balanceCodeFences(text: string): string {
  // Match all ``` fence markers (tilde fences ~~~ are less common, skip for now)
  const fenceMatches = text.match(/```/g)
  if (!fenceMatches || fenceMatches.length % 2 === 0) {
    return text // Balanced or no fences
  }

  // Odd count means the last fence is unclosed — append closing fence
  return text + '\n```'
}

/**
 * Neutralizes incomplete Markdown links to prevent broken anchors.
 *
 * Detects `[text](url` at the end of the string where the closing `)`
 * is missing. Escapes the opening `[` so the Markdown parser treats it
 * as literal text instead of attempting to create a link.
 */
function neutralizeIncompleteLinks(text: string): string {
  // Look for an incomplete link pattern at the end of the text:
  // [arbitrary text](some-url without closing )
  // We need to find the LAST `[` that has a `(` after it but no matching `)`
  //
  // Strategy: scan from the end looking for `]( ` pattern that isn't closed

  // Quick check: if there's no `[` or `(`, nothing to do
  if (!text.includes('[') || !text.includes('(')) {
    return text
  }

  // Find all markdown link patterns: [text](url)
  // We need to detect if the last one is incomplete
  // Pattern: [...]( where the ) is missing

  // Find the last `)` — everything after it could have an incomplete link
  let lastCloseParen = -1
  for (let j = text.length - 1; j >= 0; j--) {
    if (text[j] === ')') {
      lastCloseParen = j
      break
    }
  }

  // Search for `](` pattern after the last `)`
  const searchStart = lastCloseParen + 1
  const afterLastParen = text.slice(searchStart)

  // Check if there's a `](` in the portion after last `)`
  // which would indicate an incomplete link
  const bracketParenIdx = afterLastParen.lastIndexOf('](')
  if (bracketParenIdx >= 0) {
    // Found an incomplete link pattern
    const absoluteIdx = searchStart + bracketParenIdx
    // Escape the `[` before the `](` to neutralize the link
    // Find the matching `[` for this `]`
    const openBracketIdx = text.lastIndexOf('[', absoluteIdx)
    if (openBracketIdx >= 0) {
      return (
        text.slice(0, openBracketIdx) +
        '\\[' +
        text.slice(openBracketIdx + 1)
      )
    }
  }

  // Also check for `[text` at the very end without any `]` or `(`
  // This is a different pattern: user started typing `[OpenAI` but hasn't
  // gotten to `](` yet. This is generally safe — marked won't create a link.
  // But let's also check for `[text](` where `](` appears but `)` is missing
  // That's already handled above.

  return text
}

/**
 * Closes orphaned emphasis markers at the end of the text.
 *
 * If the text ends with an unclosed `**` or `*`, appends the matching
 * closer so the Markdown parser doesn't produce broken `<strong>` or `<em>`.
 */
function closeOrphanedEmphasis(text: string): string {
  // Count `**` pairs — if odd, append closing `**`
  const doubleStarMatches = text.match(/\*\*/g)
  if (doubleStarMatches && doubleStarMatches.length % 2 !== 0) {
    // Check if the last `**` is actually a bold opener
    // (could be `*` + `*` from italic markers adjacent)
    const lastDoubleStar = text.lastIndexOf('**')
    const afterLastDouble = text.slice(lastDoubleStar + 2)
    // If there's no closing `**` after the last opener, close it
    if (!afterLastDouble.includes('**')) {
      return text + '**'
    }
  }

  // Count single `*` not part of `**`
  // Remove all `**` first, then count remaining single `*`
  const withoutDouble = text.replace(/\*\*/g, '')
  const singleStarMatches = withoutDouble.match(/\*/g)
  if (singleStarMatches && singleStarMatches.length % 2 !== 0) {
    return text + '*'
  }

  return text
}
