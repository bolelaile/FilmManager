# FilmManager

面向胶片摄影爱好者的本地桌面应用，用于管理胶片扫描文件。

**当前版本：** 1.1.81 · **平台：** Windows x64

---

## 功能特性

- **导入与索引** — 递归扫描文件夹，支持 JPG / PNG / TIFF / WebP 及主流 RAW 格式；导入时自动读取 EXIF（拍摄日期、相机与镜头型号），可自动收录未入库器材
- **自动整理与筛选** — 导入时可按年份、年月、相机、胶片或来源文件夹自动创建子库并将照片归档；支持按日期口径、文件格式及待整理状态筛选
- **子文件夹卷导入** — 导入含子文件夹的目录时可启用"按子文件夹识别为卷"模式：扫描后为每个子文件夹提供确认表格，可逐行编辑卷名、胶片/相机/镜头/格式属性（自动模糊匹配文件夹名）、拍摄地点、拍摄日期及是否建卷；确认后批量导入并自动建卷
- **胶卷管理** — 将同一胶卷类型与尺寸的照片组织为"卷"；支持自定义命名（留空则按"胶片类型-格式-日期"自动生成）
- **双视图切换** — 顶栏一键切换"卷视图"与"照片视图"；卷视图以卡片形式展示每卷封面、胶片类型、格式、拍摄地点及照片数；点击卷卡片可进入该卷的独立照片视图
- **未分卷汇总** — 未纳入任何卷的照片自动归入"其他图片"卡片，统一展示在卷视图中
- **器材与胶片别名** — 胶片、相机和镜头支持维护多个别名，文件夹解析与 EXIF 器材识别均可按别名匹配；属性库支持 JSON 批量导入名称和别名
- **属性标注** — 相机、胶卷、镜头、冲扫方式等多维度属性，支持批量编辑；胶卷属性附带品牌图标
- **本地树状子库** — 界面子库与 `{libraryRoot}/files/` 下的真实目录树保持一致；导入、移动、重命名和删除子库都会同步整理本地文件，并支持无限层级与后代照片汇总计数
- **三档视图** — 小 / 中 / 大缩略图网格，自适应窗口宽度与全屏；小视图以横向列表展示属性详情
- **全屏预览** — 滚轮缩放（0.5×–8×）、拖拽平移、左右切换、顺时针 90° 旋转（角度持久化）；右侧显示 RGB 直方图、属性编辑、文件信息
- **RAW 解码** — 通过 Sharp/libvips 解码，支持应用 ICC 色彩配置文件实时预览
- **地点地图** — 基于 Leaflet 展示拍摄地点与关联照片，内置约 345 个国内城市、区县和摄影目的地；支持 OSM.de、Esri 和标准 OpenStreetMap 多瓦片源自动故障切换
- **多选操作** — 框选后可在右键菜单批量编辑属性与拍摄地点、顺时针旋转、跨子库移动或从库中移除；顶部栏仅保留带选中数量的建卷入口
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

---

## License

MIT
