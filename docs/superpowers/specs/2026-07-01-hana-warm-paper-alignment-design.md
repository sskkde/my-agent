# HanaAgent 暖纸主题聊天页样式对齐设计规范

**日期**: 2026-07-01  
**范围**: `web/src/features/session/chat/*` + `web/src/layout/AgentShell.tsx`（chat 模式）  
**目标**: 将当前部署的聊天主交互页与 HanaAgent 暖纸主题原型截图在所有可见维度上对齐，不新增业务逻辑、不引入新依赖。

## 1. 设计原则

- **暖纸质感**：背景使用低饱和米色/暖灰，模拟纸张堆叠；边框极淡，仅在需要分隔时使用 0.5px `rgba`。
- **信息密度适中**：右侧面板显示真实 task / desk 入口；左侧列表强调当前选中态。
- **字体层级清晰**：欢迎标题使用更大、更重的宋体/衬线；辅助文字颜色更深以提高可读性。
-** 组件状态明确**：hover、active、disabled 状态区分明显但不刺眼。

## 2. 全局 / 顶部栏

### 当前问题
- 当前有双层顶部栏：AgentShell minimal topbar（用户/退出/设置） + ChatShell titlebar（标题/切换右侧）。
- 标题栏背景与主区域同色，缺少纸片叠加感。

### 对齐方案
- **删除 AgentShell 的 minimal topbar**：chat 模式下只保留 ChatShell 的 titlebar。
- **把用户/退出/设置入口合并到 ChatShell titlebar 右侧**：与切换右侧面板按钮放在同一行。
- **titlebar 背景色加深**：使用 `--bg-elevated`（#f5f0e8 方向），与主区域 `--bg` 形成纸张层级。
- **标题字体**：使用系统无衬线、0.9rem、500、颜色 `--text`。
- **标题内容**：未选中会话时显示 "HanaAgent"；选中后显示会话标题。

## 3. 左侧会话列表

### 当前问题
- 选中项高亮不明显。
- 缺少「归档」入口。
- 搜索图标视觉权重略高。

### 对齐方案
- **选中态**：背景色 `rgba(83, 125, 150, 0.12)`，标题加粗 `font-weight: 600`，颜色 `var(--accent)`。
- **分组标题**："7 天内 / 今天 / 昨天" 使用 0.65rem、uppercase、字距 0.05em、颜色 `var(--text-muted)`。
- **搜索图标**：改为 14px，颜色 `var(--text-faint)`，hover 变 `var(--text-muted)`。
- **新增「归档」入口**：放在左侧边栏底部，样式为小型文字链接，带归档图标。

## 4. 中间主区域

### 当前问题
- 欢迎标题偏小、偏细。
- 副标题行高过大。
- 提示卡片边框偏重，「读书推荐」在非 hover 下不应有灰底。
- 中央 logo 尺寸略大。

### 对齐方案
- **欢迎标题**：font-size 2.25rem、font-weight 500、衬线字体（Noto Serif SC / Source Han Serif SC），颜色 `var(--text)`。
- **副标题**：font-size 0.92rem、line-height 1.5、max-width 34rem、颜色 `var(--text-muted)`。
- **提示卡片**:
  - 背景 `--bg-card` 或完全透明，border 0.5px `rgba(216, 207, 190, 0.35)`。
  - 圆角 12px（原型的卡片更圆润）。
  - hover 时背景 `rgba(83, 125, 150, 0.06)`、边框 `rgba(83, 125, 150, 0.15)`。
  - 去掉单个卡片固定灰底（修复当前「读书推荐」偏灰问题）。
- **提示卡片网格**：gap 12px，内部 padding 18px。
- **中央 logo**：64px → 56px，border 0.5px `var(--border)`，阴影更淡。

## 5. 右侧工作计划面板

### 当前问题
- 只有空状态占位，缺少「+ 添加任务」按钮、任务分组、优先级标识、筛选图标。

### 对齐方案
- **面板 header**：左侧日历图标 + 标题 "工作计划"，右侧漏斗筛选图标按钮。
- **添加任务按钮**：顶部虚线边框按钮 "+ 添加任务"，hover 背景 `rgba(83, 125, 150, 0.06)`。
- **任务分组**：
  - 按时间分 "今天 / 明天 / 未来" 等，分组标题样式与左侧分组一致。
  - 当没有真实 task 时，仍然保留分组标题并显示一条柔和的占位 task（如 "暂无任务，点击添加"）。
- **任务项结构**：
  - 左侧复选框（未选中空心圆，已完成实心圆 + 对勾）。
  - 标题文字，已完成带删除线、颜色变淡。
  - 第二行元信息：截止时间 / 优先级 / 地点，使用 0.72rem `var(--text-faint)`。
  - 优先级圆点：高优先级红色、中优先级橙色、低优先级灰色。
- **实现方式**：继续使用 `TodoWorkPlanCard`，但扩展其空状态和渲染样式；不引入新的数据模型。

## 6. 右侧书桌面板

