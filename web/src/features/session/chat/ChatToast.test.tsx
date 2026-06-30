import { render, screen, waitFor } from '@testing-library/react'
import { ChatToast, showToast } from './ChatToast'

describe('ChatToast', () => {
  it('renders toast container', () => {
    render(<ChatToast />)
    expect(document.getElementById('chat-toast')).toBeInTheDocument()
  })

  it('shows message when showToast is called', async () => {
    render(<ChatToast />)
    showToast('hello toast')
    await waitFor(() => {
      expect(screen.getByText('hello toast')).toBeInTheDocument()
    })
  })
})
