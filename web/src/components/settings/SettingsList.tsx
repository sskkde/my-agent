import React from 'react'
import '../settings/settings-primitives.css'

export interface SettingsListProps {
  children: React.ReactNode
  className?: string
  testId?: string
}

/**
 * SettingsList - card container for grouped settings rows.
 *
 * Renders a rounded card with inset border, matching the Warm-Paper
 * design system's hairline + 3px radius aesthetic.
 *
 * Usage:
 *   <SettingsList>
 *     <SettingsRow title="..." description="..." control={<Switch />} />
 *     <SettingsRow title="..." description="..." control={<Select />} />
 *   </SettingsList>
 */
const SettingsList: React.FC<SettingsListProps> = ({ children, className = '', testId }) => {
  return (
    <div className={`settings-list ${className}`.trim()} data-testid={testId}>
      {children}
    </div>
  )
}

export default SettingsList
