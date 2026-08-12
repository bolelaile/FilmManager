# FilmManager 产品规格文档

**版本：** 1.3.3
**技术栈：** Electron 29 · React 18 · TypeScript 5 · Ant Design 5 · Zustand 4 · better-sqlite3 9 · Sharp 0.33 · Leaflet 1.9 · @tanstack/react-virtual 3 · electron-vite 2

---

## 一、产品概述

FilmManager 是一款面向胶片摄影爱好者的本地桌面应用，用于管理胶片扫描文件。核心功能包括：

- **导入与索引**：递归扫描文件夹，支持 JPG / PNG / TIFF / BMP / WebP 及主流 RAW 格式；导入时自动读取 EXIF（拍摄日期、相机与镜头型号），可自动收录未入库器材；自动识别胶片格式（半格/135/120各规格/6×12 等）
- **子文件夹卷导入**：批量按子文件夹识别为卷，模糊匹配胶片/相机/镜头属性，逐行确认后批量导入；支持拖放根目录；确认表格可内联新增相机/镜头/胶片格式等属性值
- **胶卷管理**：将同一胶卷的照片组织为"卷"；支持封面、自动/手动命名、属性一致性验证
- **双视图切换**：顶栏一键切换卷视图与照片视图；卷视图以三档尺寸（小/中/大）独立于照片视图的缩略图尺寸；支持框选与右键多选，可批量编辑属性或删除
- **属性标注**：相机、胶片、镜头、冲扫方式等多维度，支持批量编辑；胶卷属性附带品牌图标
- **本地树状子库**：界面子库与 `{libraryRoot}/files/` 下的真实目录树保持一致
- **三档视图**：小（横向列表）/中（网格）/大（带悬停预览面板）缩略图
- **全屏预览**：滚轮缩放（0.5×–8×）、拖拽平移、左右切换、旋转、RGB 直方图、属性编辑
- **RAW 解码**：通过 Sharp/libvips 解码，支持 ICC 色彩配置文件
- **地点地图**：基于 Leaflet + OpenStreetMap，三源自动轮换；支持地名搜索、手动坐标录入
- **外部软件联动**：检测已安装图像处理软件并直接传入文件路径打开
- **别名系统**：胶片、相机和镜头支持多别名，文件夹解析和 EXIF 识别均按别名匹配
- **完全离线**：所有数据本地存储，仅地点搜索功能需要网络

---

## 二、数据库结构

数据库文件：`{libraryRoot}/film.db`（SQLite，WAL 模式，`PRAGMA foreign_keys = ON`）

### 2.1 表结构总览

| 表名 | 说明 |
|---|---|
| `photos` | 核心照片记录（路径、尺寸、拍摄日期、旋转、备注） |
| `sub_libraries` | 树形自引用子库（含对应本地目录名） |
| `attribute_types` | 属性类别定义（camera / film / lens 等） |
| `attribute_values` | 各类别的可选值（含图标键） |
| `attribute_value_aliases` | 属性值别名（用于模糊匹配） |
| `photo_attributes` | 照片—属性值关联（多对多） |
| `rolls` | 胶卷卷（名称、封面、所属子库） |
| `photo_rolls` | 照片—胶卷关联 |
| `locations` | 地点（含经纬度） |
| `photo_locations` | 照片—地点关联（多对多） |
| `color_profiles` | ICC 色彩配置文件 |

---

### 2.2 photos — 照片主表

```sql
CREATE TABLE photos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path      TEXT    NOT NULL UNIQUE,
  original_name  TEXT    NOT NULL,
  file_type      TEXT    NOT NULL,
  thumb_path     TEXT,
  thumb_ready    INTEGER DEFAULT 0,
  width          INTEGER,
  height         INTEGER,
  file_size      INTEGER,
  sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
  imported_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  shot_date      TEXT,
  rotation       INTEGER NOT NULL DEFAULT 0,
  notes          TEXT    DEFAULT '',
  content_hash   TEXT,
  storage_mode   TEXT    NOT NULL DEFAULT 'managed',
  import_status  TEXT    NOT NULL DEFAULT 'ready'
);
CREATE INDEX idx_photos_sub_library    ON photos(sub_library_id);
CREATE INDEX idx_photos_imported_at    ON photos(imported_at);
CREATE INDEX idx_photos_original_name  ON photos(original_name);
CREATE INDEX idx_photos_content_hash   ON photos(content_hash);
```

| 字段 | 说明 |
|---|---|
| `file_path` | 磁盘绝对路径，UNIQUE；重复导入会被跳过 |
| `file_type` | 小写扩展名，用于区分 RAW 与普通格式 |
| `thumb_path` | 缩略图路径，异步生成后写入（格式 WebP，400px 边长） |
| `thumb_ready` | 0/1；控制 UI 是否显示缩略图 |
| `shot_date` | `YYYY-MM-DD`；优先 EXIF DateTimeOriginal，可用户覆盖 |
| `rotation` | 用户旋转角度，固定为 0 / 90 / 180 / 270（顺时针），重启后保持 |
| `content_hash` | MD5(文件大小字节串 + 文件前 64KB)；导入时去重用；相同哈希视为重复，自动跳过 |
| `storage_mode` | `managed`（复制到图库 files/）或 `linked`（只记录原始路径）；linked 模式下移动/删除不操作源文件 |
| `import_status` | `indexing`（两阶段导入占位中）/ `ready`（完整可用）/ `error`（处理失败） |

**支持的文件格式**

- **普通格式**：JPG · JPEG · PNG · TIFF · TIF · BMP · WebP
- **RAW 格式**：CR2 · CR3 · NEF · NRW · ARW · SRF · SR2 · ORF · RW2 · PEF · RAF · DNG · RAW · RWL · MRW · X3F · 3FR · FFF · IIQ · MEF

BMP 文件使用纯 JS 解码器（支持 24bpp / 32bpp 无压缩），避免 Windows 环境下 Sharp 的兼容问题。

---

### 2.3 sub_libraries — 子库（本地树状文件夹）

```sql
CREATE TABLE sub_libraries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT    DEFAULT '',
  parent_id   INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
  folder_name TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
```

| 字段 | 说明 |
|---|---|
| `parent_id` | 父级子库 ID，`NULL` 表示顶层；支持无限层级嵌套 |
| `folder_name` | `{libraryRoot}/files/` 下对应的安全目录名；非法字符替换为 `_`，Windows 保留名（CON/PRN/AUX/NUL/COM/LPT）自动追加后缀 |

**业务规则**

- 新建子库：同时在父级物理目录下创建对应文件夹
- 重命名子库：移动完整目录树（跨设备时 copy+delete），批量更新照片绝对路径
- 删除子库：直属照片及文件移到 `{libraryRoot}/files/`；直属子库及其目录树提升到根级，照片文件不删除
- 移动照片：文件移到目标子库物理目录，同步更新 `photos.file_path` 与 `sub_library_id`；失败时保留原路径并回滚 DB
- 首次启动 1.1.8 时自动把旧版扁平 `files/` 目录按现有 `sub_library_id` 迁移为真实目录树（幂等）
- 文件或目录重名时自动追加数字后缀（`_1`、`_2` …）

---

### 2.4 attribute_types — 属性类别定义

```sql
CREATE TABLE attribute_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT    NOT NULL UNIQUE,
  display_name TEXT    NOT NULL,
  is_system    INTEGER DEFAULT 0,
  is_active    INTEGER DEFAULT 1,
  sort_order   INTEGER DEFAULT 0
);
```

**系统预置属性类别（is_system = 1，不可删除/停用）**

