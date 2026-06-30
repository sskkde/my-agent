import { render, screen } from '@testing-library/react'
import ChatMessageList from './ChatMessageList'
import type { ConsoleTimelineEvent } from '../../../api/types'

describe('ChatMessageList', () => {
  it('renders welcome screen when no events', () => {
    render(<ChatMessageList events={[]} loading={false} onPromptSelect={() => {}} onRetryStream={() => {}} />)
    expect(screen.getByTestId('chat-welcome')).toBeInTheDocument()
  })

  it('renders messages from events', () => {
    const events: ConsoleTimelineEvent[] = [
      {
        eventId: '1',
        eventType: 'user_message',
        sessionId: 's1',
        timestamp: new Date().toISOString(),
        content: 'hi',
        actor: 'user',
      },
      {
        eventId: '2',
        eventType: 'assistant_message',
        sessionId: 's1',
        timestamp: new Date().toISOString(),
        content: 'hello',
        actor: 'assistant',
      },
    ]
    render(<ChatMessageList events={events} loading={false} onPromptSelect={() => {}} onRetryStream={() => {}} />)
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('hello')).toBeInTheDocument()
  })
})
