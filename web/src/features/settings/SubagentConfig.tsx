import React, { useState, useEffect, useCallback } from 'react';
import {
  getSubagentDefinitions,
  getSubagentPreference,
  updateSubagentPreference,
  resetSubagentPreference,
  getProviders,
  ApiClientError,
} from '../../api/client';
import type {
  SubagentDefinition,
  SubagentPreference,
  SubagentFallbackMode,
  ProviderSummary,
} from '../../api/types';
import LoadingSpinner from '../../components/LoadingSpinner';
import ErrorMessage from '../../components/ErrorMessage';

interface SubagentConfigProps {
  isAuthenticated: boolean;
}

interface SubagentFormData {
  providerId: string;
  model: string;
  fallbackMode: SubagentFallbackMode;
}

const FALLBACK_MODE_OPTIONS: { value: SubagentFallbackMode; label: string; description: string }[] = [
  { value: 'none', label: '不回退', description: '失败时不切换其他提供商' },
  { value: 'same_provider', label: '同提供商回退', description: '失败时仅尝试同一提供商的兼容模型' },
  { value: 'any_compatible', label: '任意兼容回退', description: '失败时尝试任意兼容提供商或模型' },
];

const SubagentConfig: React.FC<SubagentConfigProps> = ({ isAuthenticated }) => {
  const [definitions, setDefinitions] = useState<SubagentDefinition[]>([]);
  const [preferences, setPreferences] = useState<Record<string, SubagentPreference>>({});
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [resettingType, setResettingType] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [formData, setFormData] = useState<Record<string, SubagentFormData>>({});

  const fetchData = useCallback(async () => {
    if (!isAuthenticated) return;

    setLoading(true);
    setError(null);
    try {
      const [defsRes, providersData] = await Promise.all([
        getSubagentDefinitions(),
        getProviders(),
      ]);

      const preferenceEntries = await Promise.all(
        defsRes.definitions.map(async (def) => [def.agentType, (await getSubagentPreference(def.agentType)).preference] as const)
      );
      const preferencesByType: Record<string, SubagentPreference> = {};
      for (const [agentType, preference] of preferenceEntries) {
        if (preference) {
          preferencesByType[agentType] = preference;
        }
      }

      setDefinitions(defsRes.definitions);
      setPreferences(preferencesByType);
      setProviders(providersData);

      const initialFormData: Record<string, SubagentFormData> = {};
      defsRes.definitions.forEach((def) => {
        const pref = preferencesByType[def.agentType];
        initialFormData[def.agentType] = {
          providerId: pref?.providerId ?? '',
          model: pref?.model ?? '',
          fallbackMode: pref?.fallbackMode ?? def.providerPolicy.fallbackMode,
        };
      });
      setFormData(initialFormData);
    } catch (err) {
      setError(err instanceof Error ? err : new Error('加载子代理配置失败'));
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleToggleExpand = (subagentType: string) => {
    setExpandedType((prev) => (prev === subagentType ? null : subagentType));
    setSaveErrors((prev) => ({ ...prev, [subagentType]: '' }));
  };

  const handleInputChange = (subagentType: string, field: keyof SubagentFormData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [subagentType]: {
        ...prev[subagentType],
        [field]: value,
      },
    }));
    setSaveErrors((prev) => ({ ...prev, [subagentType]: '' }));
  };

  const handleSave = async (subagentType: string) => {
    const data = formData[subagentType];
    setSavingType(subagentType);
    setSaveErrors((prev) => ({ ...prev, [subagentType]: '' }));

    try {
      const request: { providerId?: string | null; model?: string | null; fallbackMode?: SubagentFallbackMode } = {};
      
      if (data.providerId) {
        request.providerId = data.providerId;
      }
      if (data.model.trim()) {
        request.model = data.model.trim();
      }
      request.fallbackMode = data.fallbackMode;

      await updateSubagentPreference(subagentType, request);
      await fetchData();
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '保存配置失败';
      setSaveErrors((prev) => ({ ...prev, [subagentType]: message }));
    } finally {
      setSavingType(null);
    }
  };

  const handleReset = async (subagentType: string) => {
    if (!confirm('确定要重置此子代理的配置吗？这将恢复到默认设置。')) {
      return;
    }

    setResettingType(subagentType);
    setSaveErrors((prev) => ({ ...prev, [subagentType]: '' }));

    try {
      await resetSubagentPreference(subagentType);
      await fetchData();
    } catch (err) {
      const message = err instanceof ApiClientError ? err.message : '重置配置失败';
      setSaveErrors((prev) => ({ ...prev, [subagentType]: message }));
    } finally {
      setResettingType(null);
    }
  };

  const getProviderDisplayName = (providerId: string | null | undefined): string => {
    if (!providerId) return '默认';
    const provider = providers.find((p) => p.providerId === providerId);
    return provider?.displayName || providerId;
  };

  const getEffectiveConfig = (subagentType: string) => {
    const def = definitions.find((d) => d.agentType === subagentType);
    const pref = preferences[subagentType];
    
    return {
      providerId: pref?.providerId ?? def?.providerPolicy.defaultProviderId ?? null,
      model: pref?.model ?? def?.providerPolicy.defaultModel ?? null,
      fallbackMode: pref?.fallbackMode ?? def?.providerPolicy.fallbackMode ?? 'any_compatible',
      hasOverride: !!pref && (!!pref.providerId || !!pref.model || pref.fallbackMode !== def?.providerPolicy.fallbackMode),
    };
  };

  if (!isAuthenticated) {
    return (
      <div className="settings-section">
        <h3>子代理配置</h3>
        <p className="settings-empty">请先登录以配置子代理</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="settings-section subagent-config">
        <h3>子代理配置</h3>
        <LoadingSpinner label="加载子代理配置..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="settings-section subagent-config">
        <h3>子代理配置</h3>
        <ErrorMessage error={error} retry={{ onClick: fetchData }} />
      </div>
    );
  }

  if (definitions.length === 0) {
    return (
      <div className="settings-section subagent-config">
        <h3>子代理配置</h3>
        <p className="settings-empty">暂无可用的子代理类型</p>
      </div>
    );
  }

  return (
    <div className="settings-section subagent-config">
      <div className="subagent-config-header">
        <h3>子代理配置</h3>
        <span className="subagent-config-hint">
          为每个子代理类型单独配置 LLM 提供商
        </span>
      </div>

      <div className="subagent-list">
        {definitions.map((def) => {
          const isExpanded = expandedType === def.agentType;
          const effective = getEffectiveConfig(def.agentType);
          const currentFormData = formData[def.agentType] || {
            providerId: '',
            model: '',
            fallbackMode: def.providerPolicy.fallbackMode,
          };
          const saveError = saveErrors[def.agentType];

          return (
            <div key={def.agentType} className="subagent-card">
              <div
                className="subagent-card-header"
                onClick={() => handleToggleExpand(def.agentType)}
                data-testid={`subagent-card-${def.agentType}`}
              >
                <div className="subagent-info">
                  <span className="subagent-name">{def.displayName}</span>
                  <span className="subagent-type-badge">{def.agentType}</span>
                  {effective.hasOverride && (
                    <span className="subagent-override-badge">已配置</span>
                  )}
                </div>
                <div className="subagent-effective-info">
                  <span className="effective-provider">
                    {getProviderDisplayName(effective.providerId)}
                  </span>
                  {effective.model && (
                    <span className="effective-model">{effective.model}</span>
                  )}
                </div>
                <button
                  className="subagent-expand-btn"
                  aria-expanded={isExpanded}
                  data-testid={`subagent-expand-${def.agentType}`}
                >
                  {isExpanded ? '收起' : '展开'}
                </button>
              </div>

              {isExpanded && (
                <div className="subagent-card-body">
                  <p className="subagent-description">{def.description}</p>
                  {(def.providerPolicy.requiredCapabilities?.length ?? 0) > 0 && (
                    <div className="subagent-capabilities">
                      <span className="capabilities-label">能力:</span>
                      <div className="capabilities-list">
                        {def.providerPolicy.requiredCapabilities?.map((cap) => (
                          <span key={cap} className="capability-tag">{cap}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="subagent-form">
                    <div className="form-group">
                      <label htmlFor={`provider-${def.agentType}`}>服务提供商</label>
                      <select
                        id={`provider-${def.agentType}`}
                        value={currentFormData.providerId}
                        onChange={(e) =>
                          handleInputChange(def.agentType, 'providerId', e.target.value)
                        }
                        className="input-field"
                        data-testid={`subagent-provider-${def.agentType}`}
                      >
                        <option value="">使用默认</option>
                        {providers.map((provider) => (
                          <option key={provider.providerId} value={provider.providerId}>
                            {provider.displayName}
                          </option>
                        ))}
                      </select>
                      <span className="form-hint">留空则使用全局默认提供商</span>
                    </div>

                    <div className="form-group">
                      <label htmlFor={`model-${def.agentType}`}>模型</label>
                      <input
                        id={`model-${def.agentType}`}
                        type="text"
                        value={currentFormData.model}
                        onChange={(e) =>
                          handleInputChange(def.agentType, 'model', e.target.value)
                        }
                        placeholder="例如: gpt-4, claude-3-opus"
                        className="input-field"
                        data-testid={`subagent-model-${def.agentType}`}
                      />
                      <span className="form-hint">留空则使用提供商默认模型</span>
                    </div>

                    <div className="form-group">
                      <label htmlFor={`fallback-${def.agentType}`}>失败模式</label>
                      <select
                        id={`fallback-${def.agentType}`}
                        value={currentFormData.fallbackMode}
                        onChange={(e) =>
                          handleInputChange(def.agentType, 'fallbackMode', e.target.value as SubagentFallbackMode)
                        }
                        className="input-field"
                        data-testid={`subagent-fallback-${def.agentType}`}
                      >
                        {FALLBACK_MODE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <span className="form-hint">
                        {FALLBACK_MODE_OPTIONS.find((o) => o.value === currentFormData.fallbackMode)?.description}
                      </span>
                    </div>

                    {saveError && (
                      <div className="subagent-save-error" data-testid={`subagent-error-${def.agentType}`}>
                        {saveError}
                      </div>
                    )}

                    <div className="subagent-actions">
                      <button
                        className="secondary-button"
                        onClick={() => handleReset(def.agentType)}
                        disabled={savingType === def.agentType || resettingType === def.agentType}
                        data-testid={`subagent-reset-${def.agentType}`}
                      >
                        {resettingType === def.agentType ? '重置中...' : '重置'}
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => handleSave(def.agentType)}
                        disabled={savingType === def.agentType || resettingType === def.agentType}
                        data-testid={`subagent-save-${def.agentType}`}
                      >
                        {savingType === def.agentType ? '保存中...' : '保存配置'}
                      </button>
                    </div>
                  </div>

                  <div className="subagent-effective-section">
                    <h4>当前生效配置</h4>
                    <div className="effective-config-grid">
                      <div className="effective-item">
                        <span className="effective-label">提供商:</span>
                        <span className={`effective-value${!effective.providerId ? ' not-configured' : ''}`}>
                          {effective.providerId ? getProviderDisplayName(effective.providerId) : '未配置'}
                        </span>
                      </div>
                      <div className="effective-item">
                        <span className="effective-label">模型:</span>
                        <span className={`effective-value${!effective.model ? ' not-configured' : ''}`}>
                          {effective.model ?? '未配置'}
                        </span>
                      </div>
                      <div className="effective-item">
                        <span className="effective-label">失败模式:</span>
                        <span className="effective-value">
                          {FALLBACK_MODE_OPTIONS.find((o) => o.value === effective.fallbackMode)?.label}
                        </span>
                      </div>
                      <div className="effective-item">
                        <span className="effective-label">用户覆盖:</span>
                        <span className={`effective-value ${effective.hasOverride ? 'has-override' : ''}`}>
                          {effective.hasOverride ? '已启用' : '未设置'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SubagentConfig;
