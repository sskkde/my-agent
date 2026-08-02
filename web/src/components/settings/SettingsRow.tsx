import React from 'react'

export interface SettingsRowProps {
  /** Left-aligned primary label */
  title: string
  /** Secondary description shown below the title */
  description?: string
  /** Optional icon node rendered before the title */
  icon?: React.ReactNode
  /**
   * Click handler. When provided, the row becomes a clickable navigation
   * item (renders a trailing arrow and hover/active states).
   * When omitted, the row is a static settings item that displays
   * the `control` prop on the right side.
   */
  onClick?: () => void
  /** Right-side control for settings rows (Switch, Select, Radio, etc.) */
  control?: React.ReactNode
  /** Whether this row is the currently active/selected navigation item */
  active?: boolean
  /** Optional testId for E2E/unit tests */
  testId?: string
}

/**
 * SettingsRow - atomic settings/navigation row primitive.
 *
 * Layout: [icon?] [title + description] [control | arrow]
 *
 * - Navigation rows (onClick provided): clickable, trailing arrow, hover bg
 * - Settings rows (control provided): static, control on right
 *
 * Separated from siblings by a 1px border-bottom.
 */
const SettingsRow: React.FC<SettingsRowProps> = ({
  title,
  description,
  icon,
  onClick,
  control,
  active = false,
  testId,
}) => {
  const isNav = typeof onClick === 'function'
  const Tag = isNav ? 'button' : 'div'

  return (
    <Tag
      className={[
        'settings-row',
        isNav ? 'settings-row--nav' : '',
        active ? 'settings-row--active' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onClick}
      data-testid={testId}
      data-active={active || undefined}
    >
      {icon && <span className="settings-row__icon" aria-hidden="true">{icon}</span>}

      <span className="settings-row__copy">
        <span className="settings-row__title">{title}</span>
        {description && <span className="settings-row__description">{description}</span>}
      </span>

      {control && <span className="settings-row__control">{control}</span>}

      {isNav && (
        <span className="settings-row__arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width="16" height="16">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>
      )}
    </Tag>
  )
}

export default SettingsRow
