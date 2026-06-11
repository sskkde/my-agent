import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { sanitizeMarkdown } from './markdownSanitize'
import { formatMessageContent } from '../timeline/formatMessageContent'
import { MarkdownContent } from './MarkdownContent'
import { PlainTextContent } from './PlainTextContent'
import { StreamingMarkdownContent } from './StreamingMarkdownContent'
import { ToolResultContent } from './ToolResultContent'
import { MessageContent } from './MessageContent'

/**
 * Cross-path security regression tests (Task 14)
 *
 * These tests verify that XSS vectors are blocked across ALL rendering paths:
 * - Assistant Markdown path (MarkdownContent / MessageContent assistant role)
 * - User plain text path (PlainTextContent / MessageContent user role)
 * - Streaming Markdown path (StreamingMarkdownContent)
 * - Tool result path (ToolResultContent)
 * - Markdown sanitizer direct path (sanitizeMarkdown)
 * - formatMessageContent legacy path (with [md] blocks and fullMarkdown)
 *
 * Vectors tested:
 * - <script> tags
 * - <img onerror> event handler
 * - javascript: protocol
 * - vbscript: protocol
 * - data:text/html protocol
 * - <iframe> tags
 * - <object>/<embed> tags
 * - Markdown image data URI (![](data:text/html,...))
 * - Event handler attributes (onclick, onload, etc.)
 */

// --- Shared malicious payloads ---

const XSS_VECTORS = {
  scriptTag: '<script>alert("XSS")</script>',
  imgOnError: '<img src=x onerror=alert(1)>',
  javascriptLink: '<a href="javascript:alert(1)">click</a>',
  vbscriptLink: '<a href="vbscript:msgbox(1)">click</a>',
  dataHtmlLink: '<a href="data:text/html,<script>alert(1)</script>">click</a>',
  iframeTag: '<iframe src="https://evil.com"></iframe>',
  objectTag: '<object data="malicious.swf"></object>',
  embedTag: '<embed src="malicious.swf">',
  onclickHandler: '<div onclick="alert(1)">click</div>',
  onloadHandler: '<body onload="alert(1)">',
  styleExpression: '<div style="background:url(javascript:alert(1))">x</div>',
}

const MARKDOWN_XSS_VECTORS = {
  javascriptMdLink: '[Click](javascript:alert(1))',
  vbscriptMdLink: '[Click](vbscript:msgbox(1))',
  dataHtmlMdLink: '[Click](data:text/html,<script>alert(1)</script>)',
  dataHtmlMdImage: '![img](data:text/html,<script>alert(1)</script>)',
  scriptInMd: '<script>alert(1)</script>',
  imgOnErrorInMd: '<img src=x onerror=alert(1)>',
  iframeInMd: '<iframe src="evil.com"></iframe>',
  objectInMd: '<object data="evil.swf"></object>',
  onclickInMd: '<div onclick="alert(1)">click</div>',
}

// --- Helper: assert no executable XSS in rendered container ---
function assertNoXSS(container: HTMLElement, label: string) {
  expect(container.querySelector('script'), `${label}: no <script> element`).toBeNull()
  expect(container.querySelector('iframe'), `${label}: no <iframe> element`).toBeNull()
  expect(container.querySelector('object'), `${label}: no <object> element`).toBeNull()
  expect(container.querySelector('embed'), `${label}: no <embed> element`).toBeNull()
}

// ========================================================================
// 1. sanitizeMarkdown direct path
// ========================================================================
describe('Security: sanitizeMarkdown direct path', () => {
  it('strips <script> tags', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.scriptTag)
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert')
  })

  it('strips <img onerror> event handler', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.imgOnError)
    expect(result).not.toContain('onerror')
  })

  it('removes javascript: protocol from href', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.javascriptLink)
    expect(result).not.toContain('javascript:')
  })

  it('removes vbscript: protocol from href', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.vbscriptLink)
    expect(result).not.toContain('vbscript:')
  })

  it('removes data:text/html protocol from href', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.dataHtmlLink)
    expect(result).not.toContain('data:text/html')
  })

  it('strips <iframe> tags', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.iframeTag)
    expect(result).not.toContain('<iframe')
  })

  it('strips <object> tags', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.objectTag)
    expect(result).not.toContain('<object')
  })

  it('strips <embed> tags', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.embedTag)
    expect(result).not.toContain('<embed')
  })

  it('strips onclick event handler', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.onclickHandler)
    expect(result).not.toContain('onclick')
  })

  it('strips onload event handler', () => {
    const result = sanitizeMarkdown(XSS_VECTORS.onloadHandler)
    expect(result).not.toContain('onload')
  })
})

