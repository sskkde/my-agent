import React, { useEffect, useState, useCallback, useRef } from 'react'
import * as client from '../../api/client'
import type { WorkdirInfo, WorkdirTreeNode, WorkdirFileContent } from '../../api/types'

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
  const [previewFile, setPreviewFile] = useState<WorkdirFileContent | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const sessionIdRef = useRef(sessionId)
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  const fetchWorkdir = useCallback(async () => {
    if (!sessionId) {
      setActiveWorkdir(null)
      setLoading(false)
      setError(null)
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

  const handleFileClick = useCallback(
    async (relativePath: string) => {
      const workdirId = activeWorkdirIdRef.current
      if (!workdirId) return
      setPreviewLoading(true)
      setPreviewError(null)
      setPreviewFile(null)
      try {
        const content = await client.readWorkdirFile(workdirId, relativePath)
        if (workdirId === activeWorkdirIdRef.current) {
          setPreviewFile(content)
        }
      } catch (err) {
        if (workdirId === activeWorkdirIdRef.current) {
          const status = (err as unknown as { status?: number })?.status
          if (status === 413) {
            setPreviewError('文件过大无法预览')
          } else {
            setPreviewError(err instanceof Error ? err.message : 'Failed to load file')
          }
        }
      } finally {
        if (workdirId === activeWorkdirIdRef.current) {
          setPreviewLoading(false)
        }
      }
    },
    [],
  )

  const handleClosePreview = useCallback(() => {
    setPreviewFile(null)
    setPreviewError(null)
    setPreviewLoading(false)
  }, [])

  const handleUploadClick = useCallback(() => {
    setUploadError(null)
    fileInputRef.current?.click()
  }, [])

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      const workdirId = activeWorkdirIdRef.current
      if (!workdirId) return

      setUploading(true)
      setUploadError(null)
      try {
        const content = await file.text()
        await client.uploadWorkdirFile(workdirId, file.name, content)
        if (workdirId === activeWorkdirIdRef.current) {
          await loadTree('')
        }
      } catch (err) {
        if (workdirId === activeWorkdirIdRef.current) {
          const status = (err as unknown as { status?: number })?.status
          if (status === 409) {
            setUploadError('同名文件已存在')
          } else if (status === 413) {
            setUploadError('文件过大')
          } else {
            setUploadError(err instanceof Error ? err.message : '上传失败')
          }
        }
      } finally {
        if (workdirId === activeWorkdirIdRef.current) {
          setUploading(false)
        }
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [loadTree],
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
          onClick={() => (isDir ? handleToggleDir(node.relativePath) : handleFileClick(node.relativePath))}
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
          <div className="desk-workdir-card__header">
            <button
              className="desk-upload-btn"
              onClick={handleUploadClick}
              disabled={uploading}
              title="仅支持文本文件"
              data-testid="desk-upload-btn"
            >
              {uploading ? '上传中...' : '放到书桌'}
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelected}
              style={{ display: 'none' }}
              data-testid="desk-file-input"
            />
          </div>
          {uploadError && (
            <div className="desk-upload-error" data-testid="desk-upload-error">
              {uploadError}
            </div>
          )}
          <div className="desk-workdir-card__workdir-name">{activeWorkdir.name}</div>
          <div className="desk-tree" data-testid="desk-tree">
            {(treeCache[''] || []).map((node) =>
              renderTreeNode(node, 0),
            )}
          </div>
          {(previewLoading || previewError || previewFile) && (
            <div className="desk-file-preview" data-testid="desk-file-preview">
              <div className="desk-file-preview__header">
                <span className="desk-file-preview__path">
                  {previewFile?.path || '加载中...'}
                </span>
                <button
                  className="desk-file-preview__close"
                  onClick={handleClosePreview}
                  data-testid="desk-file-preview-close"
                >
                  关闭
                </button>
              </div>
              {previewLoading ? (
                <div className="desk-file-preview__loading">⏳ 加载中...</div>
              ) : previewError ? (
                <div className="desk-file-preview__error">{previewError}</div>
              ) : previewFile ? (
                <>
                  <pre className="desk-file-preview__content" data-testid="desk-file-preview-content">
                    {previewFile.content}
                  </pre>
                  <div className="desk-file-preview__meta">
                    <span>{previewFile.sizeBytes} 字节</span>
                    <span>修改于 {new Date(previewFile.modifiedAt).toLocaleString()}</span>
                  </div>
                </>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DeskWorkdirCard
