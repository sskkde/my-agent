# 书桌组件接入工作目录功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将聊天右侧栏「书桌」一栏接入后端工作目录功能——只读展示当前会话激活工作目录的文件树（支持目录展开），点击文件在右侧栏内只读预览，保留「放到书桌」按钮上传文本文件到工作目录。

**Architecture:** 新建 `DeskWorkdirCard` 组件，封装 workdir 概览逻辑（拉取激活 workdir → 文件树 → 只读预览 → 上传）。`ChatContextPanel` 用该组件替换书桌区的假数据和占位按钮。复用 `client.ts` 已封装的 4 个 API，不改后端、不改 `WorkdirPanel`。

**Tech Stack:** React 18 + TypeScript (strict, noUnusedLocals/Parameters) + Vitest + @testing-library/react + jsdom。路径别名 `@` → `src/`（vitest 配置，非 tsconfig）。

**Spec:** `docs/superpowers/specs/2026-07-05-desk-workdir-integration-design.md`

## Global Constraints

- TypeScript strict 模式：`noUnusedLocals` + `noUnusedParameters`，删除代码后不得留下未使用的 import / 变量 / 参数
- ESM 模块（`"type": "module"`），Target ES2022
- 测试用 vitest + jsdom，`vi.mock('../../api/client')` 模式 mock 整个 client 模块，用 `vi.mocked(client.fnName).mockResolvedValue(...)` 控制返回值
- 测试文件与被测文件同目录，命名 `*.test.tsx`
- 提交信息格式：`<type>(<scope>): <subject>`，type 用 feat/refactor/test/docs
- 不改动后端、不改动 `web/src/api/client.ts`、不改动 `WorkdirPanel`/`useWorkdir`/`WorkdirFileTree`/`WorkdirFileEditor`/`WorkdirSelector`、不改动 `TodoWorkPlanCard`
- client API 签名（必须按此调用）：
  - `getSessionWorkdir(sessionId: string): Promise<SessionWorkdirResponse>` 其中 `SessionWorkdirResponse = { workdir: WorkdirInfo | null }`
  - `listWorkdirTree(workdirId: string, path?: string): Promise<WorkdirTreeResponse>` 其中 `WorkdirTreeResponse = { tree: WorkdirTreeNode[]; path: string }`，`WorkdirTreeNode = { name: string; type: 'file'|'directory'; relativePath: string }`
  - `readWorkdirFile(workdirId: string, path: string): Promise<WorkdirFileContent>` 其中 `WorkdirFileContent = { path: string; content: string; sizeBytes: number; modifiedAt: string }`
  - `uploadWorkdirFile(workdirId: string, path: string, content: string): Promise<UploadWorkdirFileResponse>`（三个独立参数，不是对象）其中 `UploadWorkdirFileResponse = { path: string; sizeBytes: number; modifiedAt: string }`
- `WorkdirInfo = { id: string; userId: string; name: string; createdAt: string; updatedAt: string }`
- CSS 新增类放入 `web/src/features/session/chat/chat-theme.css`（书桌是聊天右侧栏的一部分，与该文件已有的 `.chat-desk-*` 类同源）
- 空状态文案：标题「暂无书桌内容」、副提示「选择工作目录后显示文件」、图标 `🗂️`
- 上传按钮文案「放到书桌」、上传中「上传中...」、按钮 title「仅支持文本文件」

---

## File Structure

| 文件 | 责任 | 操作 |
|------|------|------|
| `web/src/features/context/DeskWorkdirCard.tsx` | 只读 workdir 概览卡片（树 + 预览 + 上传） | 新建 |
| `web/src/features/context/DeskWorkdirCard.test.tsx` | DeskWorkdirCard 单测 | 新建 |
| `web/src/features/session/chat/ChatContextPanel.tsx` | 聊天右侧栏容器 | 修改 |
| `web/src/features/session/chat/ChatContextPanel.test.tsx` | 右侧栏单测 | 修改 |
| `web/src/features/session/chat/chat-theme.css` | 书桌相关 CSS | 修改（追加） |

---

### Task 1: 新建 DeskWorkdirCard 骨架 + workdir 加载 + 空状态（TDD）