| key | display_name | 说明 |
|---|---|---|
| `camera` | 相机 | 相机型号，支持别名匹配 |
| `film` | 胶片 | 胶卷品牌型号，支持图标 |
| `imported_at` | 入库时间 | 系统自动记录，仅供筛选 |

**预置可停用属性类别**

| key | display_name | 说明 |
|---|---|---|
| `lens` | 镜头型号 | 拍摄镜头，支持别名匹配 |
| `dev_method` | 冲扫方式 | 自冲自扫 / 送冲送扫 / 自冲送扫 / 送冲自扫 |
| `dev_lab` | 冲扫商家 | 冲洗店名称 |
| `film_format` | 胶片格式 | 135/35mm · 半格/17.5mm · 645中画幅 · 6×6中画幅 · 6×7中画幅 · 6×8中画幅 · 6×12中画幅 · 120中画幅 · 4×5大画幅 · 8×10大画幅（导入时自动识别） |

---

### 2.5 attribute_values — 属性可选值

```sql
CREATE TABLE attribute_values (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_type_id     INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
  value                 TEXT    NOT NULL,
  icon_key              TEXT,
  is_preset             INTEGER DEFAULT 0,
  film_size_type        TEXT,          -- '135' | '120' | 'both' | NULL（仅 film 类型使用）
  camera_formats        TEXT,          -- 逗号分隔令牌，如 '135,半格' / '6x6,645'（仅 camera 类型使用）
  camera_default_format TEXT,          -- 相机默认/主画幅令牌（仅 camera 类型使用）
  UNIQUE(attribute_type_id, value)
);
```

| 字段 | 说明 |
|---|---|
| `icon_key` | 胶卷图标索引键（如 `kodak_portra_400`），仅 film 类型使用 |
| `is_preset` | 1=系统内置预设值，0=用户自行添加的值 |
| `film_size_type` | 胶卷可用尺寸约束：`'135'`=仅 135 胶卷；`'120'`=仅 120 中画幅；`'both'`=通用；`NULL`=未分类。导入时用于约束格式自动识别的匹配范围 |
| `camera_formats` | 相机支持的画幅列表（逗号分隔令牌）。令牌：`135` `半格` `645` `6x6` `6x7` `6x8` `6x9` `6x12` `xpan` `4x5` `8x10`。仅 camera 类型使用 |
| `camera_default_format` | 相机默认/主画幅令牌（取值同上）。仅 camera 类型使用 |

**胶片图标机制**

- 格式：WebP，64px（标准）和 128px（@2x）
- 查找优先级：`{userData}/film-icons/{iconKey}.webp` → `{appPath}/resources/film-icons/{iconKey}.webp`
- 用户可通过"胶卷库"导入自定义图片（JPG/PNG/WebP），Sharp 自动裁剪缩放为 64/128px，以时间戳键名存入 `userData/film-icons/`
- 批量加载：`attrs:filmIconsBatch` 每次最多 20 个，并发查询后存入 Zustand 的 `filmIconCache`

---

### 2.6 attribute_value_aliases — 属性值别名

```sql
CREATE TABLE attribute_value_aliases (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  value_id   INTEGER NOT NULL REFERENCES attribute_values(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(value_id, alias)
);
CREATE INDEX idx_aliases_value_id ON attribute_value_aliases(value_id);
```

**用途**：文件夹名称模糊匹配（子文件夹导入时）和 EXIF 器材识别均可按别名匹配。
**匹配策略**：第一轮主名称匹配（按 value 长度降序），第二轮别名匹配（跳过已匹配类型）；最短有效别名长度 ≥ 2。
**规范化**：去除空格、连字符、下划线、点，转小写，保留非 ASCII 字符（中文）。

---

### 2.7 photo_attributes — 照片属性关联（多对多）

```sql
CREATE TABLE photo_attributes (
  photo_id           INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  attribute_type_id  INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
  attribute_value_id INTEGER NOT NULL REFERENCES attribute_values(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, attribute_type_id, attribute_value_id)
);
```

**业务约束**：每张照片对每种属性类别最多关联一个值（应用层：设置属性前先删除该类别旧值）。

---

### 2.8 rolls — 胶卷卷

```sql
CREATE TABLE rolls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE photo_rolls (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  roll_id  INTEGER NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, roll_id)
);
```

**自动命名规则**：若未指定卷名，从第一张照片取「胶片类型-胶片格式-拍摄日期」拼接，若均无则用"未命名卷"。
**封面选取**：卷内有缩略图的最早拍摄照片。

---

### 2.9 locations — 拍摄地点

```sql
CREATE TABLE locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  address    TEXT DEFAULT '',
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE photo_locations (
  photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, location_id)
);
```

**初始种子数据**（数据库首次创建时写入 `seedChinaLocations()`）：

- 4 个直辖市、31 个省会/自治区首府/特别行政区（含港澳台）
- 各省主要地级市（约 300+ 条）
- 热门旅摄目的地（桂林、三亚、丽江、大理、喀纳斯、敦煌等）
- 北京各区 + 上海各区
- 重复检测：按规范化名称和坐标距离去重/合并

地点搜索通过 **OSM Nominatim API** 实时查询（`accept-language=zh`），User-Agent: `FilmManager/1.0`。
反向地理编码：经纬度 → 最近地名（`/reverse?zoom=14`），优先 village/suburb/town/city/county/state。

---

### 2.10 color_profiles — ICC 色彩配置文件

```sql
CREATE TABLE color_profiles (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  is_preset INTEGER DEFAULT 0
);
```

用于 RAW 文件全屏预览时色彩空间转换。内置配置从 `resources/profiles/` 加载，用户可导入自定义 ICC/ICM 文件（复制到 `{userData}/profiles/`）。

---

## 三、实体关系图

```
sub_libraries ──────────────── (树形自引用 parent_id)
      │
photos ─────────── sub_library_id (N:1)
  │
  ├── photo_attributes ── attribute_values ── attribute_types
  │       (多对多)             │
  │                    attribute_value_aliases
  │
  ├── photo_locations ── locations
  │       (多对多)
  │
  └── photo_rolls ── rolls ── sub_libraries

attribute_values.icon_key → {userData/appPath}/film-icons/{key}.webp
photos.thumb_path          → {libraryRoot}/thumbs/{md5(path:rotation)}.webp
color_profiles.file_path   → {resources/userData}/profiles/{name}.icc
```

---

## 四、数据库迁移策略

增量迁移，用 `try {} catch {}` 包裹保证幂等（旧库可直接升级）：

| 迁移 | 变更内容 |
|---|---|
| 初始 | `sub_libraries` / `photos` / `attribute_types` / `attribute_values` / `photo_attributes` / `color_profiles` |
| 迁移 1 | `ALTER TABLE attribute_values ADD COLUMN icon_key TEXT` |
| 迁移 2 | `ALTER TABLE photos ADD COLUMN shot_date TEXT` |
| 迁移 3 | 创建 `locations` / `photo_locations` 表 |
| 迁移 4 | `ALTER TABLE photos ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0` |
| 迁移 5 | 创建 `attribute_value_aliases` 表及索引 |
| 迁移 6 | 创建 `rolls` / `photo_rolls` 表及索引 |
| 迁移 7 | `ALTER TABLE sub_libraries ADD COLUMN folder_name TEXT`；调用 `synchronizeLibraryLayout()` 迁移旧版扁平 `files/` |
| 迁移 8 | `CREATE INDEX IF NOT EXISTS idx_photos_original_name ON photos(original_name)` |
| 迁移 9 | `ALTER TABLE photos ADD COLUMN content_hash TEXT` |
| 迁移 10 | `CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash)` |
| 迁移 11 | `ALTER TABLE photos ADD COLUMN storage_mode TEXT NOT NULL DEFAULT 'managed'` |
| 迁移 12 | `ALTER TABLE photos ADD COLUMN import_status TEXT NOT NULL DEFAULT 'ready'` |
| 迁移 13 | 创建 `import_queue` 表（`id, source_path, status, photo_id, error_msg, queued_at, done_at`）及 `idx_import_queue_status` / `idx_import_queue_photo_id` 索引 |
| 迁移 14 | `ALTER TABLE attribute_values ADD COLUMN film_size_type TEXT`；为已有胶卷条目写入分类值、统一 Fuji 名称、新增 Lucky c400、写入富士品牌别名 |
| 迁移 15 | `ALTER TABLE attribute_values ADD COLUMN camera_formats TEXT`；`ALTER TABLE attribute_values ADD COLUMN camera_default_format TEXT`；新增 `6x9 中画幅`、`135 宽幅 / Xpan` 胶片格式预设值；为所有相机预设条目写入画幅信息（`migrateCameraFormats`），同时新增 Pentax MZ3/MZ5/MZ7/17/645 系列、Contax 645、Mamiya 645 系列、Bronica 系列、Fuji GW/TX 系列、Hasselblad Xpan 系列等相机预设 |

