# FilmManager

面向胶片摄影爱好者的本地桌面应用，用于管理胶片扫描文件。

**当前版本：** 1.1.1 · **平台：** Windows x64

---

## 功能特性

- **导入与索引** — 递归扫描文件夹，支持 JPG / PNG / TIFF / WebP 及主流 RAW 格式；导入时自动读取 EXIF（拍摄日期、相机与镜头型号），可自动收录未入库器材
- **属性标注** — 相机、胶卷、镜头、冲扫方式等多维度属性，支持批量编辑；胶卷属性附带品牌图标
- **虚拟子库** — 树形分组，无限层级，每个子库显示照片数量
- **三档视图** — 小 / 中 / 大缩略图网格，自适应窗口宽度与全屏；小视图以横向列表展示属性详情
- **全屏预览** — 滚轮缩放（0.5×–8×）、拖拽平移、左右切换、顺时针 90° 旋转（角度持久化）；右侧显示 RGB 直方图、属性编辑、文件信息
- **RAW 解码** — 通过 Sharp/libvips 解码，支持应用 ICC 色彩配置文件实时预览
- **地点地图** — 基于 Leaflet + OpenStreetMap，为照片标记拍摄地点
- **多选操作** — 框选 + 批量删除 / 批量属性编辑 / 批量设置拍摄日期 / 批量旋转 / 跨子库移动
- **完全离线** — 所有数据本地存储，仅地点搜索功能需要网络

---

## 界面预览

> 小视图（列表）· 中视图（网格）· 大视图（宽网格）· 全屏预览

---

## 快速开始

### 直接使用

从 [Releases](https://github.com/bolelaile/FilmManager/releases) 页面下载最新的 `FilmManager Setup x.x.x.exe`，双击安装即可。

### 开发环境搭建

**环境要求**

| 工具 | 版本 |
|------|------|
| Node.js | ≥ 20 LTS |
| npm | ≥ 10 |
| 操作系统 | Windows / macOS / Linux（开发）|

```bash
# 克隆仓库
git clone https://github.com/bolelaile/FilmManager.git
cd FilmManager

# 安装依赖（自动重编译原生模块）
npm install

# 启动开发模式（热更新）
npm run dev
```

### 打包安装包

```bash
# Windows 环境直接打包
npm run dist

# Linux / macOS 跨平台编译 Windows 安装包
npm run dist:cross
```

输出文件位于 `dist-electron/FilmManager Setup x.x.x.exe`。

---

## 项目结构

```
FilmManager/
├── src/
│   ├── main/                   # Electron 主进程（Node.js + TypeScript）
│   │   ├── index.ts            # 窗口创建、IPC 注册、自定义协议
│   │   ├── db/                 # SQLite 初始化、Schema、增量迁移
│   │   ├── ipc/                # IPC Handler（photos / import / attrs / sublib / library / locations）
│   │   └── services/           # 业务逻辑（缩略图生成、EXIF 读取、RAW 解码）
│   ├── preload/
│   │   └── index.ts            # contextBridge 暴露 window.api
│   └── renderer/src/           # React 渲染进程
│       ├── components/         # UI 组件
│       │   ├── PhotoGrid/      # 照片网格（虚拟滚动、三档视图、框选）
│       │   ├── PhotoViewer/    # 全屏预览（Modal、直方图、属性编辑）
│       │   ├── FilterPanel/    # 左侧筛选面板（属性过滤、子库树）
│       │   ├── DetailDrawer/   # 照片详情抽屉
│       │   ├── ImportDialog/   # 导入对话框
│       │   ├── BatchEditModal/ # 批量属性编辑
│       │   ├── FilmLibraryModal/   # 胶卷库管理
│       │   ├── AttrLibraryModal/   # 相机库 / 镜头库管理
│       │   ├── MapView/        # 地点地图
│       │   ├── FilmIcon/       # 胶卷图标组件
│       │   └── Layout/         # TopBar（含自定义窗口控制按钮）
│       ├── pages/
│       │   └── Library.tsx     # 主页面
│       ├── store/              # Zustand 全局状态
│       └── types/              # TypeScript 类型定义
├── resources/
│   ├── film-icons/             # 内置胶卷品牌图标（WebP）
│   └── profiles/               # 内置 ICC 色彩配置文件
├── docs/
│   ├── product-spec.md         # 产品规格文档（数据库设计、IPC API、功能说明）
│   └── requirements.md         # 依赖环境文档
├── scripts/
│   └── prepare-win-natives.mjs # 跨平台编译辅助脚本
├── electron.vite.config.ts
├── package.json
└── tsconfig.json
```

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面壳 | Electron 29 |
| 前端框架 | React 18 + TypeScript 5 |
| UI 组件库 | Ant Design 5 |
| 状态管理 | Zustand 4 |
| 虚拟滚动 | @tanstack/react-virtual 3 |
| 数据库 | SQLite（better-sqlite3 9，WAL 模式） |
| 图像处理 | Sharp 0.33（缩略图、RAW 解码、EXIF、ICC） |
| 地图 | Leaflet 1.9 + react-leaflet 5 + OpenStreetMap |
| 构建工具 | electron-vite 2 + Vite 5 |
| 打包 | electron-builder 24（NSIS） |

详细依赖版本见 [`docs/requirements.md`](docs/requirements.md)。

---

## 数据库设计

数据库文件位于 `{libraryRoot}/film.db`（默认 `%APPDATA%\FilmManager\library\film.db`）。

核心表：

| 表 | 说明 |
|----|------|
| `photos` | 照片主记录（路径、尺寸、拍摄日期、备注） |
| `sub_libraries` | 虚拟子库（树形自引用） |
| `attribute_types` | 属性类别（相机、胶片、镜头等） |
| `attribute_values` | 属性可选值 |
| `photo_attributes` | 照片—属性值关联（多对多） |
| `locations` | 拍摄地点（含经纬度） |
| `photo_locations` | 照片—地点关联（多对多） |
| `color_profiles` | ICC 色彩配置文件 |

完整 Schema 与 IPC API 见 [`docs/product-spec.md`](docs/product-spec.md)。

---

## 支持的文件格式

| 类型 | 格式 |
|------|------|
| 标准格式 | JPG · JPEG · PNG · TIFF · TIF · BMP · WebP |
| RAW 格式 | CR2 · CR3 · NEF · ARW · RAF · ORF · RW2 · DNG 等 |

---

## 视图布局规格

列数随窗口宽度自动切换（以 1400px 为分界）：

| 视图 | 窗口模式 | 全屏模式 |
|------|---------|---------|
| 小视图（横向列表） | 1 列 | 2 列 |
| 中视图 | 5 列 | 8 列 |
| 大视图 | 3 列 | 5 列 |

---

## 版本历史

| 版本 | 主要变更 |
|------|---------|
| 1.0.0 | 初始版本：照片导入、属性标注、子库、全屏预览 |
| 1.0.1 | 布局优化，installer 更新 |
| 1.0.2 | 缩略图优化、拖拽导入、直方图、缩放平移、框选、右键菜单 |
| 1.0.3 | Modal 查看器、中文属性 search-to-create、查看器属性编辑侧栏、胶卷库 |
| 1.0.4 | 相机库 / 镜头库 AttrLibraryModal |
| 1.1.0 | EXIF 自动读取、子库照片数统计、批量属性编辑、相机库 / 镜头库独立管理 |
| 1.1.1 | 三档视图布局优化、自适应列数、合并自定义标题栏与工具栏 |

---

## License

MIT
