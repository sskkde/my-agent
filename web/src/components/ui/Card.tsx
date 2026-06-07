import React from 'react'

export interface CardProps {
  children: React.ReactNode
  className?: string
  'data-testid'?: string
}

export interface CardHeaderProps {
  children: React.ReactNode
  className?: string
}

export interface CardContentProps {
  children: React.ReactNode
  className?: string
}

export interface CardFooterProps {
  children: React.ReactNode
  className?: string
}

const Card: React.FC<CardProps> & {
  Header: React.FC<CardHeaderProps>
  Content: React.FC<CardContentProps>
  Footer: React.FC<CardFooterProps>
} = ({ children, className = '', 'data-testid': testId = 'ui-card' }) => {
  return (
    <div className={`ui-card${className ? ` ${className}` : ''}`} data-testid={testId}>
      {children}
    </div>
  )
}

const CardHeader: React.FC<CardHeaderProps> = ({ children, className = '' }) => {
  return (
    <div className={`ui-card__header${className ? ` ${className}` : ''}`} data-testid="ui-card-header">
      {children}
    </div>
  )
}

const CardContent: React.FC<CardContentProps> = ({ children, className = '' }) => {
  return (
    <div className={`ui-card__content${className ? ` ${className}` : ''}`} data-testid="ui-card-content">
      {children}
    </div>
  )
}

const CardFooter: React.FC<CardFooterProps> = ({ children, className = '' }) => {
  return (
    <div className={`ui-card__footer${className ? ` ${className}` : ''}`} data-testid="ui-card-footer">
      {children}
    </div>
  )
}

Card.Header = CardHeader
Card.Content = CardContent
Card.Footer = CardFooter

export default Card
