export type SyntheticToolStatus = 'cancelled' | 'aborted' | 'timeout';

export const SYNTHETIC_TOOL_STATUSES = {
  CANCELLED: 'cancelled',
  ABORTED: 'aborted',
  TIMEOUT: 'timeout',
} as const;

export const INTERRUPT_BEHAVIORS = {
  CANCEL: 'cancel',
  BLOCK: 'block',
  FINISH_CURRENT: 'finish_current',
} as const;

export interface SyntheticToolResult {
  toolCallId: string;
  status: SyntheticToolStatus;
  isSynthetic: true;
  modelFacingContent: string;
  userVisibleSummary?: string;
}
