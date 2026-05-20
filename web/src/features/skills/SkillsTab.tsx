import React, { useEffect, useState } from 'react';
import { getSkills } from '../../api/client';
import type { SkillSummary } from '../../api/types';
import LoadingSpinner from '../../components/LoadingSpinner';

interface SkillsData {
  skills: SkillSummary[];
  loading: boolean;
  error: boolean;
}

const SkillsTab: React.FC = () => {
  const [data, setData] = useState<SkillsData>({
    skills: [],
    loading: true,
    error: false,
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await getSkills();
        setData({
          skills: response.skills,
          loading: false,
          error: false,
        });
      } catch {
        setData({
          skills: [],
          loading: false,
          error: true,
        });
      }
    };

    fetchData();
  }, []);

  const { skills, loading, error } = data;

  const getTypeBadgeClass = (type: string): string => {
    switch (type.toLowerCase()) {
      case 'native':
        return 'type-badge native';
      case 'mcp':
        return 'type-badge mcp';
      case 'custom':
        return 'type-badge custom';
      default:
        return 'type-badge';
    }
  };

  return (
    <div data-testid="skills-panel" className="skills-panel">
      <div className="content-header">
        <h2>技能</h2>
      </div>

      <div className="content-body">
        {loading && (
          <div className="skills-loading" data-testid="skills-loading">
            <LoadingSpinner label="加载技能数据..." />
          </div>
        )}

        {error && (
          <div className="skills-error" data-testid="skills-error">
            无法加载技能数据
          </div>
        )}

        {!loading && !error && skills.length === 0 && (
          <div className="skills-empty-state" data-testid="skills-empty-state">
            <p>暂无技能配置</p>
          </div>
        )}

        {!loading && !error && skills.length > 0 && (
          <div className="skills-list" data-testid="skills-list">
            {skills.map((skill, index) => (
              <div
                key={skill.skillId}
                className="skill-card"
                data-testid={`skill-card-${index}`}
              >
                <div className="skill-header">
                  <span className="skill-name">{skill.name}</span>
                  <span className={getTypeBadgeClass(skill.type)}>
                    {skill.type}
                  </span>
                </div>
                <div className="skill-id">ID: {skill.skillId}</div>
                <div className="skill-status">
                  {skill.enabled ? (
                    <span className="enabled-badge" data-testid={`skill-enabled-${index}`}>
                      ✓ 已启用
                    </span>
                  ) : (
                    <span className="disabled-badge">✗ 已禁用</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsTab;
