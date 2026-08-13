import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AskUserModal } from './AskUserModal'
import type { AskInfo } from '../../api/types'

const createAsk = (overrides: Partial<AskInfo> = {}): AskInfo => ({
  id: 'ask-1',
  sessionId: 'session-1',
  status: 'pending',
  question: 'Which environment should I use?',
  context: 'The deployment target is not configured yet.',
  options: [
    { label: 'Staging', description: 'Use the shared staging environment.' },
    { label: 'Production', description: 'Deploy directly to production.' },
  ],
  multiSelect: false,
  requestedAt: '2024-01-01T10:00:00Z',
  ...overrides,
})

const renderModal = (ask: AskInfo, onSubmit = vi.fn(), onClose = vi.fn()) => {
  render(<AskUserModal ask={ask} loading={false} error={null} onSubmit={onSubmit} onClose={onClose} />)
  return { onSubmit, onClose }
}

describe('AskUserModal', () => {
  it('renders nothing when ask is null', () => {
    const { container } = render(
      <AskUserModal ask={null} loading={false} error={null} onSubmit={vi.fn()} onClose={vi.fn()} />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('renders the question, context, and marks the first option as recommended', () => {
    renderModal(createAsk())

    expect(screen.getByTestId('ask-user-modal')).toBeInTheDocument()
    expect(screen.getByText('用户提问')).toBeInTheDocument()
    expect(screen.getByText('Which environment should I use?')).toBeInTheDocument()
    expect(screen.getByText('The deployment target is not configured yet.')).toBeInTheDocument()
    expect(screen.getByText('推荐')).toBeInTheDocument()
    expect(screen.getByText('Use the shared staging environment.')).toBeInTheDocument()
  })

  it('submits a single selected option immediately', () => {
    const { onSubmit } = renderModal(createAsk())

    fireEvent.click(screen.getByTestId('ask-user-modal-option-0'))

    expect(onSubmit).toHaveBeenCalledWith([{ question: createAsk().question, answer: 'Staging' }])
  })

  it('submits an option value when its display label differs', () => {
    const ask = createAsk({
      options: [{ value: 'staging', label: '预发布' }],
    })
    const { onSubmit } = renderModal(ask)

    fireEvent.click(screen.getByTestId('ask-user-modal-option-0'))

    expect(onSubmit).toHaveBeenCalledWith([{ question: ask.question, answer: 'staging' }])
  })

  it('submits selected answers from multi-select checkboxes', () => {
    const ask = createAsk({ multiSelect: true })
    const { onSubmit } = renderModal(ask)

    fireEvent.click(screen.getByTestId('ask-user-modal-checkbox-0'))
    fireEvent.click(screen.getByTestId('ask-user-modal-checkbox-1'))
    fireEvent.click(screen.getByTestId('ask-user-modal-submit'))

    expect(onSubmit).toHaveBeenCalledWith([
      { question: ask.question, answer: 'Staging' },
      { question: ask.question, answer: 'Production' },
    ])
  })

  it('submits a custom answer when no options are provided', () => {
    const ask = createAsk({ options: null })
    const { onSubmit } = renderModal(ask)

    fireEvent.change(screen.getByLabelText('自定义回答'), { target: { value: 'Use development' } })
    fireEvent.click(screen.getByTestId('ask-user-modal-submit'))

    expect(onSubmit).toHaveBeenCalledWith([{ question: ask.question, answer: 'Use development' }])
  })

  it('allows a custom answer when multi-select has no options', () => {
    const ask = createAsk({ options: null, multiSelect: true })
    const { onSubmit } = renderModal(ask)

    fireEvent.change(screen.getByLabelText('自定义回答'), { target: { value: 'Use development' } })
    fireEvent.click(screen.getByTestId('ask-user-modal-submit'))

    expect(onSubmit).toHaveBeenCalledWith([{ question: ask.question, answer: 'Use development' }])
  })

  it('closes on Escape and backdrop click when idle', () => {
    const { onClose } = renderModal(createAsk())
    const modal = screen.getByTestId('ask-user-modal')

    fireEvent.keyDown(modal, { key: 'Escape' })
    fireEvent.click(modal)

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes when Escape is pressed outside the overlay while idle', () => {
    const { onClose } = renderModal(createAsk())

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('disables submission and close controls while loading', () => {
    const onSubmit = vi.fn()
    const onClose = vi.fn()
    const ask = createAsk({ multiSelect: true })

    render(<AskUserModal ask={ask} loading error="正在提交" onSubmit={onSubmit} onClose={onClose} />)

    expect(screen.getByTestId('ask-user-modal-submit')).toBeDisabled()
    expect(screen.getByTestId('ask-user-modal-close')).toBeDisabled()
    expect(screen.getByText('正在提交')).toBeInTheDocument()
  })
})
