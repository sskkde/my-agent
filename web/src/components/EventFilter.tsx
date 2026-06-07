import React from 'react'

export interface EventTypeOption {
  type: string
  label: string
  count: number
}

export interface EventFilterProps {
  eventTypes: EventTypeOption[]
  selectedTypes: string[]
  onChange: (selectedTypes: string[]) => void
  showAllOption?: boolean
  multiSelect?: boolean
}

const EventFilter: React.FC<EventFilterProps> = ({
  eventTypes,
  selectedTypes,
  onChange,
  showAllOption = true,
  multiSelect = true,
}) => {
  const allTypesSelected = selectedTypes.length === 0 || selectedTypes.length === eventTypes.length

  const handleAllClick = () => {
    onChange([])
  }

  const handleTypeClick = (type: string) => {
    if (!multiSelect) {
      onChange([type])
      return
    }

    if (selectedTypes.includes(type)) {
      const newSelected = selectedTypes.filter((t) => t !== type)
      onChange(newSelected)
    } else {
      onChange([...selectedTypes, type])
    }
  }

  const isTypeSelected = (type: string): boolean => {
    if (allTypesSelected) return true
    return selectedTypes.includes(type)
  }

  return (
    <div className="event-filter" role="group" aria-label="事件类型过滤" data-testid="event-filter">
      {showAllOption && (
        <button
          className={`event-filter__chip ${allTypesSelected ? 'event-filter__chip--selected' : ''}`}
          onClick={handleAllClick}
          type="button"
          aria-pressed={allTypesSelected}
          data-testid="filter-chip-all"
        >
          全部
        </button>
      )}
      {eventTypes.map((eventType) => {
        const selected = isTypeSelected(eventType.type)
        return (
          <button
            key={eventType.type}
            className={`event-filter__chip ${selected ? 'event-filter__chip--selected' : ''}`}
            onClick={() => handleTypeClick(eventType.type)}
            type="button"
            aria-pressed={selected}
            data-testid={`filter-chip-${eventType.type}`}
          >
            {eventType.label}
            <span className="event-filter__count">{eventType.count}</span>
          </button>
        )
      })}
    </div>
  )
}

export default EventFilter
