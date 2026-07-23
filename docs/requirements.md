# FilmManager 项目环境依赖文档

**版本：** 1.1.3
**更新时间：** 2026-07

---

## 一、开发语言

| 语言 | 版本要求 | 用途 |
|------|---------|------|
| **TypeScript** | ^5.3.3 | 全项目统一语言（主进程、预加载脚本、渲染进程） |
| **JavaScript (ES2022)** | — | TypeScript 编译目标 |
| **HTML / CSS** | — | 渲染层结构与基础样式 |

---

## 二、运行环境

| 环境 | 版本要求 | 说明 |
|------|---------|------|
| **Node.js** | ≥ 20.x（推荐 20 LTS） | 开发与构建环境；当前实测 v20.19.5 |
| **npm** | ≥ 10.x | 包管理器；当前实测 v10.8.2 |
| **Electron** | ^29.1.0 | 桌面运行时，内置 Chromium + Node.js |
| **目标平台** | Windows x64 | 打包目标；开发可在 macOS / Linux 进行 |

---

## 三、核心框架

| 框架 | 版本 | 用途 |
|------|------|------|
| **Electron** | ^29.1.0 | 桌面应用壳，提供系统 API（文件系统、IPC、原生窗口） |
| **React** | ^18.2.0 | 渲染进程 UI 框架 |
| **React DOM** | ^18.2.0 | React 的 DOM 渲染器 |
| **electron-vite** | ^2.0.0 | Electron 专用构建工具，统一管理主进程 / 预加载 / 渲染进程的 Vite 构建 |
| **Vite** | ^5.1.1 | 底层前端构建引擎（由 electron-vite 调用） |

---

## 四、运行时依赖（`dependencies`）

打包进最终安装包，应用运行必需。

### 4.1 UI 组件

| 库 | 版本 | 用途 |
|----|------|------|
| **antd** | ^5.14.0 | Ant Design 组件库，提供 Modal、Button、Select、DatePicker、Tree 等所有 UI 组件 |
| **@tanstack/react-virtual** | ^3.2.0 | 虚拟化滚动，支持数万张图片的高性能网格渲染 |
| **dayjs** | ^1.11.10 | 日期处理库，用于拍摄日期格式化与 DatePicker 绑定 |

### 4.2 地图功能

| 库 | 版本 | 用途 |
|----|------|------|
| **leaflet** | ^1.9.4 | 地图渲染引擎，使用 OpenStreetMap 底图 |
| **react-leaflet** | ^5.0.0 | Leaflet 的 React 封装 |
| **@types/leaflet** | ^1.9.21 | Leaflet TypeScript 类型声明（放在 dependencies 供运行时使用） |

### 4.3 数据库

| 库 | 版本 | 用途 |
|----|------|------|
| **better-sqlite3** | ^9.4.3 | SQLite3 同步接口，主进程直接操作本地数据库（WAL 模式） |

### 4.4 图像处理

| 库 | 版本 | 用途 |
|----|------|------|
| **sharp** | ^0.33.3 | 高性能图像处理：生成缩略图、解码 RAW 文件、读取 EXIF、应用 ICC 色彩配置、裁剪胶卷图标 |

### 4.5 日志

| 库 | 版本 | 用途 |
|----|------|------|
| **electron-log** | ^5.1.2 | 主进程日志，写入 `{userData}/logs/`，支持自动滚动 |

### 4.6 状态管理

| 库 | 版本 | 用途 |
|----|------|------|
| **zustand** | ^4.5.1 | 渲染进程全局状态管理（选中照片、视图模式、过滤条件等） |

---

## 五、开发依赖（`devDependencies`）

仅用于开发和构建，不打包进安装包。

### 5.1 构建工具

| 库 | 版本 | 用途 |
|----|------|------|
| **electron-vite** | ^2.0.0 | Electron 专用 Vite 配置封装 |
| **vite** | ^5.1.1 | 前端构建，支持 HMR 热更新 |
| **@vitejs/plugin-react** | ^4.2.1 | Vite 的 React 插件（JSX 转换、Fast Refresh） |
| **electron-builder** | ^24.9.4 | 打包为平台安装包（NSIS .exe） |
| **@electron/rebuild** | ^3.6.0 | 将 better-sqlite3 / sharp 等原生模块重新编译为当前 Electron 对应的 Node ABI |

