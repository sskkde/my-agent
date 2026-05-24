# Web 工具使用启发式

- search 用于查找信息，不用于已知 URL
- fetch 用于已知 URL 的文本抽取，不用于搜索
- browser 只用于需要登录、交互、JS 渲染、视觉布局的场景
- 优先用 search/fetch，browser 为最后手段
- 不在无明确需求时主动调用 web 工具
