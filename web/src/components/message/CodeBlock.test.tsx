import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CodeBlock } from './CodeBlock'

describe('CodeBlock', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  describe('language label display', () => {
    it('displays language label when language is provided', () => {
      render(<CodeBlock code="const x = 1" language="ts" />)
      
      expect(screen.getByText('ts')).toBeInTheDocument()
    })

    it('shows fallback "code" when language is empty string', () => {
      render(<CodeBlock code="some code" language="" />)
      
      expect(screen.getByText('code')).toBeInTheDocument()
    })

    it('does not show language label when language is undefined', () => {
      render(<CodeBlock code="some code" />)
      
      expect(screen.queryByTestId('code-language-label')).not.toBeInTheDocument()
    })

    it('does not show language label when language is null', () => {
      render(<CodeBlock code="some code" language={null as unknown as string} />)
      
      expect(screen.queryByTestId('code-language-label')).not.toBeInTheDocument()
    })
  })

  describe('code display', () => {
    it('renders the code text', () => {
      const code = 'function hello() { return "world"; }'
      render(<CodeBlock code={code} />)
      
      expect(screen.getByText(code, { exact: false })).toBeInTheDocument()
    })

    it('preserves whitespace in code', () => {
      const code = '  indented\n    code'
      render(<CodeBlock code={code} />)
      
      const codeElement = document.querySelector('.code-block__code')
      expect(codeElement?.textContent).toBe(code)
    })
  })

  describe('horizontal overflow for long lines', () => {
    it('applies horizontal overflow class for long single-line code', () => {
      const longLine = 'a'.repeat(500)
      render(<CodeBlock code={longLine} language="ts" />)
      
      const preElement = screen.getByRole('presentation')
      expect(preElement.className).toMatch(/overflow-x/)
    })
  })

  describe('copy functionality', () => {
    it('copies exact source text to clipboard when copy button clicked', async () => {
      const code = 'const exact = "code"'
      render(<CodeBlock code={code} language="ts" />)
      
      const copyButton = screen.getByRole('button', { name: /copy/i })
      fireEvent.click(copyButton)
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code)
    })

    it('copies code without any mutations or sanitization', async () => {
      const code = '<script>alert("xss")</script>'
      render(<CodeBlock code={code} />)
      
      const copyButton = screen.getByRole('button', { name: /copy/i })
      fireEvent.click(copyButton)
      
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code)
    })

    it('shows copied-state feedback after successful copy', async () => {
      render(<CodeBlock code="test code" language="ts" />)
      
      const copyButton = screen.getByRole('button', { name: /copy/i })
      fireEvent.click(copyButton)
      
      await waitFor(() => {
        expect(screen.getByText(/copied/i)).toBeInTheDocument()
      })
    })

    it('resets copied state after delay', async () => {
      vi.useFakeTimers()
      
      render(<CodeBlock code="test code" language="ts" />)
      
      const copyButton = screen.getByRole('button', { name: /copy/i })
      fireEvent.click(copyButton)
      
      await act(async () => {
        await Promise.resolve()
      })
      
      expect(screen.getByText(/copied/i)).toBeInTheDocument()
      
      await act(async () => {
        vi.advanceTimersByTime(2000)
      })
      
      expect(screen.queryByText(/copied/i)).not.toBeInTheDocument()
      
      vi.useRealTimers()
    })
  })

  describe('className prop', () => {
    it('applies custom className to wrapper', () => {
      render(<CodeBlock code="test" className="custom-class" />)
      
      const container = screen.getByTestId('code-block-container')
      expect(container).toHaveClass('custom-class')
    })
  })

  describe('accessibility', () => {
    it('has accessible label for code block', () => {
      render(<CodeBlock code="test code" language="ts" />)
      
      expect(screen.getByRole('presentation', { name: /code block/i })).toBeInTheDocument()
    })

    it('copy button has accessible label', () => {
      render(<CodeBlock code="test code" language="ts" />)
      
      expect(screen.getByRole('button', { name: /copy code/i })).toBeInTheDocument()
    })
  })
})
