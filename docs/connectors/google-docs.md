# Google Docs Connector

Google Docs 连接器允许 AI 代理与 Google Docs 进行交互，支持文档的读取、创建、更新和搜索操作。

## 支持的操作

| 操作 | 能力 ID | 风险等级 | 描述 |
|------|---------|----------|------|
| 列出文档 | `docs.list_docs` | 低 | 列出用户有权访问的文档 |
| 获取文档 | `docs.get_doc` | 低 | 获取指定文档的内容 |
| 创建文档 | `docs.create_doc` | 中 | 创建新文档 |
| 更新文档 | `docs.update_doc` | 中 | 更新现有文档内容 |
| 搜索文档 | `docs.search_docs` | 低 | 按关键词搜索文档 |

## 认证

### OAuth 2.0

Google Docs 连接器使用 OAuth 2.0 进行认证。需要以下步骤：

1. 在 Google Cloud Console 创建 OAuth 2.0 客户端
2. 配置授权重定向 URI
3. 请求用户授权
4. 获取访问令牌

### 最小权限范围

连接器仅请求文档操作所需的最小权限：

- `https://www.googleapis.com/auth/documents` - 文档读写权限
- `https://www.googleapis.com/auth/drive.readonly` - Drive 文件列表（仅读取）

### 凭据加密

OAuth 令牌使用 AES-256-GCM 加密存储：

- 加密算法：`aes-256-gcm`
- 密钥来源：`APP_SECRET_KEY` 环境变量
- 存储位置：`authStateRef` 字段（加密后的字符串）
- 格式：`aes-256-gcm:<iv>:<authTag>:<encrypted>`

## 配置

### 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| `APP_SECRET_KEY` | 用于加密凭据的密钥（必需） | - |
| `DOCS_MOCK_MODE` | 启用模拟模式（开发/测试） | `false` |

### 连接器配置

```json
{
  "provider": "google",
  "timeout": 30000,
  "retries": 3
}
```

## 错误处理

### 错误代码

| 代码 | 描述 | 可恢复 |
|------|------|--------|
| `AUTH_INVALID` | 认证失败或令牌无效 | 否 |
| `AUTH_EXPIRED` | OAuth 令牌已过期 | 是（刷新令牌） |
| `RATE_LIMITED` | 请求频率超限 | 是（自动重试） |
| `NOT_FOUND` | 文档不存在 | 否 |
| `FORBIDDEN` | 无权限访问文档 | 否 |
| `VALIDATION_ERROR` | 请求参数无效 | 否 |
| `NETWORK_ERROR` | 网络或超时错误 | 是 |
| `UNKNOWN_ERROR` | 未知错误 | 否 |

### 速率限制处理

当收到 HTTP 429 响应时：

1. 自动重试（最多 3 次）
2. 指数退避 + 抖动延迟
3. 错误标记为可恢复

### 超时处理

- 默认超时：30 秒
- 可配置：通过 `timeout` 参数
- 超时后自动重试

## Mock 模式

用于开发和测试环境：

### 启用方式

```bash
export DOCS_MOCK_MODE=true
```

或在代码中：

```typescript
const adapter = createDocsConnectorAdapter({
  useMock: true,
  transport: new DocsMockTransport(),
});
```

### Mock 数据

Mock 模式提供预定义的测试文档：

- 3 个示例文档（项目提案、会议记录、预算表）
- 支持完整的 CRUD 操作
- 不进行真实 HTTP 请求

## 安全特性

### 凭据保护

- OAuth 令牌加密存储，不在日志中明文显示
- API 响应中不返回凭据
- 错误消息中不包含敏感信息

### 审计日志

所有连接器操作记录审计事件：

- 操作类型和时间戳
- 用户 ID 和会话 ID
- 操作结果（成功/失败）

### 权限控制

- 读取操作风险等级：低
- 写入操作风险等级：中
- 可能需要审批流程（取决于配置）

## API 端点

### Google Docs API

- Base URL: `https://docs.googleapis.com/v1`
- 文档操作：`/documents/{documentId}`

### Google Drive API

- Base URL: `https://www.googleapis.com/drive/v3`
- 文件列表：`/files`
- 文件元数据：`/files/{fileId}`

## 使用示例

### 列出文档

```typescript
const response = await connectorRuntime.executeCall({
  requestId: 'req-001',
  connectorInstanceId: instance.id,
  capabilityId: 'docs.list_docs',
  operation: 'list_docs',
  params: {
    maxResults: 10,
    folderId: 'folder-123',
  },
  userId: 'user-001',
});
```

### 创建文档

```typescript
const response = await connectorRuntime.executeCall({
  requestId: 'req-002',
  connectorInstanceId: instance.id,
  capabilityId: 'docs.create_doc',
  operation: 'create_doc',
  params: {
    title: 'New Document',
    content: 'Document content here...',
  },
  userId: 'user-001',
});
```

### 搜索文档

```typescript
const response = await connectorRuntime.executeCall({
  requestId: 'req-003',
  connectorInstanceId: instance.id,
  capabilityId: 'docs.search_docs',
  operation: 'search_docs',
  params: {
    query: 'project proposal',
    maxResults: 5,
  },
  userId: 'user-001',
});
```

## 限制

- 单次请求最大文档数：100
- 最大内容长度：1MB
- OAuth 令牌有效期：通常 1 小时
- 速率限制：遵循 Google API 配额

## 故障排除

### 认证失败

1. 检查 OAuth 令牌是否有效
2. 确认令牌权限范围正确
3. 验证 `APP_SECRET_KEY` 配置

### 速率限制

1. 减少请求频率
2. 实现请求队列
3. 使用指数退避

### 文档不存在

1. 确认文档 ID 正确
2. 检查用户是否有访问权限
3. 验证文档未被删除

## 相关连接器

- [Notion](./notion.md) - Notion 文档连接器
- [Google Calendar](./google-calendar.md) - Google 日历连接器
- [Google Contacts](./google-contacts.md) - Google 联系人连接器
