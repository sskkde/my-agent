# 项目问题修复设计

- 日期：2026-07-06
- 状态：已批准设计方向，待实现计划
- 范围：修复 2026-07-06 全面代码审查发现的 10 项问题

## 1. 目标

修复审查中确认的安全、功能、性能、依赖和 CI 问题，使后端、前端和 MCP 子项目在基础门禁上恢复可信状态。

验收标准：

- 用户禁用、系统设置、webhook 鉴权、legacy redirect、workdir 文件接口、MCP XLSX/PPTX 行为均有真实代码修复。
- 根项目、`web`、`mcp-servers/minimax-document-mcp` 的类型检查通过。
- 根项目和前端 lint 通过，无 error。
- 根项目、`web`、`mcp-servers/minimax-document-mcp` 的 `npm audit --audit-level=moderate` 通过，或仅剩无法安全自动修复且已在代码/文档中明确隔离的非运行时风险。
- MCP 子项目测试通过；前端消息安全测试通过；新增/更新的后端测试覆盖修复点。

## 2. 修复范围

包含：

- 用户禁用状态持久化和认证拦截。
- 管理后台系统设置持久化，并接入限流和 session TTL。
- Messaging webhook 与 API token 认证策略对齐，并收紧 provider 入站校验。
- 前端依赖安全升级和 lint error 修复。
- Workdir 文件读写接口的阻塞 I/O 和大文件内存风险修复。
- Legacy `/api/*` redirect 保留 query string。
- MCP XLSX workspace 读文件模型修复、PPTX 坐标修复和依赖审计处理。

不包含：

- 新增完整多租户路由隔离。当前 `resolveTenant` 仍保持 GA 约束：所有用户解析到 `org_default`。
- 实现 Feishu 加密消息解密。若配置 `encryptKey` 但当前代码无法安全验证/解密，则失败关闭并返回明确错误。
- 大规模重构 API route policy 自动化。当前仍保留 handler 内 `request.requirePermission` 模式。

## 3. 后端认证与管理

### 3.1 用户禁用

新增用户状态模型：

- `users` 表增加 `status TEXT NOT NULL DEFAULT 'active'`，允许值为 `active` 或 `disabled`。
- `User` 类型增加 `status` 字段。
- `UserStore` 的 `create/get/list/rowToUser` 读写 `status`。
- 新增 `updateStatus(userId, status, tenantId)`。

认证拦截：

- `authenticateRequest` 获取用户后，如果 `user.status === 'disabled'`，返回 `null`。
- `POST /api/v1/auth/login` 验证密码前后均不得为 disabled 用户签发新 session。
- `registerApiKeyAuth` 接收 `userStore`，当 API key 绑定 `userId` 且用户 disabled 时返回 401；没有 `userId` 的 service key 保持可用。

管理路由：

- `GET /api/v1/admin/users` 返回真实 `status`。
- `PATCH /api/v1/admin/users/:userId/status` 调用 `userStore.updateStatus` 并返回持久化后的用户。
- 请求体只接受 `active` 和 `disabled`。

测试：

- 禁用用户刷新列表仍为 disabled。
- disabled 用户不能登录。
- disabled 用户已有 session 不能通过 `/api/v1/auth/me`。
- disabled 用户绑定 API key 不能访问受保护 API。

### 3.2 系统设置持久化

新增全局设置存储：

- 新增 `system_settings` 表，字段包含 `tenant_id`、`key`、`value_json`、`updated_at`，以 `(tenant_id, key)` 作为唯一键。
- 新增 `SystemSettingsStore`，提供 `get()` 和 `update(partial)`。
- 默认值：`rateLimitPerMinute=60`、`rateLimitPerHour=1000`、`sessionTokenTtlHours=24`。
- 输入校验：三个字段必须为正整数；`sessionTokenTtlHours` 不超过 168；rate limit 不超过 100000。

接入点：

- `GET /api/v1/admin/settings` 返回 store 中的真实设置。
- `PATCH /api/v1/admin/settings` 保存后返回真实设置。
- `registerRateLimitMiddleware` 接收可选 `SystemSettingsStore`，在 `max()` 中读取最新 `rateLimitPerMinute`，保持 auth endpoint 使用更严格的 `authMax`。
- 登录和 setup 创建 session token 时从 `SystemSettingsStore` 读取 `sessionTokenTtlHours`。

测试：

- PATCH 后再次 GET 保留新值。
- 登录 token 的 `expiresAt` 反映设置后的 TTL。
- 无设置记录时返回默认值。

## 4. Messaging Webhook 安全

### 4.1 API token 豁免一致性

- `auth-token` 默认豁免路径加入 `/api/v1/messaging/*`。
- session auth、API token auth、RBAC 三处 webhook 豁免列表保持一致。

测试：

- 设置 `API_AUTH_TOKEN` 后，provider 签名正确的 webhook 不因缺少 Bearer token 被 401。
- 非 messaging 受保护 API 在缺少 Bearer/session/API key 时仍为 401。

### 4.2 Provider 入站校验

DingTalk：

- 生产环境中 `signSecret` 必填；缺失时 `verifyInbound` 返回 false。
- 非生产测试可通过显式测试配置创建带 `signSecret` 的 adapter，不新增静默绕过。

Feishu：

- 继续验证 `header.token === verificationToken`。
- 如果配置了 `encryptKey`，当前版本不支持只凭 signature header 放行，改为失败关闭并返回 false。
- 不在本次实现 Feishu encrypted payload 解密或完整签名验签。

