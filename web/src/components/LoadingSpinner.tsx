import React from 'react';

export interface LoadingSpinnerProps {
  size?: 'small' | 'medium' | 'large';
  label?: string;
  inline?: boolean;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  label = '加载中...',
  inline = false,
}) => {
  const className = `spinner spinner--${size}${inline ? ' spinner--inline' : ''}`;

  return (
    <div
      className={className}
      role="status"
      aria-label={label}
      data-testid="loading-spinner"
    >
      <span className="spinner__circle" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
};

export default LoadingSpinner;
