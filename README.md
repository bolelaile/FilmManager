# FilmManager

面向胶片摄影爱好者的本地桌面应用，用于管理胶片扫描文件。

**当前版本：** 1.3.4 · **平台：** Windows x64

---

## 功能特性

- **导入与索引** — 递归扫描文件夹，支持 JPG / PNG / TIFF / WebP 及主流 RAW 格式；导入时自动读取 EXIF（拍摄日期、相机与镜头型号），可自动收录未入库器材；自动识别胶片格式（半格 / 135 / 645 / 6×6 / 6×7 / 6×12 等）
- **自动整理与筛选** — 导入时可按年份、年月、相机、胶片或来源文件夹自动创建子库并将照片归档；支持按日期口径、文件格式及待整理状态筛选
- **子文件夹卷导入** — 导入含子文件夹的目录时可启用"按子文件夹识别为卷"模式：支持将根目录直接拖放至导入对话框触发扫描；扫描后为每个子文件夹提供确认表格，可逐行编辑卷名、胶片/相机/镜头/格式属性（自动模糊匹配文件夹名，并可在表格内直接内联新增属性值）、拍摄地点、拍摄日期及是否建卷；确认后批量导入并自动建卷
- **胶卷管理** — 将同一胶卷类型与尺寸的照片组织为"卷"；支持自定义命名（留空则按"胶片类型-格式-日期"自动生成）
- **双视图切换** — 顶栏一键切换"卷视图"与"照片视图"；卷视图以卡片形式展示每卷封面、胶片类型、格式、拍摄地点及照片数；点击卷卡片可进入该卷的独立照片视图
- **未分卷汇总** — 未纳入任何卷的照片自动归入"其他图片"卡片，统一展示在卷视图中
- **器材与胶片别名** — 胶片、相机和镜头支持维护多个别名，文件夹解析与 EXIF 器材识别均可按别名匹配；属性库支持 JSON 批量导入名称和别名
- **属性标注** — 相机、胶卷、镜头、冲扫方式等多维度属性，支持批量编辑；胶卷属性附带品牌图标
- **本地树状子库** — 界面子库与 `{libraryRoot}/files/` 下的真实目录树保持一致；导入、移动、重命名和删除子库都会同步整理本地文件，并支持无限层级与后代照片汇总计数
- **三档视图** — 小 / 中 / 大缩略图网格，自适应窗口宽度与全屏；小视图以横向列表展示属性详情；大视图右侧显示悬停预览面板（即时缩略图 + 全分辨率预览 + 详细元数据）
- **全屏预览** — 滚轮缩放（0.5×–8×）、拖拽平移、左右切换、顺时针 90° 旋转（角度持久化）；右侧显示 RGB 直方图、属性编辑、文件信息
- **RAW 解码** — 通过 Sharp/libvips 解码，支持应用 ICC 色彩配置文件实时预览
- **地点地图** — 基于 Leaflet + OpenStreetMap，为照片标记拍摄地点；地图默认以中国为主视图，有已导入地点时自动调整视角；支持在照片全屏预览与卷卡片中添加/修改/删除地点，可通过地名搜索、经纬度录入或地图拖拽（附近地名自动识别）选择地点
- **外部软件联动** — 全屏预览标题栏及照片网格右键菜单均提供"用其他应用打开"功能；自动检测本机已安装的图像处理软件（Photoshop、Lightroom、GIMP、Capture One、RawTherapee、darktable、IrfanView、FastStone、XnViewMP、ACDSee、Affinity Photo、像素蛋糕、Luminar Neo 等）；支持批量多选后一次性传入多个文件路径；全屏预览标题栏点击应用图标按钮即可打开当前照片
- **完全离线** — 所有数据本地存储，仅地点搜索功能需要网络

---

## v1.1.3 与 v1.1.x 合并说明

### leaf v1.1.3（本轮开发起始版本）