---

## 五、IPC API 汇总

前端通过 `window.api.*` 调用（Electron contextBridge，`contextIsolation: true`）。

### 5.1 photos

| 方法 | 参数 / 说明 |
|---|---|
| `photos.list(params)` | 分页查询（PAGE_SIZE=80）；支持属性过滤（每种类型一个 JOIN）、子库递归 CTE、日期范围、文件格式、整理状态、搜索、排序；批量查询每页属性 |
| `photos.get(id)` | 获取单张照片（含完整属性列表） |
| `photos.filterOptions()` | 返回文件类型计数 + 未分类/缺拍摄日期/缺相机信息的数量 |
| `photos.setAttributes(photoId, attrs)` | 替换单张照片全部属性（DELETE + INSERT 包裹于同一事务，任一步骤失败整体回滚） |
| `photos.batchSetAttributes(ids, attrs)` | 批量替换属性（事务，per-type per-photo） |
| `photos.updateNotes(id, notes)` | 更新备注 |
| `photos.setShotDate(id, shotDate\|null)` | 设置/清除拍摄日期 |
| `photos.batchSetShotDate(ids, shotDate\|null)` | 批量设置/清除拍摄日期 |
| `photos.delete(ids, deleteFile)` | 先收集文件路径，再用事务原子删除 DB 记录，最后删除磁盘文件；`deleteFile=true` 时 DB 提交成功后才执行文件删除，确保数据库一致性 |
| `photos.fullPreview(filePath, iccPath?, rotation?)` | Sharp 渲染 ≤4096px JPEG dataURL；RAW 可携带 ICC Profile（`withMetadata({icc})`）；旋转持久化 |
| `photos.thumbDataUrl(thumbPath)` | 读取缩略图文件并返回 dataURL |
| `photos.moveToSubLibrary(ids, subLibId\|null)` | 批量移动照片及本地文件，返回 `{ moved, unchanged, failed }` |
| `photos.setRotation(id, rotation)` | 设置旋转角度（0/90/180/270）并重建缩略图 |
| `photos.batchRotate(ids, delta?)` | 批量顺时针旋转，默认 +90° |

**photos:list 排序字段**：`imported_at`（默认降序）/ `shot_date`（`COALESCE(shot_date, imported_at)`）/ `file_name`（`original_name`）。

---

### 5.2 import

| 方法 | 说明 |
|---|---|
| `import.selectAndImport(options)` | 弹出系统文件夹选择对话框并导入 |
| `import.importPaths(paths, options)` | 导入指定路径列表（拖拽导入用） |
| `import.scanFolders(rootPath?)` | 枚举子文件夹并模糊匹配属性，返回 `FolderScanResult[]`；`rootPath` 缺省时弹出系统文件夹选择对话框，也可直接传入路径（支持拖放） |
| `import.importRolls(configs)` | 批量导入卷（子文件夹模式），每卷可指定属性、地点、拍摄日期、是否建卷 |
| 事件 `import:total` | 扫描到的总文件数 |
| 事件 `import:progress` | `{ imported, skipped, total? }` 逐文件推送 |

**ImportOptions**：`subLibraryId` / `organizeBy` / `shotDate` / `filmName` / `cameraName` / `lensName` / `autoCreateEquipment`

**AutoOrganizeMode**：`none` / `year` / `year-month` / `camera` / `film` / `source-folder`

**导入流程（单批次）**：
1. 扫描目录，过滤支持格式
2. 推送 `import:total`
3. 逐文件：复制到目标子库目录 → INSERT photos → EXIF 提取器材 → **胶片格式自动识别** → 异步生成缩略图
4. 同名文件自动追加 `_1` / `_2` 后缀，不覆盖
5. 导入完成后：批量写入属性、地点、拍摄日期（均在应用层事务中执行）
6. 若开启建卷：属性一致性检查（警告，不阻断）→ 调用 `rolls:create`

**EXIF 器材识别流程**（`assignEquipmentAttribute`）：
1. 规范化：去除首部品牌重复前缀（`formatEquipmentName`），去除多余空格
2. 精确匹配现有值（normalized 完全一致）
3. 模糊匹配（normalized 包含关系）
4. 别名匹配（一轮主名称，一轮别名，按长度降序）
5. 若 `autoCreateEquipment=true` 且无匹配：`INSERT OR IGNORE` 新建属性值

**胶片格式自动识别**（`detectFilmFormat` + `resolveFilmFormat`，`thumbnail.ts` / `import.ts`）：

导入时将图像缩小至最大 600×600 做像素分析，识别链如下：

-1. **相机画幅约束**（最高优先级，`resolveFilmFormat`）：若照片已关联相机且该相机有 `camera_formats`：
    - 单一画幅 → 直接赋值，跳过一切像素分析
    - 多画幅 → 与 `film_size_type` 取交集：交集唯一 → 赋值；交集为空 → 退回默认画幅；交集仍多个 → 继续像素分析
0. **胶卷类型约束**：若照片已标注胶卷且该胶卷有 `film_size_type`，则跳过像素分析，直接按约束匹配：
   - `'135'`：比例 ≤ 1.40 → `半格 / 17.5mm`；1.40–1.58 → `135 / 35mm`；其余 → null
   - `'120'`：仅按比例区分 6×6 / 6×7 / 645 / 6×12（同下方 120 比例规则）
1. **6×6 优先判断**：比例 ≈ 1.0（±0.08）直接返回 `6x6 中画幅`，先于齿孔检测，避免方形扫描边缘暗区误触发齿孔算法。
2. **齿孔检测**：采样图像左侧和右侧各 3 列像素，检测是否存在规律性暗区（亮度 < 40，明暗转换次数 ≥ 4）。若两侧均触发 → 判为 135 系列：比例 < 1.45 归为 `半格 / 17.5mm`，否则归为 `135 / 35mm`。
3. **120 背纸边纸检测**：扫描图像顶部 / 底部各约 5% 高度的行，若存在行平均亮度明显高于画面中心（>1.4× + 20）的行，判为 120 背纸特征，再按比例区分：
   - 比例 ≈ 1.0（±0.08）→ `6x6 中画幅`
   - 1.10–1.26 → `6x7 中画幅`
   - 1.27–1.42 → `645 中画幅`（645 与 6×8 比例相同，统一归为 645）
   - 1.88–2.15 → `6x12 中画幅`
   - 比例不在以上范围 → 保守归为 `120 中画幅`
