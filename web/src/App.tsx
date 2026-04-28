import { useState } from 'react';
import AppShell from './components/AppShell';
import AgentMonitorTab from './features/monitor/AgentMonitorTab';
import DashboardTab from './features/dashboard/DashboardTab';
import SessionConsoleTab from './features/session/SessionConsoleTab';
import StatusTab from './features/status/StatusTab';
import type { TabId } from './components/TabNav';
import './styles.css';

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardTab />;
      case 'session-console':
        return <SessionConsoleTab />;
      case 'agent-monitor':
        return <AgentMonitorTab />;
      case 'status':
        return <StatusTab onTabChange={setActiveTab} />;
    }
  };

  return (
    <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
      {renderContent()}
    </AppShell>
  );
}

export default App;