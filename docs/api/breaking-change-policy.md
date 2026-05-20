# 破坏性变更政策

**版本**: 1.0  
**最后更新**: 2026-05-19  
**适用范围**: Agent Platform API

---

## 概述

本文档定义 Agent Platform API 的破坏性变更管理政策，包括版本策略、废弃流程和通知机制。

---

## 1. 版本策略

### 1.1 语义化版本

Agent Platform 遵循 [语义化版本 2.0.0](https://semver.org/lang/zh-CN/) 规范：

```
MAJOR.MINOR.PATCH[-PRERELEASE]

MAJOR: 破坏性变更
MINOR: 新功能（向后兼容）
PATCH: Bug 修复（向后兼容）
PRERELEASE: 预发布标识（如 rc.1, beta.2）
```

### 1.2 版本类型定义

| 版本类型 | 示例 | 说明 | 破坏性变更 |
|----------|------|------|------------|
| Major | 1.0.0 → 2.0.0 | 主要版本升级 | 是 |
| Minor | 1.0.0 → 1.1.0 | 功能更新 | 否 |
| Patch | 1.0.0 → 1.0.1 | Bug 修复 | 否 |
| Pre-release | 1.0.0-rc.1 | 预发布版本 | 可能 |

### 1.3 API 版本前缀

所有 API 端点使用版本前缀：

```
/api/v1/  — 当前稳定版本
/api/v2/  — 未来主要版本（如有）
```

旧版路径重定向规则：
- `/api/` → `/api/v1/`（HTTP 307）

---

## 2. 破坏性变更定义

### 2.1 破坏性变更类型

以下变更被视为破坏性变更：

#### API 契约变更

| 变更类型 | 示例 | 破坏性 |
|----------|------|--------|
| 删除端点 | 删除 `/api/v1/sessions/{id}` | 是 |
| 重命名端点 | `/sessions` → `/conversations` | 是 |
| 更改 HTTP 方法 | GET → POST | 是 |
| 删除请求参数 | 删除 `limit` 参数 | 是 |
| 更改参数类型 | `limit: number` → `limit: string` | 是 |
| 添加必需参数 | 添加必需的 `userId` 参数 | 是 |

#### 响应格式变更

| 变更类型 | 示例 | 破坏性 |
|----------|------|--------|
| 删除响应字段 | 删除 `items` 字段 | 是 |
| 更改字段类型 | `id: number` → `id: string` | 是 |
| 更改错误码 | 404 → 410 | 是 |
| 更改错误格式 | 改变 Error Envelope 结构 | 是 |

#### 认证/授权变更

| 变更类型 | 示例 | 破坏性 |
|----------|------|--------|
| 更改认证方式 | Token → OAuth | 是 |
| 更改权限模型 | 删除角色 | 是 |
| 强制新认证 | 可选认证 → 必需认证 | 是 |

### 2.2 非破坏性变更

以下变更不被视为破坏性变更：

| 变更类型 | 示例 | 破坏性 |
|----------|------|--------|
| 添加新端点 | 新增 `/api/v1/analytics` | 否 |
| 添加可选参数 | 添加可选 `filter` 参数 | 否 |
| 添加响应字段 | 添加 `nextCursor` 字段 | 否 |
| 扩展枚举值 | `status: ["active"]` → `["active", "paused"]` | 否 |
| Bug 修复 | 修复错误响应格式 | 否 |
| 性能优化 | 减少响应延迟 | 否 |

---

## 3. 废弃流程

### 3.1 废弃阶段

破坏性变更必须经过以下阶段：

```
活跃 → 废弃通知 → 废弃警告 → 移除
```

| 阶段 | 持续时间 | 行为 |
|------|----------|------|
| 活跃 | — | 功能正常使用 |
| 废弃通知 | 2 个 Minor 版本 | 文档标注废弃，响应头添加 `Deprecation: true` |
| 废弃警告 | 1 个 Minor 版本 | 日志警告，响应头添加 `Warning: 299` |
| 移除 | Major 版本 | 功能移除 |

### 3.2 废弃时间线示例

```
v1.0.0 — 功能活跃
v1.1.0 — 废弃通知（文档 + 响应头）
v1.2.0 — 废弃警告继续
v1.3.0 — 废弃警告继续
v2.0.0 — 功能移除
```

最小废弃周期：**3 个 Minor 版本**（约 3-6 个月）

### 3.3 废弃通知格式

#### 响应头

```http
HTTP/1.1 200 OK
Deprecation: true
Sunset: Sat, 31 Dec 2026 23:59:59 GMT
Link: </api/v2/sessions>; rel="successor-version"
```

#### 响应体警告

```json
{
  "items": [...],
  "_warnings": [
    {
      "type": "deprecation",
      "message": "This endpoint is deprecated. Use /api/v2/sessions instead.",
      "sunset": "2026-12-31T23:59:59Z",
      "alternative": "/api/v2/sessions"
    }
  ]
}
```

#### 文档标注

```markdown
### GET /api/v1/sessions

> ⚠️ **已废弃**
> 
> 此端点将在 v2.0.0 中移除。
> 请使用 [`GET /api/v2/sessions`](#get-apiv2sessions) 替代。
> 
> 废弃时间：v1.1.0  
> 移除时间：v2.0.0（预计 2026-12-31）
```

---

## 4. 通知机制

### 4.1 通知渠道

| 渠道 | 用途 | 频率 |
|------|------|------|
| Release Notes | 详细变更说明 | 每次发布 |
| CHANGELOG | 变更历史 | 每次发布 |
| API 响应头 | 运行时通知 | 每次请求 |
| 文档 | 废弃标注 | 持续 |
| 邮件通知 | 重大变更 | Major 版本 |
| GitHub Issues | 变更讨论 | 按需 |

### 4.2 通知内容模板

#### Release Notes 模板

```markdown
## 破坏性变更

### 已移除

- **`GET /api/v1/legacy-endpoint`** — 已移除
  - 替代方案：`GET /api/v1/new-endpoint`
  - 迁移指南：[链接]

### 已废弃

- **`GET /api/v1/old-endpoint`** — 将在 v2.0.0 移除
  - 替代方案：`GET /api/v1/new-endpoint`
  - 废弃时间：v1.1.0
  - 移除时间：v2.0.0（预计 2026-12-31）

### 迁移指南

#### 从 `old-endpoint` 迁移到 `new-endpoint`

**之前：**
```javascript
const response = await fetch('/api/v1/old-endpoint');
```

**之后：**
```javascript
const response = await fetch('/api/v1/new-endpoint');
```
```

### 4.3 提前通知周期

| 变更类型 | 最小通知周期 |
|----------|--------------|
| 端点移除 | 3 个 Minor 版本 |
| 参数移除 | 2 个 Minor 版本 |
| 响应字段移除 | 2 个 Minor 版本 |
| 认证变更 | 3 个 Minor 版本 |
| Major 版本升级 | 6 个月 |

---

## 5. 变更审批流程

### 5.1 审批级别

| 变更类型 | 审批级别 | 审批人 |
|----------|----------|--------|
| Major 版本升级 | 高 | 技术委员会 |
| 端点移除 | 高 | 架构师 + 产品经理 |
| 参数/字段移除 | 中 | 技术负责人 |
| 非破坏性变更 | 低 | 开发者 |

### 5.2 审批检查清单

破坏性变更审批需确认：

- [ ] 变更必要性已论证
- [ ] 替代方案已提供
- [ ] 迁移指南已编写
- [ ] 影响范围已评估
- [ ] 废弃时间线已确定
- [ ] 通知计划已制定
- [ ] 向后兼容性已考虑

### 5.3 变更记录

所有破坏性变更必须记录在：

1. **CHANGELOG.md** — 变更历史
2. **Release Notes** — 详细说明
3. **OpenAPI 规范** — API 定义更新
4. **迁移指南** — 用户迁移步骤

---

## 6. 向后兼容性保证

### 6.1 API 契约锁定

v0.7.0-rc.1 起，API 契约锁定测试确保：

- 所有 v1 端点返回 Response Envelope 格式
- 所有列表端点支持 limit/offset 参数
- 错误响应使用 Error Envelope 格式
- 版本号在所有位置一致

### 6.2 兼容性测试

```bash
# 运行 API 契约锁定测试
npx vitest run tests/integration/api/api-contract-lock.test.ts
```

### 6.3 版本共存

支持多版本 API 共存：

```
/api/v1/  — 稳定版本
/api/v2/  — 新版本（如有）
```

客户端可逐步迁移，无需一次性切换。

---

## 7. 特殊情况处理

### 7.1 安全修复

安全漏洞修复可跳过废弃流程：

- 立即移除存在安全风险的端点/参数
- 在 Release Notes 中说明原因
- 提供安全替代方案

### 7.2 实验性功能

标记为 `experimental` 的功能：

- 不受向后兼容保证约束
- 可随时变更或移除
- 必须在文档中明确标注

```markdown
> ⚠️ **实验性功能**
> 
> 此功能处于实验阶段，可能随时变更或移除。
> 不建议在生产环境使用。
```

### 7.3 预发布版本

预发布版本（如 `-rc.1`, `-beta.2`）：

- 可能包含破坏性变更
- 不受向后兼容保证约束
- 不建议用于生产环境

---

## 8. 实施示例

### 示例 1：端点废弃

**场景**：废弃 `/api/v1/legacy-search`，推荐使用 `/api/v1/search`

#### 步骤 1：添加废弃通知（v1.1.0）

```typescript
// src/api/routes/legacy-search.ts
server.get('/api/v1/legacy-search', async (request, reply) => {
  reply.header('Deprecation', 'true');
  reply.header('Sunset', 'Sat, 31 Dec 2026 23:59:59 GMT');
  reply.header('Link', '</api/v1/search>; rel="successor-version"');
  
  // ... 原有逻辑
});
```

#### 步骤 2：更新文档

```markdown
### GET /api/v1/legacy-search

> ⚠️ **已废弃**
> 
> 请使用 [`GET /api/v1/search`](#get-apiv1search) 替代。
> 移除时间：v2.0.0（预计 2026-12-31）
```

#### 步骤 3：发布 Release Notes

```markdown
### 已废弃

- **`GET /api/v1/legacy-search`** — 将在 v2.0.0 移除
  - 替代方案：`GET /api/v1/search`
```

#### 步骤 4：移除端点（v2.0.0）

```typescript
// 删除 legacy-search.ts
// 更新路由注册
```

### 示例 2：响应字段变更

**场景**：将 `userId` 字段重命名为 `user_id`

#### 步骤 1：添加新字段，保留旧字段（v1.1.0）

```typescript
{
  "user_id": "user-123",  // 新字段
  "userId": "user-123",   // 旧字段（废弃）
  "_warnings": [
    {
      "type": "deprecation",
      "field": "userId",
      "message": "Use user_id instead",
      "sunset": "2026-12-31T23:59:59Z"
    }
  ]
}
```

#### 步骤 2：移除旧字段（v2.0.0）

```typescript
{
  "user_id": "user-123"
}
```

---

## 9. 相关文档

- [CHANGELOG](./CHANGELOG.md)
- [Release Notes](./RELEASE_NOTES_v0.7.0-rc.1.md)
- [OpenAPI 规范](./openapi.yaml)

---

## 附录：术语表

| 术语 | 定义 |
|------|------|
| 破坏性变更 | 可能导致现有客户端失效的变更 |
| 废弃 | 标记为即将移除，但仍可使用 |
| 移除 | 完全删除，不再可用 |
| 向后兼容 | 新版本不影响现有客户端 |
| 迁移指南 | 帮助用户迁移到新版本的文档 |
| Response Envelope | 标准响应格式 `{ data, meta, error }` |
| Error Envelope | 标准错误格式 `{ code, message, details }` |
