/**
 * useWorkdir - Hook for managing workdir state per session
 *
 * Manages:
 * - Workdir list fetching and CRUD
 * - Active workdir selection per session
 * - File tree browsing
 * - Text file read/write
 * - Create folder/file, rename/delete with confirmation states
 * - Error display without crashing parent UI
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import * as api from '../../../api/client'
import type {
  WorkdirInfo,
  WorkdirTreeNode,
  WorkdirFileContent,
} from '../../../api/types'

export interface UseWorkdirReturn {
  /** List of user workdirs */
  workdirs: WorkdirInfo[]
  /** Whether workdir list is loading */
  workdirsLoading: boolean
  /** Workdir list error message */
  workdirsError: string | null
  /** Currently active workdir for this session */
  activeWorkdir: WorkdirInfo | null
  /** Whether active workdir is loading */
  activeWorkdirLoading: boolean
  /** Active workdir error message */
  activeWorkdirError: string | null
  /** File tree for current browsing path */
  fileTree: WorkdirTreeNode[]
  /** Whether file tree is loading */
  fileTreeLoading: boolean
  /** File tree error message */
  fileTreeError: string | null
  /** Currently read file content */
  openFile: WorkdirFileContent | null
  /** Whether file content is loading */
  openFileLoading: boolean
  /** File read error message */
  openFileError: string | null
  /** Current editing content for open file */
  editContent: string
  /** Whether edit content differs from saved */
  editDirty: boolean
  /** Whether save is in progress */
  saving: boolean
  /** Save error message */
  saveError: string | null

  // Actions
  /** Fetch all workdirs */
  fetchWorkdirs: () => Promise<void>
  /** Create a new workdir */
  handleCreateWorkdir: (name: string) => Promise<WorkdirInfo | null>
  /** Switch active workdir for this session */
  handleSwitchWorkdir: (workdirId: string) => Promise<void>
  /** Clear active workdir for this session */
  handleClearWorkdir: () => Promise<void>
  /** Delete a workdir (requires confirmation at UI level) */
  handleDeleteWorkdir: (workdirId: string) => Promise<void>
  /** Rename a workdir */
  handleRenameWorkdir: (workdirId: string, newName: string) => Promise<void>
  /** Load file tree for a workdir at optional path */
  handleLoadTree: (workdirId: string, path?: string) => Promise<void>
  /** Read a file */
  handleReadFile: (workdirId: string, path: string) => Promise<void>
  /** Update edit content */
  handleEditChange: (content: string) => void
  /** Save current edit content */
  handleSaveFile: (workdirId: string, path: string) => Promise<void>
  /** Close open file editor */
  handleCloseEditor: () => void
  /** Create a folder */
  handleCreateFolder: (workdirId: string, path: string) => Promise<void>
  /** Create a file */
  handleCreateFile: (workdirId: string, path: string) => Promise<void>
  /** Delete an entry (file or folder) */
  handleDeleteEntry: (workdirId: string, path: string) => Promise<void>
  /** Rename an entry */
  handleRenameEntry: (workdirId: string, oldPath: string, newPath: string) => Promise<void>
  /** Clear all errors */
  clearErrors: () => void
}

