# 书桌组件接入工作目录功能设计

- 日期：2026-07-05
- 状态：已批准，待实现
- 方案：方案 A（新建 `DeskWorkdirCard` 组件 + 保留「放到书桌」上传到工作目录）

## 1. 目标

将前端聊天右侧栏「书桌」一栏接入后端工作目录（workdir）功能。书桌以只读概览形式展示当前会话激活工作目录的文件树（支持目录展开），点击文件在右侧栏内显示只读预览。保留「放到书桌」按钮，点击后选择本地文件上传到当前激活工作目录（仅文本，后端 upload 端点只接受 utf-8 content）。移除示例假数据。

## 2. 范围

### 包含

- 书桌拉取并展示当前会话激活工作目录的文件/目录（`GET /sessions/:sessionId/workdir` + `GET /workdirs/:id/tree`）
- 支持目录展开（点击目录项加载下一层 `listWorkdirTree(workdirId, path)`）
- 点击文件项在右侧栏内展开只读预览（`GET /workdirs/:id/files?path=`）
- 保留「放到书桌」按钮，点击触发文件选择器，上传到当前激活工作目录（`POST /workdirs/:id/files/upload`，body `{path, content}`，仅 utf-8 文本）
- 上传成功后刷新文件树，新文件出现在列表
- 移除 `EXAMPLE_DESK_ITEMS` 假数据，无 session / 无激活 workdir 时显示空状态
- 移除书桌区的「筛选」占位按钮

### 不包含

- 不嵌入完整 `WorkdirPanel`（那是 SessionConsoleTab 的文件浏览器 + 编辑器，职责不同）
- 不在书桌内提供 workdir 切换/创建/删除（用户需在 SessionConsoleTab 的 WorkdirPanel 操作）
- 不在书桌内提供文件树 CRUD（创建文件夹/文件、重命名、删除）
- 不提供文件编辑/保存（只读预览）
- 不支持二进制文件上传（后端 `POST /workdirs/:id/files/upload` 只接受 utf-8 `content` 字符串）
- 不改动后端 API（workdir 路由已完备）
- 不改动 `client.ts`（`getSessionWorkdir` / `listWorkdirTree` / `readWorkdirFile` / `uploadWorkdirFile` 已封装）
- 不改动 `WorkdirPanel` / `useWorkdir` / `WorkdirFileTree` 等 SessionConsoleTab 组件
- 不改动 `TodoWorkPlanCard`（工作计划栏保持现状）

## 3. 数据流

```
ChatContextPanel (sessionId)
   └─ DeskWorkdirCard (sessionId)
        ├─ client.getSessionWorkdir(sessionId)
        │    → GET /api/v1/sessions/:sessionId/workdir
        │    → { workdir: null | WorkdirResponse }
        ├─ client.listWorkdirTree(workdirId, path?)
        │    → GET /api/v1/workdirs/:workdirId/tree?path=
        │    → { tree: [{name, type, relativePath}], path }
        │    → 缓存到 treeCache[path]，支持目录展开
        ├─ client.readWorkdirFile(workdirId, path)  [点击文件时]
        │    → GET /api/v1/workdirs/:workdirId/files?path=
        │    → { path, content, sizeBytes, modifiedAt }
        │    → 显示只读预览
        └─ client.uploadWorkdirFile(workdirId, { path, content })  [放到书桌时]
             → POST /api/v1/workdirs/:workdirId/files/upload
             → body { path: fileName, content: fileTextContent }
             → { path, sizeBytes, modifiedAt }
             → 成功后刷新根层文件树
```

## 4. 后端契约（已存在，无改动）

| 端点 | 用途 |
|------|------|
| `GET /api/v1/sessions/:sessionId/workdir` | 获取会话激活工作目录（null 或 WorkdirResponse） |
| `GET /api/v1/workdirs/:workdirId/tree?path=` | 列出指定层文件/目录节点 |
| `GET /api/v1/workdirs/:workdirId/files?path=` | 读取文件内容（utf-8） |
| `POST /api/v1/workdirs/:workdirId/files/upload` | 上传新文件（body `{path, content}`，utf-8，冲突返回 409，超大返回 413） |

- 鉴权：`ResourceType.workdirs` + 对应 Action，会话所有权校验
- `WorkdirResponse`：`{ id, userId, name, createdAt, updatedAt }`
- `WorkdirTreeNode`：`{ name, type: 'file'\|'directory', relativePath }`
- `WorkdirFileContent`：`{ path, content, sizeBytes, modifiedAt }`

