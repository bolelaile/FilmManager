# FilmManager

面向胶片摄影爱好者的本地桌面应用，用于管理胶片扫描文件。

**当前版本：** 1.1.71 · **平台：** Windows x64

---

## 功能特性

- **子文件夹卷导入** — 导入含子文件夹的目录时可启用"按子文件夹识别为卷"模式：扫描后为每个子文件夹提供确认表格，可逐行编辑卷名、胶片/相机/镜头/格式属性（自动模糊匹配文件夹名）、拍摄地点、拍摄日期及是否建卷；确认后批量导入并自动建卷
- **胶卷卷管理** — 将同一胶卷类型与尺寸的照片组织为"卷"；支持自定义命名（留空则按"胶片类型-格式-日期"自动生成）
- **双视图切换** — 顶栏一键切换"卷视图"与"照片视图"；卷视图以卡片形式展示每卷封面、胶片类型、格式、拍摄地点及照片数；点击卷卡片可进入该卷的独立照片视图
- **未分卷汇总** — 未纳入任何卷的照片自动归入"其他图片"卡片，统一展示在卷视图中
- **导入与索引** — 递归扫描文件夹，支持 JPG / PNG / TIFF / WebP 及主流 RAW 格式；导入时自动读取 EXIF（拍摄日期、相机型号）
- **属性标注** — 相机、胶卷、镜头、冲扫方式等多维度属性，支持批量编辑；胶卷属性附带品牌图标
- **虚拟子库** — 树形分组，无限层级，每个子库显示照片数量
- **三档视图** — 小 / 中 / 大缩略图网格，自适应窗口宽度与全屏；小视图以横向列表展示属性详情
- **全屏预览** — 滚轮缩放（0.5×–8×）、拖拽平移、左右切换；右侧显示 RGB 直方图、属性编辑、文件信息
- **RAW 解码** — 通过 Sharp/libvips 解码，支持应用 ICC 色彩配置文件实时预览
- **地点地图** — 基于 Leaflet + OpenStreetMap，为照片标记拍摄地点
- **多选操作** — 框选 + 批量删除 / 批量属性编辑 / 批量设置拍摄日期
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
| `attribute_value_aliases` | 属性值别名（中英文名、缩写，用于文件夹名匹配） |
| `photo_attributes` | 照片—属性值关联（多对多） |
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
| 1.1.2 | 所有 Modal 去除遮罩（mask=false）并支持拖拽移位，修复窗口在对话框打开时无法拖动的问题 |
| 1.1.3 | 胶卷卷功能：选照片建卷、自动/手动命名、卷视图与照片视图切换、未分卷"其他图片"汇总 |
| 1.1.4 | 增强导入：子文件夹批量导入 + 自动识别为卷，文件夹名模糊匹配胶片/相机/镜头属性，逐行确认后批量建卷 |
| 1.1.5 | 智能文件夹解析：父子层级属性推断（相机↔胶卷双向）、复合命名日期正则提取、确认界面属性来源标注（↑父/↓子） |
| 1.1.6 | 识别大小写不敏感优化：normalize 同时去除连字符/下划线/点，`Nikon-F3`、`kodak_portra_400` 等分隔符变体均可正确匹配 |
| 1.1.7 | 别名系统：胶卷/相机/镜头库支持每条目添加多个别名（中英文、缩写等），别名参与文件夹名称模糊匹配；胶卷库/相机库/镜头库支持通过 JSON 文件批量导入或更新条目（含别名）；导入确认界面中别名匹配到的属性旁显示橙色 `~别名` 徽标与 Tooltip |
| 1.1.71 | 设置页新增三个功能标签：**存储** — 查看并修改图片文件存储目录（含浏览/保存，重启生效）；**关于** — 展示应用版本、GitHub 仓库及 Releases/Issues 快捷链接；**日志** — 查看本地运行日志（最近 300 行）、刷新及在文件管理器中打开日志目录 |

---

## License

MIT
