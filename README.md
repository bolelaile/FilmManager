# FilmManager

面向胶片摄影爱好者的本地桌面应用，用于管理胶片扫描文件。完全离线，所有数据本地存储，仅地点搜索需要网络。

**当前版本：** 1.4.2 · **平台：** Windows x64 · **许可：** MIT

---

## 主要功能

- **导入与索引** — 递归扫描文件夹，支持 JPG / PNG / TIFF / WebP 及主流 RAW 格式；导入时自动读取 EXIF（拍摄日期、相机与镜头型号），可自动收录未入库器材；自动识别胶片格式（半格 / 135 / 645 / 6×6 / 6×7 / 6×9 / 6×12 等）
- **胶卷管理** — 将同一胶卷的照片组织为"卷"，自动命名与封面选取；卷视图卡片展示封面/胶片/格式/地点/照片数，未分卷照片归入"其他图片"
- **子文件夹卷导入** — 按子文件夹识别为卷，自动模糊匹配胶片/相机/镜头属性，逐行确认表格可内联编辑后批量导入建卷
- **自动整理与筛选** — 导入时可按年份/年月/相机/胶片/来源文件夹自动创建子库归档；按子库树、属性、文件格式、整理状态、收藏、日期范围、搜索筛选，faceted search 联动计数
- **本地树状子库** — 界面子库与磁盘真实目录树保持一致，导入/移动/重命名/删除子库均同步整理本地文件，支持无限层级与后代照片汇总计数
- **三档视图 + 时间线** — 小/中/大缩略图网格（自适应窗口宽度），大视图带悬停预览面板；时间线视图按年月分组，与筛选面板全面联动
- **全屏预览** — 滚轮缩放（0.5×–8×）、拖拽平移、左右切换、顺时针 90° 旋转（持久化）、RGB 直方图、属性编辑；RAW 解码支持 ICC 色彩配置
- **地点地图** — Leaflet + OpenStreetMap（三源自动轮换），支持地名搜索、坐标录入、地图选点；导入时 EXIF GPS 自动关联拍摄地点
- **外部软件联动** — 自动检测本机已安装的图像处理软件（Photoshop / Lightroom / Capture One / darktable / RawTherapee / GIMP 等），可单张或批量传入打开
- **带胶片边框导出** — 参考开源项目 [film-index-generator](https://github.com/Judian99/film-index-generator) 的 Canvas 方法，物理比例几何 + Courier 等宽边字 + 按胶卷工艺自动匹配墨色 + 内置胶卷品牌库；照片 cover 填满帧区并支持拖动/缩放自定义裁切；支持单张/选中/整卷/当前筛选批量导出（并发 + 进度 + 取消）、命名模板与同名冲突处理、预设持久化
- **收藏/星标** — 照片星标，网格卡片 + 全屏预览 + 筛选面板联动，支持批量收藏
- **回收站** — 删除改为软删（移入回收站，文件保留可恢复），回收站弹窗支持恢复 / 彻底删除 / 清空
- **快捷键** — 38 个可自定义快捷键（全局 / 网格 / 预览），设置页录制绑定 + 冲突报错，`?` 呼出帮助
- **属性复制粘贴 / 拖拽进卷** — 右键或 Ctrl+Shift+C/V 复制粘贴属性；拖拽照片到卷卡片建联
- **重复照片管理** — 按 content_hash 分组，一键保留最新/最旧/最大，其余移入回收站
- **统计仪表盘** — 总数/库容量/卷数/地点数 + 按月/胶片/相机/镜头/地点/卷 Top20 柱状图

---

## 项目结构

项目采用 **6 层分层架构**（基础设施 → 数据访问 → 功能核心 → IPC 适配 → 应用协调 → UI），各层单向依赖、功能模块独立封装，便于单独升级或替换。详见 [`docs/架构分层.md`](docs/架构分层.md)。

```
FilmManager/
├── src/
│   ├── main/                       # Electron 主进程（Node.js + TypeScript）
│   │   ├── index.ts                # 窗口创建、生命周期、自定义协议、app/win IPC
│   │   │
│   │   ├── app/                    # ── 5. 应用协调层 ──
│   │   │   └── bootstrap.ts        #   DI 装配（统一构造 Repository + Service 单例）
│   │   │
│   │   ├── infra/                  # ── 1. 基础设施层 ──
│   │   │   ├── image-utils.ts      #   纯图像工具（isRawFormat/normalizeRotation/computeContentHash/decodeBmp）
│   │   │   ├── config.ts           #   库根目录配置读写
│   │   │   └── ipc-bus.ts          #   IPC handle/send 统一封装
│   │   │
│   │   ├── data/                   # ── 2. 数据访问层（Repository） ──
│   │   │   ├── index.ts            #   createRepositories 工厂
│   │   │   ├── types.ts            #   行类型 + QueryFilter/Paging
│   │   │   └── repositories/       #   7 个 Repository（封装全部 SQL）
│   │   │       ├── photo-repository.ts
│   │   │       ├── sublibrary-repository.ts
│   │   │       ├── attribute-repository.ts
│   │   │       ├── roll-repository.ts
│   │   │       ├── location-repository.ts
│   │   │       ├── export-preset-repository.ts
│   │   │       └── import-queue-repository.ts
│   │   │
│   │   ├── features/               # ── 3. 功能核心层（独立 Service 封装） ──
│   │   │   ├── photos/             #   PhotoService（列表/COUNT缓存/全屏预览/旋转/收藏/时间线）
│   │   │   ├── import/             #   ImportService + folder-scanner/equipment-resolver/gps-linker/sublibrary-resolver
│   │   │   ├── rolls/              #   RollService（建卷/删除三档/批量/卷内查询）
│   │   │   ├── attributes/         #   AttributeService（CRUD/faceted/图标/别名/JSON导入）
│   │   │   ├── sublibrary/         #   SubLibraryService（树/计数/CRUD，委托 library-layout）
│   │   │   ├── locations/          #   LocationService + osm-geocoder（在线搜索/反向地理编码）
│   │   │   ├── library/            #   LibraryService（库信息/ICC/统计/缩略图重生成）
│   │   │   ├── stats/              #   StatsService（统计仪表盘：按月/胶片/相机/镜头/地点/卷）
│   │   │   ├── export/             #   ExportService + exportPipeline + stock-presets
│   │   │   │   └── frame-renderer/ #   边框渲染器子模块（封闭封装，移植自 film-index-generator）
│   │   │   │       ├── index.ts    #     统一入口 renderFilmFrame（对外唯一暴露）
│   │   │   │       ├── shared.ts   #     共享画布基元（渐变/齿孔/边字工具）
│   │   │   │       ├── frame-135.ts#     135 渲染器（物理mm几何/齿孔/边字/条码）
│   │   │   │       ├── frame-generic.ts # 通用渲染器（10画幅/120边字三角箭头+条码）
│   │   │   │       └── types.ts    #     内部类型（不对外暴露）
│   │   │   ├── thumbnails/         #   缩略图生成（Sharp + EXIF + 胶片格式识别）
│   │   │   ├── film-format/        #   胶片格式识别（导入/导出共享）
│   │   │   ├── library-layout/     #   磁盘目录树同步
│   │   │   └── external-apps/      #   ExternalAppService（检测/打开图像软件）
│   │   │
│   │   ├── ipc/                    # ── 4. IPC 适配层（薄 adapter） ──
│   │   │   ├── index.ts            #   统一注册 + library-layout 同步
│   │   │   ├── photos.ts           #   仅注册+转发到 PhotoService
│   │   │   ├── import.ts           #   dialog + 转发到 ImportService
│   │   │   ├── attributes.ts       #   dialog + 转发到 AttributeService
│   │   │   ├── rolls.ts            #   转发到 RollService
│   │   │   ├── sublibraries.ts     #   转发到 SubLibraryService
│   │   │   ├── library.ts          #   dialog + 转发到 LibraryService
│   │   │   ├── locations.ts        #   转发到 LocationService
│   │   │   └── export.ts           #   转发到 ExportService
│   │   │
│   │   ├── db/                     # SQLite 初始化、Schema、增量迁移、种子数据
│   │   └── workers/                # 缩略图 Worker Thread 池（4线程+崩溃恢复）
│   │
│   ├── preload/
│   │   └── index.ts                # contextBridge 暴露 window.api（按领域分组）
│   │
│   ├── renderer/                   # ── 6. UI 层 ──
│   │   ├── services/
│   │   │   └── service-client.ts   #   window.api 类型化封装（UI 经此调用）
│   │   └── src/
│   │       ├── components/         #   UI 组件
│   │       │   ├── PhotoGrid/      #     照片网格（虚拟滚动、三档视图、框选）
│   │       │   ├── PhotoViewer/    #     全屏预览（直方图、属性编辑、缩放平移）
│   │       │   ├── ExportModal/    #     导出弹窗（画幅/边字/pan-zoom/预览）
│   │       │   ├── FilterPanel/    #     左侧筛选面板（属性/子库/faceted）
│   │       │   ├── RollsView/      #     卷视图（三档/多选/批量）
│   │       │   ├── TimelineView/   #     时间线视图（年月分组）
│   │       │   ├── ImportDialog/   #     导入向导（单批次/卷模式）
│   │       │   ├── MapView/        #     地点地图（Leaflet 三源轮换）
│   │       │   └── ...             #     其他组件（DetailDrawer/BatchEditModal/SettingsModal 等）
│   │       ├── pages/Library.tsx   #   主页面（状态协调）
│   │       ├── store/              #   Zustand 三 slice（filter/library/ui）
│   │       ├── hooks/              #   usePhotoLoader/useRollLoader/useLibraryData
│   │       └── types/              #   渲染层类型定义
│   │
│   └── shared/                     # 跨进程共享
│       ├── import-types.ts         #   ImportOptions / AutoOrganizeMode
│       ├── export-types.ts         #   ExportConfig / FilmFormatId / filmFormatToId
│       └── services/               #   Service 接口契约（IPhotoService 等）
│
├── resources/
│   ├── film-icons/                 # 内置胶卷品牌图标（WebP，234+）
│   ├── profiles/                   # 内置 ICC 色彩配置文件
│   ├── film-borders/               # 胶片边框素材
│   ├── fonts/                      # 内嵌字体
│   └── presets/                    # 胶卷/相机预设模板（JSON）
│
├── docs/
│   ├── product-spec.md             # 产品规格（数据库设计、IPC API、功能说明）
│   ├── 架构分层.md                  # 6 层架构说明 + 调用链
│   ├── 功能测试流程.md              # L1/L2/L3 测试流程
│   ├── 导出功能优化方案.md           # 导出功能设计文档
│   └── requirements.md             # 依赖环境文档
│
├── scripts/
│   ├── prepare-win-natives.mjs     # 跨平台编译原生模块（better-sqlite3/sharp/@napi-rs/canvas）
│   ├── logic-test.cjs              # L2 逻辑单测（14 项）
│   ├── regression-test.cjs         # L2 渲染器回归（12 项）
│   └── test-library-layout.mjs     # L3 library-layout 集成测试
│
├── electron.vite.config.ts
├── package.json
└── tsconfig.json
```

### 分层调用链

```
UI 组件 → service-client → preload(window.api) → ipc-adapters → features Service → data Repository → DB
                                                                        ↓
                                                              infra/图像工具 + workers
```

**依赖规则**：上层单向依赖下层；功能核心不直接 `getDb()`/`ipcMain`；IPC 适配层仅参数转换+转发；UI 经 service-client 调用。

---

## 运行环境

| 工具 | 版本 |
|------|------|
| Node.js | ≥ 20 LTS |
| npm | ≥ 10 |
| 操作系统 | Windows（生产打包）· Windows / macOS / Linux（开发） |

## 技术栈

| 层次 | 技术 |
|------|------|
| 桌面壳 | Electron 29 |
| 前端框架 | React 18 + TypeScript 5 |
| UI 组件库 | Ant Design 5 |
| 状态管理 | Zustand 4 |
| 虚拟滚动 | @tanstack/react-virtual 3 |
| 数据库 | SQLite（better-sqlite3 9，WAL 模式） |
| 图像处理 | Sharp 0.33（缩略图、RAW 解码、EXIF、背景模糊） |
| 胶片边框导出 | @napi-rs/canvas 1.0（Canvas 2D 渲染） |
| 地图 | Leaflet 1.9 + OpenStreetMap（三源自动轮换） |
| 构建工具 | electron-vite 2 + Vite 5 |
| 打包 | electron-builder 24（NSIS） |

详细依赖版本见 [`docs/requirements.md`](docs/requirements.md)。

---

## 快速开始

### 直接使用

从 [Releases](https://github.com/bolelaile/FilmManager/releases) 页面下载最新的 `FilmManager Setup x.x.x.exe`，双击安装即可。

### 开发环境

```bash
git clone https://github.com/bolelaile/FilmManager.git
cd FilmManager
npm install      # 自动重编译原生模块
npm run dev      # 开发模式（热更新）
```

### 打包安装包

```bash
npm run dist          # Windows 环境直接打包
npm run dist:cross    # Linux / macOS 跨平台编译 Windows 安装包
```

输出文件位于 `dist-electron/FilmManager Setup x.x.x.exe`。

---

## 支持的文件格式

| 类型 | 格式 |
|------|------|
| 标准格式 | JPG · JPEG · PNG · TIFF · TIF · BMP · WebP |
| RAW 格式 | CR2 · CR3 · NEF · NRW · ARW · SRF · SR2 · ORF · RW2 · PEF · RAF · DNG · RAW · RWL · MRW · X3F · 3FR · FFF · IIQ · MEF |

---

## 数据库设计

数据库文件位于 `{libraryRoot}/film.db`（SQLite，WAL 模式，外键开启），默认 `%APPDATA%\FilmManager\library\film.db`。核心表：

| 表 | 说明 |
|----|------|
| `photos` | 照片主记录（路径、尺寸、拍摄日期、旋转、收藏、内容哈希、存储模式、导入状态） |
| `sub_libraries` | 树状子库（树形自引用，含本地目录名） |
| `attribute_types` / `attribute_values` | 属性类别与可选值（相机、胶片、镜头、冲扫方式、胶片格式等） |
| `attribute_value_aliases` | 属性值别名（用于文件夹解析与 EXIF 器材识别的模糊匹配） |
| `photo_attributes` | 照片—属性值关联（多对多） |
| `rolls` / `photo_rolls` | 胶卷记录与照片—胶卷关系 |
| `locations` / `photo_locations` | 拍摄地点与照片—地点关联 |
| `color_profiles` | ICC 色彩配置文件 |
| `export_presets` | 导出预设（名称、是否内置、JSON 配置） |
| `import_queue` | 导入任务队列（两阶段导入追踪） |
| `db_meta` | 数据库元信息（种子数据版本门控） |

完整 Schema 与 IPC API 见 [`docs/product-spec.md`](docs/product-spec.md)。

---

## 更新历史

> 按版本由新到旧排列。

### 1.4.2

- **回收站（软删除）**：删除改为移入回收站（`deleted_at` 标记，文件不动，可恢复）；原三档硬删简化为「移入回收站 / 彻底删除」；新增回收站弹窗（恢复 / 彻底删除 / 清空回收站）；全链路查询过滤回收站（照片列表/时间线/筛选计数/faceted/子库计数/卷计数/地点计数/库布局同步均排除已删照片）
- **快捷键体系**：38 个动作（全局 / 照片网格 / 全屏预览三类）+ 设置页「快捷键」Tab 自定义录制 + **冲突报错拒绝**（同可达域重复绑定高亮提示）；绑定持久化于 `db_meta`；`?` 呼出帮助浮层；网格方向键焦点导航、预览 F/R/E/I/+/-/0/Home/End
- **属性复制粘贴**：右键「复制属性 / 粘贴属性」+ `Ctrl+Shift+C/V`，复用 `batchSetAttributes`
- **拖拽进卷**：照片卡片可拖拽（自定义 MIME），卷卡片为放置目标调 `rolls:addPhotos`；全局拖入守卫隔离应用内拖拽
- **重复照片管理**：按 `content_hash` 分组展示，「保留最新 / 最旧 / 最大，其余移入回收站」+ 单张软删
- **统计仪表盘**：新增 `StatsService` + `stats:dashboard`；总数 / 库容量 / 卷数 / 地点数 + 按月 / 胶片 / 相机 / 镜头 / 地点 / 卷 Top20（纯 CSS 柱状图，无新依赖）
- **安全加固**：`photos:fullPreview` 路径校验（仅库内已登记照片 + ICC 路径限定配置目录），封堵渲染层被攻陷后任意文件读取
- **漏洞修复**：符号快捷键（`?`/`+`）Shift 误判导致不匹配；弹窗打开时全局/网格快捷键误操作

### 1.4.1

- **边框渲染核心完整移植**：从参考项目提取 3 个核心文件封装为 `frame-renderer/` 子模块（shared/frame-135/frame-generic），封装完整封闭，对外仅暴露 `renderFilmFrame`
- **补齐边字与齿孔**：120 边字三角箭头+条码+preset 交替、齿孔三种对齐（continuous/center/anchored）、imageInSprockets 曝光区
- **画幅补全**：新增 6×17 画幅；filmFormatToId 补 6×8/6×17 映射；修复 FilmFormatId 类型不一致

### 1.4.0

- **分层架构重构**：6 层分层（基础设施 / 数据访问 / 功能核心 / IPC 适配 / 应用协调 / UI），功能模块分离为独立 Service 封装，层间调用清晰，便于单独升级或替换
- **功能核心层**：9 个 Service（photos / import / rolls / attributes / sublibrary / locations / library / export / external-apps），每个可独立替换/升级
- **Repository 数据层**：7 个 Repository 封装全部 SQL，功能核心不直接访问 DB
- **IPC 薄适配层**：9 个 adapter 仅注册+转发（无 SQL/业务逻辑）
- **渲染层 service-client**：window.api 类型化封装
- **DI 装配 + 架构文档 + 功能测试流程**

### 1.3.7

- **导出功能重构**：改为参考 [film-index-generator](https://github.com/Judian99/film-index-generator) 的 Canvas 渲染方法（`@napi-rs/canvas`），物理比例几何 + Courier 等宽边字 + 发光 + 品牌/预设交替 + 帧号 + 条码 + 按胶卷工艺自动匹配墨色 + 内置胶卷品牌库；照片 cover 填满 + 拖动/缩放裁切；覆盖 9 种画幅；导出图片画面居中；格式精简为 JPEG/PNG，旧预设自动迁移
- **性能优化**：导入并行化（有界并发 + 异步文件拷贝）、并行导入同名文件竞态修复、缩略图 Worker Pool 崩溃恢复、GPS 地点关联缓存、照片列表 COUNT 缓存、启动迁移按版本门控跳过

### 1.3.6

- 新增**带胶片边框导出功能**：按 `film_format` 自动匹配边框模板（135 齿孔 / 半格 / Xpan / 120 背纸 / 大画幅净边 / 无边框），边字 token 系统（支持批量递增帧号），多格式/位深/背景/边框样式配置，单张/选中/整卷/筛选批量导出（并发 + 进度 + 取消），命名模板与同名冲突处理，`export_presets` 表 + 内置预设与自定义预设持久化

### 1.3.5

- UX 优化：时间线视图与 FilterPanel 全面联动 + 三档缩略图尺寸区分 + 年份多选/月份范围过滤；搜索框 300ms 防抖；FilterPanel 筛选 Chips（逐条移除）；全局拖拽导入（拖入文件显示蒙层并自动打开导入对话框）

### 1.3.4

- 卷视图大缩略图改为横向详情行布局；统一所有弹窗圆角与 padding；设置页新增版本更新历史面板；缩略图 Worker Thread 池并行生成；收藏/星标系统（卡片星标 + 全屏切换 + 筛选 + 批量）；导入时 EXIF GPS 自动地点关联（100m 范围匹配或新建）

### 1.3.3

- 相机画幅属性系统（`camera_formats` / `camera_default_format`）+ 新增 6×9/Xpan 格式预设 + 70+ 相机预设；导入时相机画幅与胶卷类型交集约束格式识别；文件夹复合命名解析（相机/时间/胶片/地点/题材分别提取）；卷模式导入新增"单文件夹为一卷"与存储方式选择；卷视图多选/框选/批量操作/三档独立尺寸；删除卷三档选项（索引/数据库/物理文件）

### 1.3.2

- 修复 6×6 被误判为半格；新增 `film_size_type` 胶卷分类字段约束格式识别范围；统一 Fuji 命名与品牌别名；新增乐凯 c400 预设

### 1.3.1+

- 导入时自动识别胶片格式（齿孔/背纸/长宽比像素分析），不覆盖手动标注；新增半格/645/6×6/6×7/6×8/6×12 格式预设；卷确认表格属性 Select 支持内联新增值；卷导入模式新增拖放根目录扫描

### 1.3.1

- 两阶段导入（占位登记 + 后台处理）+ 全局进度条；导入存储模式选择（复制到图库 / 建立索引）；新增 `import_queue` 任务队列；修复 linked 模式删除/移动与回滚相关 Bug

### 1.3.0

- 架构重构：Zustand Store 拆分三个领域 slice；Library.tsx 拆分为三个自定义 hook；提取共享类型；基于内容哈希的重复文件检测；COUNT 查询与删除/属性操作原子化优化；数据库增量迁移

### 1.2.1

- 地图回归 Leaflet + 三源自动轮换（OSM.de → Esri → OSM），瓦片加载状态与重试；LocationPicker 恢复检索 + 手动坐标模式；地点种子数据扩充

### 1.2.0

- 地图改用 MapLibre GL；BatchEditModal 批量设置拍摄地点；地点种子数据大幅扩充与去重修正；setForPhotos 支持清除地点；faceted search 联动计数

### 1.1.12

- 修复筛选切换时照片网格空白的竞态；用户操作安全刷新机制；修复地图视图 Modal 黑屏（invalidateSize 时机）

### 1.1.11

- 外部软件联动：全屏预览与右键菜单"用其他应用打开"，检测 20+ 图像处理软件（Photoshop / Lightroom / GIMP / Capture One / RawTherapee / darktable 等），支持批量传入

### 1.1.10

- 地点地图默认中国视角 + fitBounds；地图钉侧栏照片预览；地图选点模式 + 反向地理编码；全屏预览/卷卡片添加/修改/删除地点

### 1.1.9

- 筛选面板 faceted search 联动计数；BMP 预览与缩略图修复（纯 JS 解码器）；补充 234 种胶卷预设图标；大视图悬停预览面板

### 1.1.8 / 1.1.81

- 本地树状整理：子库映射为 `{libraryRoot}/files/` 真实目录树，导入/移动/重命名/删除同步磁盘文件，旧版扁平目录自动迁移；另含卷视图属性筛选、建卷一致性验证、自动整理模式、90° 旋转持久化

### 1.1.71

- 设置页新增存储 / 关于 / 日志三个标签

### 1.1.7

- `leaf v1.1.3` 与 `v1.1.x` 开发线合并：胶卷视图与建卷、未分卷汇总、子文件夹批量导入、智能文件夹名称解析、胶片/相机/镜头别名与 JSON 批量导入

### 1.1.3（leaf 发布线）

- 导入自动整理（年/年月/相机/胶片/来源文件夹）；EXIF 器材识别；整理状态筛选；90° 旋转持久化；跨子库移动；任意层级子库删除；Windows NSIS 安装包发布流程

### 1.1.0–1.1.2

- EXIF 自动读取、子库照片数统计、批量属性编辑、相机库/镜头库管理；三档视图布局优化、自适应列数、合并标题栏与工具栏；Windows 原生模块准备与 Release 构建流程

### 1.0.0–1.0.4

- 初始版本：照片导入、属性标注、子库、全屏预览；缩略图优化、拖拽导入、直方图、缩放平移、框选、右键菜单；Modal 查看器、中文属性 search-to-create、胶卷库；相机库/镜头库

---

## License

MIT