## 5. 改动文件

### 5.1 新建 `web/src/features/context/DeskWorkdirCard.tsx`

**Props：**
```ts
export interface DeskWorkdirCardProps {
  sessionId?: string | null
  className?: string
  testId?: string
}
```

**状态：**
- `activeWorkdir: WorkdirInfo | null` — 当前会话激活工作目录
- `loading: boolean` / `error: Error | null` — workdir 加载态
- `treeCache: Record<string, WorkdirTreeNode[]>` — 按 path 缓存每层节点（key 为 relativePath，根层用 `''`）
- `expandedPaths: Set<string>` — 已展开的目录 relativePath
- `treeLoadingPaths: Set<string>` / `treeErrorByPath: Record<string, string>` — 每层加载/错误态
- `previewFile: { path: string; content: string; sizeBytes: number; modifiedAt: string } | null`
- `previewLoading: boolean` / `previewError: string | null`
- `uploading: boolean` / `uploadError: string | null`
- `fileInputRef: React.RefObject<HTMLInputElement>` — 隐藏的文件选择器

**逻辑：**
- `useEffect(sessionId)`：sessionId 变化 → 重置全部状态 → `getSessionWorkdir(sessionId)` → 设 `activeWorkdir`
- `useEffect(activeWorkdir)`：activeWorkdir 确定 → 加载根层 `listWorkdirTree(workdirId)` → 缓存 `treeCache['']`
- stale response guard：`sessionIdRef` + `activeWorkdirIdRef`
- `handleToggleDir(relativePath)`：toggle `expandedPaths`，若 `treeCache[relativePath]` 未缓存则调 `listWorkdirTree(workdirId, relativePath)` 加载并缓存
- `handleFileClick(relativePath)`：调 `readWorkdirFile(workdirId, relativePath)` → 设 `previewFile`，在卡片底部展开只读预览
- `handleClosePreview()`：清 `previewFile`
- `handleUploadClick()`：`fileInputRef.current?.click()`
- `handleFileSelected(e)`：取 `e.target.files?.[0]`，读 `file.text()` → `uploadWorkdirFile(workdirId, { path: file.name, content })` → 成功后刷新根树（重新调 `listWorkdirTree(workdirId)` 更新 `treeCache['']`）；失败设 `uploadError`
- `handleRetry()`：重试 `getSessionWorkdir`

**渲染分支：**
1. `loading` → `.desk-loading`（spinner + 加载中...）
2. `error` → `.desk-error`（⚠️ + 加载失败 + 重试按钮）
3. `!activeWorkdir` → `.desk-empty`（图标 + "暂无书桌内容" + "选择工作目录后显示文件"）
4. `activeWorkdir` → 卡片内容：
   - 头部：workdir 名称 + 「放到书桌」按钮（`disabled={!activeWorkdir || uploading}`）
   - 隐藏 `<input type="file" ref={fileInputRef} onChange={handleFileSelected} style={{display:'none'}} />`
   - `uploading` 时按钮显示 spinner 文案"上传中..."
   - `uploadError` 时内联错误提示
   - 文件树：递归渲染 `treeCache['']`，目录项可展开（▶/▼ + 缩进），文件项可点击预览
   - 目录展开时加载中显示小 spinner，失败显示错误
   - `previewFile` 时在树下方展开只读预览区：文件路径 + 关闭按钮 + `<pre>` 内容 + 大小/修改时间

### 5.2 新建 `web/src/features/context/DeskWorkdirCard.test.tsx`

`vi.mock('../../api/client')`，覆盖以下测试：
1. 无 sessionId → 不调用 `getSessionWorkdir`，渲染空状态
2. 有 sessionId 但无激活 workdir（`getSessionWorkdir` 返回 `{workdir: null}`）→ 渲染空状态（"暂无书桌内容"）
3. 有激活 workdir → 调用 `listWorkdirTree`，渲染根层节点
4. 点击目录项 → 加载子层并展开（`expandedPaths` 含该 path，子节点显示）
5. 点击文件项 → 调用 `readWorkdirFile`，显示只读预览（内容 + 关闭按钮）
6. 点击「放到书桌」→ 触发文件选择器（mock `fileInputRef.current.click`）
7. 选择文件后 → 调用 `uploadWorkdirFile`，成功后刷新根树
8. 上传冲突（409）→ 显示"同名文件已存在"错误
9. workdir 加载失败 → error 分支 + 重试按钮可重试
10. `getSessionWorkdir` 传 sessionId 参数验证

