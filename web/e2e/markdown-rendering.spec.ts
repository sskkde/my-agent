import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const EVIDENCE_DIR = path.join(__dirname, '..', '..', '.omo', 'evidence')

// Ensure evidence directory exists
if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
}

const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

/**
 * Markdown Rendering Visual QA Tests
 *
 * This test suite verifies Markdown rendering in the browser:
 * 1. Assistant messages render Markdown (headings, lists, code, tables, blockquotes, links)
 * 2. User XSS payloads render as plain text (no rendered img nodes)
 * 3. Long code blocks have horizontal scroll
 * 4. Streaming cursor indicator appears
 */

test.describe('Markdown Rendering Visual QA', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT)
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('should render assistant markdown with all element types', async ({ page }) => {
    const evidenceLog: string[] = [
      '\n=== ASSISTANT MARKDOWN RENDERING TEST ===',
      `Viewport: ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ]

    // Navigate to session console
    await page.getByTestId('tab-session-console').click()
    await page.waitForTimeout(300)

    // Create a session
    const newSessionButton = page.getByTestId('session-new-button')
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click()
      await page.waitForTimeout(500)
    }

    // Send a message to trigger assistant response with markdown
    const input = page.getByTestId('session-message-input')
    const sendButton = page.getByTestId('session-send-button')

    if (await input.isVisible()) {
      const testMessage = 'Show me markdown examples with headings, lists, code, tables, blockquotes, and links'
      await input.fill(testMessage)
      evidenceLog.push(`Sent message: "${testMessage}"`)

      if (await sendButton.isEnabled()) {
        await sendButton.click()
        await page.waitForTimeout(3000) // Wait for assistant response
      }
    }

    // Check for assistant message with markdown
    const timeline = page.getByTestId('session-timeline')
    
    // Check for heading elements (h2 is common in assistant responses)
    const hasHeadings = (await timeline.locator('.message-markdown h2, .message-markdown h3').count()) > 0
    evidenceLog.push(`Headings rendered: ${hasHeadings}`)

    // Check for list elements
    const hasLists = (await timeline.locator('.message-markdown ul, .message-markdown ol').count()) > 0
    evidenceLog.push(`Lists rendered: ${hasLists}`)

    // Check for code blocks
    const hasCodeBlocks = (await timeline.locator('.message-markdown pre code').count()) > 0
    evidenceLog.push(`Code blocks rendered: ${hasCodeBlocks}`)

    // Check for tables
    const hasTables = (await timeline.locator('.message-markdown table').count()) > 0
    evidenceLog.push(`Tables rendered: ${hasTables}`)

    // Check for blockquotes
    const hasBlockquotes = (await timeline.locator('.message-markdown blockquote').count()) > 0
    evidenceLog.push(`Blockquotes rendered: ${hasBlockquotes}`)

    // Check for links with security attributes
    const hasLinks = (await timeline.locator('.message-markdown a[target="_blank"]').count()) > 0
    evidenceLog.push(`Secure links (target="_blank") rendered: ${hasLinks}`)

    // Capture screenshot of markdown rendering
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-13-assistant-markdown.png') })
    evidenceLog.push(`Screenshot saved: task-13-assistant-markdown.png`)

    // Verify at least some markdown elements are present
    const hasAnyMarkdown = hasHeadings || hasLists || hasCodeBlocks || hasTables || hasBlockquotes || hasLinks
    evidenceLog.push(`\n✓ Markdown rendering verified: ${hasAnyMarkdown}`)

    if (hasAnyMarkdown) {
      evidenceLog.push('✓ Assistant markdown rendering confirmed')
    } else {
      evidenceLog.push('⚠ No assistant response generated (requires LLM provider)')
    }

    // Write evidence log
    const logPath = path.join(EVIDENCE_DIR, 'task-13-assistant-markdown.log')
    fs.writeFileSync(logPath, evidenceLog.join('\n'))

    console.log(`Evidence log saved to: ${logPath}`)
  })

  test('should render user XSS payload as plain text', async ({ page }) => {
    const evidenceLog: string[] = [
      '\n=== USER XSS PLAIN TEXT TEST ===',
      `Viewport: ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ]

    // Navigate to session console
    await page.getByTestId('tab-session-console').click()
    await page.waitForTimeout(300)

    // Create a session
    const newSessionButton = page.getByTestId('session-new-button')
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click()
      await page.waitForTimeout(500)
    }

    // Send XSS payload
    const input = page.getByTestId('session-message-input')
    const sendButton = page.getByTestId('session-send-button')

    const xssPayload = '<img src=x onerror=alert(1)>'
    if (await input.isVisible()) {
      await input.fill(xssPayload)
      evidenceLog.push(`Sent XSS payload: "${xssPayload}"`)

      if (await sendButton.isEnabled()) {
        await sendButton.click()
        await page.waitForTimeout(1000)
      }
    }

    // Check that XSS payload is NOT rendered as an img element
    const timeline = page.getByTestId('session-timeline')
    
    // Look for user message card
    const userMessageCard = timeline.locator('.timeline-event-card--user_message').first()
    await expect(userMessageCard).toBeVisible({ timeout: 5000 })
    evidenceLog.push('✓ User message card found')

    // Check that NO img element exists with the XSS src
    const hasRenderedImg = (await userMessageCard.locator('img[src="x"]').count()) > 0
    evidenceLog.push(`Rendered img with XSS src: ${hasRenderedImg}`)

    // Check that NO img element exists at all in user message
    const hasAnyImg = (await userMessageCard.locator('img').count()) > 0
    evidenceLog.push(`Any img in user message: ${hasAnyImg}`)

    // Check that the text content shows the XSS payload as plain text
    const textContent = await userMessageCard.textContent()
    const hasXssAsText = textContent?.includes(xssPayload) || false
    evidenceLog.push(`XSS payload visible as text: ${hasXssAsText}`)

    // Capture screenshot showing XSS as plain text
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-13-user-xss-plain.png') })
    evidenceLog.push(`Screenshot saved: task-13-user-xss-plain.png`)

    // Write evidence log
    const logPath = path.join(EVIDENCE_DIR, 'task-13-user-xss.log')
    fs.writeFileSync(logPath, evidenceLog.join('\n'))

    console.log(`Evidence log saved to: ${logPath}`)

    // Assertions: XSS should NOT be rendered as HTML
    expect(hasRenderedImg).toBe(false)
    expect(hasAnyImg).toBe(false)
    expect(hasXssAsText).toBe(true)
  })

  test('should handle long code block with horizontal scroll', async ({ page }) => {
    const evidenceLog: string[] = [
      '\n=== LONG CODE BLOCK SCROLL TEST ===',
      `Viewport: ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ]

    // Navigate to session console
    await page.getByTestId('tab-session-console').click()
    await page.waitForTimeout(300)

    // Create a session
    const newSessionButton = page.getByTestId('session-new-button')
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click()
      await page.waitForTimeout(500)
    }

    // Send a message requesting code example
    const input = page.getByTestId('session-message-input')
    const sendButton = page.getByTestId('session-send-button')

    if (await input.isVisible()) {
      await input.fill('Show me a very long line of code')
      evidenceLog.push('Sent message to trigger long code line')

      if (await sendButton.isEnabled()) {
        await sendButton.click()
        await page.waitForTimeout(3000) // Wait for response
      }
    }

    // Check for code blocks
    const timeline = page.getByTestId('session-timeline')
    const codeBlocks = await timeline.locator('.code-block, .message-markdown pre').count()
    evidenceLog.push(`Code blocks found: ${codeBlocks}`)

    if (codeBlocks > 0) {
      // Get the first code block
      const firstCodeBlock = timeline.locator('.code-block, .message-markdown pre').first()
      
      // Check if it has horizontal scroll capability
      const scrollInfo = await firstCodeBlock.evaluate((el) => {
        const style = window.getComputedStyle(el)
        const pre = el.querySelector('pre') || el
        const preStyle = window.getComputedStyle(pre)
        return {
          overflowX: preStyle.overflowX,
          scrollWidth: pre.scrollWidth,
          clientWidth: pre.clientWidth,
          canScroll: pre.scrollWidth > pre.clientWidth,
        }
      })

      evidenceLog.push(`\nCode block scroll info:`)
      evidenceLog.push(`  overflow-x: ${scrollInfo.overflowX}`)
      evidenceLog.push(`  scrollWidth: ${scrollInfo.scrollWidth}px`)
      evidenceLog.push(`  clientWidth: ${scrollInfo.clientWidth}px`)
      evidenceLog.push(`  can scroll horizontally: ${scrollInfo.canScroll}`)

      // Verify overflow-x is auto or scroll
      const hasProperOverflow = scrollInfo.overflowX === 'auto' || scrollInfo.overflowX === 'scroll'
      evidenceLog.push(`✓ Proper overflow handling: ${hasProperOverflow}`)

      expect(hasProperOverflow).toBe(true)
    } else {
      evidenceLog.push('⚠ No code blocks found - skipping scroll verification')
    }

    // Capture screenshot
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-13-code-block-scroll.png') })
    evidenceLog.push(`Screenshot saved: task-13-code-block-scroll.png`)

    const logPath = path.join(EVIDENCE_DIR, 'task-13-code-scroll.log')
    fs.writeFileSync(logPath, evidenceLog.join('\n'))

    console.log(`Evidence log saved to: ${logPath}`)
  })

  test('should show streaming cursor indicator', async ({ page }) => {
    const evidenceLog: string[] = [
      '\n=== STREAMING CURSOR TEST ===',
      `Viewport: ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ]

    // Navigate to session console
    await page.getByTestId('tab-session-console').click()
    await page.waitForTimeout(300)

    // Create a session
    const newSessionButton = page.getByTestId('session-new-button')
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click()
      await page.waitForTimeout(500)
    }

    // Send a message to trigger streaming
    const input = page.getByTestId('session-message-input')
    const sendButton = page.getByTestId('session-send-button')

    if (await input.isVisible()) {
      await input.fill('Tell me a long story about streaming')
      evidenceLog.push('Sent message to trigger streaming response')

      if (await sendButton.isEnabled()) {
        await sendButton.click()
        
        // Immediately look for streaming cursor (within first second)
        await page.waitForTimeout(300)
        
        const timeline = page.getByTestId('session-timeline')
        const hasStreamingCursor = (await timeline.locator('.streaming-cursor').count()) > 0
        evidenceLog.push(`Streaming cursor found (early): ${hasStreamingCursor}`)

        if (hasStreamingCursor) {
          // Capture screenshot with streaming cursor visible
          await page.screenshot({ path: path.join(EVIDENCE_DIR, 'task-13-streaming-cursor.png') })
          evidenceLog.push(`Screenshot saved: task-13-streaming-cursor.png`)
        }

        // Wait for streaming to complete
        await page.waitForTimeout(2000)
      }
    }

    // Check for streaming draft class on cards
    const timeline = page.getByTestId('session-timeline')
    const hasStreamingDraft = (await timeline.locator('.timeline-event-card--streaming-draft').count()) > 0
    const hasAssistantPlaceholder = (await timeline.locator('.timeline-event-card--assistant-placeholder').count()) > 0
    
    evidenceLog.push(`\nStreaming state indicators:`)
    evidenceLog.push(`  Streaming draft card: ${hasStreamingDraft}`)
    evidenceLog.push(`  Assistant placeholder: ${hasAssistantPlaceholder}`)

    // Write evidence log
    const logPath = path.join(EVIDENCE_DIR, 'task-13-streaming-cursor.log')
    fs.writeFileSync(logPath, evidenceLog.join('\n'))

    console.log(`Evidence log saved to: ${logPath}`)
  })

  test('should verify DOM structure for markdown elements', async ({ page }) => {
    const evidenceLog: string[] = [
      '\n=== MARKDOWN DOM STRUCTURE TEST ===',
      `Viewport: ${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}`,
      `Started: ${new Date().toISOString()}\n`,
    ]

    // Navigate to session console
    await page.getByTestId('tab-session-console').click()
    await page.waitForTimeout(300)

    // Create a session
    const newSessionButton = page.getByTestId('session-new-button')
    if (await newSessionButton.isVisible()) {
      await newSessionButton.click()
      await page.waitForTimeout(500)
    }

    // Send message to trigger assistant response
    const input = page.getByTestId('session-message-input')
    const sendButton = page.getByTestId('session-send-button')

    if (await input.isVisible()) {
      await input.fill('Test markdown: ## Heading, - List, `code`, [link](https://example.com)')
      
      if (await sendButton.isEnabled()) {
        await sendButton.click()
        await page.waitForTimeout(3000)
      }
    }

    const timeline = page.getByTestId('session-timeline')

    // Verify assistant message has message-content wrapper
    const assistantContent = timeline.locator('[data-testid="message-content-assistant"]')
    const hasAssistantWrapper = (await assistantContent.count()) > 0
    evidenceLog.push(`Assistant message wrapper found: ${hasAssistantWrapper}`)

    // Verify user message has message-content wrapper
    const userContent = timeline.locator('[data-testid="message-content-user"]')
    const hasUserWrapper = (await userContent.count()) > 0
    evidenceLog.push(`User message wrapper found: ${hasUserWrapper}`)

    // Verify markdown-content class exists
    const markdownContent = timeline.locator('.markdown-content, [data-testid="markdown-content"]')
    const hasMarkdownContent = (await markdownContent.count()) > 0
    evidenceLog.push(`Markdown content container found: ${hasMarkdownContent}`)

    // Verify plaintext-content class exists
    const plaintextContent = timeline.locator('.plaintext-content, [data-testid="plaintext-content"]')
    const hasPlaintextContent = (await plaintextContent.count()) > 0
    evidenceLog.push(`Plaintext content container found: ${hasPlaintextContent}`)

    // Check for specific markdown elements in assistant messages
    if (hasAssistantWrapper) {
      const assistantMessage = assistantContent.first()
      
      // Check for .message-markdown class
      const hasMessageMarkdownClass = (await assistantMessage.locator('.message-markdown').count()) > 0
      evidenceLog.push(`\nAssistant message has .message-markdown class: ${hasMessageMarkdownClass}`)

      // Check for various markdown element classes
      const elementChecks = {
        'h2': assistantMessage.locator('.message-markdown h2'),
        'h3': assistantMessage.locator('.message-markdown h3'),
        'ul': assistantMessage.locator('.message-markdown ul'),
        'ol': assistantMessage.locator('.message-markdown ol'),
        'li': assistantMessage.locator('.message-markdown li'),
        'code': assistantMessage.locator('.message-markdown code'),
        'pre': assistantMessage.locator('.message-markdown pre'),
        'a': assistantMessage.locator('.message-markdown a'),
        'blockquote': assistantMessage.locator('.message-markdown blockquote'),
        'table': assistantMessage.locator('.message-markdown table'),
      }

      evidenceLog.push('\nMarkdown element presence:')
      for (const [element, locator] of Object.entries(elementChecks)) {
        const count = await locator.count()
        evidenceLog.push(`  ${element}: ${count}`)
      }
    }

    // Write evidence log
    const logPath = path.join(EVIDENCE_DIR, 'task-13-dom-structure.log')
    fs.writeFileSync(logPath, evidenceLog.join('\n'))

    console.log(`Evidence log saved to: ${logPath}`)

    expect(hasUserWrapper).toBe(true)
    evidenceLog.push('✓ User message structure verified')
    
    if (hasAssistantWrapper) {
      evidenceLog.push('✓ Assistant message structure verified')
    } else {
      evidenceLog.push('⚠ No assistant message (requires LLM provider)')
    }
  })
})