4. **纯比例降级**（无像素信号时）：1.42–1.58 → `135 / 35mm`；1.0±0.08 → `6x6 中画幅`；1.10–1.23 → `6x7 中画幅`；1.26–1.40 → `645 中画幅`；1.88–2.15 → `6x12 中画幅`；其余区间返回 `null`（不赋值）。
5. **赋值策略**（`assignFilmFormatAttribute`）：仅在照片尚无 `film_format` 属性时写入，绝不覆盖用户手动标注的值。

**子文件夹卷模式确认表格新增功能**：

- 相机、镜头、胶片格式等属性 Select 均支持在搜索框内直接新增值（`dropdownRender` + 内联"＋新增"按钮），无需退出导入对话框到库管理页操作
- 拖放区域：导入对话框卷模式步骤新增拖放区，将包含子文件夹的根目录拖放至此可直接触发扫描，与"选择根目录"按钮等效

**文件夹名称解析（子文件夹导入）**（`matchFolderName`）：
- Pass 1：遍历主名称（按长度降序，最短 ≥ 2）
- Pass 2：遍历别名（同策略，仅填补未匹配类型）
- 返回 `AttrMatch[]`，每项含 `typeId` / `valueId` / `matchedAlias: string|null`
- 日期提取（`parseDateFromName`）：正则覆盖 `YYYYMMDD` / `YYYY-MM-DD` / `YYYYMM` / `YYMM` / `YYMMDD` / `YYMM` 六种格式

**自动整理模式实现**（`resolveTargetSubLibrary`）：
- `year` / `year-month`：从 shot_date 或 imported_at 取年/年月，查或建对应子库
- `camera`：取 EXIF/手动相机名，查或建"相机型号"子库
- `film`：取手动 filmName，查或建"胶片类型"子库
- `source-folder`：取文件所在目录名，查或建同名子库

---

### 5.3 attrs

| 方法 | 说明 |
|---|---|
| `attrs.listAll()` | 所有激活类别（含 values 数组） |
| `attrs.listTypes()` | 所有类别（含非激活） |
| `attrs.listValues(typeId)` | 某类别所有值（含 icon_key） |
| `attrs.valueCounts(params)` | 返回每个值的照片数；有筛选条件时执行 faceted search（每种类型排除自身筛选后分别统计）|
| `attrs.addType(displayName)` | 新增自定义属性类别 |
| `attrs.updateType(id, name)` | 重命名类别 |
| `attrs.toggleType(id, active)` | 启用/停用类别 |
| `attrs.deleteType(id)` | 删除类别（非系统） |
| `attrs.addValue(typeId, value, iconKey?)` | 新增属性值 |
| `attrs.updateValue(id, value, iconKey?)` | 修改属性值/图标 |
| `attrs.deleteValue(id)` | 删除属性值 |
| `attrs.reorder(ids)` | 调整类别显示顺序 |
| `attrs.filmIconDataUrl(key, size?)` | 获取胶卷图标 dataURL（64 or 128px） |
| `attrs.filmIconsBatch(keys, size?)` | 批量获取图标 dataURL |
| `attrs.importCustomIcon()` | 弹出文件选择，Sharp 缩放为 64/128px，存入 userData/film-icons/ |
| `attrs.filmIconManifest()` | 读取 resources/film-icons/manifest.json |
| `attrs.listAliases(valueId)` | 获取某属性值的所有别名 |
| `attrs.addAlias(valueId, alias)` | 新增别名（UNIQUE 约束，重复返回 null） |
| `attrs.removeAlias(aliasId)` | 删除别名 |
| `attrs.importJson(typeId)` | 弹出 JSON 文件选择，事务内幂等 upsert；返回 `{ added, updated, aliasesAdded }` |

**Faceted Search 实现**（`attrs:valueCounts`）：
- 无筛选条件：单次 GROUP BY 查询全库计数
- 有筛选条件：为每种属性类型单独构建 SQL（排除该类型自身筛选，保留其他所有筛选条件），并行执行 N 次查询后合并结果
- FilterPanel 根据计数 > 0 动态显示/隐藏属性值选项，有激活筛选时实现 faceted filtering 效果

**JSON 批量导入格式**（胶卷）：
```json
[{"value": "Kodak Portra 400 [135 / 35mm]", "icon_key": "kodak_portra_400", "aliases": ["柯达Portra400", "KP400"]}]
```

**JSON 批量导入格式**（相机/镜头）：
```json
[{"value": "Nikon FM2", "aliases": ["尼康FM2", "NikonFM2"]}]
```

---

### 5.4 sublib

| 方法 | 说明 |
|---|---|
| `sublib.list()` | 获取子库树（含 children 递归） |
| `sublib.create(name, parentId?)` | 新建子库（同时创建物理目录，失败时回滚记录） |
| `sublib.rename(id, name)` | 重命名（移动目录树，更新照片路径） |
| `sublib.setDescription(id, desc)` | 设置描述 |
| `sublib.delete(id)` | 删除子库（直属照片移到根，直属子库提升） |
| `sublib.counts()` | 获取各子库照片数（含后代，递归 CTE；额外含 `__total`） |

---

### 5.5 library

| 方法 | 说明 |
|---|---|
| `library.info()` | 返回 `{ root, thumbDir, profilesDir }` |
| `library.revealFile(path)` | 在文件管理器中定位文件（`shell.showItemInFolder`） |
| `library.regenThumb(id)` | 重新生成单张照片缩略图并更新 DB |
| `library.listProfiles()` | 内置 profiles + 用户自定义 profiles 合并列表 |
| `library.importProfile()` | 导入 ICC/ICM 文件（复制到 `{userData}/profiles/`） |
| `library.stats()` | `{ total, byType[], librarySize }` |

---

### 5.6 locations

| 方法 | 说明 |
|---|---|
| `locations.list()` | 所有地点（含照片数 photo_count） |
| `locations.add(name, address, lat, lng)` | 新增地点，返回 id |
| `locations.delete(id)` | 删除地点（级联清除 photo_locations） |
| `locations.update(id, name, address)` | 修改地点名称/地址 |
| `locations.photos(locationId)` | 获取某地点的所有照片 ID |
| `locations.forPhoto(photoId)` | 获取某张照片的地点列表 |
| `locations.setForPhotos(photoIds, locationId\|null)` | 批量设置地点（先清除旧记录）；`locationId=null` 仅清除 |
| `locations.addToPhoto(photoId, locationId)` | 为单张照片添加地点（OR IGNORE） |
| `locations.removeFromPhoto(photoId, locationId)` | 从单张照片移除地点 |
| `locations.clearForPhotos(photoIds)` | 批量清除照片的所有地点记录 |
| `locations.search(query)` | OSM Nominatim 在线搜索（limit=8，accept-language=zh），失败返回 `[]` |
| `locations.reverseGeocode(lat, lng)` | OSM Nominatim 反向地理编码（zoom=14），提取 village/suburb/town/city 等 |
| `locations.mapData()` | 返回 `{ locations, photosByLoc }` 用于地图视图渲染 |

---

### 5.7 rolls

