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

  // =============================================================================
  // Attachment Tests
  // =============================================================================

  describe('Attachment Controls', () => {
    const mockOnFilesSelected = vi.fn()
    const mockOnRemoveFile = vi.fn()

    const createFile = (name: string, size: number, type = 'text/plain'): File => {
      const file = new File(['x'.repeat(size)], name, { type })
      Object.defineProperty(file, 'size', { value: size })
      return file
    }

    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('does not show attach button when onFilesSelected is not provided', () => {
      render(<ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />)

      expect(screen.queryByTestId('composer-attach-button')).not.toBeInTheDocument()
    })

    it('shows attach button when onFilesSelected is provided', () => {
      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
        />,
      )

      expect(screen.getByTestId('composer-attach-button')).toBeInTheDocument()
    })

    it('attach button opens file input', () => {
      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
        />,
      )

      const fileInput = screen.getByTestId('composer-file-input') as HTMLInputElement
      const attachButton = screen.getByTestId('composer-attach-button')

      fireEvent.click(attachButton)
      expect(fileInput).toBeInTheDocument()
    })

    it('calls onFilesSelected when files are selected', () => {
      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
        />,
      )

      const fileInput = screen.getByTestId('composer-file-input') as HTMLInputElement
      const file = createFile('test.txt', 100)

      fireEvent.change(fileInput, { target: { files: [file] } })
      expect(mockOnFilesSelected).toHaveBeenCalledWith([file])
    })

    it('renders preview chips for selected files', () => {
      const files = [createFile('document.pdf', 1024), createFile('image.png', 2048)]

      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          selectedFiles={files}
        />,
      )

      expect(screen.getByTestId('attachment-chips')).toBeInTheDocument()
      const chips = screen.getAllByTestId('attachment-chip')
      expect(chips).toHaveLength(2)
      expect(screen.getByText('document.pdf')).toBeInTheDocument()
      expect(screen.getByText('image.png')).toBeInTheDocument()
    })

    it('shows file size in chips', () => {
      const files = [createFile('large.txt', 1048576)]

      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          selectedFiles={files}
        />,
      )

      expect(screen.getByText('1.0 MB')).toBeInTheDocument()
    })

    it('remove button calls onRemoveFile with correct index', () => {
      const files = [createFile('a.txt', 100), createFile('b.txt', 200)]

      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          selectedFiles={files}
          onRemoveFile={mockOnRemoveFile}
        />,
      )

      const removeButtons = screen.getAllByTestId('attachment-remove-button')
      fireEvent.click(removeButtons[1])
      expect(mockOnRemoveFile).toHaveBeenCalledWith(1)
    })

    it('shows upload errors', () => {
      const errors = ['文件过大 (最大 10MB)', '不支持的文件类型']

      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          uploadErrors={errors}
        />,
      )

      expect(screen.getByTestId('upload-errors')).toBeInTheDocument()
      const errorElements = screen.getAllByTestId('upload-error')
      expect(errorElements).toHaveLength(2)
      expect(screen.getByText('文件过大 (最大 10MB)')).toBeInTheDocument()
      expect(screen.getByText('不支持的文件类型')).toBeInTheDocument()
    })

    it('shows uploading indicator when isUploading is true', () => {
      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          isUploading={true}
        />,
      )

      expect(screen.getByTestId('uploading-indicator')).toBeInTheDocument()
      expect(screen.getByText('上传中...')).toBeInTheDocument()
    })

    it('does not show uploading indicator when isUploading is false', () => {
      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          isUploading={false}
        />,
      )

      expect(screen.queryByTestId('uploading-indicator')).not.toBeInTheDocument()
    })

    it('sends message with attachments even when text is empty', () => {
      const files = [createFile('doc.pdf', 100)]

      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          selectedFiles={files}
        />,
      )

      fireEvent.click(screen.getByTestId('session-send-button'))
      expect(mockOnSend).toHaveBeenCalledTimes(1)
    })

    it('sends message with attachments and text', () => {
      const files = [createFile('doc.pdf', 100)]

      render(
        <ComposerDock
          value="Here is the document"
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          selectedFiles={files}
        />,
      )

      fireEvent.click(screen.getByTestId('session-send-button'))
      expect(mockOnSend).toHaveBeenCalledTimes(1)
    })

    it('Enter key sends when files are selected even with empty text', () => {
      const files = [createFile('doc.pdf', 100)]

      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          selectedFiles={files}
        />,
      )

      fireEvent.keyDown(screen.getByTestId('session-message-input'), {
        key: 'Enter',
        shiftKey: false,
      })
      expect(mockOnSend).toHaveBeenCalledTimes(1)
    })

    it('disables attach button when sending', () => {
      render(
        <ComposerDock
          value=""
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          sending={true}
        />,
      )

      expect(screen.getByTestId('composer-attach-button')).toBeDisabled()
    })

    it('hides hint on mobile', () => {
      const { container } = render(
        <ComposerDock value="" onChange={mockOnChange} onSend={mockOnSend} />,
      )

      expect(container.querySelector('.composer-hint')).toBeInTheDocument()
    })

    it('preserves existing selectors after attachment additions', () => {
      render(
        <ComposerDock
          value="test"
          onChange={mockOnChange}
          onSend={mockOnSend}
          onFilesSelected={mockOnFilesSelected}
          selectedFiles={[createFile('file.txt', 100)]}
          uploadErrors={['Error']}
          isUploading={true}
        />,
      )

      expect(screen.getByTestId('session-message-input')).toBeInTheDocument()
      expect(screen.getByTestId('session-send-button')).toBeInTheDocument()
    })
  })
})
