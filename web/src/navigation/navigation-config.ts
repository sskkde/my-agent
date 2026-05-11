export type TabId =
  | 'dashboard'
  | 'session-console'
  | 'agent-monitor'
  | 'status'
  | 'sessions'
  | 'usage'
  | 'logs-debug'
  | 'channels'
  | 'instances'
  | 'skills'
  | 'agents'
  | 'settings'
  | 'workflows'
  | 'approvals'
  | 'memory';

export type NavGroupId = 'chat' | 'control' | 'agent' | 'settings';

export interface NavItem {
  id: TabId;
  label: string;
  description: string;
  testId: string;
  iconKey: string;
}

export interface NavGroup {
  id: NavGroupId;
  label: string;
  testId: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'chat',
    label: 'Chat',
    testId: 'nav-group-chat',
    items: [
      {
        id: 'session-console',
        label: '会话',
        description: 'Chat with agents',
        testId: 'tab-session-console',
        iconKey: 'messageSquare',
      },
    ],
  },
  {
    id: 'control',
    label: 'Control',
    testId: 'nav-group-control',
    items: [
      {
        id: 'dashboard',
        label: '概览',
        description: 'Overview dashboard',
        testId: 'tab-dashboard',
        iconKey: 'layoutDashboard',
      },
      {
        id: 'sessions',
        label: '会话列表',
        description: 'Session management',
        testId: 'tab-sessions',
        iconKey: 'list',
      },
      {
        id: 'usage',
        label: '用量统计',
        description: 'Usage statistics',
        testId: 'tab-usage',
        iconKey: 'barChart',
      },
      {
        id: 'logs-debug',
        label: '日志调试',
        description: 'Logs and debugging',
        testId: 'tab-logs-debug',
        iconKey: 'fileText',
      },
      {
        id: 'channels',
        label: '通道',
        description: 'Channel configuration',
        testId: 'tab-channels',
        iconKey: 'radio',
      },
      {
        id: 'instances',
        label: '实例',
        description: 'Instance management',
        testId: 'tab-instances',
        iconKey: 'server',
      },
      {
        id: 'status',
        label: '状态',
        description: 'System status',
        testId: 'tab-status',
        iconKey: 'info',
      },
      {
        id: 'workflows',
        label: '工作流',
        description: 'Workflow builder',
        testId: 'tab-workflows',
        iconKey: 'gitBranch',
      },
      {
        id: 'approvals',
        label: '审批',
        description: 'Approval management',
        testId: 'tab-approvals',
        iconKey: 'checkCircle',
      },
      {
        id: 'memory',
        label: '记忆',
        description: 'Memory management',
        testId: 'tab-memory',
        iconKey: 'database',
      },
    ],
  },
  {
    id: 'agent',
    label: 'Agent',
    testId: 'nav-group-agent',
    items: [
      {
        id: 'agent-monitor',
        label: '监控',
        description: 'Agent monitoring',
        testId: 'tab-agent-monitor',
        iconKey: 'activity',
      },
      {
        id: 'skills',
        label: '技能',
        description: 'Agent skills',
        testId: 'tab-skills',
        iconKey: 'zap',
      },
      {
        id: 'agents',
        label: '代理配置',
        description: 'Agent configuration',
        testId: 'tab-agents',
        iconKey: 'settings',
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    testId: 'nav-group-settings',
    items: [
      {
        id: 'settings',
        label: '设置',
        description: 'System settings',
        testId: 'tab-settings',
        iconKey: 'settings',
      },
    ],
  },
];

const allNavItems: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function getNavItemById(id: TabId): NavItem | undefined {
  return allNavItems.find((item) => item.id === id);
}

export function getNavGroupById(id: NavGroupId): NavGroup | undefined {
  return NAV_GROUPS.find((group) => group.id === id);
}
