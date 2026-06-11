import React from 'react'
import { CodeBlock } from './CodeBlock'
import { parseCodeBlocks, Segment } from './parseCodeBlocks'

/**
 * Renders HTML with code blocks as React components
 * 
 * This component:
 * 1. Parses HTML to extract code blocks
 * 2. Renders non-code parts as HTML
 * 3. Renders code blocks as CodeBlock React components
 * 
 * This allows code blocks to have full React interactivity (copy button, etc.)
 * while maintaining the efficiency of HTML rendering for the rest.
 */

export interface MarkdownCodeRendererProps extends React.HTMLAttributes<HTMLDivElement> {
  html: string
  className?: string
}

export const MarkdownCodeRenderer: React.FC<MarkdownCodeRendererProps> = ({
  html,
  className,
  ...rest
}) => {
  const segments = parseCodeBlocks(html)
  
  return (
    <div className={className} {...rest}>
      {segments.map((segment: Segment, index: number) => {
        if (segment.type === 'html') {
          return (
            <div
              key={index}
              dangerouslySetInnerHTML={{ __html: segment.html }}
            />
          )
        } else {
          return (
            <CodeBlock
              key={index}
              code={segment.code}
              language={segment.language}
            />
          )
        }
      })}
    </div>
  )
}

export default MarkdownCodeRenderer
