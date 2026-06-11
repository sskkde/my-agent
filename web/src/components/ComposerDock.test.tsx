import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import ComposerDock from './ComposerDock'

describe('ComposerDock', () => {
  const mockOnChange = vi.fn()
  const mockOnSend = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // =============================================================================
  // Structure Tests (Round 1)
  // =============================================================================

  describe('Structure', () => {
    it('has data-testid="session-message-input" on textarea', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
      expect(screen.getByTestId('session-message-input').tagName).toBe('TEXTAREA')
    })

    it('has data-testid="session-send-button" on send button', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByTestId('session-send-button')).toBeInTheDocument()
    })

    it('displays placeholder text', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} placeholder="Type a message..." />)

      expect(screen.getByPlaceholderText('Type a message...')).toBeInTheDocument()
    })

    it('displays default placeholder when not specified', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByPlaceholderText('输入消息...')).toBeInTheDocument()
    })

    it('renders with custom className', () => {
      const { container } = render(
        <ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} className="custom-dock" />,
      )

      expect(container.querySelector('.custom-dock')).toBeInTheDocument()
    })

    it('renders an empty toolbar slot for future composer actions', () => {
      const { container } = render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(container.querySelector('.composer-toolbar')).toBeInTheDocument()
    })

    it('renders the composer as a dock container for bottom anchoring styles', () => {
      const { container } = render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(container.firstElementChild).toHaveClass('composer-dock')
    })
  })

  // =============================================================================
  // Send Behavior Tests
  // =============================================================================

  describe('Send Behavior', () => {
    it('calls onSend when send button is clicked with valid message', () => {
      render(<ComposerDock value="Hello world" onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.click(screen.getByTestId('session-send-button'))
      expect(mockOnSend).toHaveBeenCalledTimes(1)
    })

    it('calls onSend when Enter key is pressed with valid message', () => {
      render(<ComposerDock value="Hello world" onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.keyDown(screen.getByTestId('session-message-input'), {
        key: 'Enter',
        shiftKey: false,
      })
      expect(mockOnSend).toHaveBeenCalledTimes(1)
    })

    it('does not call onSend when Shift+Enter is pressed', () => {
      render(<ComposerDock value="Hello world" onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.keyDown(screen.getByTestId('session-message-input'), {
        key: 'Enter',
        shiftKey: true,
      })
      expect(mockOnSend).not.toHaveBeenCalled()
    })

    it('does not call onSend when sending is in progress', () => {
      render(<ComposerDock value="Hello world" onChange={mockOnChange} onSend={mockOnSend} sending={true} />)

      fireEvent.click(screen.getByTestId('session-send-button'))
      expect(mockOnSend).not.toHaveBeenCalled()
    })
  })

  // =============================================================================
  // Empty/Whitespace Blocking Tests
  // =============================================================================

  describe('Empty/Whitespace Blocking', () => {
    it('disables send button when value is empty', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByTestId('session-send-button')).toBeDisabled()
    })

    it('disables send button when value is whitespace only', () => {
      render(<ComposerDock value="   " onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByTestId('session-send-button')).toBeDisabled()
    })

    it('does not call onSend when clicking send with empty value', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.click(screen.getByTestId('session-send-button'))
      expect(mockOnSend).not.toHaveBeenCalled()
    })

    it('does not call onSend when clicking send with whitespace only', () => {
      render(<ComposerDock value="   " onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.click(screen.getByTestId('session-send-button'))
      expect(mockOnSend).not.toHaveBeenCalled()
    })

    it('does not call onSend when pressing Enter with empty value', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.keyDown(screen.getByTestId('session-message-input'), {
        key: 'Enter',
      })
      expect(mockOnSend).not.toHaveBeenCalled()
    })

    it('does not call onSend when pressing Enter with whitespace only', () => {
      render(<ComposerDock value="   " onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.keyDown(screen.getByTestId('session-message-input'), {
        key: 'Enter',
      })
      expect(mockOnSend).not.toHaveBeenCalled()
    })
  })

  // =============================================================================
  // Input Change Tests
  // =============================================================================

  describe('Input Change', () => {
    it('calls onChange when typing in textarea', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      fireEvent.change(screen.getByTestId('session-message-input'), {
        target: { value: 'Hello' },
      })
      expect(mockOnChange).toHaveBeenCalledWith('Hello')
    })

    it('displays current value in textarea', () => {
      render(<ComposerDock value="Test message" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByTestId('session-message-input')).toHaveValue('Test message')
    })
  })

  // =============================================================================
  // Sending State Tests
  // =============================================================================

  describe('Sending State', () => {
    it('disables textarea when sending', () => {
      render(<ComposerDock value="Hello" onChange={mockOnChange} onSend={mockOnSend} sending={true} />)

      expect(screen.getByTestId('session-message-input')).toBeDisabled()
    })

    it('disables send button when sending', () => {
      render(<ComposerDock value="Hello" onChange={mockOnChange} onSend={mockOnSend} sending={true} />)

      expect(screen.getByTestId('session-send-button')).toBeDisabled()
    })

    it('displays "发送中..." when sending', () => {
      render(<ComposerDock value="Hello" onChange={mockOnChange} onSend={mockOnSend} sending={true} />)

      expect(screen.getByText('发送中...')).toBeInTheDocument()
    })

    it('displays "发送" when not sending', () => {
      render(<ComposerDock value="Hello" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByText('发送')).toBeInTheDocument()
    })
  })

  // =============================================================================
  // Auto-resize Tests
  // =============================================================================

  describe('Auto-resize', () => {
    it('sets initial rows to 1', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.getByTestId('session-message-input')).toHaveAttribute('rows', '1')
    })
  })
})
