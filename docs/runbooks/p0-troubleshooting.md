> 完整运维流程请参阅 [RUNBOOK.md](../RUNBOOK.md)。本文档仅列出 P0 验收阶段常见的快速诊断步骤。

# P0 验收阶段故障排查指南

本文档专注于 P0 验收测试阶段的常见问题诊断，提供快速定位和解决问题的步骤。

## 1. API 启动失败

### 症状

- 启动时报错 `EADDRINUSE: address already in use`
- 服务无法在预期端口启动

### 诊断命令

```bash
# 检查端口占用
lsof -i :3003

# 或使用 netstat
netstat -tlnp | grep 3003
```

### 解决方案

1. 终止占用端口的进程：
   ```bash
   kill -9 <PID>
   ```
2. 或更改端口：
   ```bash
   PORT=3004 npm run start:api
   ```

### 症状：数据库路径错误

- 报错 `Unable to open database file`
- 启动失败提示 DATABASE_PATH 相关错误

### 诊断命令

```bash
# 检查数据目录是否存在
ls -la data/

# 检查数据库文件权限
stat data/app.db
```

### 解决方案

1. 创建数据目录：
   ```bash
   mkdir -p data
   ```
2. 运行数据库迁移：
   ```bash
   npm run db:migrate
   ```

## 2. better-sqlite3 编译失败

### 症状

- `npm install` 报错 `gyp ERR!`
- 报错 `Cannot find module 'better-sqlite3'`
- 本地编译 native 模块失败

### 诊断命令

```bash
# 检查 Node.js 版本
node --version

# 检查编译工具链
which python3
which make
which g++
```

### 解决方案

1. 确保 Node.js 版本 >= 20：
   ```bash
   nvm use 20
   ```
2. 安装编译依赖：

   ```bash
   # Ubuntu/Debian
   sudo apt-get install build-essential python3

   # macOS
   xcode-select --install
   ```

3. 清理并重新安装：
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

## 3. 数据库迁移失败

### 症状

- 迁移脚本报错 `SQLITE_ERROR: table already exists`
- 报错 `migration failed`
- 数据库状态不一致

### 诊断命令

```bash
# 检查当前迁移状态
sqlite3 data/app.db "SELECT * FROM migrations ORDER BY id;"

# 检查数据库完整性
sqlite3 data/app.db "PRAGMA integrity_check;"
```

### 解决方案

1. 迁移是幂等的，可安全重新运行：
   ```bash
   npm run db:migrate
   ```
2. 如需重置数据库（警告：会丢失数据）：
   ```bash
   rm data/app.db
   npm run db:migrate
   ```
3. 对于 E2E 测试数据库：
   ```bash
   npm run reset:e2e-db
   ```

## 4. P0 测试失败诊断

### 症状

- `npm run test:p0` 报错
- 测试超时或断言失败

### 诊断命令

```bash
# 运行 P0 测试并查看详细输出
npm run test:p0

# 单独运行特定测试文件
npx vitest run tests/e2e/full-flow-suite.test.ts --reporter=verbose

# 运行并输出更多调试信息
DEBUG=* npx vitest run tests/e2e/full-flow-suite.test.ts
```

### 解决方案

1. 确保环境变量已配置：
   ```bash
   cat .env | grep -E "(APP_SECRET_KEY|OPENROUTER_API_KEY|OLLAMA_BASE_URL)"
   ```
2. 确保 API 服务未运行（测试会自行启动）：
   ```bash
   pkill -f "tsx src/api/server.ts"
   ```
3. 检查测试数据库状态：
   ```bash
   ls -la data/e2e.db
   ```

## 5. 环境变量缺失

### 症状

- 启动时报错 `APP_SECRET_KEY is required`
- LLM 调用失败
- 认证相关错误

### 诊断命令

```bash
# 检查 .env 文件是否存在
ls -la .env

# 检查必需变量
grep -E "^(APP_SECRET_KEY|OPENROUTER_API_KEY|OLLAMA_BASE_URL)" .env
```

### 解决方案

1. 从示例文件创建配置：
   ```bash
   cp .env.example .env
   ```
2. 编辑并填写必需值：
   ```bash
   # 生成随机密钥
   openssl rand -hex 32 >> .env
   ```
3. 确保至少配置一个 LLM 提供者

## 6. npm registry 不可达

### 症状

- `npm install` 报错 `ETIMEDOUT`
- 包下载失败或极慢

### 诊断命令

```bash
# 测试 registry 连接
npm ping

# 检查当前 registry
npm config get registry
```

### 解决方案

1. 切换到国内镜像：
   ```bash
   npm config set registry https://registry.npmmirror.com
   ```
2. 或使用代理：
   ```bash
   npm config set proxy http://proxy.example.com:8080
   ```
3. 清理缓存后重试：
   ```bash
   npm cache clean --force
   npm install
   ```

## 7. Foreground 路由返回空

### 症状

- 消息发送后响应为空
- LLM 路由返回 `route: null`
- 无工具调用被触发

### 诊断命令

```bash
# 启用调试日志
LOG_LEVEL=debug npm run start:api

# 检查 LLM 提供者配置
curl http://localhost:3003/api/providers
```

### 解决方案

1. 检查 agent 配置：
   ```bash
   curl http://localhost:3003/api/agents/foreground.default/config
   ```
2. 确认 providerId 和 model 已正确设置
3. 检查 allowedToolIds 是否包含预期工具

## 8. 审批流程未触发

### 症状

- 工具调用未进入审批流程
- 审批请求未生成
- 自动批准了本应人工审批的操作

### 诊断命令

```bash
# 检查审批配置
curl http://localhost:3003/api/agents/foreground.default/config | jq '.allowedToolIds'

# 查看会话历史中的审批请求
curl http://localhost:3003/api/sessions/<session-id>/transcript | jq '.[] | select(.type == "approval_request")'
```

### 解决方案

1. 确认工具 ID 在 allowedToolIds 列表中
2. 检查权限配置是否正确
3. 查看日志中的审批流程细节：
   ```bash
   LOG_LEVEL=debug npm run start:api 2>&1 | grep -i approval
   ```

---

## 快速参考

| 问题       | 快速诊断命令            |
| ---------- | ----------------------- |
| 端口占用   | `lsof -i :3003`         |
| 数据库问题 | `npm run db:health`     |
| 测试失败   | `npm run test:p0`       |
| 类型错误   | `npm run typecheck`     |
| 依赖问题   | `npm ls better-sqlite3` |

更多运维细节请参阅 [RUNBOOK.md](../RUNBOOK.md)。
