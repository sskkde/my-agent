import React from 'react';

export type TabId = 'dashboard' | 'session-console' | 'agent-monitor' | 'status';

interface TabNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const tabs: { id: TabId; label: string }[] = [
  { id: 'dashboard', label: '概览' },
  { id: 'session-console', label: '会话' },
  { id: 'agent-monitor', label: '监控' },
  { id: 'status', label: '状态' },
];

const TabNav: React.FC<TabNavProps> = ({ activeTab, onTabChange }) => {
  const handleKeyDown = (e: React.KeyboardEvent, tabId: TabId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onTabChange(tabId);
    }
  };

  return (
    <nav role="tablist" aria-label="主导航">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          data-testid={`tab-${tab.id}`}
          aria-selected={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
          onKeyDown={(e) => handleKeyDown(e, tab.id)}
          className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
};

export default TabNav;