**Files:**
- Create: `web/src/features/context/DeskWorkdirCard.tsx`
- Create: `web/src/features/context/DeskWorkdirCard.test.tsx`

**Interfaces:**
- Consumes: `client.getSessionWorkdir(sessionId)` from `../../api/client`；类型 `WorkdirInfo` from `../../api/client`
- Produces: `DeskWorkdirCard` 组件，props `{ sessionId?: string | null; className?: string; testId?: string }`，默认 `testId='desk-workdir-card'`；渲染 `.desk-loading` / `.desk-error` / `.desk-empty` / workdir 内容分支

- [ ] **Step 1: 写失败测试 — workdir 加载 + 空状态**

Create `web/src/features/context/DeskWorkdirCard.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import DeskWorkdirCard from './DeskWorkdirCard'
import * as client from '../../api/client'

vi.mock('../../api/client')

const TEST_SESSION_ID = 'ses_desk_test'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DeskWorkdirCard', () => {
  it('does not call getSessionWorkdir when sessionId is null', () => {
    render(<DeskWorkdirCard sessionId={null} />)
    expect(client.getSessionWorkdir).not.toHaveBeenCalled()
  })

  it('calls getSessionWorkdir with sessionId', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(client.getSessionWorkdir).toHaveBeenCalledWith(TEST_SESSION_ID)
    })
  })

  it('renders empty state when no active workdir', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('暂无书桌内容')).toBeInTheDocument()
    })
    expect(screen.getByText('选择工作目录后显示文件')).toBeInTheDocument()
  })

  it('renders error state with retry when getSessionWorkdir fails', async () => {
    vi.mocked(client.getSessionWorkdir).mockRejectedValue(new Error('Failed to load workdir'))

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('加载失败')).toBeInTheDocument()
    })
    expect(screen.getByText('重试')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: FAIL — `DeskWorkdirCard` 模块不存在（import 报错）。

- [ ] **Step 3: 实现最小 DeskWorkdirCard — workdir 加载 + 空状态**

Create `web/src/features/context/DeskWorkdirCard.tsx`:

```tsx
/**
 * DeskWorkdirCard - Displays the active workdir's file tree in the Desk section
 *
 * Read-only overview: lists files/directories of the session's active workdir,
 * supports directory expansion, click file for read-only preview, and an
 * upload button ("放到书桌") to upload a text file into the workdir.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react'
import * as client from '../../api/client'
import type { WorkdirInfo, WorkdirTreeNode, WorkdirFileContent } from '../../api/client'

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
          {/* Task 2 will add file tree; Task 3 will add preview; Task 4 will add upload */}
          <div className="desk-workdir-card__workdir-name">{activeWorkdir.name}</div>
        </div>
      )}
    </div>
  )
}

export default DeskWorkdirCard
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: PASS — 4 个测试全部通过。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS — 无新错误（预存的 mcp-servers/ 和 tests/e2e/ 错误与本次无关）。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/context/DeskWorkdirCard.tsx web/src/features/context/DeskWorkdirCard.test.tsx
git commit -m "feat(context): DeskWorkdirCard skeleton with workdir loading and empty state"
```

---

### Task 2: 文件树渲染 + 目录展开（TDD）

**Files:**
- Modify: `web/src/features/context/DeskWorkdirCard.tsx`
- Modify: `web/src/features/context/DeskWorkdirCard.test.tsx`

**Interfaces:**
- Consumes: `client.listWorkdirTree(workdirId, path?)` from `../../api/client`；`WorkdirTreeNode` 类型
- Produces: `DeskWorkdirCard` 渲染根层节点，目录可点击展开加载子层

- [ ] **Step 1: 追加失败测试 — 文件树渲染 + 目录展开**

在 `DeskWorkdirCard.test.tsx` 的 `describe` 块末尾追加（`}` 之前）：

```tsx
  it('renders root tree nodes when active workdir exists', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({
      tree: [
        { name: 'README.md', type: 'file', relativePath: 'README.md' },
        { name: 'src', type: 'directory', relativePath: 'src' },
      ],
      path: '/',
    })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
    expect(screen.getByText('src')).toBeInTheDocument()
    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('expands directory and loads children on click', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree)
      .mockResolvedValueOnce({
        tree: [{ name: 'src', type: 'directory', relativePath: 'src' }],
        path: '/',
      })
      .mockResolvedValueOnce({
        tree: [{ name: 'index.ts', type: 'file', relativePath: 'src/index.ts' }],
        path: 'src',
      })

    const { container } = render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('src')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('src'))

    await waitFor(() => {
      expect(screen.getByText('index.ts')).toBeInTheDocument()
    })
    expect(client.listWorkdirTree).toHaveBeenCalledWith('wd-1', 'src')
  })
