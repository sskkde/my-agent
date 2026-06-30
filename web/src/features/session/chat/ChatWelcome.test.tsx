import { render, screen, fireEvent } from '@testing-library/react'
import ChatWelcome from './ChatWelcome'

describe('ChatWelcome', () => {
  it('renders title and prompts', () => {
    render(<ChatWelcome onPromptSelect={() => {}} />)
    expect(screen.getByText('有什么可以帮你的？')).toBeInTheDocument()
    expect(screen.getByText('写一首短诗')).toBeInTheDocument()
  })

  it('calls onPromptSelect when prompt card clicked', () => {
    const onPromptSelect = vi.fn()
    render(<ChatWelcome onPromptSelect={onPromptSelect} />)
    fireEvent.click(screen.getByText('写一首短诗'))
    expect(onPromptSelect).toHaveBeenCalledWith('帮我写一首关于秋天的短诗')
  })
})
