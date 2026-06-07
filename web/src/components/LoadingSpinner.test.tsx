import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import LoadingSpinner from './LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders with default props', () => {
    render(<LoadingSpinner />)

    const spinner = screen.getByTestId('loading-spinner')
    expect(spinner).toBeInTheDocument()
    expect(spinner).toHaveClass('spinner')
    expect(spinner).toHaveClass('spinner--medium')
  })

  it('renders with small size', () => {
    render(<LoadingSpinner size="small" />)

    const spinner = screen.getByTestId('loading-spinner')
    expect(spinner).toHaveClass('spinner--small')
  })

  it('renders with medium size', () => {
    render(<LoadingSpinner size="medium" />)

    const spinner = screen.getByTestId('loading-spinner')
    expect(spinner).toHaveClass('spinner--medium')
  })

  it('renders with large size', () => {
    render(<LoadingSpinner size="large" />)

    const spinner = screen.getByTestId('loading-spinner')
    expect(spinner).toHaveClass('spinner--large')
  })

  it('renders with inline modifier', () => {
    render(<LoadingSpinner inline />)

    const spinner = screen.getByTestId('loading-spinner')
    expect(spinner).toHaveClass('spinner--inline')
  })

  it('has accessibility role', () => {
    render(<LoadingSpinner />)

    const spinner = screen.getByRole('status')
    expect(spinner).toBeInTheDocument()
  })

  it('has default accessibility label', () => {
    render(<LoadingSpinner />)

    const spinner = screen.getByLabelText('加载中...')
    expect(spinner).toBeInTheDocument()
  })

  it('has custom accessibility label', () => {
    render(<LoadingSpinner label="正在加载数据..." />)

    const spinner = screen.getByLabelText('正在加载数据...')
    expect(spinner).toBeInTheDocument()
  })

  it('renders screen reader text', () => {
    render(<LoadingSpinner label="Loading data" />)

    expect(screen.getByText('Loading data')).toHaveClass('sr-only')
  })

  it('renders spinner circle element', () => {
    render(<LoadingSpinner />)

    const circle = document.querySelector('.spinner__circle')
    expect(circle).toBeInTheDocument()
    expect(circle).toHaveAttribute('aria-hidden', 'true')
  })
})