### 5.3 修改 `web/src/features/session/chat/ChatContextPanel.tsx`

**删除：**
- `EXAMPLE_DESK_ITEMS` 常量（6 项假数据）
- `DeskIcon` 函数（约 50 行）
- 书桌区的 `.chat-rs-panel__actions`（筛选按钮 + svg）
- 书桌区的 `.chat-rs-add-btn`（放到书桌按钮——移入 `DeskWorkdirCard` 内部）
- 书桌区的 `.chat-desk-list` + 假数据 map
- `showToast` import（工作计划区上次已移除，书桌区本次也不再使用）

**保留：**
- 书桌 panel header 的标题 + 书本 svg
- `<DeskWorkdirCard sessionId={sessionId} />`（替换原 body 内容）

**新增：**
- `import DeskWorkdirCard from '../../context/DeskWorkdirCard'`

**最终书桌区结构：**
```tsx
<div className="chat-rs-panel chat-rs-panel--bottom">
  <div className="chat-rs-panel__header">
    <span className="chat-rs-panel__title">
      <svg>...书桌图标...</svg>
      书桌
    </span>
  </div>
  <div className="chat-rs-panel__body">
    <DeskWorkdirCard sessionId={sessionId} />
  </div>
</div>
```

### 5.4 修改 `web/src/features/session/chat/ChatContextPanel.test.tsx`

- 移除对「放到书桌」「筛选」按钮、6 个示例 desk items 的断言
- 新增 `vi.mock('../../api/client')` + `vi.mocked(client.getSessionWorkdir).mockResolvedValue({ workdir: null })` + `vi.mocked(client.listWorkdirTree).mockResolvedValue({ tree: [], path: '' })` 让 `DeskWorkdirCard` 渲染空状态
- 断言「书桌」标题存在
- 断言 `DeskWorkdirCard` 渲染（`getByTestId('desk-workdir-card')`）
- 断言不存在「放到书桌」按钮（已移入 `DeskWorkdirCard`，`ChatContextPanel` 层不再有；按钮在 `DeskWorkdirCard` 内部测试）
- 断言不存在「筛选」按钮

## 6. 不改动

- 后端：`src/api/routes/workdirs.ts`、`src/workdirs/*`、`src/storage/workdir-store.ts`
- 前端 API client：`web/src/api/client.ts`（`getSessionWorkdir` / `listWorkdirTree` / `readWorkdirFile` / `uploadWorkdirFile` 已封装）
- 类型：`web/src/api/types.ts`（`WorkdirInfo` / `WorkdirTreeNode` / `WorkdirFileContent` 已存在）
- SessionConsoleTab 组件：`WorkdirPanel` / `useWorkdir` / `WorkdirFileTree` / `WorkdirFileEditor` / `WorkdirSelector`
- 工作计划栏：`TodoWorkPlanCard`

## 7. CSS

复用已有类：
- `.chat-desk-list` / `.chat-desk-item` / `.chat-desk-item__icon/__main/__name/__meta`（文件/目录项视觉）

新增类（放入 `web/src/features/session/chat/chat-theme.css` 或 `web/src/styles.css`，遵循已有命名风格）：
- `.desk-workdir-card` — 卡片根容器
- `.desk-workdir-card__header` — workdir 名称 + 放到书桌按钮行
- `.desk-workdir-card__workdir-name` — workdir 名称
- `.desk-upload-btn` — 放到书桌按钮（新建独立类，视觉对称 `.chat-rs-add-btn`：圆角小按钮 + 加号 svg + 文案）
- `.desk-upload-error` — 上传错误内联提示
- `.desk-tree` — 文件树容器
- `.desk-tree-node` — 树节点行（含缩进 padding-left by depth）
- `.desk-tree-node--directory` / `.desk-tree-node--file` — 类型变体
- `.desk-tree-node__icon` — 📂/📄 图标
- `.desk-tree-node__name` — 名称
- `.desk-tree-node__chevron` — ▶/▼ 展开指示
- `.desk-tree-node__loading` — 子层加载小 spinner
- `.desk-tree-node__error` — 子层加载错误
- `.desk-file-preview` — 只读预览区
- `.desk-file-preview__header` — 路径 + 关闭按钮
- `.desk-file-preview__path`
- `.desk-file-preview__close`
- `.desk-file-preview__content` — `<pre>` 包裹的文件内容
- `.desk-file-preview__meta` — 大小 + 修改时间
- `.desk-empty` / `.desk-empty__icon` / `.desk-empty__title` / `.desk-empty__hint` — 空状态（对称 `.todo-plan-empty`）
- `.desk-loading` / `.desk-error` — 加载/错误状态（对称 `.todo-plan-loading` / `.todo-plan-error`）

