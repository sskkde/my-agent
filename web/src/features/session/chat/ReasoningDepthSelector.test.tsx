import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ReasoningDepthSelector from './ReasoningDepthSelector'

describe('ReasoningDepthSelector', () => {
  it('shows current depth label next to model status area', () => {
    render(
      <ReasoningDepthSelector
        value="medium"
        sessionId="s1"
        isOpen={false}
        onOpen={() => {}}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('chat-reasoning-depth-trigger')).toHaveTextContent('推理:中')
  })

  it('allows selecting a new depth when open', () => {
    const onSelect = vi.fn()
    render(
      <ReasoningDepthSelector
        value="off"
        sessionId="s1"
        isOpen={true}
        onOpen={() => {}}
        onClose={() => {}}
        onSelect={onSelect}
      />,
    )
    fireEvent.click(screen.getByTestId('chat-reasoning-depth-option-high'))
    expect(onSelect).toHaveBeenCalledWith('high')
  })

  it('disables trigger when no session', () => {
    render(
      <ReasoningDepthSelector
        value="off"
        sessionId={null}
        isOpen={false}
        onOpen={() => {}}
        onClose={() => {}}
        onSelect={() => {}}
      />,
    )
    expect(screen.getByTestId('chat-reasoning-depth-trigger')).toBeDisabled()
  })
})
