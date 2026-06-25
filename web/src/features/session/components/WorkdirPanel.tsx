import React, { useCallback } from 'react'
import { WorkdirSelector } from './WorkdirSelector'
import { WorkdirFileTree } from './WorkdirFileTree'
import { WorkdirFileEditor } from './WorkdirFileEditor'
import type { UseWorkdirReturn } from '../hooks/useWorkdir'

export interface WorkdirPanelProps {
  sessionId: string
  workdirState: UseWorkdirReturn
}

export const WorkdirPanel: React.FC<WorkdirPanelProps> = ({ workdirState }) => {
  const {
    workdirs,
    workdirsLoading,
    workdirsError,
    activeWorkdir,
    activeWorkdirLoading,
    activeWorkdirError,
    fileTree,
    fileTreeLoading,
    fileTreeError,
    openFile,
    openFileLoading,
    openFileError,
    editContent,
    editDirty,
    saving,
    saveError,
    handleCreateWorkdir,
    handleSwitchWorkdir,
    handleClearWorkdir,
    handleLoadTree,
    handleReadFile,
    handleEditChange,
    handleSaveFile,
    handleCloseEditor,
    handleCreateFolder: createFolderAction,
    handleCreateFile: createFileAction,
    handleDeleteEntry,
    handleRenameEntry,
    clearErrors,
  } = workdirState

  const handleRefreshTree = useCallback(() => {
    if (activeWorkdir) {
      handleLoadTree(activeWorkdir.id)
    }
  }, [activeWorkdir, handleLoadTree])

  const handleFileClick = useCallback(
    (path: string) => {
      if (activeWorkdir) {
        handleReadFile(activeWorkdir.id, path)
      }
    },
    [activeWorkdir, handleReadFile],
  )

  const handleSave = useCallback(() => {
    if (activeWorkdir && openFile) {
      handleSaveFile(activeWorkdir.id, openFile.path)
    }
  }, [activeWorkdir, openFile, handleSaveFile])

  const handleCreateFolder = useCallback(
    (path: string) => {
      if (activeWorkdir) {
        createFolderAction(activeWorkdir.id, path)
      }
    },
    [activeWorkdir, createFolderAction],
  )

  const handleCreateFile = useCallback(
    (path: string) => {
      if (activeWorkdir) {
        createFileAction(activeWorkdir.id, path)
      }
    },
    [activeWorkdir, createFileAction],
  )

  const handleDelete = useCallback(
    (path: string) => {
      if (activeWorkdir) {
        handleDeleteEntry(activeWorkdir.id, path)
      }
    },
    [activeWorkdir, handleDeleteEntry],
  )

  const handleRename = useCallback(
    (oldPath: string, newPath: string) => {
      if (activeWorkdir) {
        handleRenameEntry(activeWorkdir.id, oldPath, newPath)
      }
    },
    [activeWorkdir, handleRenameEntry],
  )

  React.useEffect(() => {
    if (activeWorkdir) {
      handleLoadTree(activeWorkdir.id)
    }
  }, [activeWorkdir?.id, handleLoadTree])

  // Workdir-level errors
  const hasErrors = workdirsError || activeWorkdirError

  return (
    <div className="workdir-panel" data-testid="workdir-panel">
      {/* Selector row */}
      <div className="workdir-panel-header">
        <WorkdirSelector
          workdirs={workdirs}
          activeWorkdir={activeWorkdir}
          loading={workdirsLoading || activeWorkdirLoading}
          onSelect={handleSwitchWorkdir}
          onCreate={handleCreateWorkdir}
          onClear={handleClearWorkdir}
        />
      </div>

      {/* Error display */}
      {hasErrors && (
        <div className="workdir-panel-error" data-testid="workdir-panel-error">
          {workdirsError || activeWorkdirError}
          <button className="workdir-panel-error-dismiss" onClick={clearErrors} data-testid="workdir-panel-error-dismiss">
            ✕
          </button>
        </div>
      )}

      {/* Content: Tree + Editor */}
      {activeWorkdir && (
        <div className="workdir-panel-content">
          {/* File tree */}
          <div className="workdir-panel-tree">
            <WorkdirFileTree
              nodes={fileTree}
              loading={fileTreeLoading}
              error={fileTreeError}
              onFileClick={handleFileClick}
              onRefresh={handleRefreshTree}
              onCreateFolder={handleCreateFolder}
              onCreateFile={handleCreateFile}
              onDelete={handleDelete}
              onRename={handleRename}
              workdirId={activeWorkdir.id}
            />
          </div>

          {/* File editor (if open) */}
          {openFile && (
            <div className="workdir-panel-editor">
              <WorkdirFileEditor
                file={openFile}
                loading={openFileLoading}
                error={openFileError}
                content={editContent}
                dirty={editDirty}
                saving={saving}
                saveError={saveError}
                onContentChange={handleEditChange}
                onSave={handleSave}
                onClose={handleCloseEditor}
              />
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!activeWorkdir && !workdirsLoading && !activeWorkdirLoading && (
        <div className="workdir-panel-empty" data-testid="workdir-panel-empty">
          <p>选择或创建一个工作目录开始浏览文件</p>
        </div>
      )}
    </div>
  )
}
