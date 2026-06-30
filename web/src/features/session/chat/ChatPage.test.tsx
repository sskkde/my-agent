import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ChatPage from './ChatPage'

describe('ChatPage', () => {
  it('renders chat shell', () => {
    render(
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>
    )
    expect(screen.getByTestId('chat-shell')).toBeInTheDocument()
  })
})
