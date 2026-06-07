# 数据库恢复操作指南

**版本**: v0.7.0-rc.1  
**最后更新**: 2026-05-19

---

## 概述

本文档详细说明如何从备份恢复 Agent Platform 数据库。恢复操作应在以下场景执行：

- 数据库损坏或数据丢失
- 回滚到之前版本
- 迁移到新服务器
- 灾难恢复

---

## 恢复前准备

### 1. 确认备份文件存在

```bash
# 列出所有备份
npm run db:backup list

# 或直接检查备份目录
ls -la data/backups/

# 检查备份文件完整性
file data/backups/backup-*.db
```

**要求**: 备份文件必须存在且非空。

### 2. 停止服务

恢复前必须停止所有访问数据库的服务：

```bash
# Docker 部署
docker compose down

# 或直接部署
systemctl stop agent-platform
# 或
pm2 stop agent-platform
```

**警告**: 在服务运行时恢复数据库会导致数据损坏。

### 3. 备份当前数据库

在恢复前，备份当前数据库以防需要回退：

```bash
# 备份当前数据库
cp $DATABASE_PATH "${DATABASE_PATH}.pre-restore-$(date +%Y%m%d%H%M%S)"

# 或使用备份脚本
npm run db:backup create -- --output "data/backups/pre-restore-$(date +%Y%m%d%H%M%S).db"
```

---

## 恢复方式

### 方式一：SQLite .restore 命令（推荐）

使用 SQLite 内置恢复命令，自动处理完整性检查：

```bash
# 进入 SQLite 命令行
sqlite3 "$DATABASE_PATH"

# 在 SQLite 提示符下执行
.restore data/backups/backup-YYYY-MM-DD.db

# 验证恢复结果
PRAGMA integrity_check;
.tables
.quit
```

**优点**:

- SQLite 原生支持
- 自动处理 WAL 文件
- 内置完整性验证

**适用场景**:

- 备份文件较小（< 1GB）
- 目标数据库已存在

---

### 方式二：文件替换

直接替换数据库文件，适用于快速恢复：

```bash
# 1. 删除或重命名现有数据库
mv "$DATABASE_PATH" "${DATABASE_PATH}.old"

# 2. 复制备份文件
cp data/backups/backup-YYYY-MM-DD.db "$DATABASE_PATH"

# 3. 清理 WAL 文件（如果存在）
rm -f "${DATABASE_PATH}-wal"
rm -f "${DATABASE_PATH}-shm"

# 4. 设置正确权限
chmod 644 "$DATABASE_PATH"
```

**优点**:

- 操作简单快速
- 无需 SQLite 交互

**适用场景**:

- 灾难恢复（数据库完全丢失）
- 迁移到新服务器
- 备份文件较大

---

### 方式三：从 SQL 导出恢复

如果备份是 SQL 格式（通过 `npm run db:backup export`）：

```bash
# 1. 创建新数据库
sqlite3 "$DATABASE_PATH" < data/backups/export-YYYY-MM-DD.sql

# 2. 验证
sqlite3 "$DATABASE_PATH" "PRAGMA integrity_check;"
```

**适用场景**:

- SQL 文本备份
- 需要检查备份内容
- 跨版本迁移

---

## 完整性验证

恢复后必须验证数据完整性：

### 1. SQLite 完整性检查

```bash
sqlite3 "$DATABASE_PATH" "PRAGMA integrity_check;"
```

**预期输出**: `ok`

如果输出不是 `ok`，说明数据库损坏，需要使用其他备份。

### 2. 表数量验证

```bash
# 检查表数量
sqlite3 "$DATABASE_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';"
```

**预期值**: 根据版本不同，v0.7.0-rc.1 应有约 20+ 张表。

### 3. 关键表数据验证

```bash
# 检查会话表
sqlite3 "$DATABASE_PATH" "SELECT COUNT(*) FROM sessions;"

# 检查用户表
sqlite3 "$DATABASE_PATH" "SELECT COUNT(*) FROM users;"

# 检查消息表
sqlite3 "$DATABASE_PATH" "SELECT COUNT(*) FROM messages;"
```

记录各表记录数，与备份前对比。

### 4. 使用验证脚本

```bash
# 运行备份恢复验证脚本
npx tsx scripts/check-backup-restore.ts
```

**预期输出**: `7/7 checks passed`

---

## 恢复后检查

### 1. 启动服务

```bash
# Docker 部署
docker compose up -d

# 或直接部署
systemctl start agent-platform
```

### 2. 健康检查

