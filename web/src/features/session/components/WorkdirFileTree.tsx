import React, { useCallback } from 'react'
import type { WorkdirTreeNode } from '../../../api/types'

export interface WorkdirFileTreeProps {
  nodes: WorkdirTreeNode[]
  loading: boolean
  error: string | null
  onFileClick: (path: string) => void
  onRefresh: () => void
  onCreateFolder?: (path: string) => void
  onCreateFile?: (path: string) => void
  onDelete?: (path: string) => void
  onRename?: (oldPath: string, newPath: string) => void
  workdirId: string | null
}

const FileTreeNode: React.FC<{
	  node: WorkdirTreeNode
	  onFileClick: (path: string) => void
	  onDelete?: (path: string) => void
	  onRename?: (oldPath: string, newPath: string) => void
	}> = ({ node, onFileClick, onDelete, onRename }) => {
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [renaming, setRenaming] = React.useState(false)
  const [renameValue, setRenameValue] = React.useState(node.name)

  const handleClick = useCallback(() => {
    if (node.type === 'file') {
      onFileClick(node.relativePath)
    }
  }, [node, onFileClick])

  const handleDelete = useCallback(() => {
    if (confirmDelete) {
      onDelete?.(node.relativePath)
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
    }
  }, [confirmDelete, node.relativePath, onDelete])

  const handleRenameSubmit = useCallback(() => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== node.name && onRename) {
      // Build new path by replacing the last segment
      const dir = node.relativePath.substring(0, node.relativePath.lastIndexOf('/'))
      const newPath = dir ? `${dir}/${trimmed}` : trimmed
      onRename(node.relativePath, newPath)
    }
    setRenaming(false)
  }, [renameValue, node, onRename])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleRenameSubmit()
      } else if (e.key === 'Escape') {
        setRenaming(false)
        setRenameValue(node.name)
      }
    },
    [handleRenameSubmit, node.name],
  )

  return (
    <div
      className={`workdir-tree-node workdir-tree-node--${node.type}`}
      data-testid={`workdir-tree-node-${node.name}`}
      onClick={handleClick}
      role={node.type === 'file' ? 'button' : undefined}
      tabIndex={node.type === 'file' ? 0 : undefined}
      onKeyDown={node.type === 'file' ? (e) => e.key === 'Enter' && handleClick() : undefined}
    >
      <div className="workdir-tree-node-content">
        <span className="workdir-tree-node-icon">{node.type === 'directory' ? '📂' : '📄'}</span>
        {renaming ? (
          <input
            type="text"
            className="workdir-tree-rename-input"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            data-testid="workdir-tree-rename-input"
          />
        ) : (
          <span className="workdir-tree-node-name">{node.name}</span>
        )}
      </div>

      {/* Action buttons for files */}
      {node.type === 'file' && !renaming && (
        <div className="workdir-tree-node-actions">
          {onRename && (
            <button
              className="workdir-tree-action-btn"
              onClick={(e) => {
                e.stopPropagation()
                setRenaming(true)
              }}
              data-testid="workdir-tree-rename-btn"
              title="重命名"
            >
              ✏️
            </button>
          )}
          {confirmDelete ? (
            <div className="workdir-tree-confirm-delete" data-testid="workdir-tree-confirm-delete">
              <button
                className="workdir-tree-confirm-btn workdir-tree-confirm-btn--danger"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
                data-testid="workdir-tree-confirm-delete-yes"
              >
                确认
              </button>
              <button
                className="workdir-tree-confirm-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  setConfirmDelete(false)
                }}
                data-testid="workdir-tree-confirm-delete-no"
              >
                取消
              </button>
            </div>
          ) : (
            onDelete && (
              <button
                className="workdir-tree-action-btn workdir-tree-action-btn--danger"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
                data-testid="workdir-tree-delete-btn"
                title="删除"
              >
                🗑️
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

export const WorkdirFileTree: React.FC<WorkdirFileTreeProps> = ({
  nodes,
  loading,
  error,
  onFileClick,
  onRefresh,
  onCreateFolder,
  onCreateFile,
  onDelete,
  onRename,
  workdirId,
}) => {
  const [creatingPath, setCreatingPath] = React.useState<string | null>(null)
  const [creatingType, setCreatingType] = React.useState<'file' | 'folder'>('file')
  const [newEntryName, setNewEntryName] = React.useState('')

  const handleCreateSubmit = useCallback(() => {
    const trimmed = newEntryName.trim()
    if (!trimmed || !creatingPath) return
    const fullPath = creatingPath ? `${creatingPath}/${trimmed}` : trimmed
    if (creatingType === 'folder') {
      onCreateFolder?.(fullPath)
    } else {
      onCreateFile?.(fullPath)
    }
    setCreatingPath(null)
    setNewEntryName('')
  }, [newEntryName, creatingPath, creatingType, onCreateFolder, onCreateFile])

  const handleCreateKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleCreateSubmit()
      } else if (e.key === 'Escape') {
        setCreatingPath(null)
        setNewEntryName('')
      }
    },
    [handleCreateSubmit],
  )

  if (!workdirId) {
    return (
      <div className="workdir-file-tree workdir-file-tree--empty" data-testid="workdir-file-tree">
        <p className="workdir-file-tree-hint">选择一个工作目录以浏览文件</p>
      </div>
    )
  }

  return (
    <div className="workdir-file-tree" data-testid="workdir-file-tree">
      {/* Toolbar */}
      <div className="workdir-file-tree-toolbar">
        <button
          className="workdir-file-tree-toolbar-btn"
          onClick={onRefresh}
          disabled={loading}
          data-testid="workdir-tree-refresh"
          title="刷新"
        >
          🔄
        </button>
        {onCreateFolder && (
          <button
            className="workdir-file-tree-toolbar-btn"
            onClick={() => {
              setCreatingPath('')
              setCreatingType('folder')
            }}
            data-testid="workdir-tree-new-folder"
            title="新建文件夹"
          >
            📁+
          </button>
        )}
        {onCreateFile && (
          <button
            className="workdir-file-tree-toolbar-btn"
            onClick={() => {
              setCreatingPath('')
              setCreatingType('file')
            }}
            data-testid="workdir-tree-new-file"
            title="新建文件"
          >
            📄+
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="workdir-file-tree-error" data-testid="workdir-tree-error">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="workdir-file-tree-loading" data-testid="workdir-tree-loading">
          加载中...
        </div>
      )}

      {/* Tree nodes */}
      {!loading && !error && (
        <div className="workdir-file-tree-list">
          {nodes.length === 0 ? (
            <div className="workdir-file-tree-empty" data-testid="workdir-tree-empty">
              空目录
            </div>
          ) : (
            nodes.map((node) => (
              <FileTreeNode
                key={node.relativePath}
	                node={node}
	                onFileClick={onFileClick}
	                onDelete={onDelete}
	                onRename={onRename}
              />
            ))
          )}
        </div>
      )}

      {/* Create entry form */}
      {creatingPath !== null && (
        <div className="workdir-tree-create-form" data-testid="workdir-tree-create-form">
          <input
            type="text"
            className="workdir-tree-create-input"
            value={newEntryName}
            onChange={(e) => setNewEntryName(e.target.value)}
            onKeyDown={handleCreateKeyDown}
            placeholder={creatingType === 'folder' ? '文件夹名称...' : '文件名称...'}
            autoFocus
            data-testid="workdir-tree-create-input"
          />
          <div className="workdir-tree-create-actions">
            <button
              className="workdir-tree-create-confirm"
              onClick={handleCreateSubmit}
              disabled={!newEntryName.trim()}
              data-testid="workdir-tree-create-confirm"
            >
              创建
            </button>
            <button
              className="workdir-tree-create-cancel"
              onClick={() => {
                setCreatingPath(null)
                setNewEntryName('')
              }}
              data-testid="workdir-tree-create-cancel"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