export function useWorkdir(sessionId: string | null): UseWorkdirReturn {
  const [workdirs, setWorkdirs] = useState<WorkdirInfo[]>([])
  const [workdirsLoading, setWorkdirsLoading] = useState(false)
  const [workdirsError, setWorkdirsError] = useState<string | null>(null)

  const [activeWorkdir, setActiveWorkdir] = useState<WorkdirInfo | null>(null)
  const [activeWorkdirLoading, setActiveWorkdirLoading] = useState(false)
  const [activeWorkdirError, setActiveWorkdirError] = useState<string | null>(null)

  const [fileTree, setFileTree] = useState<WorkdirTreeNode[]>([])
  const [fileTreeLoading, setFileTreeLoading] = useState(false)
  const [fileTreeError, setFileTreeError] = useState<string | null>(null)

  const [openFile, setOpenFile] = useState<WorkdirFileContent | null>(null)
  const [openFileLoading, setOpenFileLoading] = useState(false)
  const [openFileError, setOpenFileError] = useState<string | null>(null)

  const [editContent, setEditContent] = useState('')
  const [editDirty, setEditDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const mountedRef = useRef(true)

  // Fetch workdirs list
  const fetchWorkdirs = useCallback(async () => {
    if (!sessionId) return
    try {
      setWorkdirsLoading(true)
      setWorkdirsError(null)
      const response = await api.listWorkdirs()
      if (mountedRef.current) {
        setWorkdirs(response.workdirs)
      }
    } catch (err) {
      if (mountedRef.current) {
        setWorkdirsError(err instanceof Error ? err.message : 'Failed to load workdirs')
      }
    } finally {
      if (mountedRef.current) {
        setWorkdirsLoading(false)
      }
    }
  }, [sessionId])

  // Fetch active workdir for session
  const fetchActiveWorkdir = useCallback(async () => {
    if (!sessionId) return
    try {
      setActiveWorkdirLoading(true)
      setActiveWorkdirError(null)
      const response = await api.getSessionWorkdir(sessionId)
      if (mountedRef.current) {
        setActiveWorkdir(response.workdir)
      }
    } catch (err) {
      if (mountedRef.current) {
        setActiveWorkdirError(err instanceof Error ? err.message : 'Failed to load active workdir')
      }
    } finally {
      if (mountedRef.current) {
        setActiveWorkdirLoading(false)
      }
    }
  }, [sessionId])

  // Load workdirs and active workdir on session change
  useEffect(() => {
    mountedRef.current = true
    if (sessionId) {
      fetchWorkdirs()
      fetchActiveWorkdir()
    } else {
      setWorkdirs([])
      setActiveWorkdir(null)
      setFileTree([])
      setOpenFile(null)
      setEditContent('')
      setEditDirty(false)
    }
    return () => {
      mountedRef.current = false
    }
  }, [sessionId, fetchWorkdirs, fetchActiveWorkdir])

  // Create workdir
  const handleCreateWorkdir = useCallback(async (name: string): Promise<WorkdirInfo | null> => {
    if (!sessionId) return null
    try {
      setWorkdirsError(null)
      const response = await api.createWorkdir(name)
      const newWorkdir = response.workdir
      if (mountedRef.current && newWorkdir) {
        setWorkdirs((prev) => [...prev, newWorkdir])
        // Auto-switch to newly created workdir
        await api.setSessionWorkdir(sessionId, newWorkdir.id)
        if (mountedRef.current) {
          setActiveWorkdir(newWorkdir)
        }
      }
      return newWorkdir
    } catch (err) {
      if (mountedRef.current) {
        setWorkdirsError(err instanceof Error ? err.message : 'Failed to create workdir')
      }
      return null
    }
  }, [sessionId])

  // Switch workdir
  const handleSwitchWorkdir = useCallback(async (workdirId: string) => {
    if (!sessionId) return
    try {
      setActiveWorkdirError(null)
      await api.setSessionWorkdir(sessionId, workdirId)
      const workdir = workdirs.find((w) => w.id === workdirId)
      if (mountedRef.current) {
        setActiveWorkdir(workdir ?? null)
        // Reset file tree and editor when switching
        setFileTree([])
        setOpenFile(null)
        setEditContent('')
        setEditDirty(false)
      }
    } catch (err) {
      if (mountedRef.current) {
        setActiveWorkdirError(err instanceof Error ? err.message : 'Failed to switch workdir')
      }
    }
  }, [sessionId, workdirs])

  // Clear active workdir
  const handleClearWorkdir = useCallback(async () => {
    if (!sessionId) return
    try {
      setActiveWorkdirError(null)
      await api.clearSessionWorkdir(sessionId)
      if (mountedRef.current) {
        setActiveWorkdir(null)
        setFileTree([])
        setOpenFile(null)
        setEditContent('')
        setEditDirty(false)
      }
    } catch (err) {
      if (mountedRef.current) {
        setActiveWorkdirError(err instanceof Error ? err.message : 'Failed to clear workdir')
      }
    }
  }, [sessionId])

  // Delete workdir
  const handleDeleteWorkdir = useCallback(async (workdirId: string) => {
    try {
      setWorkdirsError(null)
      await api.deleteWorkdir(workdirId)
      if (mountedRef.current) {
        setWorkdirs((prev) => prev.filter((w) => w.id !== workdirId))
        if (activeWorkdir?.id === workdirId) {
          setActiveWorkdir(null)
          setFileTree([])
          setOpenFile(null)
          setEditContent('')
          setEditDirty(false)
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setWorkdirsError(err instanceof Error ? err.message : 'Failed to delete workdir')
      }
    }
  }, [activeWorkdir])

  // Rename workdir
  const handleRenameWorkdir = useCallback(async (workdirId: string, newName: string) => {
    try {
      setWorkdirsError(null)
      const response = await api.renameWorkdir(workdirId, newName)
      if (mountedRef.current && response.workdir) {
        setWorkdirs((prev) => prev.map((w) => (w.id === workdirId ? response.workdir! : w)))
        if (activeWorkdir?.id === workdirId) {
          setActiveWorkdir(response.workdir)
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setWorkdirsError(err instanceof Error ? err.message : 'Failed to rename workdir')
      }
    }
  }, [activeWorkdir])

  // Load file tree
  const handleLoadTree = useCallback(async (workdirId: string, path?: string) => {
    try {
      setFileTreeLoading(true)
      setFileTreeError(null)
      const response = await api.listWorkdirTree(workdirId, path)
      if (mountedRef.current) {
        setFileTree(response.tree)
      }
    } catch (err) {
      if (mountedRef.current) {
        setFileTreeError(err instanceof Error ? err.message : 'Failed to load file tree')
      }
    } finally {
      if (mountedRef.current) {
        setFileTreeLoading(false)
      }
    }
  }, [])

  // Read file
  const handleReadFile = useCallback(async (workdirId: string, path: string) => {
    try {
      setOpenFileLoading(true)
      setOpenFileError(null)
      const content = await api.readWorkdirFile(workdirId, path)
      if (mountedRef.current) {
        setOpenFile(content)
        setEditContent(content.content)
        setEditDirty(false)
        setSaveError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        setOpenFileError(err instanceof Error ? err.message : 'Failed to read file')
      }
    } finally {
      if (mountedRef.current) {
        setOpenFileLoading(false)
      }
    }
  }, [])

  // Edit change
  const handleEditChange = useCallback((content: string) => {
    setEditContent(content)
    setEditDirty(true)
  }, [])

  // Save file
  const handleSaveFile = useCallback(async (workdirId: string, path: string) => {
    try {
      setSaving(true)
      setSaveError(null)
      await api.writeWorkdirFile(workdirId, path, editContent)
      if (mountedRef.current) {
        setEditDirty(false)
        // Update openFile with new content
        setOpenFile((prev) => (prev ? { ...prev, content: editContent } : null))
      }
    } catch (err) {
      if (mountedRef.current) {
        setSaveError(err instanceof Error ? err.message : 'Failed to save file')
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }, [editContent])

  // Close editor
  const handleCloseEditor = useCallback(() => {
    setOpenFile(null)
    setEditContent('')
    setEditDirty(false)
    setSaveError(null)
  }, [])

  // Create folder
  const handleCreateFolder = useCallback(async (workdirId: string, path: string) => {
    try {
      setFileTreeError(null)
      await api.createWorkdirDir(workdirId, path)
      // Reload tree
      const treeResponse = await api.listWorkdirTree(workdirId)
      if (mountedRef.current) {
        setFileTree(treeResponse.tree)
      }
    } catch (err) {
      if (mountedRef.current) {
        setFileTreeError(err instanceof Error ? err.message : 'Failed to create folder')
      }
    }
  }, [])

  // Create file (write empty content)
  const handleCreateFile = useCallback(async (workdirId: string, path: string) => {
    try {
      setFileTreeError(null)
      await api.writeWorkdirFile(workdirId, path, '')
      // Reload tree
      const treeResponse = await api.listWorkdirTree(workdirId)
      if (mountedRef.current) {
        setFileTree(treeResponse.tree)
      }
    } catch (err) {
      if (mountedRef.current) {
        setFileTreeError(err instanceof Error ? err.message : 'Failed to create file')
      }
    }
  }, [])

  // Delete entry (write empty content as delete isn't explicitly in API, but we can use createWorkdirDir workaround)
  // Note: The API doesn't have a delete entry endpoint, so this is a placeholder that shows the error pattern
  const handleDeleteEntry = useCallback(async (_workdirId: string, _path: string) => {
    // The current API does not expose a delete-entry endpoint.
    // This is a placeholder for when such an endpoint is added.
    if (mountedRef.current) {
      setFileTreeError('Delete is not yet supported via the API')
    }
  }, [])

  // Rename entry
  const handleRenameEntry = useCallback(async (_workdirId: string, _oldPath: string, _newPath: string) => {
    // The current API does not expose a rename-entry endpoint.
    // This is a placeholder for when such an endpoint is added.
    if (mountedRef.current) {
      setFileTreeError('Rename is not yet supported via the API')
    }
  }, [])

  // Clear errors
  const clearErrors = useCallback(() => {
    setWorkdirsError(null)
    setActiveWorkdirError(null)
    setFileTreeError(null)
    setOpenFileError(null)
    setSaveError(null)
  }, [])

  return {
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
    fetchWorkdirs,
    handleCreateWorkdir,
    handleSwitchWorkdir,
    handleClearWorkdir,
    handleDeleteWorkdir,
    handleRenameWorkdir,
    handleLoadTree,
    handleReadFile,
    handleEditChange,
    handleSaveFile,
    handleCloseEditor,
    handleCreateFolder,
    handleCreateFile,
    handleDeleteEntry,
    handleRenameEntry,
    clearErrors,
  }
}
