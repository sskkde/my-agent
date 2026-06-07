import React from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
  size?: 'small' | 'medium';
  className?: string;
}

const Badge: React.FC<BadgeProps> = ({
  variant = 'default',
  size = 'medium',
  className = '',
  children,
}) => {
  const baseClass = 'ui-badge';
  const variantClass = `ui-badge--${variant}`;
  const sizeClass = `ui-badge--${size}`;
  const combinedClassName = `${baseClass} ${variantClass} ${sizeClass}${className ? ` ${className}` : ''}`;

  return (
    <span className={combinedClassName} data-testid="ui-badge">
      {children}
    </span>
  );
};

export default Badge;
