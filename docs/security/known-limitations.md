# 已知安全限制

本文档记录了 v0.7.0-rc.1 版本中已知的安全限制。这些限制在当前版本中被接受为已知问题，但应在后续版本中解决。

## 限制列表

### 1. excludedPaths 覆盖几乎所有路由

**优先级**: 高

**描述**

当 `API_AUTH_TOKEN` 环境变量未设置时，API 完全开放。即使设置了认证令牌，`excludedPaths` 配置也排除了大量路由，使其绕过会话认证检查。

当前排除的路径列表（来自 `src/api/server.ts`）：

```
/api/health
/api/health/ready
/api/setup/status
/api/setup/user
/api/auth/login
/api/auth/logout
/api/tools
/api/webhooks/*
/api/docs
/api/docs/*
/api/sessions
/api/sessions/*
/api/approvals
/api/approvals/*
/api/runs
/api/runs/*
/api/usage
/api/logs
/api/logs/*
/api/debug/*
/api/instances
/api/instances/*
/api/channels
/api/skills
/api/skills/*
/api/settings
/api/providers
/api/providers/*
/api/models
/api/agents/*
/api/memory
/api/memory/*
/api/workflows/*
/api/tool-results/*
/api/triggers/*
/api/webhooks/*
/api/connectors
/api/connectors/*
/api/planner-runs
/api/planner-runs/*
/api/observability/*
/api/tags
/api/metrics
/api/v1/health
/api/v1/health/ready
/api/v1/setup/status
/api/v1/setup/user
/api/v1/auth/login
/api/v1/auth/logout
/api/v1/tools
/api/v1/webhooks/*
/api/v1/docs
/api/v1/docs/*
/api/v1/metrics
```

**影响**

大多数 API 端点不经过会话认证中间件。实际的 API 保护依赖于 API Key 认证（`Bearer ak_*` 令牌），但如果没有正确配置，API 可能完全暴露。

**建议修复**

1. 审核 `excludedPaths` 列表，仅保留真正需要公开访问的端点（如 `/api/health`）
2. 为所有业务端点强制要求认证
3. 考虑引入更细粒度的认证级别（公开/只读/完全访问）

---

### 2. CORS origin:true 允许所有来源

**优先级**: 高

**描述**

CORS 配置设置为 `origin: true`（见 `src/api/server.ts` 第 49 行），这意味着任何网站都可以向 API 发起跨域请求。

```typescript
await server.register(cors, {
  origin: true,  // 允许所有来源
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});
```

**影响**

- 任何恶意网站都可以尝试向 API 发起请求
- 虽然浏览器同源策略提供了一定保护，但这依赖于其他安全机制（如认证）正常工作
- 在生产环境中，这可能导致 CSRF 攻击风险

**建议修复**

1. 在生产环境中将 `origin` 设置为允许的域名列表
2. 使用环境变量配置允许的来源，例如：

```typescript
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3002'];
await server.register(cors, {
  origin: allowedOrigins,
  // ...
});
```

---

### 3. 速率限制豁免本地请求

**优先级**: 中

**描述**

速率限制中间件豁免了来自 localhost 的请求（见 `src/api/middleware/rate-limit.ts` 第 52-59 行）：

```typescript
allowList: (request: FastifyRequest, key: string | number) => {
  if (isSseEndpoint(request.url)) {
    return true;
  }
  if (key === '127.0.0.1' || key === '::1') {
    return true;  // 豁免 localhost
  }
  return false;
},
```

**影响**

- 在 Docker 容器中运行的服务可能使用 localhost IP 地址
- 这意味着某些部署场景下，内部服务可能绕过速率限制
- 在共享环境中，这可能被滥用

**建议修复**

1. 添加环境变量控制是否豁免 localhost
2. 在生产环境中禁用此豁免
3. 考虑使用更精确的信任网络配置

---

### 4. Cookie 未设置 Secure 标志

**优先级**: 中

**描述**

会话 Cookie 设置时未包含 `Secure` 标志（见 `src/api/middleware/auth.ts` 第 45-51 行）：

```typescript
export function setSessionCookie(reply: FastifyReply, token: string): void {
  const maxAge = 24 * 60 * 60;
  reply.header(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`
    // 注意：缺少 Secure 标志
  );
}
```

**影响**

- Cookie 可通过非 HTTPS 连接传输
- 在不安全的网络中，会话令牌可能被拦截
- 中间人攻击可以窃取会话

**建议修复**

1. 在生产环境中添加 `Secure` 标志：

```typescript
const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
reply.header(
  'Set-Cookie',
  `${SESSION_COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`
);
```

2. 考虑使用 `SameSite=Strict` 以提供更强的 CSRF 保护

---

### 5. 会话认证不保护大多数 API 端点

**优先级**: 高

**描述**

会话认证中间件（`registerAuthMiddleware`）对 `excludedPaths` 中的所有路径跳过认证检查。由于大多数业务 API 端点都在排除列表中，会话认证实际上只保护极少数端点。

实际的 API 保护依赖于：
1. API Key 认证（`Bearer ak_*` 令牌）
2. 环境变量 `API_AUTH_TOKEN` 的配置

**影响**

- 如果未正确配置 API Key 认证，大多数端点将完全无保护
- 会话认证机制形同虚设
- 安全模型依赖于单一防线（API Key）

**建议修复**

1. 重新设计认证架构，使会话认证和 API Key 认证协同工作
2. 减小 `excludedPaths` 范围
3. 为不同类型的端点定义不同的认证要求
4. 添加审计日志记录未认证的访问尝试

---

## 总结

| 限制 | 优先级 | 当前状态 |
|------|--------|----------|
| excludedPaths 覆盖几乎所有路由 | 高 | 已知，需在生产部署前解决 |
| CORS origin:true 允许所有来源 | 高 | MVP 可接受，生产必须修复 |
| 速率限制豁免本地请求 | 中 | 开发便利，生产应禁用 |
| Cookie 未设置 Secure 标志 | 中 | 本地开发可接受，生产必须修复 |
| 会话认证不保护大多数端点 | 高 | 架构问题，需重新设计 |

## 相关文件

- `src/api/server.ts` - CORS 配置和 excludedPaths 定义
- `src/api/middleware/auth.ts` - 会话认证和 Cookie 设置
- `src/api/middleware/rate-limit.ts` - 速率限制配置