```bash
# 等待服务启动
sleep 10

# API 健康检查
curl -f http://localhost:3003/api/v1/health

# 详细健康检查
curl http://localhost:3003/api/v1/health/ready
```

### 3. 功能验证

```bash
# 查询会话列表
curl http://localhost:3003/api/v1/sessions

# 创建测试会话
curl -X POST http://localhost:3003/api/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{"userId":"restore-test"}'
```

### 4. 日志检查

```bash
# Docker 部署
docker compose logs -f api

# 或直接部署
journalctl -u agent-platform -f
```

检查是否有数据库相关错误。

---

## 故障排除

### 问题 1：备份文件损坏

**症状**:

```
Error: file is not a database
PRAGMA integrity_check: *** in database main ***
```

**解决**:

```bash
# 检查文件类型
file data/backups/backup-*.db

# 如果显示非 SQLite 数据库，尝试其他备份
ls -la data/backups/

# 恢复更早的备份
cp data/backups/backup-OLDER-DATE.db "$DATABASE_PATH"
```

---

### 问题 2：版本不匹配

**症状**:

```
Error: Migration version mismatch
```

**解决**:

```bash
# 检查备份的迁移版本
sqlite3 data/backups/backup-*.db "SELECT * FROM schema_version;"

# 检查当前代码期望的迁移版本
ls migrations/ | wc -l

# 如果版本不匹配，切换到对应版本的代码
git checkout v0.6.0  # 或其他匹配版本
```

---

### 问题 3：权限问题

**症状**:

```
Error: unable to open database file
Error: disk I/O error
```

**解决**:

```bash
# 检查文件权限
ls -la "$DATABASE_PATH"

# 修复权限
chown -R agent-platform:agent-platform "$(dirname $DATABASE_PATH)"
chmod 755 "$(dirname $DATABASE_PATH)"
chmod 644 "$DATABASE_PATH"

# 检查目录权限
ls -la "$(dirname $DATABASE_PATH)"
```

---

### 问题 4：WAL 文件冲突

**症状**:

```
Error: database is locked
```

**解决**:

```bash
# 确保服务已停止
docker compose down  # 或 systemctl stop agent-platform

# 检查并清理 WAL 文件
ls -la "${DATABASE_PATH}-wal" "${DATABASE_PATH}-shm"

# 删除 WAL 文件
rm -f "${DATABASE_PATH}-wal" "${DATABASE_PATH}-shm"

# 重新恢复
cp data/backups/backup-*.db "$DATABASE_PATH"
```

---

### 问题 5：磁盘空间不足

**症状**:

```
Error: database or disk is full
```

**解决**:

```bash
# 检查磁盘空间
df -h "$(dirname $DATABASE_PATH)"

# 清理旧备份
ls -la data/backups/
rm data/backups/backup-OLD-*.db

# 清理其他临时文件
rm -f "${DATABASE_PATH}.old"
rm -f "${DATABASE_PATH}.pre-restore-*"
```

---

### 问题 6：恢复后数据丢失

**症状**: 恢复后表数据少于预期

**解决**:

```bash
# 检查备份文件中的数据
sqlite3 data/backups/backup-*.db "SELECT COUNT(*) FROM sessions;"

# 如果备份数据也不完整，尝试其他备份
ls -la data/backups/

# 如果所有备份都不完整，检查是否有外部备份
# （如云存储、异地备份等）
```

---

## 恢复记录模板

每次恢复操作后，记录以下信息：

```markdown
## 恢复记录

- **时间**: YYYY-MM-DD HH:MM:SS
- **备份文件**: backup-YYYY-MM-DD.db
- **备份时间**: [备份创建时间]
- **恢复原因**: [描述恢复原因]
- **恢复方式**: [sqlite restore / file replacement / sql import]
- **完整性检查**: [通过/失败]
- **验证结果**: [通过/失败]
- **执行人**: [姓名]
- **备注**: [其他说明]
```

---

## 最佳实践

1. **定期验证备份**: 定期运行 `npx tsx scripts/check-backup-restore.ts` 验证备份可用性

2. **保留多个备份**: 保留至少 7 天的备份，重要节点保留更久

3. **恢复前备份**: 恢复前始终备份当前数据库

4. **停止服务**: 恢复前确保所有服务已停止

5. **验证完整性**: 恢复后必须运行完整性检查

6. **记录操作**: 记录每次恢复操作的详细信息

---

## 相关文档

- [生产部署指南](../deployment/production.md)
- [回滚操作手册](../release/ROLLBACK_RUNBOOK.md)
- [备份 CLI 使用](../../src/cli/db-backup.ts)