```

并在文件顶部 import 区追加：

```tsx
import { fireEvent } from '@testing-library/react'
```

（即把 `import { render, screen, waitFor }` 改为 `import { render, screen, waitFor, fireEvent }`）

- [ ] **Step 2: 运行测试，验证失败**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: FAIL — 新增 2 个测试失败（`getByText('README.md')` 找不到，因为组件还没渲染树）。

- [ ] **Step 3: 实现 — 文件树渲染 + 目录展开**

替换 `DeskWorkdirCard.tsx` 中 `} else (` 之后的 workdir 内容分支（即 Task 1 的 `<div className="desk-workdir-card__content">` 那块）为完整文件树实现。同时新增状态和处理函数。

在状态声明区（`const [error, setError]` 之后）追加：

```tsx
  const [treeCache, setTreeCache] = useState<Record<string, WorkdirTreeNode[]>>({})
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [treeLoadingPaths, setTreeLoadingPaths] = useState<Set<string>>(new Set())
  const [treeErrorByPath, setTreeErrorByPath] = useState<Record<string, string>>({})
```

在 `fetchWorkdir` 之后追加加载根树的 effect 和目录展开处理：

```tsx
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
```

替换渲染分支的 workdir 内容区（Task 1 的占位 `<div className="desk-workdir-card__content">`）为：

```tsx
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
```

并在组件内（return 之前）添加 `renderTreeNode` 函数：

```tsx
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
          role={isDir ? 'treeitem' : 'treeitem'}
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
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: PASS — 6 个测试全部通过。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS — 无新错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/context/DeskWorkdirCard.tsx web/src/features/context/DeskWorkdirCard.test.tsx
git commit -m "feat(context): DeskWorkdirCard file tree with directory expansion"
```

---

### Task 3: 文件点击只读预览（TDD）

**Files:**
- Modify: `web/src/features/context/DeskWorkdirCard.tsx`
- Modify: `web/src/features/context/DeskWorkdirCard.test.tsx`

**Interfaces:**
- Consumes: `client.readWorkdirFile(workdirId, path)` from `../../api/client`；`WorkdirFileContent` 类型
- Produces: 点击文件项在卡片底部展开只读预览区

- [ ] **Step 1: 追加失败测试 — 文件点击预览**

在 `DeskWorkdirCard.test.tsx` 的 `describe` 块末尾追加：

```tsx
  it('shows read-only preview when file is clicked', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({
      tree: [{ name: 'README.md', type: 'file', relativePath: 'README.md' }],
      path: '/',
    })
    vi.mocked(client.readWorkdirFile).mockResolvedValue({
      path: 'README.md',
      content: '# Hello World',
      sizeBytes: 13,
      modifiedAt: '2024-01-01T00:00:00Z',
    })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByTestId('desk-tree-node-README.md'))

    await waitFor(() => {
      expect(screen.getByText('# Hello World')).toBeInTheDocument()
    })
    expect(client.readWorkdirFile).toHaveBeenCalledWith('wd-1', 'README.md')
    expect(screen.getByText('关闭')).toBeInTheDocument()
  })

  it('closes preview when close button is clicked', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({
      tree: [{ name: 'README.md', type: 'file', relativePath: 'README.md' }],
      path: '/',
    })
    vi.mocked(client.readWorkdirFile).mockResolvedValue({
      path: 'README.md',
      content: '# Hello World',
      sizeBytes: 13,
      modifiedAt: '2024-01-01T00:00:00Z',
    })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('README.md')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('desk-tree-node-README.md'))
    await waitFor(() => {
      expect(screen.getByText('# Hello World')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('关闭'))
    expect(screen.queryByText('# Hello World')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: FAIL — 新增 2 个测试失败（点击文件无响应，`# Hello World` 找不到）。

- [ ] **Step 3: 实现 — 文件点击预览**

在状态声明区追加：

```tsx
  const [previewFile, setPreviewFile] = useState<WorkdirFileContent | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
```

在 `handleToggleDir` 之后追加：

```tsx
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
          setPreviewError(err instanceof Error ? err.message : 'Failed to load file')
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
```

修改 `renderTreeNode` 中文件项的 `onClick`：把 `onClick={() => (isDir ? handleToggleDir(node.relativePath) : undefined)}` 改为：

```tsx
          onClick={() => (isDir ? handleToggleDir(node.relativePath) : handleFileClick(node.relativePath))}
```

在 workdir 内容渲染区（`<div className="desk-tree">...</div>` 之后）追加预览区：

```tsx
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
```

- [ ] **Step 4: 运行测试，验证通过**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: PASS — 8 个测试全部通过。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS — 无新错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/context/DeskWorkdirCard.tsx web/src/features/context/DeskWorkdirCard.test.tsx
git commit -m "feat(context): DeskWorkdirCard read-only file preview on click"
```

---

### Task 4: 放到书桌上传功能（TDD）

**Files:**
- Modify: `web/src/features/context/DeskWorkdirCard.tsx`
- Modify: `web/src/features/context/DeskWorkdirCard.test.tsx`

**Interfaces:**
- Consumes: `client.uploadWorkdirFile(workdirId, path, content)` from `../../api/client`（三个独立参数）
- Produces: 「放到书桌」按钮触发文件选择器，上传后刷新根树

- [ ] **Step 1: 追加失败测试 — 上传**

在 `DeskWorkdirCard.test.tsx` 的 `describe` 块末尾追加：

```tsx
  it('uploads file and refreshes tree when 放到书桌 is clicked', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree)
      .mockResolvedValueOnce({ tree: [], path: '/' })
      .mockResolvedValueOnce({
        tree: [{ name: 'notes.txt', type: 'file', relativePath: 'notes.txt' }],
        path: '/',
      })
    vi.mocked(client.uploadWorkdirFile).mockResolvedValue({
      path: 'notes.txt',
      sizeBytes: 5,
      modifiedAt: '2024-01-01T00:00:00Z',
    })

    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('放到书桌')).toBeInTheDocument()
    })

    const input = screen.getByTestId('desk-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(client.uploadWorkdirFile).toHaveBeenCalledWith('wd-1', 'notes.txt', 'hello')
    })
    await waitFor(() => {
      expect(screen.getByText('notes.txt')).toBeInTheDocument()
    })
  })

  it('shows error when upload returns 409 conflict', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({
      workdir: { id: 'wd-1', userId: 'u-1', name: 'project', createdAt: '', updatedAt: '' },
    })
    vi.mocked(client.listWorkdirTree).mockResolvedValue({ tree: [], path: '/' })
    const conflictError = new Error('File already exists')
    ;(conflictError as unknown as { status: number }).status = 409
    vi.mocked(client.uploadWorkdirFile).mockRejectedValue(conflictError)

    const file = new File(['hello'], 'dup.txt', { type: 'text/plain' })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('放到书桌')).toBeInTheDocument()
    })
    const input = screen.getByTestId('desk-file-input') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText('同名文件已存在')).toBeInTheDocument()
    })
  })

  it('disables 放到书桌 button when no active workdir', async () => {
    vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })

    render(<DeskWorkdirCard sessionId={TEST_SESSION_ID} />)

    await waitFor(() => {
      expect(screen.getByText('暂无书桌内容')).toBeInTheDocument()
    })
    // Button should not be present in empty state (no workdir to upload to)
    expect(screen.queryByText('放到书桌')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: FAIL — 新增 3 个测试失败（「放到书桌」按钮不存在、上传无响应）。

- [ ] **Step 3: 实现 — 上传功能**

在状态声明区追加：

```tsx
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
```

在 `handleClosePreview` 之后追加：

```tsx
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
          // Refresh root tree
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
        // Reset input so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [loadTree],
  )
```

在 workdir 内容渲染区，`<div className="desk-workdir-card__workdir-name">` 之前插入按钮行 + 隐藏 input：

```tsx
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
```

（注意：`<div className="desk-workdir-card__workdir-name">` 保留在 header 之后）

- [ ] **Step 4: 运行测试，验证通过**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx --run`
Expected: PASS — 11 个测试全部通过。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS — 无新错误。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/context/DeskWorkdirCard.tsx web/src/features/context/DeskWorkdirCard.test.tsx
git commit -m "feat(context): DeskWorkdirCard upload text file to workdir via 放到书桌"
```

---

### Task 5: 接入 ChatContextPanel + 移除假数据（TDD）

**Files:**
- Modify: `web/src/features/session/chat/ChatContextPanel.tsx`
- Modify: `web/src/features/session/chat/ChatContextPanel.test.tsx`

**Interfaces:**
- Consumes: `DeskWorkdirCard`（Task 1-4 产出，props `{ sessionId?: string | null }`）
- Produces: `ChatContextPanel` 书桌区渲染 `<DeskWorkdirCard sessionId={sessionId} />`，无假数据、无占位按钮

- [ ] **Step 1: 更新失败测试 — ChatContextPanel 书桌区**

整体替换 `web/src/features/session/chat/ChatContextPanel.test.tsx` 为：

```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '../../api/client'
import ChatContextPanel from './ChatContextPanel'

vi.mock('../../api/client')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(client.listTodos).mockResolvedValue({ todos: [], total: 0 })
  vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })
  vi.mocked(client.listWorkdirTree).mockResolvedValue({ tree: [], path: '' })
})

describe('ChatContextPanel', () => {
  it('renders work plan and desk titles', () => {
    render(<ChatContextPanel />)
    expect(screen.getByText('工作计划')).toBeInTheDocument()
    expect(screen.getByText('书桌')).toBeInTheDocument()
  })

  it('renders TodoWorkPlanCard and DeskWorkdirCard', () => {
    render(<ChatContextPanel />)
    expect(screen.getByTestId('todo-work-plan-card')).toBeInTheDocument()
    expect(screen.getByTestId('desk-workdir-card')).toBeInTheDocument()
  })

  it('does not render 放到书桌 button at ChatContextPanel level (it lives inside DeskWorkdirCard)', () => {
    render(<ChatContextPanel />)
    // 放到书桌 button only renders when active workdir exists; with null workdir it's absent
    expect(screen.queryByText('放到书桌')).not.toBeInTheDocument()
  })

  it('does not render 筛选 button', () => {
    render(<ChatContextPanel />)
    expect(screen.queryAllByTitle('筛选')).toHaveLength(0)
  })

  it('does not render example desk items', () => {
    render(<ChatContextPanel />)
    expect(screen.queryByText('暖纸主题设计规范.md')).not.toBeInTheDocument()
    expect(screen.queryByText('theme-warm-paper.css')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 运行测试，验证失败**

Run: `npm --prefix web test -- src/features/session/chat/ChatContextPanel.test.tsx --run`
Expected: FAIL — `getByTestId('desk-workdir-card')` 找不到（`ChatContextPanel` 还在用假数据）；`暖纸主题设计规范.md` 仍存在（断言 `not.toBeInTheDocument()` 失败）。

- [ ] **Step 3: 修改 ChatContextPanel — 移除假数据 + 接入 DeskWorkdirCard**

Edit `web/src/features/session/chat/ChatContextPanel.tsx`:

1. 删除 import `showToast`（第 9 行）和工作计划区已不再使用——确认：工作计划区上次已移除按钮，书桌区本次也不再使用 → **删除 `import { showToast } from './ChatToast'`**。

2. 删除 `EXAMPLE_DESK_ITEMS` 常量（第 16-23 行）。

3. 删除 `DeskIcon` 函数（第 25-73 行整个函数）。

4. 新增 import（在 `TodoWorkPlanCard` import 之后）：

```tsx
import DeskWorkdirCard from '../../context/DeskWorkdirCard'
```

5. 替换书桌 panel（`.chat-rs-panel--bottom` 整块）为：

```tsx
      <div className="chat-rs-panel chat-rs-panel--bottom">
        <div className="chat-rs-panel__header">
          <span className="chat-rs-panel__title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
            书桌
          </span>
        </div>
        <div className="chat-rs-panel__body">
          <DeskWorkdirCard sessionId={sessionId} />
        </div>
      </div>
```

（删除原 header 内的 `.chat-rs-panel__actions` 筛选按钮、原 body 内的 `.chat-rs-add-btn` 放到书桌按钮 + `.chat-desk-list` 假数据 map）

- [ ] **Step 4: 运行测试，验证通过**

Run: `npm --prefix web test -- src/features/session/chat/ChatContextPanel.test.tsx --run`
Expected: PASS — 5 个测试全部通过。

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS — 无新错误（确认 `showToast`/`DeskIcon`/`EXAMPLE_DESK_ITEMS` 无残留引用）。

- [ ] **Step 6: 提交**

```bash
git add web/src/features/session/chat/ChatContextPanel.tsx web/src/features/session/chat/ChatContextPanel.test.tsx
git commit -m "refactor(chat): integrate DeskWorkdirCard and remove placeholder desk data"
```

---

### Task 6: CSS 样式 + 全量回归验证

**Files:**
- Modify: `web/src/features/session/chat/chat-theme.css`（追加 `.desk-*` 类）
- 可能修复：`web/src/features/context/ContextDeskPanel.test.tsx`（若因 `DeskWorkdirCard` 默认渲染 workdir 而失败）

**Interfaces:** 无新接口

- [ ] **Step 1: 追加 CSS 到 chat-theme.css**

在 `web/src/features/session/chat/chat-theme.css` 末尾追加：

```css
/* ==========================================================================
   Desk Workdir Card
   ========================================================================== */
.desk-workdir-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.desk-workdir-card__header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 4px;
}
.desk-upload-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--chat-border, #e0d6c8);
  border-radius: 6px;
  background: transparent;
  color: var(--chat-text, inherit);
  font-size: 12px;
  cursor: pointer;
}
.desk-upload-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.desk-upload-error {
  padding: 4px 8px;
  font-size: 12px;
  color: #c45c4a;
  background: rgba(196, 92, 74, 0.08);
  border-radius: 4px;
}
.desk-workdir-card__workdir-name {
  font-size: 12px;
  color: var(--chat-text-faint, #999);
  padding: 0 4px;
}
.desk-tree {
  display: flex;
  flex-direction: column;
}
.desk-tree-node-wrapper {
  display: flex;
  flex-direction: column;
}
.desk-tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 4px;
}
.desk-tree-node:hover {
  background: rgba(0, 0, 0, 0.04);
}
.desk-tree-node__chevron {
  width: 12px;
  font-size: 10px;
  color: var(--chat-text-faint, #999);
}
.desk-tree-node__icon {
  font-size: 14px;
}
.desk-tree-node__name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desk-tree-node__children {
  display: flex;
  flex-direction: column;
}
.desk-tree-node__loading,
.desk-tree-node__error {
  padding: 3px 4px;
  font-size: 12px;
  color: var(--chat-text-faint, #999);
}
.desk-tree-node__error {
  color: #c45c4a;
}
.desk-file-preview {
  margin-top: 8px;
  border-top: 1px solid var(--chat-border, #e0d6c8);
  padding-top: 8px;
}
.desk-file-preview__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.desk-file-preview__path {
  font-size: 12px;
  color: var(--chat-text-faint, #999);
}
.desk-file-preview__close {
  padding: 2px 8px;
  border: 1px solid var(--chat-border, #e0d6c8);
  border-radius: 4px;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}
.desk-file-preview__content {
  margin: 0;
  padding: 8px;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 4px;
  font-size: 12px;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}
.desk-file-preview__meta {
  display: flex;
  gap: 12px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--chat-text-faint, #999);
}
.desk-loading,
.desk-error,
.desk-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 20px 8px;
  text-align: center;
}
.desk-loading__spinner,
.desk-error__icon,
.desk-empty__icon {
  font-size: 24px;
}
.desk-empty__text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.desk-empty__title {
  font-size: 13px;
  color: var(--chat-text, inherit);
}
.desk-empty__hint {
  font-size: 11px;
  color: var(--chat-text-faint, #999);
}
.desk-error__retry {
  padding: 2px 8px;
  border: 1px solid var(--chat-border, #e0d6c8);
  border-radius: 4px;
  background: transparent;
  font-size: 11px;
  cursor: pointer;
}
```

- [ ] **Step 2: 运行受影响测试**

Run: `npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx src/features/session/chat/ChatContextPanel.test.tsx --run`
Expected: PASS — 全部通过。

- [ ] **Step 3: 运行全量前端测试**

Run: `npm --prefix web test -- --run`
Expected: PASS — 若 `ContextDeskPanel.test.tsx` 失败（该文件 `describe.skip`，应仍跳过），其余全过。

若 `ContextDeskPanel.test.tsx` 未跳过且失败（因 `ChatContextPanel` 改动连带影响），修复方式：该测试文件 `describe.skip('ContextDeskPanel legacy tests', ...)` 已整体跳过，不应失败。若确实失败，加 mock `client.getSessionWorkdir` + `client.listWorkdirTree` 返回空，并在该测试中移除对 `EXAMPLE_DESK_ITEMS` 文案的断言。

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS — 无新错误。

- [ ] **Step 5: 提交**

```bash
git add web/src/features/session/chat/chat-theme.css
git commit -m "style(chat): add desk workdir card CSS"
```

（若 Step 3 修复了 `ContextDeskPanel.test.tsx`，一并 `git add` 并在 commit message 末尾追加 `+ ContextDeskPanel test fix`）

- [ ] **Step 6: 最终确认**

Run: `git log --oneline -7`
Expected: 看到本次改动的 6 个 commit（Task 1-6）。

---

## Self-Review

**Spec coverage:**
- §2 包含「拉取激活 workdir」→ Task 1 ✓
- §2 包含「目录展开」→ Task 2 ✓
- §2 包含「文件只读预览」→ Task 3 ✓
- §2 包含「放到书桌上传」→ Task 4 ✓
- §2 包含「移除假数据 + 空状态」→ Task 1（空状态）+ Task 5（移除假数据）✓
- §2 包含「移除筛选按钮」→ Task 5 ✓
- §5.1 DeskWorkdirCard 完整状态/逻辑 → Task 1-4 ✓
- §5.2 10 个测试场景 → Task 1(4) + Task 2(2) + Task 3(2) + Task 4(3) = 11 个（覆盖 spec 的 10 个 + 1 个关闭预览额外）✓
- §5.3 ChatContextPanel 删除/保留/新增 → Task 5 ✓
- §5.4 ChatContextPanel 测试更新 → Task 5 ✓
- §7 CSS → Task 6 ✓
- §8 边界（无 session/无 workdir/加载/错误/上传各态）→ Task 1 + Task 4 测试覆盖 ✓
- §12 验收标准 1-12 → Task 1-5 实现；13-14 → Task 6 验证 ✓

**Placeholder scan:** 无 TBD/TODO/「适当处理」。所有代码块均为完整可执行代码。✓

**Type consistency:**
- `uploadWorkdirFile(workdirId, path, content)` — Task 4 调用与 client.ts:1120-1132 真实签名一致（三个独立参数）✓
- `WorkdirInfo` / `WorkdirTreeNode` / `WorkdirFileContent` — Task 1-4 使用与 `api/types.ts` 一致 ✓
- `SessionWorkdirResponse = { workdir: WorkdirInfo | null }` — Task 1 mock 与类型一致 ✓
- `WorkdirTreeResponse = { tree: WorkdirTreeNode[]; path: string }` — Task 2 mock 一致 ✓
- `data-testid` 命名：`desk-workdir-card` / `desk-empty` / `desk-workdir-content` / `desk-tree` / `desk-tree-node-${relativePath}` / `desk-file-preview` / `desk-file-preview-close` / `desk-upload-btn` / `desk-file-input` / `desk-upload-error` — 各 Task 使用一致 ✓
- 空状态文案：`暂无书桌内容` / `选择工作目录后显示文件` / `🗂️` — Task 1 与 spec §8 一致 ✓
- 上传按钮文案：`放到书桌` / `上传中...` — Task 4 与 spec 一致 ✓

无问题，计划完成。