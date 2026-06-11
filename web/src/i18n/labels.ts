import type { ConsoleSessionInfo, UserRole, WorkflowStepType } from '../api/types'

export type SessionStatus = ConsoleSessionInfo['status']
export type ChannelStatus = 'connected' | 'active' | 'disconnected' | 'inactive' | 'healthy' | 'degraded' | 'unhealthy'
export type WorkflowStatus =
  | 'draft'
  | 'validated'
  | 'published'
  | 'archived'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export const SESSION_STATUS_LABELS = {
  active: '活跃',
  archived: '已归档',
  closed: '已关闭',
} satisfies Record<SessionStatus, string>

export const SESSION_STATUS_OPTIONS = Object.entries(SESSION_STATUS_LABELS).map(([value, label]) => ({
  value: value as SessionStatus,
  label,
}))

export const CHANNEL_STATUS_LABELS = {
  connected: '已连接',
  active: '活跃',
  disconnected: '已断开',
  inactive: '未激活',
  healthy: '健康',
  degraded: '降级',
  unhealthy: '异常',
} satisfies Record<ChannelStatus, string>

export const WORKFLOW_STEP_TYPES: WorkflowStepType[] = ['tool_call', 'agent_run', 'subagent_run', 'approval', 'wait']

export const WORKFLOW_STEP_TYPE_LABELS = {
  tool_call: '工具调用',
  agent_run: '代理运行',
  subagent_run: '子代理运行',
  approval: '审批',
  wait: '等待',
} satisfies Record<WorkflowStepType, string>

export const WORKFLOW_STATUS_LABELS = {
  draft: '草稿',
  validated: '已验证',
  published: '已发布',
  archived: '已归档',
  pending: '待处理',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
} satisfies Record<WorkflowStatus, string>

export const USER_ROLE_LABELS = {
  admin: '管理员',
  user: '用户',
  service: '服务账号',
} satisfies Record<UserRole, string>

const TOOL_DISPLAY_NAME_LABELS: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  list_directory: '列出目录',
  execute_command: '执行命令',
  status_query: '状态查询',
  'status.query': '状态查询',
  web_search: '网页搜索',
  docs_search: '文档搜索',
  file_read: '读取文件',
  file_write: '写入文件',
}

const SKILL_TYPE_LABELS: Record<string, string> = {
  builtin: '内置',
  custom: '自定义',
  system: '系统',
  user: '用户',
  project: '项目',
}

export function getSessionStatusLabel(status: SessionStatus): string {
  return SESSION_STATUS_LABELS[status]
}

export function getChannelStatusLabel(status: string): string {
  const normalized = status.toLowerCase() as ChannelStatus
  return CHANNEL_STATUS_LABELS[normalized] ?? status
}

export function getWorkflowStepTypeLabel(stepType: WorkflowStepType): string {
  return WORKFLOW_STEP_TYPE_LABELS[stepType]
}

export function getWorkflowStatusLabel(status: string): string {
  const normalized = status.toLowerCase() as WorkflowStatus
  return WORKFLOW_STATUS_LABELS[normalized] ?? status
}

export function getUserRoleLabel(role: UserRole): string {
  return USER_ROLE_LABELS[role]
}

export function getToolDisplayName(toolName: string): string {
  return TOOL_DISPLAY_NAME_LABELS[toolName] ?? toolName
}

export function getSkillTypeLabel(skillType: string): string {
  return SKILL_TYPE_LABELS[skillType.toLowerCase()] ?? skillType
}

export function formatDateTimeZhCN(date: string | number | Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatSessionTitleDate(date: string | number | Date): string {
  return new Date(date).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

export function formatNumberZhCN(num: number): string {
  return num.toLocaleString('zh-CN')
}

export function formatUsdCents(cents: number | null): string {
  if (cents === null) return '未配置'
  return `$${(cents / 100).toFixed(2)}`
}