| 方法 | 说明 |
|---|---|
| `rolls.list(params?)` | 列出所有卷（含照片数、封面缩略图、属性摘要、地点名、`shot_date_min`）；支持与 photos:list 相同的全部筛选参数 |
| `rolls.checkAttrConsistency(photoIds)` | 检查胶卷类型和相机是否一致，返回 `{ ok, warnings[] }` |
| `rolls.create({ photoIds, name?, subLibraryId? })` | 建卷（自动命名、选封面、关联照片） |
| `rolls.rename(id, name)` | 重命名卷 |
| `rolls.delete(id, deletePhotos?, deleteFiles?)` | 删除卷；`deletePhotos=true` 同时删 DB 照片记录；`deleteFiles=true` 同时删物理文件（linked 模式照片不删文件） |
| `rolls.batchDelete(ids, deletePhotos?, deleteFiles?)` | 批量删除多个卷（同上语义） |
| `rolls.batchSetAttributes(ids, attrs)` | 批量为多个卷的所有照片设置属性（`attrs: { typeId, valueId }[]`） |
| `rolls.photos(rollId\|null, params)` | 分页查询卷内照片；`rollId=null` 返回未分卷照片（unassigned_pr） |
| `rolls.forPhoto(photoId)` | 查询照片所属卷 |
| `rolls.removePhotos(rollId, photoIds)` | 从卷中移除照片 |
| `rolls.addPhotos(rollId, photoIds)` | 向卷中添加照片 |
| `rolls.setCover(rollId, photoId)` | 设置封面照片 |

**rolls:list 属性摘要**：批量查询每卷所有照片的 film / film_format / camera / lens 属性（DISTINCT，每类型只保留第一个值），以及第一个拍摄地点名称；`shot_date_min` 为该卷所有照片 `shot_date` 的最小值（SQL `MIN(member.shot_date)`）。

---

### 5.8 app

| 方法 | 说明 |
|---|---|
| `app.setLibraryRoot(root)` | 设置库根目录（写入 `userData/config.json`） |
| `app.getLibraryRoot()` | 获取当前库根目录 |
| `app.pickLibraryRoot()` | 弹出文件夹选择对话框选择库根目录 |
| `app.getInitError()` | 获取主进程初始化错误（可显示给用户） |
| `app.getVersion()` | 返回 `app.getVersion()` |
| `app.getLogContent(maxLines?)` | 读取运行日志最近 N 行（默认 500） |
| `app.getLogPath()` | 返回 electron-log 日志文件路径 |
| `app.revealLog()` | 在文件管理器中打开日志文件 |
| `app.openExternal(url)` | 使用系统浏览器打开 URL（`shell.openExternal`） |
| `app.detectImageApps()` | 检测已安装图像处理软件（返回 `{ name, exePath }[]`） |
| `app.openWithApp(exePath, filePaths)` | 以指定路径启动应用并传入文件（`spawn` detached），返回是否成功 |

### 5.9 win（窗口控制）

| 方法 | 说明 |
|---|---|
| `win.minimize()` | 最小化窗口 |
| `win.maximize()` | 最大化/还原窗口 |
| `win.close()` | 关闭窗口 |

---

## 六、外部软件联动（detectImageApps）

`detectImageApps` 通过 PowerShell 读取 Windows 三个注册表配置单元中的 Uninstall 条目：

- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`
- `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall`
- `HKLM\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall`

同时读取 `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths` 作为补充路径。

**支持检测的软件**（25+）：Adobe Photoshop / Lightroom Classic / Lightroom · GIMP · Capture One · RawTherapee · darktable · IrfanView · Paint.NET · FastStone Image Viewer · XnViewMP · ACDSee · Affinity Photo · 像素蛋糕（Polarr） · Luminar Neo / AI · ON1 Photo RAW · DxO PhotoLab · Corel PaintShop Pro 等

每个应用规格包含：可能的 DisplayName 关键词、可能的安装目录路径、可能的可执行文件名。

---

## 七、图像处理详解

### 7.1 缩略图生成（thumbnail.ts）

- **输出格式**：WebP，400px 最大边长（等比缩放），品质自适应
- **缓存键**：`MD5(filePath + ':' + rotation)` → `{thumbDir}/{hash}.webp`
- **BMP 处理**：纯 JS 解码器（`decodeBmp`），支持 24bpp / 32bpp 无压缩（compression=0/3），BGR→RGB 转换后送入 Sharp raw input
- **RAW 处理**：先尝试 Sharp 直接解码；失败时扫描文件缓冲区查找最大嵌入 JPEG（`extractEmbeddedJpeg`，>50KB，按 SOI/EOI 定界）
- **旋转**：`normalizeRotation` 四舍五入到最近 90° 取模 360；Sharp 的 `rotate()` 在 resize 之前执行

### 7.2 全屏预览（renderFullPreview）

- **尺寸上限**：4096px（等比缩放）
- **ICC Profile**：`withMetadata({ icc: fs.readFileSync(iccPath) })`
- **输出**：JPEG base64 dataURL
- **旋转**：同缩略图，通过 `normalizeRotation` 处理

### 7.3 EXIF 提取（getExifData）

1. 对于普通格式：调用 `sharp(path).metadata()` 获取原始 EXIF 缓冲区
2. 对于 RAW：先尝试直接 `sharp.metadata()`；失败时扫描嵌入 JPEG 后再读其 EXIF
3. 用 `exif-reader` 解析 IFD 标签；读取 `Make`/`Model`/`LensMake`/`LensModel`/`DateTimeOriginal`
4. `formatEquipmentName(make, model)`：若 model 已包含 make 则只用 model，否则拼接（避免 "Canon Canon EOS-1V"）
5. MAKER_ALIASES 映射：如 `"NIKON CORPORATION" → "Nikon"` 等

### 7.4 RGB 直方图（前端计算）

- 在 `<img>` 的 `onLoad` 回调中调用 `computeHistogram`
- 将图像下采样到最大 240px（保持比例），绘制到离屏 Canvas
- 读取像素数据，统计 R/G/B 各 256 档频率
- 在 HistogramCanvas 中用 `screen` 混合模式叠加三通道（红 #cc3333 / 绿 #33aa44 / 蓝 #3366dd）

---

## 八、功能模块与 UX 交互说明

### 8.1 全局状态（Zustand Store）

Store 按领域拆分为三个独立 slice，同时保留 `useStore()` 向后兼容组合导出：

**filterSlice**（筛选与选中）

| 状态字段 | 说明 |
|---|---|
| `filter` | FilterState（筛选条件完整对象） |
| `selectedIds` | 当前选中照片 ID 集合（Set） |
| `setFilter / resetFilter` | 更新 / 重置筛选条件 |
| `toggleSelect / selectAll / clearSelection` | 选中状态管理 |

**librarySlice**（库参考数据）

| 状态字段 | 说明 |
|---|---|
| `attrTypes` | 所有激活属性类别（含 values），启动时加载 |
| `filmIconCache` | iconKey → base64 dataURL，跨会话复用 |
| `subLibraries` | 子库树，增删改后刷新 |
| `iccProfiles / activeProfile` | ICC 配置文件列表与当前选中 |
| `importProgress` | `{ total, imported, skipped } \| null`，用于全局进度提示 |

**uiSlice**（界面交互）

| 状态字段 | 说明 |
|---|---|
| `thumbnailSize` | `'small' \| 'medium' \| 'large'`（照片视图缩略图尺寸） |
| `rollThumbnailSize` | `'small' \| 'medium' \| 'large'`（卷视图缩略图尺寸，独立于照片视图） |
| `viewMode` | `'rolls' \| 'photos'` |
| `activeRoll` | 当前进入卷内部时的 Roll 对象 |
| `viewerPhoto / viewerPhotos / viewerIndex` | 全屏预览状态 |
| `settingsOpen` | 设置弹窗开关 |
| `detailPhotoId` | 详情抽屉照片 ID |

### 8.2 照片列表加载（自定义 hooks）

Library.tsx 已从约 530 行的 God Component 拆分为三个自定义 hook，组件本体缩减至约 270 行：

**usePhotoLoader(filter, activeRoll, unassignedOnly)**
- 封装照片分页加载全部逻辑；维护 `photos`, `total`, `page`, `loading`, `hasMore`
- `loadCounterRef`（单调递增）：每次触发新加载前递增，加载完成前检查 ID，防止竞态条件覆盖
- `loadingRef`（布尔锁）：防止同一请求并发，`reset=true` 时强制执行
- 卷内视图：调用 `rolls:photos`；普通视图：调用 `photos:list`

**useRollLoader(filter)**
- 封装胶卷列表加载（`rolls:list`）；维护 `rolls`, `photolessCount`, `rollsLoading`

**useLibraryData()**
- 封装属性类型、子库、值计数、filterOptions 的加载
- `loadAttrs` 完成后同步刷新 `valueCounts`，保持 faceted search 计数一致

**卷模式切换**

- 卷视图：调用 `rolls:list`（含封面缩略图、属性摘要、地点名、未分卷计数）
- 进入卷（`handleRollClick`）：设置 `activeRoll` + `viewMode='photos'`，PhotoGrid 切换为 `rolls:photos` 分页
- 顶栏返回按钮：清除 `activeRoll`，切回 `viewMode='rolls'`
- 未分卷（`handleOtherPhotosClick`）：设置特殊参数 `rollId=null` 查询未分卷照片

### 8.3 照片网格（PhotoGrid）

**列数与视图尺寸**

| 视图 | 窗口模式 (<1400px) | 宽屏模式 (≥1400px) |
|---|---|---|
| 小（列表） | 1 列 | 2 列 |
| 中（网格） | 5 列 | 8 列 |
| 大（宽网格） | 3 列 | 5 列 |

小视图列表：INFO_BAR=0；中视图：INFO_BAR=46px；大视图：INFO_BAR=52px；ROW_GAP：8/12/28px

**虚拟滚动**

- `useVirtualizer`（@tanstack/react-virtual），overscan=3
- 行高变化时调用 `measure()` 强制重测（确保大/小视图切换时行高正确）

**框选（Box Selection）**

1. `mousedown` 在非卡片区域（空白处）：记录起始坐标（转换到内容空间），设置 `isSelecting=true`
2. `mousemove`：更新 selection rect（转换坐标系），高亮覆盖范围内照片
3. `mouseup`：提交选中集合；`justDraggedRef=true` 防止 click 事件误触发取消选中

**右键上下文菜单**

- 右键未选中照片：仅选中该张
- 右键已选中照片：保留多选集合
- 菜单项：在文件管理器打开 · 复制文件路径 · 用其他应用打开（hover → 检测应用 → 子菜单）· 编辑属性 · 旋转 90° · 移动到子库 · 从库中移除

**大视图悬停预览面板（HoverPreviewPanel）**

- 固定在网格右侧，宽 360px
- 鼠标进入照片卡片：立即显示缩略图
- 280ms 防抖后通过 `photos:fullPreview` 加载全分辨率预览
- 面板下方按行展示：文件名、格式、尺寸、大小、拍摄日期、入库日期、所有已标注属性

### 8.4 全屏预览（PhotoViewer）

**Modal 属性**：`mask=false`（允许背后继续操作）；`width=calc(100vw - 48px)`；body `height=calc(100vh - 130px)`

**图像区域**

- 背景区 `onClick` → 关闭（点击图片外围关闭）
- `onWheel` → 缩放（0.5×–8×）；scale≤1 时重置 pan
- `onMouseDown` → 开始拖拽平移（scale>1 时）；全局 mousemove/mouseup 处理拖拽

**右侧信息面板（宽 288px）**

- RGB 直方图（Canvas，screen 混合模式）
- ICC 配置文件选择（仅 RAW 显示）
- 文件信息（文件名、格式、旋转角度、尺寸、大小、拍摄日期 DatePicker、入库时间）
- 属性标签编辑（AttrEditor）：
  - 胶片：点击区域打开 FilmIconPicker 图标选择器
  - 其他：Select 下拉，支持 `search-to-create`（输入未匹配值时下方出现"新增"选项，`onMouseDown` 阻止 blur）
- 备注（只读展示）
- 拍摄地点：显示已关联地点列表（可删），加号切换 LocationPicker

**标题栏按钮**

- 旋转 90°：更新 livePhoto + 重载 fullPreview
- 用其他应用打开：Popover（`trigger=click`），首次打开时调用 `app:detectImageApps`；列表点击 → `app:openWithApp`
- 在文件管理器中显示

**键盘快捷键**：`ArrowLeft` / `ArrowRight` 切换；`Escape` 关闭

### 8.5 左侧筛选面板（FilterPanel）

**子库树**

- Ant Design Tree，`showIcon`，选中高亮
- 右键弹出固定定位的原生 context menu（自动 `clamp` 防越界），提供"删除子库"操作（含 Modal.confirm 确认）
- 子库选中后：筛选条件写入 `filter.subLibraryId`，`photos:list` 使用递归 CTE 包含后代

**时间范围**

- Segmented 切换入库日期/拍摄日期（`filter.dateField`）
- DatePicker.RangePicker 选区间

**整理状态**

- 未分类（`sub_library_id IS NULL`）/ 缺拍摄日期 / 缺相机信息
- 计数来自 `photos:filterOptions`

**文件格式**

- 多选 Select，选项含格式名 + 数量

**属性筛选**

- Collapse 面板，默认展开系统属性
- 有筛选条件时执行 faceted search（只显示结果集中存在的属性值）
- 属性值 ≥ 7 个时显示搜索框（规范化匹配）
- 胶片类型显示图标

**排序**

- Select（入库时间 / 拍摄日期 / 文件名）+ 升降序切换按钮

**活跃筛选计数 + 清除按钮**

- 统计：属性数量 + 整理状态数量 + 文件格式数量 + 日期范围（1 或 0）+ 子库（1 或 0）
- 超过 0 时底部显示"清除所有筛选 (N)"

### 8.6 顶栏（TopBar）

**拖拽区域**：`-webkit-app-region: drag` 覆盖整个 Header，操作按钮区设置 `no-drag`
**窗口控制**：最小化（#2a2a2a hover）/ 最大化（#2a2a2a hover）/ 关闭（#c0392b hover，图标变白）
**视图切换**：Segmented（卷 BlockOutlined / 照片 AppstoreOutlined）
**卷内返回**：`viewMode='photos' && activeRoll` 时显示 RollbackOutlined 返回按钮
**多选建卷**：选中照片且 viewMode!='rolls' 时，Badge 徽标 + BlockOutlined 建卷入口
**总数显示**：右侧显示当前照片总数（小字，深色）

### 8.7 导入对话框（ImportDialog）

**五个步骤**：`select → scan → confirm → importing → done`

**单批次模式（步骤 select → importing → done）**

- 拖放区域：dragenter/dragleave/drop，支持文件和文件夹，`dragCounter` ref 防止子元素 leave 误触发
- 胶片选择：点击区域打开 FilmIconPicker
- 其他属性：Select + search-to-create
- 自动整理：Switch + 五种模式 Select + 文字提示
- 建卷开关：Switch + 卷名 Input（留空则自动生成）
- 拍摄地点：LocationPicker（搜索后可选，可删）
- 拍摄日期：DatePicker（批量应用，留空读 EXIF）

**子文件夹卷模式（步骤 select → scan → confirm → importing → done）**

- 拖放区域：将包含子文件夹的根目录拖放至拖放区或点击"选择根目录并扫描"按钮 → `import:scanFolders(rootPath?)` → 返回 `FolderScanResult[]`
- Confirm 表格（`RollConfirmRow`）：每行显示文件夹名/文件数/解析日期，可编辑：
  - 卷名（点击 EditOutlined 切换为 Input）
  - 胶片（点击 FilmTag 区域打开独立 FilmIconPicker）
  - 其他属性（compact Select）；所有属性 Select 均支持搜索框内直接内联新增值（`dropdownRender` + "＋新增"条目），无需退出对话框
  - 地点（compact Select，本地模糊搜索）
  - 拍摄日期（compact DatePicker）
  - 建卷 Switch（每行独立）
  - 属性来源标注：↑父（绿色）/ ↓子（蓝色）
  - 别名匹配标注：橙色 `~别名` Badge + Tooltip（"匹配别名：xxx"）
- 用户手动修改属性时同步清空对应 `matchedAliases[typeId]`

**进度反馈**

- `import:total` 事件设置总数
- `import:progress` 事件逐文件更新
- Progress 组件显示百分比，下方显示"已导入 N 张 · 跳过 M 张"

### 8.8 卷视图（RollsView）

**三档视图尺寸**（由 `rollThumbnailSize` 独立控制，与照片视图 `thumbnailSize` 互不影响）：

| 视图 | 窗口模式 (<1400px) | 宽屏模式 (≥1400px) | 卡片高度 |
|---|---|---|---|
| 小（横向列表） | 1 列 | 2 列 | 80px 行高，60×60 封面缩略图 |
| 中（网格） | 4 列 | 6 列 | 封面 148px + 信息栏 72px |
| 大（宽网格） | 2 列 | 3 列 | 封面 220px + 信息栏 100px（额外显示相机/镜头/拍摄年月） |

**封面**：从 `thumbCache` 异步加载，无封面时显示灰色图标；右下角照片数角标（背景模糊）
**信息栏（中/大）**：胶片图标 + 名称（截断）+ 格式 Tag + 地点；大视图另显示相机、镜头、`shot_date_min`（年月）
**小视图列表**：封面缩略图（60×60）+ 名称 + 胶片名 + 格式 + 照片数，地点 Tooltip
**重命名**：点击 EditOutlined → 行内 input（autoFocus，blur/Enter 保存，Escape 取消）
**地点设置**：EnvironmentOutlined 按钮打开 Popover（显示当前地点 + 清除按钮 + LocationPicker）；批量为该卷所有照片 setForPhotos
**"其他图片"卡片**：虚线边框，点击进入未分卷照片视图

**多选与框选**

- **橡皮筋框选**：在卡片空白区域 mousedown 启动拖拽，松开时命中卡片坐标矩形（小视图按行高区间，中/大视图按网格格子坐标）
- **Ctrl/Meta/Shift 点击**：逐一切换单张卷的选中状态
- **右键菜单**：右键点击未选中卡片时替换当前选中集；菜单项：重命名（仅单选）、批量编辑属性、删除

**批量操作**

- **批量属性编辑**：Modal 中为所有选中卷的全部照片批量设置胶片/相机/镜头等属性（调用 `rolls.batchSetAttributes`）
- **删除**：三档 Radio 选项——仅删除卷索引 / 同时删除数据库照片 / 同时删除物理文件；linked 模式照片即使选"删除文件"也只删 DB 记录

### 8.9 胶卷库（FilmLibraryModal）

- 列出所有胶卷值：图标（40px）+ 名称 + 照片数 + 别名编辑 + 删除
- 别名展开区：点击 TagsOutlined 切换展开/收起；展开后显示 Tag 列表（可删）+ Input + 添加按钮
- 新增胶卷：弹出子 Modal，需填名称 + 规格（必填），图标可选；存储格式 `{名称} [{规格}]`
- 导入 JSON 按钮（底部）：调用 `attrs:importJson`，返回新增/更新/别名数量

### 8.10 相机库 / 镜头库（AttrLibraryModal）

通用组件，复用于 camera / lens 等属性类型：

- 列表：名称 + 照片数 + 别名编辑 + 删除
- 底部：`Space.Compact`（Input + 添加按钮），支持 Enter 直接新增
- 导入 JSON 按钮

### 8.11 地图视图（MapView）

**实现**：Leaflet 动态导入（`let L: typeof import('leaflet') | null = null`），避免与 Electron 渲染进程冲突

**三源自动轮换**（优先级顺序）：

1. OpenStreetMap.de（`{s}.tile.openstreetmap.de/osmde/{z}/{x}/{y}.png`）
2. Esri World Street Map（`server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}`）
3. OpenStreetMap.org（`{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`）

**切换触发条件**：

- 单个瓦片加载错误计数 ≥ 2
- 单源加载无响应超过 25 秒（stall timer，重置于每次 tileloadstart）
- 切换通过 attempt counter 防止旧回调触发

**状态 UI**：标题栏显示"加载中..."/"备用地图（Esri）"/"地图加载失败 + 重试"

**地图内容**：调用 `locations:mapData`；`fitBounds` 自动调整视角（有已导入地点时）；无地点时居中中国（[35.5,103]，zoom 4）

**标记**：`L.divIcon`（橙色圆点 + 照片数角标），Tooltip 显示地点名

**Modal 兼容**：`afterOpenChange` 回调 + 200ms 定时器双重触发 `map.invalidateSize()`

### 8.12 地点选择器（LocationPicker）

**本地搜索**：启动时加载全部 locations，按 normalize（去空格转小写）对 name + address 模糊匹配，显示前 10 条
**在线搜索**：用户点击"在 OpenStreetMap 中搜索"→ `locations:search`
**手动输入**：切换到手动表单（地点名称必填 + 地址可选 + 纬度 + 经度）
**选中后**：若已存在数据库则直接返回；在线搜索结果则先 `locations:add` 再返回

### 8.13 批量编辑（BatchEditModal）

多选照片后从右键菜单或顶栏打开：

- 所有激活属性类别的编辑（胶片用 FilmTag 点击区域 + FilmIconPicker）
- 留空 = 不修改该属性；填写 = 覆盖所有选中照片的对应属性
- 批量设置拍摄地点（set / skip / clear 三档）
- search-to-create 内联新增属性值
- 操作完成后清除选中状态 + 刷新列表

### 8.14 设置页（SettingsModal）

三个 Tab：

- **存储**：显示当前库根目录，可点击修改（`app:pickLibraryRoot` + `app:setLibraryRoot`）；显示库统计（照片总数、各格式数量、存储大小）
- **关于**：显示版本号（`app:getVersion`）、GitHub 链接（`app:openExternal`）
- **日志**：加载运行日志最近 500 行（`app:getLogContent`）；显示日志文件路径；"在文件管理器中打开"按钮

---

## 九、数据存储位置

| 数据类型 | 存储路径 |
|---|---|
| 数据库文件 | `{libraryRoot}/film.db` |
| 原始照片 | `{libraryRoot}/files/{子库目录}/{文件名}`；未分类位于 `files/` 根目录 |
| 缩略图 | `{libraryRoot}/thumbs/{md5}.webp` |
| 内置 ICC 配置文件 | `{appPath}/resources/profiles/` |
| 用户 ICC 配置文件 | `{userData}/profiles/` |
| 内置胶卷图标 | `{appPath}/resources/film-icons/` |
| 用户自定义胶卷图标 | `{userData}/film-icons/` |
| 应用配置 | `{userData}/config.json`（`libraryRoot` 字段） |
| 运行日志 | `{userData}/logs/`（electron-log 默认位置） |

`libraryRoot` 默认：`{documents}/FilmManager`；可通过设置修改，重启后生效。

---

## 十、前端架构设计

### 10.1 安全模型

- `contextIsolation: true` + `nodeIntegration: false`
- 所有主进程能力通过 `contextBridge.exposeInMainWorld('api', ...)` 暴露
- 自定义 `localfile://` 协议服务缩略图（禁止 `file://` 协议直接访问）
- CSP：`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: localfile: https:; connect-src 'self' https:`

### 10.2 主要组件树

```
App（ConfigProvider: 深色主题 #141414，primary #c8832a）
└── Library（页面级状态协调）
    ├── TopBar（窗口控制、导航、工具栏）
    ├── FilterPanel（左侧筛选面板，240px 固定宽度）
    ├── PhotoGrid（虚拟滚动网格）
    │   └── PhotoCard（单张卡片，小/中/大视图）
    │       └── HoverPreviewPanel（大视图右侧悬停预览）
    ├── RollsView（卷视图，ResizeObserver 自适应列数）
    │   └── RollCard（卡片，封面+信息+操作）
    ├── PhotoViewer（全屏预览 Modal）
    │   ├── HistogramCanvas（RGB 直方图）
    │   ├── AttrEditor（属性编辑）
    │   └── LocationPicker（地点搜索）
    ├── DetailDrawer（照片详情抽屉）
    ├── ImportDialog（导入向导）
    │   └── RollConfirmRow（子文件夹确认行）
    ├── BatchEditModal（批量属性编辑）
    ├── CreateRollModal（从选中照片建卷）
    ├── FilmLibraryModal（胶卷库管理）
    ├── AttrLibraryModal（相机库/镜头库，通用）
    ├── MapView（Leaflet 地点地图）
    └── SettingsModal（设置，三个 Tab）
```

### 10.3 关键 UX 设计模式

**防竞态（loadCounterRef）**：每次触发新的照片加载时，`loadCounterRef.current++` 获取唯一 ID；IPC 返回后比较 ID，若不一致则丢弃（旧请求不覆盖新请求）。封装于 `usePhotoLoader` hook 内部。

**Search-to-Create**：所有 Select 下拉的 `dropdownRender` 底部注入"新增 '{query}'" 按钮（规范化后无匹配时显示）；`onMouseDown` 阻止默认行为防止 blur 关闭下拉。

**FilmIconPicker**：胶片属性专用选择器，Grid 展示图标 + 名称；底部可直接新增（填写名称和规格）；自定义图标通过 `attrs:importCustomIcon` 上传。

**所有 Modal `mask={false}`**：对话框打开时允许继续操作主窗口，符合桌面应用习惯。

**实时属性刷新（livePhoto）**：PhotoViewer 内部维护 `livePhoto` 状态；属性修改后重新 `photos:get` 获取最新数据，同时调用 `onAttrChanged()` 通知父级刷新列表。

**性能优化**：
- 缩略图异步生成（Sharp 任务队列化，不阻塞导入事务）
- 虚拟化滚动（仅渲染可见行 ± overscan=3）
- 批量属性加载（每页 80 张照片的属性一次查询，IN 子句）
- 图标批量请求（每次 20 个，Zustand cache 跨组件复用）

---

## 十一、版本历史

| 版本 | 主要变更 |
|---|---|
| 1.0.0 | 初始版本：照片导入、属性标注、子库、全屏预览 |
| 1.0.1 | 布局优化，installer 更新 |
| 1.0.2 | 缩略图优化、拖拽导入、直方图、缩放平移、框选、右键菜单 |
| 1.0.3 | Modal 查看器、中文属性 search-to-create、查看器属性编辑侧栏、胶卷库 |
| 1.0.4 | 相机库 / 镜头库 AttrLibraryModal |
| 1.1.0 | EXIF 自动读取、子库照片数统计、批量属性编辑、相机库 / 镜头库独立管理 |
| 1.1.1 | 三档视图布局优化、自适应列数、合并自定义标题栏与工具栏 |
| 1.1.2 | Windows 原生模块准备与 Release 构建流程优化 |
| 1.1.3 | 自动整理、EXIF 相机/镜头识别、整理状态筛选、持久化 90° 旋转、跨子库移动、任意层级子库右键删除 |
| 1.1.4–1.1.6 | 胶卷视图与建卷、未分卷汇总、子文件夹批量导入、智能文件夹名称解析 |
| 1.1.7 | leaf+v1.1.x 合并：属性别名系统、文件夹/EXIF 别名匹配、JSON 批量导入 |
| 1.1.71 | 设置页（存储 / 关于 / 日志三 Tab） |
| 1.1.8 | 子库映射真实本地目录树；物理整理同步磁盘；旧版迁移 |
| 1.1.9 | Faceted search 联动计数；BMP 纯 JS 解码；234+ 胶卷预设图标；大视图悬停预览面板 |
| 1.1.10 | 地点地图默认中国视角；地图标记侧栏照片预览；LocationPicker 重构；全屏预览/卷卡片添加地点入口 |
| 1.1.11 | 外部软件联动（Popover + 子菜单）；`detectImageApps` PowerShell 注册表扫描 25+ 应用 |
| 1.1.12 | 筛选竞态修复（loadCounterRef）；活动安全刷新（800ms debounce）；地图 Modal 黑屏修复（invalidateSize） |
| 1.2.0 | 地图改用 MapLibre GL；BatchEditModal 批量设置地点；地点种子数据扩充；TopBar 类型修正 |
| **1.2.1** | **地图回归 Leaflet**，三源自动轮换（OSM.de → Esri → OSM），25s 超时 + 2 次错误自动切换；LocationPicker 恢复纯检索+手动坐标模式 |
| **1.3.0** | **架构重构与稳定性加固**：Zustand Store 拆分为 3 个领域 slice；Library.tsx 拆分为 3 个自定义 hook（usePhotoLoader / useRollLoader / useLibraryData）；提取共享类型 `import-types.ts`；删除 walkDirect 别名；基于内容哈希（MD5 文件大小+前 64KB）的重复文件检测；数据库新增 content_hash 列+索引、original_name 索引；COUNT 查询优化（COUNT(DISTINCT p.id) 替代子查询包裹）；photos:delete / photos:setAttributes 操作原子化 |
| **1.3.1** | **两阶段导入与存储模式**：第一阶段批量快速登记占位记录（`import_status='indexing'`）立即刷新图库骨架卡片；第二阶段后台完成 EXIF/拷贝/缩略图；存储模式新增"建立索引"（linked）选项，仅记录原始路径不复制文件；全局后台进度条（ImportProgressBar）固定显示于内容区底部；新增 `import_queue` 任务队列表；Bug 修复：linked 模式删除/移动不操作源文件；processQueueItem 错误回滚用 `copiedPath` 追踪实际已拷贝路径；对话框关闭时正确重置 storageMode |
| **1.3.1+** | **胶片格式自动识别与卷导入增强**：① 导入时自动识别胶片格式（半格/135/645/6×6/6×7/6×12等），通过像素采样检测齿孔和120背纸边纸，优先赋值、不覆盖手动标注；② 新增半格/645/6×6/6×7/6×8/6×12等格式预设值；③ 子文件夹卷确认表格所有属性Select支持内联新增值；④ 卷模式新增拖放根目录区域，直接拖入触发扫描 |
| **1.3.2** | **格式识别优化与胶卷分类**：① 修复 6×6 中画幅被误判为半格——比例 ≈ 1.0 先于齿孔检测提前返回；② 新增 `film_size_type` 字段，为所有内置胶卷条目分类（`'135'`/`'120'`/`'both'`），导入时按已标注胶卷类型约束格式匹配范围，135 胶卷仅在半格/135间选择，120 胶卷仅按比例区分中画幅规格；③ 统一所有 fuji→Fuji 命名，为富士品牌写入别名（fuji/富士/fujifilm/富士胶片）；④ 新增 Lucky c400 预设（both）；⑤ 修复 importRolls 未将 filmName 传入 importOptions 导致格式约束失效的问题 |
