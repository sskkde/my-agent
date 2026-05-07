import { useState } from 'react';
import AppShell from './components/AppShell';
import AgentMonitorTab from './features/monitor/AgentMonitorTab';
import DashboardTab from './features/dashboard/DashboardTab';
import SessionConsoleTab from './features/session/SessionConsoleTab';
import StatusTab from './features/status/StatusTab';
import SessionsTab from './features/sessions/SessionsTab';
import UsageTab from './features/usage/UsageTab';
import LogsDebugTab from './features/logs/LogsDebugTab';
import ChannelsTab from './features/channels/ChannelsTab';
import InstancesTab from './features/instances/InstancesTab';
import SkillsTab from './features/skills/SkillsTab';
import AgentsTab from './features/agents/AgentsTab';
import SettingsTab from './features/settings/SettingsTab';
import WorkflowsTab from './features/workflows/WorkflowsTab';
import LoginPage from './features/auth/LoginPage';
import { AuthProvider, useAuth } from './context/AuthContext';
import type { TabId } from './components/TabNav';
import './styles.css';

function AppContent() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const { isAuthenticated, needsSetup, loading, logout, user } = useAuth();

  if (loading) {
    return (
      <div className="auth-page" data-testid="auth-loading">
        <div className="auth-container">
          <div className="auth-card">
            <div className="auth-header">
              <h1 className="auth-title">加载中...</h1>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage mode={needsSetup ? 'setup' : 'login'} />;
  }

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
      case 'sessions':
        return <SessionsTab />;
      case 'usage':
        return <UsageTab />;
      case 'logs-debug':
        return <LogsDebugTab />;
      case 'channels':
        return <ChannelsTab />;
      case 'instances':
        return <InstancesTab />;
      case 'skills':
        return <SkillsTab />;
      case 'agents':
        return <AgentsTab />;
      case 'settings':
        return <SettingsTab />;
      case 'workflows':
        return <WorkflowsTab />;
    }
  };

  return (
    <AppShell
      activeTab={activeTab}
      onTabChange={setActiveTab}
      user={user}
      onLogout={logout}
    >
      {renderContent()}
    </AppShell>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
