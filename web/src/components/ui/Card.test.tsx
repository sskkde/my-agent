import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Card from './Card'

describe('Card', () => {
  it('renders with children', () => {
    render(<Card>Card content</Card>)

    const card = screen.getByTestId('ui-card')
    expect(card).toBeInTheDocument()
    expect(card).toHaveClass('ui-card')
    expect(card).toHaveTextContent('Card content')
  })

  it('applies custom className', () => {
    render(<Card className="custom-card">Content</Card>)

    const card = screen.getByTestId('ui-card')
    expect(card).toHaveClass('custom-card')
  })
})

describe('Card.Header', () => {
  it('renders header content', () => {
    render(
      <Card>
        <Card.Header>Header</Card.Header>
      </Card>,
    )

    const header = screen.getByTestId('ui-card-header')
    expect(header).toBeInTheDocument()
    expect(header).toHaveClass('ui-card__header')
    expect(header).toHaveTextContent('Header')
  })

  it('applies custom className', () => {
    render(
      <Card>
        <Card.Header className="custom-header">Header</Card.Header>
      </Card>,
    )

    const header = screen.getByTestId('ui-card-header')
    expect(header).toHaveClass('custom-header')
  })
})

describe('Card.Content', () => {
  it('renders content', () => {
    render(
      <Card>
        <Card.Content>Body content</Card.Content>
      </Card>,
    )

    const content = screen.getByTestId('ui-card-content')
    expect(content).toBeInTheDocument()
    expect(content).toHaveClass('ui-card__content')
    expect(content).toHaveTextContent('Body content')
  })

  it('applies custom className', () => {
    render(
      <Card>
        <Card.Content className="custom-content">Body</Card.Content>
      </Card>,
    )

    const content = screen.getByTestId('ui-card-content')
    expect(content).toHaveClass('custom-content')
  })
})

describe('Card.Footer', () => {
  it('renders footer content', () => {
    render(
      <Card>
        <Card.Footer>Footer</Card.Footer>
      </Card>,
    )

    const footer = screen.getByTestId('ui-card-footer')
    expect(footer).toBeInTheDocument()
    expect(footer).toHaveClass('ui-card__footer')
    expect(footer).toHaveTextContent('Footer')
  })

  it('applies custom className', () => {
    render(
      <Card>
        <Card.Footer className="custom-footer">Footer</Card.Footer>
      </Card>,
    )

    const footer = screen.getByTestId('ui-card-footer')
    expect(footer).toHaveClass('custom-footer')
  })
})

describe('Card composition', () => {
  it('renders full card with all sections', () => {
    render(
      <Card>
        <Card.Header>Title</Card.Header>
        <Card.Content>Content</Card.Content>
        <Card.Footer>Actions</Card.Footer>
      </Card>,
    )

    expect(screen.getByTestId('ui-card')).toBeInTheDocument()
    expect(screen.getByTestId('ui-card-header')).toHaveTextContent('Title')
    expect(screen.getByTestId('ui-card-content')).toHaveTextContent('Content')
    expect(screen.getByTestId('ui-card-footer')).toHaveTextContent('Actions')
  })
})
