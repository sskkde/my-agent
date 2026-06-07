/**
 * Context Desk Feature Module
 *
 * READ-ONLY POLICY:
 * All exports in this module are for read-only data display.
 * No mutation operations (approve, reject, edit, run-control) are exported.
 *
 * Cards are designed for informational display only.
 * Users must navigate to full feature tabs for any actions.
 */

// Card state model
export type {
  CardState,
  LoadingState,
  ReadyState,
  EmptyState,
  ErrorState,
} from './card-state'

export {
  loading,
  ready,
  empty,
  error,
  isLoading,
  isReady,
  isEmpty,
  isError,
} from './card-state'

// Card prop contracts
export type {
  ApprovalCardData,
  ApprovalCardProps,
  MemoryCardData,
  MemoryCardProps,
  RunsCardData,
  RunsCardProps,
  ToolActivityCardData,
  ToolActivityCardProps,
  EmptyStateMetadata,
  CardRefreshConfig,
  BaseCardProps,
} from './card-contracts'

// Data adapters
export type {
  ApprovalAdapterOptions,
  MemoryAdapterOptions,
  RunsAdapterOptions,
  ToolActivityAdapterOptions,
} from './data-adapters'

export {
  fetchApprovalCardData,
  fetchMemoryCardData,
  fetchRunsCardData,
  fetchToolActivityCardData,
  createEmptyMetadata,
} from './data-adapters'

// Card components
export { default as ApprovalCard } from './ApprovalCard'
export { default as MemoryCard } from './MemoryCard'
export { default as RunsCard } from './RunsCard'
export { default as ToolActivityCard } from './ToolActivityCard'

// Panel component
export { default as ContextDeskPanel } from './ContextDeskPanel'
export type { ContextDeskPanelProps } from './ContextDeskPanel'
