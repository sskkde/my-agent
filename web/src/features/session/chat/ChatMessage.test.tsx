import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChatMessage from './ChatMessage'

describe('ChatMessage', () => {
  it('renders user message', () => {
    render(<ChatMessage role="user" content="hello" />)
    expect(screen.getByText('你')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('renders assistant message with markdown', () => {
    render(<ChatMessage role="assistant" content="**bold** text" />)
    expect(screen.getByText('Hana')).toBeInTheDocument()
    expect(document.querySelector('strong')).toHaveTextContent('bold')
  })
})
