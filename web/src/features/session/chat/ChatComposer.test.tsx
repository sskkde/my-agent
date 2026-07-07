import { render, screen, fireEvent } from '@testing-library/react'
import ChatComposer from './ChatComposer'

describe('ChatComposer', () => {
  it('renders textarea and send button', () => {
    render(<ChatComposer value="" onChange={() => {}} onSend={() => {}} />)
    expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    expect(screen.getByTestId('chat-send-button')).toBeInTheDocument()
  })

  it('calls onSend when Enter pressed', () => {
    const onSend = vi.fn()
    render(<ChatComposer value="hello" onChange={() => {}} onSend={onSend} />)
    fireEvent.keyDown(screen.getByTestId('chat-input'), { key: 'Enter', code: 'Enter' })
    expect(onSend).toHaveBeenCalled()
  })

  it('disables send when value is empty', () => {
    render(<ChatComposer value="" onChange={() => {}} onSend={() => {}} />)
    expect(screen.getByTestId('chat-send-button')).toBeDisabled()
  })

  it('passes selected attachment files to the upload handler', () => {
    const onFilesSelected = vi.fn()
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        onFilesSelected={onFilesSelected}
      />,
    )

    fireEvent.change(screen.getByTestId('chat-file-input'), { target: { files: [file] } })

    expect(onFilesSelected).toHaveBeenCalledWith([file])
  })

  it('allows file-only sends and removing selected attachments', () => {
    const onSend = vi.fn()
    const onRemoveFile = vi.fn()
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={onSend}
        selectedFiles={[file]}
        onRemoveFile={onRemoveFile}
      />,
    )

    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByTestId('chat-send-button')).not.toBeDisabled()

    fireEvent.click(screen.getByTestId('chat-send-button'))
    expect(onSend).toHaveBeenCalled()

    fireEvent.click(screen.getByLabelText('移除 notes.txt'))
    expect(onRemoveFile).toHaveBeenCalledWith(0)
  })
})
