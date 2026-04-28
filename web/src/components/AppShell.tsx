import React from 'react';
import TabNav, { TabId } from './TabNav';
import '../styles.css';

interface AppShellProps {
  children: React.ReactNode;
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabPanels: { id: TabId; title: string }[] = [
  { id: 'dashboard', title: '概览' },
  { id: 'session-console', title: '会话控制台' },
  { id: 'agent-monitor', title: 'Agent 监控' },
  { id: 'status', title: '系统状态' },
];

const AppShell: React.FC<AppShellProps> = ({ children, activeTab, onTabChange }) => {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="app-title">Agent Platform</h1>
        </div>
        <TabNav activeTab={activeTab} onTabChange={onTabChange} />
        <div className="sidebar-footer">
          <span className="version-badge">v1.0.0</span>
        </div>
      </aside>
      <main className="content-panel">
        <div className="content-header">
          <h2>{tabPanels.find((t) => t.id === activeTab)?.title}</h2>
        </div>
        <div className="content-body">{children}</div>
      </main>
    </div>
  );
};

export default AppShell;