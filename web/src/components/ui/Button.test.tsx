import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import Button from './Button'

describe('Button', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('ui-button')
    expect(button).toHaveClass('ui-button--primary')
    expect(button).toHaveClass('ui-button--medium')
    expect(button).toHaveTextContent('Click me')
  })

  it('renders with primary variant', () => {
    render(<Button variant="primary">Primary</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toHaveClass('ui-button--primary')
  })

  it('renders with secondary variant', () => {
    render(<Button variant="secondary">Secondary</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toHaveClass('ui-button--secondary')
  })

  it('renders with ghost variant', () => {
    render(<Button variant="ghost">Ghost</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toHaveClass('ui-button--ghost')
  })

  it('renders with small size', () => {
    render(<Button size="small">Small</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toHaveClass('ui-button--small')
  })

  it('renders with large size', () => {
    render(<Button size="large">Large</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toHaveClass('ui-button--large')
  })

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Disabled</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toBeDisabled()
  })

  it('is disabled when loading prop is true', () => {
    render(<Button loading>Loading</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toBeDisabled()
  })

  it('renders spinner when loading', () => {
    render(<Button loading>Loading</Button>)

    const spinner = document.querySelector('.ui-button__spinner')
    expect(spinner).toBeInTheDocument()
  })

  it('applies custom className', () => {
    render(<Button className="custom-class">Custom</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toHaveClass('custom-class')
  })

  it('supports button type attribute', () => {
    render(<Button type="submit">Submit</Button>)

    const button = screen.getByTestId('ui-button')
    expect(button).toHaveAttribute('type', 'submit')
  })

  it('supports onClick handler', async () => {
    let clicked = false
    render(
      <Button
        onClick={() => {
          clicked = true
        }}
      >
        Click
      </Button>,
    )

    const button = screen.getByTestId('ui-button')
    button.click()
    expect(clicked).toBe(true)
  })
})
