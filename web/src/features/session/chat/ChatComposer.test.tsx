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
})
