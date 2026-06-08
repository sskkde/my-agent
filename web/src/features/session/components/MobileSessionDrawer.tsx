import React from 'react'

export interface MobileSessionDrawerProps {
  isOpen: boolean
  onClose: () => void
}

export const MobileSessionDrawer: React.FC<MobileSessionDrawerProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null

  return (
    <div
      className="session-sidebar-backdrop"
      data-testid="session-sidebar-backdrop"
      onClick={onClose}
      aria-hidden="true"
    />
  )
}