### 5.2 Electron 工具

| 库 | 版本 | 用途 |
|----|------|------|
| **@electron-toolkit/preload** | ^3.0.0 | 预加载脚本工具函数 |
| **@electron-toolkit/utils** | ^3.0.0 | Electron 主进程常用工具（`is` 平台判断等） |

### 5.3 TypeScript 类型声明

| 库 | 版本 | 用途 |
|----|------|------|
| **typescript** | ^5.3.3 | TypeScript 编译器 |
| **@types/node** | ^20.11.16 | Node.js 内置模块类型 |
| **@types/react** | ^18.2.55 | React 类型 |
| **@types/react-dom** | ^18.2.19 | React DOM 类型 |
| **@types/better-sqlite3** | ^7.6.8 | better-sqlite3 类型 |

### 5.4 CSS 工具（已引入，渲染层辅助）

| 库 | 版本 | 用途 |
|----|------|------|
| **tailwindcss** | ^3.4.1 | 原子 CSS 框架（当前项目以 inline style 为主，tailwind 作为补充） |
| **postcss** | ^8.4.35 | CSS 后处理器 |
| **autoprefixer** | ^10.4.17 | 自动添加 CSS 厂商前缀 |

---

## 六、原生模块说明

以下两个库包含 C++ 原生扩展，**必须针对目标 Electron 版本重新编译**，否则无法加载：

| 库 | 原因 | 处理方式 |
|----|------|---------|
| **better-sqlite3** | Node 原生扩展（`.node` 文件） | `postinstall` 脚本自动执行 `electron-rebuild` |
| **sharp** | libvips 原生绑定 | 同上；打包时通过 `asarUnpack` 排除在 asar 压缩包外 |

> **跨平台编译（Linux → Windows）：** 执行 `npm run dist:cross`，该脚本会先运行 `scripts/prepare-win-natives.mjs` 复制对应平台的预编译二进制文件，再调用 electron-builder。

---

## 七、外部服务依赖

| 服务 | 用途 | 是否必需 |
|------|------|---------|
| **OpenStreetMap Nominatim API** | 地点搜索（`locations.search`） | 可选，仅在使用地点搜索功能时需要网络连接 |

> 应用核心功能（导入、浏览、标注、预览）**完全离线**，不依赖任何云服务。

---

## 八、快速开始

```bash
# 1. 安装依赖（自动触发原生模块重编译）
npm install

# 2. 开发模式启动（带 HMR）
npm run dev

# 3. 构建生产包
npm run build

# 4. 打包 Windows 安装包（需在 Windows 上）
npm run dist

# 5. 跨平台打包（Linux / macOS → Windows x64）
npm run dist:cross
```

---

## 九、项目结构概览

```
film-manager/
├── src/
│   ├── main/               # Electron 主进程（Node.js + TypeScript）
│   │   ├── index.ts        # 窗口创建、IPC 注册入口
│   │   ├── db/             # SQLite 数据库初始化与迁移
│   │   ├── ipc/            # IPC Handler（photos, attrs, sublib, import 等）
│   │   └── services/       # 业务逻辑（缩略图生成、EXIF 读取等）
│   ├── preload/
│   │   └── index.ts        # contextBridge 暴露 window.api
│   └── renderer/
│       └── src/            # React 渲染进程
│           ├── components/ # UI 组件
│           ├── pages/      # 页面（Library 主页面）
│           ├── store/      # Zustand 全局状态
│           └── types/      # TypeScript 类型定义
├── resources/
│   ├── film-icons/         # 内置胶卷图标（WebP）
│   └── profiles/           # 内置 ICC 色彩配置文件
├── docs/
│   ├── product-spec.md     # 产品规格文档
│   └── requirements.md     # 本文件
├── package.json
├── tsconfig.json
└── electron.vite.config.ts
```
