import React, { useEffect, useState, useCallback, useRef } from 'react'
import * as client from '../../api/client'
import type { WorkdirInfo, WorkdirTreeNode } from '../../api/client'

export interface DeskWorkdirCardProps {
  sessionId?: string | null
  className?: string
  testId?: string
}

const DeskWorkdirCard: React.FC<DeskWorkdirCardProps> = ({
  sessionId,
  className = '',
  testId = 'desk-workdir-card',
}) => {
  const [activeWorkdir, setActiveWorkdir] = useState<WorkdirInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [treeCache, setTreeCache] = useState<Record<string, WorkdirTreeNode[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [treeLoadingPaths, setTreeLoadingPaths] = useState<Set<string>>(new Set())
  const [treeErrorByPath, setTreeErrorByPath] = useState<Record<string, string>>({})

  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const fetchWorkdir = useCallback(async () => {
    if (!sessionId) {
      setActiveWorkdir(null)
      return
    }
    const currentSessionId = sessionId
    setLoading(true)
    setError(null)
    try {
      const response = await client.getSessionWorkdir(currentSessionId)
      if (currentSessionId === sessionIdRef.current) {
        setActiveWorkdir(response.workdir)
      }
    } catch (err) {
      if (currentSessionId === sessionIdRef.current) {
        setError(err instanceof Error ? err : new Error('Failed to load workdir'))
      }
    } finally {
      if (currentSessionId === sessionIdRef.current) {
        setLoading(false)
      }
    }
  }, [sessionId])

  useEffect(() => {
    fetchWorkdir()
  }, [fetchWorkdir])

  const activeWorkdirIdRef = useRef<string | null>(null)
  useEffect(() => {
    activeWorkdirIdRef.current = activeWorkdir?.id ?? null
  }, [activeWorkdir])

  const loadTree = useCallback(
    async (path: string) => {
      const workdirId = activeWorkdirIdRef.current
      if (!workdirId) return
      setTreeLoadingPaths((prev) => new Set(prev).add(path))
      setTreeErrorByPath((prev) => {
        const next = { ...prev }
        delete next[path]
        return next
      })
      try {
        const response = await client.listWorkdirTree(workdirId, path || undefined)
        if (workdirId === activeWorkdirIdRef.current) {
          setTreeCache((prev) => ({ ...prev, [path || '']: response.tree }))
        }
      } catch (err) {
        if (workdirId === activeWorkdirIdRef.current) {
          setTreeErrorByPath((prev) => ({
            ...prev,
            [path || '']: err instanceof Error ? err.message : 'Failed to load directory',
          }))
        }
      } finally {
        if (workdirId === activeWorkdirIdRef.current) {
          setTreeLoadingPaths((prev) => {
            const next = new Set(prev)
            next.delete(path)
            return next
          })
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (activeWorkdir) {
      setTreeCache({})
      setExpandedPaths(new Set())
      setTreeErrorByPath({})
      loadTree('')
    } else {
      setTreeCache({})
      setExpandedPaths(new Set())
    }
  }, [activeWorkdir, loadTree])

  const handleToggleDir = useCallback(
    (relativePath: string) => {
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        if (next.has(relativePath)) {
          next.delete(relativePath)
        } else {
          next.add(relativePath)
        }
        return next
      })
      if (!treeCache[relativePath]) {
        loadTree(relativePath)
      }
    },
    [treeCache, loadTree],
  )

  const renderTreeNode = (node: WorkdirTreeNode, depth: number): React.ReactNode => {
    const isDir = node.type === 'directory'
    const isExpanded = expandedPaths.has(node.relativePath)
    const children = treeCache[node.relativePath] || []
    const isLoading = treeLoadingPaths.has(node.relativePath)
    const childError = treeErrorByPath[node.relativePath]

    return (
      <div key={node.relativePath} className="desk-tree-node-wrapper">
        <div
          className={`desk-tree-node desk-tree-node--${node.type}`}
          style={{ paddingLeft: `${depth * 16}px`}}
          data-testid={`desk-tree-node-${node.relativePath}`}
          onClick={() => (isDir ? handleToggleDir(node.relativePath) : undefined)}
          role="treeitem"
        >
          <span className="desk-tree-node__chevron">
            {isDir ? (isExpanded ? '▼' : '▶') : ''}
          </span>
          <span className="desk-tree-node__icon">{isDir ? '📂' : '📄'}</span>
          <span className="desk-tree-node__name">{node.name}</span>
        </div>
        {isDir && isExpanded && (
          <div className="desk-tree-node__children">
            {isLoading ? (
              <div className="desk-tree-node__loading" style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
                <span>⏳</span>
              </div>
            ) : childError ? (
              <div className="desk-tree-node__error" style={{ paddingLeft: `${(depth + 1) * 16}px` }}>
                {childError}
              </div>
            ) : (
              children.map((child) => renderTreeNode(child, depth + 1))
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`desk-workdir-card ${className}`} data-testid={testId}>
      {loading ? (
        <div className="desk-loading">
          <span className="desk-loading__spinner">⏳</span>
          <span>加载中...</span>
        </div>
      ) : error ? (
        <div className="desk-error">
          <span className="desk-error__icon">⚠️</span>
          <span>加载失败</span>
          <button className="desk-error__retry" onClick={fetchWorkdir}>
            重试
          </button>
        </div>
      ) : !activeWorkdir ? (
        <div className="desk-empty" data-testid="desk-empty">
          <div className="desk-empty__icon">🗂️</div>
          <div className="desk-empty__text">
            <span className="desk-empty__title">暂无书桌内容</span>
            <span className="desk-empty__hint">选择工作目录后显示文件</span>
          </div>
        </div>
      ) : (
        <div className="desk-workdir-card__content" data-testid="desk-workdir-content">
          <div className="desk-workdir-card__workdir-name">{activeWorkdir.name}</div>
          <div className="desk-tree" data-testid="desk-tree">
            {(treeCache[''] || []).map((node) =>
              renderTreeNode(node, 0),
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default DeskWorkdirCard
