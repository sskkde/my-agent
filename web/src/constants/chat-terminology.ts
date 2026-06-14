/**
 * Chat UI Terminology
 *
 * User-facing Chinese terminology for the Chat product section.
 * These terms are designed for end users and should not be used for
 * admin/operations interfaces which retain technical terminology.
 */

export const CHAT_TERMINOLOGY = {
  // Core concepts
  chat: '聊天',
  workspace: '工作区',
  desk: '书桌',
  workPlan: '工作计划',
  activityOverview: '活动概览',
  sessionSettings: '会话设置',

  // Session-related
  session: '会话',
  newSession: '新会话',
  sessionHistory: '会话历史',

  // Actions
  sendMessage: '发送消息',
  clearChat: '清空聊天',
} as const

export type ChatTerminologyKey = keyof typeof CHAT_TERMINOLOGY