## 8. 边界与错误处理

| 场景 | 行为 |
|------|------|
| 无 sessionId | `activeWorkdir=null` → 空状态 |
| 有 sessionId 无激活 workdir | `getSessionWorkdir` 返回 `{workdir:null}` → 空状态（"暂无书桌内容 / 选择工作目录后显示文件"） |
| workdir 加载中 | `.desk-loading`（spinner + 加载中...） |
| workdir 加载失败 | `.desk-error`（⚠️ 加载失败 + 重试按钮） |
| sessionId/workdir 切换 | stale response guard 清理旧状态 |
| 目录展开加载中 | 该节点下显示小 spinner |
| 目录展开失败 | 该节点下显示错误提示 |
| 文件预览加载中 | 预览区 spinner |
| 文件预览失败 | 预览区错误 + 关闭按钮 |
| 文件过大（413） | 预览区提示"文件过大无法预览" |
| 无激活 workdir 时点「放到书桌」 | 按钮 `disabled` |
| 上传中 | 按钮显示"上传中..." + `disabled` |
| 上传成功 | 刷新根树，新文件出现在列表 |
| 上传冲突（409） | 内联错误"同名文件已存在" |
| 上传超大（413） | 内联错误"文件过大" |
| 上传网络失败 | 内联错误 + 可重试 |
| 二进制文件 | `File.text()` 读取为乱码 utf-8，后端接受任意字符串；不做预检（YAGNI） |

## 9. 视觉对称性

与 `TodoWorkPlanCard` 对称：
- 卡片容器在 `.chat-rs-panel__body` 内
- 空状态同款图标 + 主标题 + 副提示结构
- 加载/错误/重试同款样式
- 文件列表项复用 `.chat-desk-item` 视觉
- 目录展开用缩进 + ▶/▼ 图标
- 只读预览在树下方展开

## 10. 测试策略

### 10.1 `DeskWorkdirCard` 单测

`vi.mock('../../api/client')`，10 个测试覆盖 §5.2 列出的全部场景。Mock 模式参考 `TodosTab.test.tsx`：`vi.mocked(client.getSessionWorkdir).mockResolvedValue(...)`。

### 10.2 `ChatContextPanel` 单测

- 断言「书桌」标题存在
- 断言 `DeskWorkdirCard` 渲染（`getByTestId('desk-workdir-card')`）
- 断言不存在「放到书桌」按钮（`queryByText('放到书桌')` 为 null —— 按钮在 `DeskWorkdirCard` 内，不在 `ChatContextPanel` 层）
- 断言不存在「筛选」按钮

### 10.3 验证命令

```bash
npm --prefix web test -- src/features/context/DeskWorkdirCard.test.tsx src/features/session/chat/ChatContextPanel.test.tsx --run
npm --prefix web test -- --run
npm run typecheck
```

## 11. 风险与回滚

- **风险**：低。仅前端改动（2 新建 + 2 修改），无后端/DB/API 变更。
- **风险点**：上传二进制文件产生乱码——用户需自行理解"仅文本"限制。可在按钮 title 加提示"仅支持文本文件"。
- **回滚**：`git revert` 单个 commit 即可恢复假数据和占位按钮。

## 12. 验收标准

1. 书桌显示当前会话激活工作目录的文件/目录
2. 点击目录可展开下一层
3. 点击文件在右侧栏内显示只读预览
4. 无 session / 无激活 workdir 显示空状态
5. 移除 `EXAMPLE_DESK_ITEMS` 假数据
6. 移除书桌区「筛选」占位按钮
7. 「放到书桌」按钮可触发文件选择器
8. 选择文件后上传到当前激活工作目录（utf-8 文本）
9. 上传成功后文件出现在列表
10. 无激活 workdir 时「放到书桌」按钮禁用
11. 上传中 / 上传失败（冲突/超大/网络）有明确反馈
12. 加载 / 错误 / 重试交互正常
13. `npm --prefix web test` 通过
14. `npm run typecheck` 通过