import { render, screen } from '@testing-library/react'
import ChatShell from './ChatShell'

describe('ChatShell', () => {
  it('renders main content and sidebars', () => {
    render(
      <ChatShell
        title="Chat"
        sidebar={<div data-testid="sidebar">sidebar</div>}
        rightPanel={<div data-testid="right">right</div>}
      >
        <div data-testid="main">main</div>
      </ChatShell>
    )
    expect(screen.getByTestId('main')).toBeInTheDocument()
    expect(screen.getByTestId('sidebar')).toBeInTheDocument()
    expect(screen.getByTestId('right')).toBeInTheDocument()
  })
})