// ========================================================================
// 2. formatMessageContent legacy path (with [md] blocks)
// ========================================================================
describe('Security: formatMessageContent with [md] blocks', () => {
  it('strips script tags inside [md] blocks', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.scriptInMd}[/md]`)
    expect(result).not.toContain('<script>')
  })

  it('strips img onerror inside [md] blocks', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.imgOnErrorInMd}[/md]`)
    expect(result).not.toContain('onerror')
  })

  it('removes javascript: from [md] link syntax', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.javascriptMdLink}[/md]`)
    expect(result).not.toContain('javascript:')
  })

  it('removes vbscript: from [md] link syntax', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.vbscriptMdLink}[/md]`)
    expect(result).not.toContain('vbscript:')
  })

  it('removes data:text/html from [md] link syntax', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.dataHtmlMdLink}[/md]`)
    expect(result).not.toContain('data:text/html')
  })

  it('strips iframe inside [md] blocks', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.iframeInMd}[/md]`)
    expect(result).not.toContain('<iframe')
  })

  it('strips object inside [md] blocks', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.objectInMd}[/md]`)
    expect(result).not.toContain('<object')
  })

  it('strips onclick inside [md] blocks', () => {
    const result = formatMessageContent(`[md]${MARKDOWN_XSS_VECTORS.onclickInMd}[/md]`)
    expect(result).not.toContain('onclick')
  })

  it('escapes script tags in plain text outside [md]', () => {
    const result = formatMessageContent(XSS_VECTORS.scriptTag)
    expect(result).not.toContain('<script>')
    expect(result).toContain('&lt;script&gt;')
  })

  it('escapes img onerror in plain text outside [md]', () => {
    const result = formatMessageContent(XSS_VECTORS.imgOnError)
    expect(result).not.toContain('<img')
    expect(result).toContain('&lt;img')
  })
})

// ========================================================================
// 3. formatMessageContent fullMarkdown path (assistant default)
// ========================================================================
describe('Security: formatMessageContent fullMarkdown path', () => {
  it('strips script tags in fullMarkdown mode', () => {
    const result = formatMessageContent(XSS_VECTORS.scriptTag, true)
    expect(result).not.toContain('<script>')
  })

  it('strips img onerror in fullMarkdown mode', () => {
    const result = formatMessageContent(XSS_VECTORS.imgOnError, true)
    expect(result).not.toContain('onerror')
  })

  it('removes javascript: links in fullMarkdown mode', () => {
    const result = formatMessageContent(MARKDOWN_XSS_VECTORS.javascriptMdLink, true)
    expect(result).not.toContain('javascript:')
  })

  it('removes vbscript: links in fullMarkdown mode', () => {
    const result = formatMessageContent(MARKDOWN_XSS_VECTORS.vbscriptMdLink, true)
    expect(result).not.toContain('vbscript:')
  })

  it('removes data:text/html links in fullMarkdown mode', () => {
    const result = formatMessageContent(MARKDOWN_XSS_VECTORS.dataHtmlMdLink, true)
    expect(result).not.toContain('data:text/html')
  })

  it('strips iframe in fullMarkdown mode', () => {
    const result = formatMessageContent(XSS_VECTORS.iframeTag, true)
    expect(result).not.toContain('<iframe')
  })

  it('strips object in fullMarkdown mode', () => {
    const result = formatMessageContent(XSS_VECTORS.objectTag, true)
    expect(result).not.toContain('<object')
  })

  it('strips embed in fullMarkdown mode', () => {
    const result = formatMessageContent(XSS_VECTORS.embedTag, true)
    expect(result).not.toContain('<embed')
  })

  it('strips onclick in fullMarkdown mode', () => {
    const result = formatMessageContent(XSS_VECTORS.onclickHandler, true)
    expect(result).not.toContain('onclick')
  })

  it('handles Markdown image data URI in fullMarkdown mode', () => {
    const result = formatMessageContent(MARKDOWN_XSS_VECTORS.dataHtmlMdImage, true)
    // img src with data:text/html is allowed by DOMPurify but content is encoded
    // The important thing is no <script> element can execute
    expect(result).not.toContain('<script>')
    // No img onerror handler is present
    expect(result).not.toContain('onerror=')
  })
})

// ========================================================================
// 4. MarkdownContent component (assistant render path)
// ========================================================================
describe('Security: MarkdownContent (assistant path)', () => {
  it('blocks script tags', () => {
    render(<MarkdownContent text={XSS_VECTORS.scriptTag} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('<script>')
  })

  it('blocks img onerror', () => {
    render(<MarkdownContent text={XSS_VECTORS.imgOnError} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('onerror')
  })

  it('blocks javascript: links', () => {
    render(<MarkdownContent text={MARKDOWN_XSS_VECTORS.javascriptMdLink} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('blocks vbscript: links', () => {
    render(<MarkdownContent text={MARKDOWN_XSS_VECTORS.vbscriptMdLink} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('vbscript:')
  })

  it('blocks data:text/html links', () => {
    render(<MarkdownContent text={MARKDOWN_XSS_VECTORS.dataHtmlMdLink} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('data:text/html')
  })

  it('blocks iframe tags', () => {
    render(<MarkdownContent text={XSS_VECTORS.iframeTag} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.innerHTML).not.toContain('<iframe')
  })

  it('blocks object tags', () => {
    render(<MarkdownContent text={XSS_VECTORS.objectTag} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('<object')
  })

  it('blocks embed tags', () => {
    render(<MarkdownContent text={XSS_VECTORS.embedTag} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('<embed')
  })

  it('blocks onclick handler', () => {
    render(<MarkdownContent text={XSS_VECTORS.onclickHandler} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('onclick')
  })

  it('blocks Markdown image data URI from executing script', () => {
    render(<MarkdownContent text={MARKDOWN_XSS_VECTORS.dataHtmlMdImage} fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror=')
  })
})

// ========================================================================
// 5. PlainTextContent component (user render path)
// ========================================================================
describe('Security: PlainTextContent (user path)', () => {
  it('renders script tag as escaped text', () => {
    render(<PlainTextContent text={XSS_VECTORS.scriptTag} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).toContain('&lt;script&gt;')
  })

  it('renders img onerror as escaped text', () => {
    render(<PlainTextContent text={XSS_VECTORS.imgOnError} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).toContain('&lt;img')
  })

  it('renders javascript: URL as plain text', () => {
    render(<PlainTextContent text="javascript:alert(1)" />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('javascript:alert(1)')
  })

  it('renders vbscript: URL as plain text', () => {
    render(<PlainTextContent text="vbscript:msgbox(1)" />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('vbscript:msgbox(1)')
  })

  it('renders data:text/html URL as plain text', () => {
    render(<PlainTextContent text="data:text/html,<script>alert(1)</script>" />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
  })

  it('renders iframe tag as escaped text', () => {
    render(<PlainTextContent text={XSS_VECTORS.iframeTag} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.innerHTML).toContain('&lt;iframe')
  })

  it('renders object tag as escaped text', () => {
    render(<PlainTextContent text={XSS_VECTORS.objectTag} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('object')).toBeNull()
    expect(container.innerHTML).toContain('&lt;object')
  })

  it('renders embed tag as escaped text', () => {
    render(<PlainTextContent text={XSS_VECTORS.embedTag} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('embed')).toBeNull()
    expect(container.innerHTML).toContain('&lt;embed')
  })

  it('renders onclick handler as escaped text', () => {
    render(<PlainTextContent text={XSS_VECTORS.onclickHandler} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.innerHTML).toContain('&lt;div')
  })

  it('renders style expression as escaped text', () => {
    render(<PlainTextContent text={XSS_VECTORS.styleExpression} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('div[style]')).toBeNull()
    expect(container.innerHTML).toContain('&lt;div')
  })
})

// ========================================================================
// 6. StreamingMarkdownContent component (streaming path)
// ========================================================================
describe('Security: StreamingMarkdownContent (streaming path)', () => {
  it('blocks script tags during streaming', () => {
    render(<StreamingMarkdownContent text={XSS_VECTORS.scriptTag} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    assertNoXSS(container, 'script tag')
    expect(container.innerHTML).not.toContain('<script>')
  })

  it('blocks img onerror during streaming (lightweight path)', () => {
    render(<StreamingMarkdownContent text={XSS_VECTORS.imgOnError} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    // Lightweight path escapes HTML as literal text; no actual img element is created
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).toContain('&lt;img')
  })

  it('blocks javascript: links during streaming (md path)', () => {
    render(<StreamingMarkdownContent text={`[md]${MARKDOWN_XSS_VECTORS.javascriptMdLink}[/md]`} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('blocks vbscript: links during streaming (md path)', () => {
    render(<StreamingMarkdownContent text={`[md]${MARKDOWN_XSS_VECTORS.vbscriptMdLink}[/md]`} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.innerHTML).not.toContain('vbscript:')
  })

  it('blocks data:text/html links during streaming (md path)', () => {
    render(<StreamingMarkdownContent text={`[md]${MARKDOWN_XSS_VECTORS.dataHtmlMdLink}[/md]`} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.innerHTML).not.toContain('data:text/html')
  })

  it('blocks iframe during streaming', () => {
    render(<StreamingMarkdownContent text={XSS_VECTORS.iframeTag} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    assertNoXSS(container, 'iframe')
    expect(container.innerHTML).not.toContain('<iframe')
  })

  it('blocks object during streaming', () => {
    render(<StreamingMarkdownContent text={XSS_VECTORS.objectTag} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.innerHTML).not.toContain('<object')
  })

  it('blocks embed during streaming', () => {
    render(<StreamingMarkdownContent text={XSS_VECTORS.embedTag} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.innerHTML).not.toContain('<embed')
  })

  it('blocks onclick during streaming (lightweight path)', () => {
    render(<StreamingMarkdownContent text={XSS_VECTORS.onclickHandler} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.querySelector('div[onclick]')).toBeNull()
    expect(container.innerHTML).toContain('&lt;div')
  })

  it('blocks Markdown image data URI during streaming (md path)', () => {
    render(<StreamingMarkdownContent text={`[md]${MARKDOWN_XSS_VECTORS.dataHtmlMdImage}[/md]`} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('onerror=')
  })

  it('blocks script tags when not streaming (static render)', () => {
    render(<StreamingMarkdownContent text={XSS_VECTORS.scriptTag} isStreaming={false} />)
    const container = screen.getByTestId('streaming-markdown-content')
    assertNoXSS(container, 'static script')
    expect(container.innerHTML).not.toContain('<script>')
  })

  it('blocks javascript: links when not streaming (md path)', () => {
    render(<StreamingMarkdownContent text={`[md]${MARKDOWN_XSS_VECTORS.javascriptMdLink}[/md]`} isStreaming={false} />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.innerHTML).not.toContain('javascript:')
  })
})

// ========================================================================
// 7. ToolResultContent component (tool result path)
// ========================================================================
describe('Security: ToolResultContent (tool result path)', () => {
  it('renders script tag as escaped text for unknown content', () => {
    render(<ToolResultContent content={XSS_VECTORS.scriptTag} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).toContain('&lt;script&gt;')
  })

  it('renders img onerror as escaped text for unknown content', () => {
    render(<ToolResultContent content={XSS_VECTORS.imgOnError} />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).toContain('&lt;img')
  })

  it('sanitizes javascript: links in explicit markdown tool content', () => {
    render(
      <ToolResultContent
        content={`[md]${MARKDOWN_XSS_VECTORS.javascriptMdLink}[/md]`}
        metadata={{ contentType: 'text/markdown' }}
      />
    )
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('sanitizes vbscript: links in explicit markdown tool content', () => {
    render(
      <ToolResultContent
        content={`[md]${MARKDOWN_XSS_VECTORS.vbscriptMdLink}[/md]`}
        metadata={{ contentType: 'text/markdown' }}
      />
    )
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('vbscript:')
  })

  it('sanitizes data:text/html links in explicit markdown tool content', () => {
    render(
      <ToolResultContent
        content={`[md]${MARKDOWN_XSS_VECTORS.dataHtmlMdLink}[/md]`}
        metadata={{ contentType: 'text/markdown' }}
      />
    )
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('data:text/html')
  })

  it('strips script tags in explicit markdown tool content', () => {
    render(
      <ToolResultContent
        content={MARKDOWN_XSS_VECTORS.scriptInMd}
        metadata={{ contentType: 'text/markdown' }}
      />
    )
    const container = screen.getByTestId('markdown-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('<script>')
  })

  it('strips img onerror in explicit markdown tool content', () => {
    render(
      <ToolResultContent
        content={`[md]${MARKDOWN_XSS_VECTORS.imgOnErrorInMd}[/md]`}
        metadata={{ contentType: 'text/markdown' }}
      />
    )
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('onerror=')
  })

  it('strips iframe in explicit markdown tool content', () => {
    render(
      <ToolResultContent
        content={MARKDOWN_XSS_VECTORS.iframeInMd}
        metadata={{ contentType: 'text/markdown' }}
      />
    )
    const container = screen.getByTestId('markdown-content')
    expect(container.innerHTML).not.toContain('<iframe')
  })

  it('does NOT render XSS as markdown when content type is auto-detected', () => {
    // Content that looks like markdown should fallback to plain text
    render(<ToolResultContent content="# Heading\n<script>alert(1)</script>" />)
    const container = screen.getByTestId('plaintext-content')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders script tag as escaped text for JSON content', () => {
    render(<ToolResultContent content='{"x": "<script>alert(1)</script>"}' />)
    const container = screen.getByTestId('json-block')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders script tag as escaped text for shell content', () => {
    render(<ToolResultContent content={'$ echo "<script>alert(1)</script>"'} />)
    const container = screen.getByTestId('code-block-container')
    expect(container.querySelector('script')).toBeNull()
  })
})

// ========================================================================
// 8. MessageContent role dispatcher (cross-role path)
// ========================================================================
describe('Security: MessageContent role dispatcher', () => {
  it('assistant role: blocks script tags via MarkdownContent', () => {
    render(<MessageContent text={XSS_VECTORS.scriptTag} role="assistant" mode="static" />)
    const container = screen.getByTestId('message-content-assistant')
    expect(container.querySelector('script')).toBeNull()
  })

  it('assistant role: blocks javascript: links via MarkdownContent', () => {
    render(<MessageContent text={MARKDOWN_XSS_VECTORS.javascriptMdLink} role="assistant" mode="static" />)
    const container = screen.getByTestId('message-content-assistant')
    expect(container.innerHTML).not.toContain('javascript:')
  })

  it('assistant role: blocks data:text/html via MarkdownContent', () => {
    render(<MessageContent text={MARKDOWN_XSS_VECTORS.dataHtmlMdLink} role="assistant" mode="static" />)
    const container = screen.getByTestId('message-content-assistant')
    expect(container.innerHTML).not.toContain('data:text/html')
  })

  it('assistant role: blocks iframe via MarkdownContent', () => {
    render(<MessageContent text={XSS_VECTORS.iframeTag} role="assistant" mode="static" />)
    const container = screen.getByTestId('message-content-assistant')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('assistant role: blocks img onerror via MarkdownContent', () => {
    render(<MessageContent text={XSS_VECTORS.imgOnError} role="assistant" mode="static" />)
    const container = screen.getByTestId('message-content-assistant')
    expect(container.innerHTML).not.toContain('onerror')
  })

  it('user role: renders script tag as escaped text via PlainTextContent', () => {
    render(<MessageContent text={XSS_VECTORS.scriptTag} role="user" mode="static" />)
    const container = screen.getByTestId('message-content-user')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).toContain('&lt;script&gt;')
  })

  it('user role: renders img onerror as escaped text', () => {
    render(<MessageContent text={XSS_VECTORS.imgOnError} role="user" mode="static" />)
    const container = screen.getByTestId('message-content-user')
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).toContain('&lt;img')
  })

  it('user role: renders javascript: URL as plain text', () => {
    render(<MessageContent text="javascript:alert(1)" role="user" mode="static" />)
    const container = screen.getByTestId('message-content-user')
    expect(container.querySelector('a')).toBeNull()
  })

  it('system role: renders script tag as escaped text via PlainTextContent', () => {
    render(<MessageContent text={XSS_VECTORS.scriptTag} role="system" mode="static" />)
    const container = screen.getByTestId('message-content-system')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).toContain('&lt;script&gt;')
  })

  it('error role: renders script tag as escaped text via PlainTextContent', () => {
    render(<MessageContent text={XSS_VECTORS.scriptTag} role="error" mode="static" />)
    const container = screen.getByTestId('message-content-error')
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).toContain('&lt;script&gt;')
  })

  it('assistant streaming mode: blocks script tags', () => {
    render(<MessageContent text={XSS_VECTORS.scriptTag} role="assistant" mode="streaming" />)
    const container = screen.getByTestId('message-content-assistant')
    expect(container.querySelector('script')).toBeNull()
  })

  it('assistant streaming mode: blocks javascript: links', () => {
    render(<MessageContent text={MARKDOWN_XSS_VECTORS.javascriptMdLink} role="assistant" mode="streaming" />)
    const container = screen.getByTestId('message-content-assistant')
    expect(container.innerHTML).not.toContain('javascript:')
  })
})

// ========================================================================
// 9. Sanitizer invariant: no bypass paths
// ========================================================================
describe('Security: sanitizer invariant - no bypass paths', () => {
  it('sanitizeMarkdown always strips script regardless of nesting', () => {
    const nested = '<div><span><b><script>alert(1)</script></b></span></div>'
    const result = sanitizeMarkdown(nested)
    expect(result).not.toContain('<script>')
  })

  it('formatMessageContent always strips script in [md] regardless of complexity', () => {
    const complex = '[md]# Title\n\nParagraph\n\n<script>document.cookie</script>\n\n- list[/md]'
    const result = formatMessageContent(complex)
    expect(result).not.toContain('<script>')
  })

  it('formatMessageContent fullMarkdown strips script regardless of content', () => {
    const complex = '# Legitimate Heading\n\nSome text.\n\n<script>steal()</script>\n\nMore text.'
    const result = formatMessageContent(complex, true)
    expect(result).not.toContain('<script>')
  })

  it('MarkdownContent strips script even with streaming cursor present', () => {
    render(<MarkdownContent text={XSS_VECTORS.scriptTag} isStreaming fullMarkdown />)
    const container = screen.getByTestId('markdown-content')
    expect(container.querySelector('script')).toBeNull()
    // Streaming cursor should still be present
    expect(container.querySelector('.streaming-cursor')).toBeTruthy()
  })

  it('StreamingMarkdownContent strips script even with incomplete markdown', () => {
    const payload = '```ts\nconst x = 1\n\n' + XSS_VECTORS.scriptTag
    render(<StreamingMarkdownContent text={payload} isStreaming />)
    const container = screen.getByTestId('streaming-markdown-content')
    expect(container.querySelector('script')).toBeNull()
  })

  it('ToolResultContent strips script even with explicit text/markdown type', () => {
    render(
      <ToolResultContent
        content={`Safe content\n\n${XSS_VECTORS.scriptTag}\n\nMore safe content`}
        metadata={{ contentType: 'text/markdown' }}
      />
    )
    const container = screen.getByTestId('markdown-content')
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('Safe content')
  })

  it('case-insensitive javascript: is blocked in sanitizeMarkdown', () => {
    const variants = [
      '<a href="JAVASCRIPT:alert(1)">x</a>',
      '<a href="JavaScript:alert(1)">x</a>',
      '<a href="JaVaScRiPt:alert(1)">x</a>',
    ]
    for (const variant of variants) {
      const result = sanitizeMarkdown(variant)
      expect(result).not.toContain('javascript:')
      expect(result).not.toContain('JAVASCRIPT:')
      expect(result).not.toContain('JavaScript:')
    }
  })

  it('case-insensitive vbscript: is blocked in sanitizeMarkdown', () => {
    const variants = [
      '<a href="VBSCRIPT:msgbox(1)">x</a>',
      '<a href="VbScript:msgbox(1)">x</a>',
    ]
    for (const variant of variants) {
      const result = sanitizeMarkdown(variant)
      expect(result).not.toContain('vbscript:')
      expect(result).not.toContain('VBSCRIPT:')
    }
  })

  it('multiple XSS payloads in single input are all stripped', () => {
    const multi = '[md]<script>one</script> <img src=x onerror=alert(2)> <iframe src="evil"></iframe>[/md]'
    const result = formatMessageContent(multi)
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('onerror')
    expect(result).not.toContain('<iframe')
  })

  it('XSS payload embedded in legitimate markdown is stripped', () => {
    const input = '[md]## Safe Heading\n\nSafe paragraph.\n\n<script>alert(1)</script>\n\n- Safe list item[/md]'
    const result = formatMessageContent(input)
    expect(result).not.toContain('<script>')
    expect(result).toContain('<h2>')
    expect(result).toContain('Safe Heading')
    expect(result).toContain('Safe list item')
  })
})
