import React, { useEffect, useState, useCallback } from 'react';
import * as client from '../../api/client';
import type { MemoryItem } from '../../api/types';

const MemoryTab: React.FC = () => {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMemory, setSelectedMemory] = useState<MemoryItem | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchMemories = useCallback(async (query?: string) => {
    setLoading(true);
    setError(false);
    try {
      const result = await client.getMemories({ query, limit: 50 });
      setMemories(result.memories);
      setTotal(result.total);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const handleSearch = () => {
    fetchMemories(searchQuery || undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handleDelete = async (memoryId: string) => {
    if (!window.confirm('确定要删除这条记忆吗？')) return;
    setDeleting(memoryId);
    try {
      await client.deleteMemory(memoryId);
      setMemories(prev => prev.filter(m => m.memoryId !== memoryId));
      setTotal(prev => prev - 1);
      if (selectedMemory?.memoryId === memoryId) setSelectedMemory(null);
    } catch (err) {
      console.error('Failed to delete memory:', err);
    } finally {
      setDeleting(null);
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      user_profile: '用户画像',
      user_preference: '用户偏好',
      user_safety_rule: '安全规则',
      project_state: '项目状态',
    };
    return labels[type] || type;
  };

  const getSensitivityLabel = (s: string) => {
    const labels: Record<string, string> = {
      low: '低',
      medium: '中',
      high: '高',
      restricted: '受限',
    };
    return labels[s] || s;
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString('zh-CN');
    } catch {
      return dateStr;
    }
  };

  return (
    <div data-testid="memory-tab" className="memory-tab">
      <h2>记忆管理</h2>

      <div className="memory-search-bar">
        <input
          data-testid="memory-search-input"
          type="text"
          placeholder="搜索记忆..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="memory-search-input"
        />
        <button onClick={handleSearch} className="memory-search-btn">搜索</button>
      </div>

      {loading && (
        <div data-testid="memory-loading" className="memory-loading">加载中...</div>
      )}

      {error && (
        <div data-testid="memory-error" className="memory-error">加载记忆失败</div>
      )}

      {!loading && !error && (
        <>
          <div data-testid="memory-count" className="memory-count">
            共 {total} 条记忆
          </div>

          <div className="memory-layout">
            <div className="memory-list">
              {memories.map(memory => (
                <div
                  key={memory.memoryId}
                  data-testid="memory-row"
                  className={`memory-row ${selectedMemory?.memoryId === memory.memoryId ? 'selected' : ''}`}
                  onClick={() => setSelectedMemory(memory)}
                >
                  <div className="memory-row-main">
                    <span className="memory-text">{memory.content?.substring(0, 100)}</span>
                  </div>
                  <div className="memory-row-meta">
                    <span className="memory-type">{getTypeLabel(memory.type)}</span>
                    <span className={`memory-sensitivity sensitivity-${memory.sensitivity}`}>
                      {getSensitivityLabel(memory.sensitivity)}
                    </span>
                    <span className="memory-date">{formatDate(memory.createdAt)}</span>
                  </div>
                  <button
                    data-testid={`memory-delete-${memory.memoryId}`}
                    className="memory-delete-btn"
                    onClick={e => { e.stopPropagation(); handleDelete(memory.memoryId); }}
                    disabled={deleting === memory.memoryId}
                  >
                    {deleting === memory.memoryId ? '删除中...' : '删除'}
                  </button>
                </div>
              ))}
              {memories.length === 0 && (
                <div className="memory-empty">暂无记忆</div>
              )}
            </div>

            {selectedMemory && (
              <div className="memory-detail">
                <h3>记忆详情</h3>
                <div className="memory-detail-field">
                  <label>ID</label>
                  <span>{selectedMemory.memoryId}</span>
                </div>
                <div className="memory-detail-field">
                  <label>类型</label>
                  <span>{getTypeLabel(selectedMemory.type)}</span>
                </div>
                <div className="memory-detail-field">
                  <label>敏感度</label>
                  <span>{getSensitivityLabel(selectedMemory.sensitivity)}</span>
                </div>
                <div className="memory-detail-field">
                  <label>生命周期</label>
                  <span>{selectedMemory.lifecycle?.status || 'active'}</span>
                </div>
                <div className="memory-detail-field">
                  <label>创建时间</label>
                  <span>{formatDate(selectedMemory.createdAt)}</span>
                </div>
                <div className="memory-detail-content">
                  <label>内容</label>
                  <p>{selectedMemory.content}</p>
                </div>
                {selectedMemory.keywords && selectedMemory.keywords.length > 0 && (
                  <div className="memory-detail-field">
                    <label>关键词</label>
                    <div className="memory-keywords">
                      {selectedMemory.keywords.map((kw, i) => (
                        <span key={i} className="memory-keyword-tag">{kw}</span>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  data-testid={`memory-delete-${selectedMemory.memoryId}`}
                  className="memory-delete-btn memory-delete-detail"
                  onClick={() => handleDelete(selectedMemory.memoryId)}
                  disabled={deleting === selectedMemory.memoryId}
                >
                  {deleting === selectedMemory.memoryId ? '删除中...' : '删除此记忆'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MemoryTab;
