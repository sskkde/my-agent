import React from 'react'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'small' | 'medium' | 'large'
  loading?: boolean
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'medium',
  loading = false,
  disabled,
  className = '',
  children,
  ...props
}) => {
  const baseClass = 'ui-button'
  const variantClass = `ui-button--${variant}`
  const sizeClass = `ui-button--${size}`
  const combinedClassName = `${baseClass} ${variantClass} ${sizeClass}${className ? ` ${className}` : ''}`

  return (
    <button className={combinedClassName} disabled={disabled || loading} data-testid="ui-button" {...props}>
      {loading ? <span className="ui-button__spinner" /> : children}
    </button>
  )
}

export default Button