测试：

- DingTalk 无 `signSecret` 时 webhook 拒绝。
- DingTalk 正确签名通过，错误签名拒绝。
- Feishu 配置 `encryptKey` 时不会因为存在 `x-lark-signature` 就通过。

## 5. Workdir 文件接口

### 5.1 文本读取

- 新增 route 层文本读取上限 `WORKDIR_TEXT_READ_MAX_BYTES = 1 MiB`。
- `GET /api/v1/workdirs/:workdirId/files` 使用 `fs.promises.stat/readFile`，拒绝超过文本读取上限的文件。
- 保持 workdir boundary 校验和所有权校验不变。

### 5.2 下载

- `GET /api/v1/workdirs/:workdirId/files/download` 使用 `fs.createReadStream`。
- `Content-Disposition` 文件名移除 CR/LF、双引号和反斜杠，避免 header 值异常。
- 保留 `WORKDIR_MAX_FILE_BYTES` 下载上限。

测试：

- 大于文本读取上限的文件返回 413。
- 下载接口返回 stream，并带安全 `Content-Disposition`。
- 路径逃逸、目录读取、非拥有者访问继续失败。

## 6. Frontend 修复与依赖

### 6.1 Lint error

- `TimelineEventCard.tsx` 的 `switch default` 分支加块级作用域或把 `attachments` 提前到 switch 外，修复 `no-case-declarations`。

### 6.2 依赖审计

- 升级 `dompurify` 到不受 GHSA-cmwh-pvxp-8882 影响的版本。
- 升级 `vite` 和 `vitest` 到 audit 不再报告 critical/high/moderate 的版本。
- 保持 Vite dev server 默认 `host=localhost` 和现有 proxy 行为。
- 升级后调整测试配置中不兼容项，直到前端 typecheck、lint、测试和 audit 通过。

测试：

- `web` typecheck 通过。
- `web` lint 通过。
- `web` test 通过，至少覆盖消息安全和格式化测试；若升级触发全套可承受，则跑全套 `npm --prefix web test`。
- `web` audit moderate gate 通过。

## 7. API 兼容重定向

- `createLegacyRedirect` 在生成 `/api/v1/*` redirect 时保留原 query string。
- path params 替换后仍使用 307。
- 不改变 legacy redirect route inventory。

测试：

- `/api/sessions?limit=10&offset=20` 重定向到 `/api/v1/sessions?limit=10&offset=20`。
- 无 query 的 legacy route 行为不变。

## 8. MCP 修复

### 8.1 XLSX workspace 模型

新增 MCP 可读 workspace root：

- 新增 `resolveDocumentWorkspaceRoot()`。
- 优先读取 `MINIMAX_DOCUMENT_WORKSPACE_ROOT`。
- 未配置时使用 `process.cwd()` 的真实路径。
- root 必须存在并可 canonicalize；所有 `inputPath` 仍通过 `normalizePath` 限制在 root 内。

`xlsx.read` 和 `xlsx.validate`：

- 不再为读取类工具创建空临时 workspace。
- 使用 `resolveDocumentWorkspaceRoot()` 作为 `workspaceRoot`。
- 继续保留 size limit、sheet 校验和错误结构。

测试：

- 在测试临时 root 中创建 XLSX，`xlsx.read` 能读取。
- 读取 root 外路径被拒绝。
- 不存在文件仍返回 file_not_found。

### 8.2 PPTX 布局

- `twoColumn` 和 `comparison` 右栏 `x: 50` 改为页面内合理坐标，例如 `x: 5.0`。
- 保持左栏、标题和 bullet 行为不变。

测试：

- 生成的 PPTX 不丢失右栏文本。
- 现有 PPTX 测试继续通过。

### 8.3 MCP 依赖审计

- 优先用 `overrides` 将 transitive `uuid` 提升到 `>=11.1.1`，并运行 MCP typecheck/test/audit。
- 如果 ExcelJS 与 uuid override 不兼容，则升级到可用的 ExcelJS 修复版本；若 upstream 仍无可用修复路径，必须把该项作为阻塞项报告，不能声称 MCP audit 已修复。

## 9. 验证命令

必须执行：

- `npm run typecheck`
- `npm run lint`
- `npm audit --audit-level=moderate`
- `npm --prefix web run typecheck`
- `npm --prefix web run lint`
- `npm --prefix web test`
- `npm --prefix web audit --audit-level=moderate`
- `npm --prefix mcp-servers/minimax-document-mcp run typecheck`
- `npm --prefix mcp-servers/minimax-document-mcp test`
- `npm --prefix mcp-servers/minimax-document-mcp audit --audit-level=moderate`

如果某个全量测试因环境或耗时限制无法完成，必须记录具体命令、失败原因和已执行的替代验证。

## 10. 风险与回滚

- 依赖升级可能引入 Vite/Vitest 配置不兼容。先升级并跑前端 tests，若全量失败，逐项修配置，不回退安全升级。
- 用户禁用字段迁移影响认证路径。保留默认 `active`，避免现有用户被误禁用。
- 系统设置接入限流可能影响测试稳定性。测试环境可通过 store 默认值或 test-specific options 保持可控。
- Workdir 文本读取上限会改变读取大文本文件行为。下载接口仍支持较大文件，通过 stream 返回。
- Feishu `encryptKey` 配置从“弱放行”变成“失败关闭”。这是安全修复，不保留旧行为。
