FilmManager 是一个基于 Electron + React 的胶片照片管理桌面应用。主进程管理窗口生命周期、SQLite 数据库、IPC 通信、Worker 缩略图池、胶片边框导出管道。渲染进程使用 Ant Design + Zustand 构建 UI，通过 preload contextBridge 与主进程通信。

核心模块：
- 主进程 (src/main/index.ts): Electron 窗口、库路径管理、异常捕获
- 数据库 (src/main/db): better-sqlite3 + WAL 模式，自动迁移
- IPC 层 (src/main/ipc): 8 个模块（photos/import/attributes/sublibraries/library/locations/rolls/export）
- Preload (src/preload): contextBridge 暴露类型安全 API
- 渲染进程 (src/renderer): React + Ant Design + Zustand 状态管理
- Worker 池 (src/main/workers): 多线程缩略图生成
- 导出管道 (src/main/services/export): @napi-rs/canvas 渲染胶片边框/齿孔/边字