### 当前问题
- 只有空状态占位，缺少「+ 放到书桌」按钮和文件列表。

### 对齐方案
- **面板 header**：左侧书本图标 + 标题 "书桌"，右侧列表视图切换图标。
- **放到书桌按钮**：顶部虚线边框按钮 "+ 放到书桌"，hover 背景 `rgba(83, 125, 150, 0.06)`。
- **文件列表**：
  - 当没有真实文件时，显示 3-5 条示例/占位文件项（带不同图标：文档、代码、图片、链接、笔记）。
  - 每项包含：文件类型图标、文件名、类型/修改时间元信息。
  - hover 背景 `rgba(42, 38, 34, 0.03)`。
- **空状态降级**：如果未来接入了真实文件，占位项自动被真实数据替换；当前阶段使用静态示例数据。

## 7. 底部输入框

### 当前问题
- 输入框偏扁，圆角较小。
- 发送按钮空输入时灰色，有输入后变成偏红的暖色（原型是偏冷灰/蓝色）。
- 工具按钮颜色偏深。

### 对齐方案
- **输入框表面**：
  - min-height 92px，padding 16px 18px。
  - border-radius 16px。
  - border 0.5px `rgba(216, 207, 190, 0.5)`。
  - focus 时 border-color `rgba(83, 125, 150, 0.25)`，轻微外发光。
- **输入框文字**：font-size 0.95rem、line-height 1.6。
- **工具按钮**：颜色 `var(--text-faint)`，hover `var(--text-muted)`。
- **状态栏**：
  - 模型名与状态之间用更轻的分隔。
  - 上下文进度条高度 3px，颜色与 accent 一致；低占用时保持灰色填充背景。
- **发送按钮**：
  - 可用时背景 `var(--accent)`（冷灰蓝 #537d96），白色箭头。
  - disabled 时背景 `var(--text-ghost)`。
  - size 36x36，border-radius 10px。

## 8. 颜色与 token 调整

在 `theme.css` 已存在的 token 基础上，新增或覆盖以下值（均使用 CSS 变量，不破坏其他页面）：

| Token | 目标值 | 用途 |
|---|---|---|
| `--bg` | `#fdf9f3` | 主区域背景 |
| `--bg-elevated` | `#f5f0e8` | 顶部栏、侧边栏背景 |
| `--bg-card` | `#fbf7ee` | 卡片/输入框背景 |
| `--border` | `rgba(216, 207, 190, 0.45)` | 全局边框 |
| `--text` | `#3d3833` | 主文字 |
| `--text-muted` | `#6b655d` | 辅助文字 |
| `--text-faint` | `#9a948c` | 更淡文字 |
| `--accent` | `#537d96` | 强调色（冷灰蓝） |
| `--accent-hover` | `#3f657d` | 强调色 hover |

说明：如果 `theme.css` 已定义同名变量且被 `applyDocumentTheme` 使用，则以覆盖该文件中的 chat section 样式为主，避免全局改 token 影响其他页面。优先在 `chat-theme.css` 中使用局部 fallback 值覆盖。

## 9. 组件改动清单

| 文件 | 改动 |
|---|---|
| `web/src/layout/AgentShell.tsx` | chat 模式下不再渲染 minimal topbar；用户/设置入口下移到 ChatShell titlebar |
| `web/src/layout/chat-minimal-topbar.css` | 若 titlebar 合并后不再需要，可删除；否则保留最小化样式 |
| `web/src/features/session/chat/ChatShell.tsx` | titlebar 右侧增加用户/设置/退出入口；背景色调整 |
| `web/src/features/session/chat/ChatPage.tsx` | 把 user/logout/设置状态传递给 ChatShell |
| `web/src/features/session/chat/chat-theme.css` | 全面调整颜色、字体、间距、边框、圆角、hover/active 状态 |
| `web/src/features/session/chat/ChatSessionList.tsx` | 增强选中态；底部增加「归档」入口 |
| `web/src/features/session/chat/ChatContextPanel.tsx` | 增加「+ 添加任务」「+ 放到书桌」按钮、任务分组、文件列表示例 |
| `web/src/features/session/chat/ChatComposer.tsx` | 调整输入框尺寸、圆角、工具按钮颜色、发送按钮颜色 |
| `web/src/features/context/TodoWorkPlanCard.tsx` | 调整任务项样式，增加分组和空状态占位 |

## 10. 测试策略

- `npm --prefix web run typecheck` 必须无错误。
- `npm --prefix web test -- --run` 通过。
- Playwright 无头截图对比：登录后首页截图与原型逐项肉眼核对。
- 不新增 e2e 测试，只更新现有 snapshot/单元测试若布局类名变更导致失败。

## 11. 范围外（明确不做）

- 不接入真实的文件上传/书桌存储。
- 不接入真实的 task 创建/编辑（只渲染已有 task 或示例占位）。
- 不修改后端 API。
- 不引入新依赖（字体、图标库等）。

---

## 12. 审批

- [x] 差异对比已完成
- [ ] 设计规范待用户审批
- [ ] 实现计划待制定
