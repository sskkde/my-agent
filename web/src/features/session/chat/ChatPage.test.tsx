import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import ChatPage from './ChatPage'
import { AuthProvider } from '../../../context/AuthContext'
import * as client from '../../../api/client'

vi.mock('../../../api/client')

describe('ChatPage', () => {
  it('renders chat shell', async () => {
    vi.mocked(client.getMe).mockResolvedValue({
      user: {
        userId: 'test-user-id',
        username: 'testuser',
        createdAt: '2024-01-01T00:00:00Z',
      },
    })
    vi.mocked(client.getSetupStatus).mockResolvedValue({ needsSetup: false })

    render(
      <MemoryRouter>
        <AuthProvider>
          <ChatPage />
        </AuthProvider>
      </MemoryRouter>,
    )

    await screen.findByTestId('chat-shell')
    expect(screen.getByTestId('chat-shell')).toBeInTheDocument()
  })
})