仓库标签 [`v1.1.3`](https://github.com/bolelaile/FilmManager/releases/tag/v1.1.3) 指向 `leaf` 发布线的 `f75652c`。该版本以功能提交 `d2ab663` 为主体，并包含 `a752d6f`、`3288e16`、`f75652c` 三次 Windows Release 流程改进。

| 功能 | 详细行为 |
|------|---------|
| 导入自动整理 | 可选择不整理、年份、年月、相机、胶片或来源文件夹；目标子库不存在时自动创建，照片实际写入对应子库而不只创建目录 |
| EXIF 器材识别 | 导入时读取相机与镜头型号；可使用导入界面的手动值覆盖 EXIF，并可控制是否自动收录器材库中不存在的型号 |
| 整理状态筛选 | 支持按入库日期或拍摄日期、文件格式，以及“未分类 / 缺拍摄日期 / 缺相机信息”筛选；选择父子库时包含后代子库照片 |
| 90° 旋转 | 查看器和批量操作均可顺时针旋转；角度写入数据库，缩略图与完整预览同步重建，重启后保持正确方向 |
| 跨子库移动 | 照片右键菜单支持移动单张照片；多选后可一次移动多张照片，也可移动回未分类 |
| 子库操作 | 任意层级子库均可使用右键菜单删除；父库计数包含全部后代照片，删除子库时其中照片回到未分类，直接子库提升为根级 |
| Windows 安装包 | Git 标签或手动触发 GitHub Actions 后，分步完成原生模块准备、构建和 NSIS 打包，并发布 `.exe`、`.blockmap` 与 `latest.yml` 到 Releases |

### v1.1.x 合入 leaf（1.1.7）

`leaf` 在合并提交 `2b4f808` 中合入 `origin/v1.1.x` 的 `7edc747` 与 `d95b5af`。合并保留了上表中的 v1.1.3 功能，并增加以下能力：

| 合并项 | 内容 |
|--------|------|
| 目标分支与合并前提交 | `leaf` / `f75652c`（标签 `v1.1.3`） |
| 来源分支与提交 | `origin/v1.1.x` / `d95b5af`（包含 `7edc747`） |
| 合并提交 | `2b4f808`（双亲为 `f75652c`、`d95b5af`） |
| 合并后版本 | `1.1.7` |
| Git 冲突状态 | 所有文本冲突均已解决，无未合并文件或冲突标记 |

- **胶卷视图与建卷** — 支持从照片创建胶卷、自动或手动命名、卷卡片浏览、进入单卷照片视图，以及“其他图片”未分卷汇总。
- **子文件夹批量导入** — 扫描每个子文件夹并生成确认行，可分别调整卷名、胶片、格式、相机、镜头、地点、日期和是否建卷后统一导入。
- **智能文件夹解析** — 支持父子目录属性推断、复合目录名日期提取、匹配来源标记，以及忽略大小写、空格、连字符、下划线和点的模糊匹配。
- **属性别名与 JSON 导入** — 胶片、相机和镜头可维护多个别名；目录解析和 EXIF 均支持别名匹配，属性库可事务化批量导入名称与别名。
- **胶卷范围筛选** — 卷列表、单卷照片和“其他图片”沿用 v1.1.3 的日期、格式、整理状态、属性与子库筛选规则。

合并过程中涉及导入、预加载 API、顶栏、图库页面和 README 等文件的文本冲突，均已手工整合，没有遗留未解决的 Git 冲突。功能层面采用以下兼容策略：

1. **普通自动整理与胶卷导入分开执行。** 普通导入可以将照片按规则拆分到自动创建的子库；胶卷导入以确认表中指定的子库和胶卷归属为准，避免同一胶卷被自动拆散到多个子库。
2. **未沿用无效的 `Modal draggable` 属性。** 当前 Ant Design 5.14 的 `Modal` 不支持该属性，原分支写法不会产生拖动效果且会导致类型错误；合并版保留 `mask={false}` 的后台交互能力。若需要可拖动弹窗，应通过 `modalRender` 配合拖动组件单独实现。
3. **数据库增量迁移保持兼容。** 既有图库会自动补充照片旋转字段，以及别名、胶卷和照片—胶卷关系表，不会重建或清空原有数据。

### v1.1.8 本地树状整理

从 1.1.8 开始，子库不再只是数据库中的逻辑分组，而会映射为 `{libraryRoot}/files/` 下的真实目录树：

```text
{libraryRoot}/files/
├── 未分类照片.jpg
├── 2024/
│   ├── 2024-07/
│   │   └── IMG_0001.jpg
│   └── 2024-08/
└── Nikon F3/
    └── scan_001.tif
```

- 新建子库时同步创建本地目录，导入照片时直接复制到目标子库目录。
- 单张或批量移动照片时同步移动本地文件，并立即更新数据库中的绝对路径。
- 重命名子库时移动整棵本地目录树，并批量更新该目录下所有照片路径。
- 删除子库时，直属照片移回 `{libraryRoot}/files/`，直属子库及其完整目录树提升到根级，照片文件不会被删除。
- 首次启动 1.1.8 时自动把旧版扁平 `files/` 目录按现有逻辑子库关系迁移为真实目录树；迁移可重复执行，已整理文件不会重复移动。
- 文件或目录重名时自动追加数字后缀，Windows 非法目录字符会替换为 `_`；文件移动失败时保留原路径并记录日志。

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
│   │   ├── ipc/                # IPC Handler（photos / import / attrs / rolls / sublib / library / locations）
│   │   └── services/           # 业务逻辑（缩略图、EXIF/RAW、本地树状目录同步）
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
│       │   ├── CreateRollModal/    # 从所选照片创建胶卷
│       │   ├── RollsView/          # 胶卷卡片与未分卷照片入口
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
| 地图 | Leaflet 1.9 + OpenStreetMap（三源自动轮换） |
| 构建工具 | electron-vite 2 + Vite 5 |
| 打包 | electron-builder 24（NSIS） |

详细依赖版本见 [`docs/requirements.md`](docs/requirements.md)。

---

## 数据库设计

数据库文件位于 `{libraryRoot}/film.db`（默认 `%APPDATA%\FilmManager\library\film.db`）。

核心表：

| 表 | 说明 |
|----|------|
| `photos` | 照片主记录（路径、尺寸、拍摄日期、旋转角度、备注） |
| `sub_libraries` | 树状子库（树形自引用，含本地目录名） |
| `attribute_types` | 属性类别（相机、胶片、镜头等） |
| `attribute_values` | 属性可选值 |
| `attribute_value_aliases` | 胶片、相机与镜头属性值的识别别名 |
| `photo_attributes` | 照片—属性值关联（多对多） |
| `rolls` | 胶卷记录（名称、类型、格式、地点、日期及所属子库） |
| `photo_rolls` | 照片—胶卷关系 |
| `locations` | 拍摄地点（含经纬度） |
| `photo_locations` | 照片—地点关联（多对多） |
| `color_profiles` | ICC 色彩配置文件 |

完整 Schema 与 IPC API 见 [`docs/product-spec.md`](docs/product-spec.md)。

---

## 预设数据导入（JSON 批量导入）

胶卷库、相机库、镜头库均支持通过 JSON 文件批量导入或更新预设条目。在对应库的管理界面点击"**导入 JSON**"按钮即可选择文件。

### 模板文件位置

| 文件 | 说明 |
|------|------|
| [`resources/presets/films.json`](resources/presets/films.json) | 胶卷预设模板（含主流135/120胶卷，含别名与内置图标键） |
| [`resources/presets/cameras.json`](resources/presets/cameras.json) | 相机型号预设模板（含主流胶片相机，含中英文别名） |

### JSON 格式规范

#### 胶卷（导入到胶卷库）

```json
[
  {
    "value": "Kodak Portra 400 [135 / 35mm]",
    "icon_key": "kodak_portra_400",
    "aliases": ["柯达Portra400", "Portra400", "KP400"]
  }
]
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `value` | string | ✅ | 胶卷全名，建议格式：`品牌 型号 [规格]`，规格可选 `135 / 35mm` · `120 中画幅` · `4×5 大画幅` · `8×10 大画幅` |
| `icon_key` | string | ❌ | 内置图标键名（见下方图标键列表），留空则无图标 |
| `aliases` | string[] | ❌ | 别名列表，用于文件夹名称模糊匹配（如中文名、缩写、不同拼写方式） |

#### 相机 / 镜头（导入到相机库或镜头库）

```json
[
  {
    "value": "Nikon FM2",
    "aliases": ["尼康FM2", "NikonFM2", "Nikon-FM2"]
  }
]
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `value` | string | ✅ | 型号全名 |
| `aliases` | string[] | ❌ | 别名列表（建议同时写中文名和英文缩写） |

> **导入规则**：`value` 已存在则**合并更新**（追加新别名、更新图标键）；不存在则**新增**。重复运行同一文件是幂等的。

### 内置图标键（`icon_key`）参考

以下键名可直接用于 `icon_key` 字段，对应 `resources/film-icons/` 目录中的内置图标：

<details>
<summary>点击展开完整图标键列表</summary>

**柯达 Kodak**
`kodak_portra_400` · `kodak_portra_160` · `kodak_portra_800` · `kodak_ektar100` · `kodak_ektar25` · `kodak_ultramax400` · `kodak_gold_200` · `kodak_proimage100` · `kodaktmax100` · `kodaktmax400` · `kodaktmaxp3200` · `kodak_tri-x_400` · `kodak_e100` · `kodak_ektachrome_100` · `kodak_ektachrome_64t` · `kodak_ektachrome_64x` · `kodachrome` · `kodak_cp_200`

**伊尔福 Ilford**
`ilford_hp5` · `ilford_fp4` · `ilford_delta_100` · `ilford_delta_400` · `ilford_delta_3200` · `ilford_xp2` · `ilford_sfx` · `ilford_ortho` · `ilford_pan100` · `ilford_pan400` · `ilford_vivd400` · `ilford_ilfocolor` · `ilford_ilfochrome100`

**肯特米尔 Kentmere**
`kentmere_pan100` · `kentmere_pan200` · `kentmere_pan400`

**乐凯 Lucky**
`lucky_c200` · `lucky_shd100` · `lucky_shd400`

**禄来 Rollei**
`rollei_infrared` · `rollei_retro400s` · `rollei_rpx25` · `rollei_rpx100` · `rollei_rpx400` · `rollei_blackbird`

**柯尼卡 Konica**
`konica_cn_200` · `konica_centuria400` · `konica_vx400` · `konica_pan100` · `konica_业务100` · `konica_jx100` · `konica_lv100` · `konica_r100` · `konica_sr1600` · `konica_infrared750`

**沃格 Woogo**
`woogo_100d` · `woogo_320t` · `woogo_400d` · `woogo_800t` · `woogo_b_w400`

**哈曼 Harman**
`harman_phoenix_200_二代` · `harman_red`

**其他**
`orwo_np_100` · `orwo_dn21` · `orwo_nc_400` · `orwo_nc_500` · `orwo_p400` · `orwo_pf2` · `orwo_un54` · `rollei_infrared` · `perutz_color400` · `perutz_image160` · `retro_80` · `yashica_400` · `yashica_ruby_60s` · `sunny_100` · `shenguang_400` · `super_jcolor100` · `vibe_400_18exp` · `vibe_800_18exp` · `vibe_quality_max100` · `vibe_quality_max400` · `vibe_quality_max800` · `vibe_quality_b_w400`

</details>

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
| 1.1.2（leaf） | Windows 原生模块准备与 Release 构建流程优化 |
| 1.1.3（leaf 标签） | 自动整理、EXIF 相机/镜头识别、整理状态筛选、持久化 90° 旋转、单张/多张跨子库移动、任意层级子库右键删除 |
| v1.1.x 开发线 | 胶卷视图与建卷、未分卷汇总、子文件夹批量导入、智能文件夹名称解析；分支内部版本记录为 1.1.2–1.1.6 |
| 1.1.7（合并版） | `leaf v1.1.3` 与 `v1.1.x` 功能合并；新增胶片/相机/镜头别名、文件夹与 EXIF 别名匹配、JSON 批量导入 |
| 1.1.71 | 设置页新增三个功能标签：**存储** — 查看并修改图片文件存储目录；**关于** — 应用版本与 GitHub 链接；**日志** — 查看本地运行日志 |
| 1.1.8 | leaf+v1.1.8 合并：① 子库映射为真实本地目录树（物理整理、重命名、删除同步本地文件）；② 卷视图属性筛选器支持；③ 建卷属性一致性验证；④ 单批次导入建卷开关；⑤ 自动整理模式（按年月/相机/胶片/来源文件夹）；⑥ 90°旋转持久化；⑦ 批量移动跨子库 |
| 1.1.81 | 功能版本同 1.1.8（leaf + v1.1.8 融合验证版） |
| 1.1.9 | 左侧筛选面板联动计数：有筛选条件时，其他属性子栏只显示当前筛选结果中存在的属性值（faceted search）；BMP 格式预览与缩略图修复（改用纯 JS BMP 解码器直接提取 RGB 像素数据，兼容所有 Windows 环境，同时对库中已有的缺失缩略图在打开时自动重新生成）；补充胶卷类别（新增 ADOX、AGFA、Alien Film、AMBER、CANDIDO、Cinestill、ClearCreek、Crystal Film、Cyberpunk、DisCamera、FOMAPAN、Fuji 全系、Fun Vision、HARMAN、HITCHCOCK、Rollei 全系等共 234 种胶卷预设图标）；大视图悬停预览面板：大视图右侧新增固定宽度预览区，鼠标悬停照片后立即显示缩略图并在 280 ms 防抖后加载全分辨率预览，面板下方按行展示文件名、格式、尺寸、大小、拍摄日期、入库日期及所有已标注属性 |
| 1.1.10 | 地点功能完善：① 地点地图默认显示以中国为主视图的世界地图，有已导入地点时自动 fitBounds 调整视角；② 地图钉点击后侧栏展示该地点照片缩略图及拍摄日期；③ 地点选择器新增地图选点模式——点击地图标志按钮后展开内嵌 Leaflet 地图，点击或拖拽标记可自动调用 Nominatim 反向地理编码识别附近地名，支持编辑确认后保存；④ 全屏预览侧栏底部新增"拍摄地点"编辑区，可为单张照片添加/删除地点；⑤ 卷视图卡片操作栏新增地点按钮，点击后弹出地点选择器，可批量为该卷所有照片设置或清除拍摄地点 |
| 1.1.11 | 外部软件联动：① 全屏预览标题栏新增"用其他应用打开"按钮（方格图标），点击后展开已检测到的图像处理软件列表，选择后立即以当前照片路径启动对应软件；② 照片网格右键菜单新增"用其他应用打开"条目，鼠标悬停后右侧弹出软件子菜单，支持批量多选后一次性向目标软件传入所有已选照片路径；③ 应用检测覆盖：Adobe Photoshop / Lightroom Classic / Lightroom、GIMP、Capture One、RawTherapee、darktable、IrfanView、Paint.NET、FastStone Image Viewer、XnViewMP、ACDSee、Affinity Photo、像素蛋糕（Polarr）、Luminar Neo / AI、ON1 Photo RAW、DxO PhotoLab、Corel PaintShop Pro 等；通过扫描常见安装目录与 Windows 注册表 App Paths 自动定位实际可执行文件 |
| 1.1.12 | 稳定性修复：① 修复筛选条件切换时照片网格出现空白的 race condition——改用单调递增 loadCounterRef 替换布尔锁，filter 变化触发的重置请求不再被正在执行的分页请求静默丢弃；② 新增用户操作安全刷新机制，监听 mouseup / keyup 事件，用户停止操作 800 ms 后自动执行一次照片列表硬刷新，确保任何交互后图库始终显示最新数据；③ 修复地点地图视图打开后显示全黑的问题——Ant Design Modal 进场动画期间容器尺寸为 0，导致 Leaflet 无法正确请求瓦片，现通过 afterOpenChange 回调与 200 ms 兜底定时器双重触发 invalidateSize()，动画结束后地图自动补全瓦片渲染 |
| 1.2.0 | 版本整合与全面优化：① 地图视图改用 MapLibre GL JS（WebGL canvas 渲染，彻底修复 Modal 内黑屏），同时实现三源自动轮换（OSM → OSM.de → Esri），弱网/超时后自动切换并在标题栏提示当前源；② BatchEditModal 新增批量设置拍摄地点功能（set / skip / clear 三档）；③ 地点种子数据大幅扩充（新增各省地级市、旅行摄影常用地点，修正哈纳斯→喀纳斯等错别字，改进重复地点合并逻辑）；④ setForPhotos IPC 支持 locationId=null 直接清除地点，兼容卷视图批量清除操作；⑤ TopBar WebkitAppRegion 类型修正；⑥ faceted search 联动计数行为保持：有筛选条件时只显示结果集中存在的属性值 |
| 1.2.1 | 地图方案切换：① 地图视图回归 Leaflet，采用三源自动轮换策略（OpenStreetMap.de → Esri World Street Map → OpenStreetMap），任一源连续 2 次瓦片错误或 25 s 无响应后自动切换到下一源；② 瓦片加载状态实时显示（loading/备用源/全部失败），失败时提供一键重试按钮；③ Leaflet 延迟动态导入，避免与 Electron 渲染进程冲突；④ LocationPicker 恢复为纯检索 + 手动坐标录入模式（本地模糊匹配 + OSM Nominatim 在线搜索），移除地图选点依赖；⑤ 地址种子数据保留 v1.2.0 扩充成果（各省地级市、修正喀纳斯等） |
| 1.3.0 | 架构重构与稳定性加固：① Zustand Store 按领域拆分为三个独立 slice（filterSlice / librarySlice / uiSlice），保留 `useStore()` 向后兼容导出，减少无关重渲染；② Library.tsx 从 530 行 God Component 拆分为三个自定义 hook（`usePhotoLoader` / `useRollLoader` / `useLibraryData`），组件本体缩减至 ~270 行；③ 提取 `src/shared/import-types.ts` 消除 preload 与 main 进程中 `ImportOptions` / `AutoOrganizeMode` 的重复类型定义；④ 删除 `walkDirect` 透传别名函数，统一调用 `walk()`；⑤ 新增基于内容哈希的重复文件检测——导入前计算 MD5(文件大小 + 前 64KB)，与库中已有记录比对，内容重复自动跳过；⑥ 数据库增量迁移：新增 `photos.content_hash` 列及对应索引、`original_name` 搜索索引（`idx_photos_original_name`）；⑦ COUNT 查询优化：以 `COUNT(DISTINCT p.id)` 替代子查询包裹全量 SELECT DISTINCT，消除 ORDER BY 双重开销；⑧ `photos:delete` 原子化——先在事务内清除 DB 记录，再执行文件删除，确保数据库一致性；⑨ `photos:setAttributes` 原子化——DELETE + INSERT 包裹于同一事务，任一步骤失败整体回滚 |
| 1.3.1 | 两阶段导入、存储模式与 Bug 修复：① 两阶段导入——第一阶段批量快速登记占位记录（`import_status='indexing'`），图库立即呈现骨架卡片；第二阶段在后台逐张完成 EXIF 解析、文件拷贝与缩略图生成，每张完成后推送进度；② 存储模式选择——导入对话框新增"复制到图库 / 建立索引"两种模式，索引模式仅记录原始路径，不复制文件；③ 全局后台导入进度条——导入期间固定显示于内容区底部，完成后 2 秒自动消失；④ 新增 `import_queue` 任务队列表用于追踪后台处理状态；⑤ Bug 修复：linked 模式下删除照片记录不再误删原始文件；linked 模式下移动到子库只更新逻辑分组，不移动文件；processQueueItem 错误回滚改用 try 块外的 copiedPath 变量追踪实际已拷贝路径，修复旧实现读取占位路径导致的回滚失效；导入对话框关闭时正确重置存储模式为默认值 |
| 1.3.1+ | 胶片格式自动识别与卷导入增强：① 导入时自动识别并写入胶片格式属性——通过 Sharp 像素采样检测左右边缘齿孔（判定 135 / 半格）和顶底背纸亮带（判定 120 系列），再结合长宽比精确区分半格/645/6×6/6×7/6×12等规格；不覆盖用户已手动标注的格式；② 新增半格/645/6×6中画幅/6×7中画幅/6×8中画幅/6×12中画幅共 6 种胶片格式预设值；③ 子文件夹卷确认表格所有属性 Select 支持内联新增值，无需离开导入对话框；④ 卷导入模式新增拖放根目录区域，直接拖入即可触发子文件夹扫描 |
| 1.3.2 | 格式识别优化与胶卷分类：① 修复 6×6 中画幅被误判为半格的问题——比例检测优先于齿孔检测，ratio ≈ 1.0 直接返回 6×6；② 新增 `film_size_type` 胶卷属性字段，为库中所有胶卷条目分类（135 / 120 / both），导入时根据已标注胶卷类型约束格式自动识别范围；③ 统一所有 fuji 开头的胶卷名称为 Fuji，并为富士品牌添加模糊匹配别名（fuji / 富士 / fujifilm 等）；④ 新增乐凯 Lucky c400 胶卷预设（135/120 通用） |
| 1.3.3 | 相机画幅属性与格式识别增强 + 导入与卷管理优化：① 新增 `camera_formats`（支持画幅列表）和 `camera_default_format`（默认画幅）字段到 attribute_values 相机条目；② 新增 `6x9 中画幅` 和 `135 宽幅 / Xpan` 两种胶片格式预设值；③ 新增 70+ 款相机预设（Pentax MZ/645/17、Contax 645、Mamiya 645、Bronica 系列、Fuji GW/TX 系列、Hasselblad Xpan、Rolleiflex、海鸥、Holga/Diana 等）；④ 导入时若相机只有单一画幅直接写入，多画幅相机与 film_size_type 取交集后再调用像素分析；⑤ 文件夹名称解析增强——支持从复合命名（相机+时间+胶片+地点+题材）中分别提取各字段，并通过地点数据库模糊匹配自动填入拍摄地点，剩余非结构化词元作为拍摄题材记录；⑥ 卷模式导入新增"单文件夹为一卷"选项（原有多子文件夹模式保留）；⑦ 卷模式导入新增存储方式选择（复制到图库 / 建立索引），与普通导入模式一致；⑧ RollsView 新增多选框架（工具栏点击进入选择模式）、批量属性修改和批量删除功能；⑨ 删除卷时新增三档选项：仅删除索引 / 同时删除数据库照片 / 同时删除物理文件；对索引模式导入的照片即使选择"删除文件"仍只删除数据库记录；⑩ 卷视图独立三档缩略图尺寸（小/中/大）——小视图以横向列表展示（1列/2列），中视图以网格展示（4列/6列），大视图以宽格展示（2列/3列，显示相机/镜头/日期详情）；顶栏缩略图尺寸控件在卷视图与照片视图间独立切换；⑪ 卷视图框选多选（鼠标拖拽橡皮筋选择）+ 右键菜单多选（Ctrl/Meta/Shift 点击）|
| 1.3.4 | UI 规范化、卷视图大缩略图重设计与性能/功能增强：① 卷视图大缩略图改为横向详情行布局（方案 A）——行高固定 220px，左侧 55% 为封面图，右侧 45% 展示卷名（16px 加粗）、胶片/格式、相机/镜头、地点（橙色图标）、拍摄年月全部属性，操作按钮位于信息区底部；普通窗口 1 列，宽屏（≥1400px）2 列；② 统一所有弹窗（删除卷/批量属性/建卷/胶卷库/相机库/镜头库/批量编辑/设置/导入）的 `borderRadius=8`、`footer padding='12px 20px'`、`body padding='16px 20px'`，消除按钮/输入框贴合窗口边框的问题；③ 设置—关于页面新增版本更新历史面板（maxHeight 220px 可滚动，由新到旧列出各版本摘要与详细变更）；④ 缩略图 Worker Pool——主进程启动 4 线程 Worker Thread 池并行生成缩略图，导入批量照片时速度大幅提升，pool 不可用时自动回退内联生成；⑤ 收藏/星标系统——照片新增 `starred` 字段，网格视图卡片右下角显示星标按钮（悬浮可见，已收藏常亮），全屏预览标题栏新增星标切换按钮，左侧筛选面板新增"已收藏"过滤条目，支持批量收藏/取消收藏；⑥ EXIF GPS 自动地点关联——导入时自动读取照片 EXIF 中的 GPS 坐标，在 100 米范围内匹配已有地点后直接关联，否则以坐标为名创建新地点并关联，无 GPS 数据的照片不受影响 |

---

## License

MIT
