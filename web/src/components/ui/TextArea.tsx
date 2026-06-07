import React from 'react';

export interface TextAreaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
}

const TextArea: React.FC<TextAreaProps> = ({
  resize = 'vertical',
  className = '',
  ...props
}) => {
  const resizeClass = `ui-textarea--resize-${resize}`;
  const combinedClassName = `ui-textarea ${resizeClass}${className ? ` ${className}` : ''}`;

  return (
    <textarea
      className={combinedClassName}
      data-testid="ui-textarea"
      {...props}
    />
  );
};

export default TextArea;
