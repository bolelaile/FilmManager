# FilmManager 产品规格文档

**版本：** 1.2.0
**技术栈：** Electron 29 · React 18 · Ant Design 5 · better-sqlite3 · Sharp · electron-vite

---

## 一、产品概述

FilmManager 是一款面向胶片摄影爱好者的本地桌面应用，用于管理胶片扫描文件。核心功能包括：导入并索引本地扫描文件（支持 EXIF 自动读取拍摄日期和相机型号）、按相机 / 胶卷 / 镜头等属性分类标注（支持多选批量编辑）、与本地目录同步的树状子库（含照片数统计）、拍摄地点地图标记、全屏预览（支持 RAW 解码与 ICC 色彩配置）。数据完全本地存储，不依赖云服务。

---

## 二、数据库结构

数据库文件：`{libraryRoot}/film.db`（SQLite，WAL 模式，外键强制开启）

### 2.1 表结构总览

| 表名 | 说明 | 行数量级 |
|---|---|---|
| `photos` | 核心照片记录 | 数千—数万张 |
| `sub_libraries` | 本地树状子库 | 数十个 |
| `attribute_types` | 属性类别定义 | 约 7 个（可扩展） |
| `attribute_values` | 各类别的可选值 | 数百个 |
| `attribute_value_aliases` | 属性值别名（胶片、相机、镜头等） | 数百个 |
| `photo_attributes` | 照片—属性值关联（多对多） | 与照片数量同量级 |
| `rolls` | 胶卷卷及封面、所属子库 | 数十—数百个 |
| `photo_rolls` | 照片—胶卷卷关联 | 与照片数量同量级 |
| `locations` | 地点（含经纬度） | 数十—数百个 |
| `photo_locations` | 照片—地点关联（多对多） | 与照片数量同量级 |
| `color_profiles` | ICC/ICM 色彩配置文件 | 数个 |

---

### 2.2 photos — 照片主表

```sql
CREATE TABLE photos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path      TEXT    NOT NULL UNIQUE,   -- 磁盘绝对路径（唯一）
  original_name  TEXT    NOT NULL,          -- 原始文件名
  file_type      TEXT    NOT NULL,          -- 扩展名，如 jpg / cr2 / nef
  thumb_path     TEXT,                      -- 缩略图文件路径（可为空）
  thumb_ready    INTEGER DEFAULT 0,         -- 0=未生成, 1=已生成
  width          INTEGER,                   -- 像素宽（元数据）
  height         INTEGER,                   -- 像素高（元数据）
  file_size      INTEGER,                   -- 文件字节数
  sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
  imported_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  shot_date      TEXT,                      -- 拍摄日期 YYYY-MM-DD（可选）
  rotation       INTEGER NOT NULL DEFAULT 0, -- 用户旋转角度 0 / 90 / 180 / 270（顺时针）
  notes          TEXT    DEFAULT ''         -- 用户备注
);

CREATE INDEX idx_photos_sub_library ON photos(sub_library_id);
CREATE INDEX idx_photos_imported_at  ON photos(imported_at);
```

**字段说明**

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | INTEGER | 自增主键 |
| `file_path` | TEXT UNIQUE | 文件磁盘路径，重复导入会被跳过 |
| `original_name` | TEXT | 显示名称，支持搜索 |
| `file_type` | TEXT | 小写扩展名，用于区分 RAW 与普通格式 |
| `thumb_path` | TEXT | 缩略图路径，异步生成后写入 |
| `thumb_ready` | INTEGER | 0/1 布尔值，控制 UI 是否显示缩略图 |
| `width` / `height` | INTEGER | 图像分辨率 |
| `file_size` | INTEGER | 字节数，UI 显示为 KB/MB |
| `sub_library_id` | INTEGER FK | 所属子库，删除子库后置 NULL |
| `imported_at` | TEXT | 入库时间（本地时间，精确到秒） |
| `shot_date` | TEXT | 拍摄日期 YYYY-MM-DD，可由用户手动设置 |
| `rotation` | INTEGER | 用户旋转角度，固定为 0 / 90 / 180 / 270，重启后保持 |
| `notes` | TEXT | 自由文本备注 |

**支持的文件格式**

- **普通格式**（直接显示）：JPG / JPEG · PNG · TIFF / TIF · BMP · WebP
- **RAW 格式**（Sharp 解码 + ICC 转换）：CR2 · CR3 · NEF · ARW · RAF · ORF · RW2 · DNG 等

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

**字段说明**

| 字段 | 说明 |
|---|---|
| `id` | 自增主键 |
| `name` | 子库显示名称 |
| `description` | 可选描述文字 |
| `parent_id` | 父级子库 ID，`NULL` 表示顶层；支持无限层级嵌套 |
| `folder_name` | `{libraryRoot}/files/` 下对应的安全目录名；用于处理非法字符和同名目录 |
| `sort_order` | 同级排序值，越小越靠前 |
| `created_at` | 创建时间 |

**业务规则**
- 新建子库：创建数据库记录的同时，在父级物理目录下创建对应文件夹
- 导入或移动照片：文件移动到目标子库物理目录，并同步更新 `photos.file_path` 与 `sub_library_id`
- 重命名子库：移动完整目录树，并更新其内所有照片的绝对路径
- 删除子库：直属照片及文件移到 `{libraryRoot}/files/`；直属子库及其目录树提升到根级
- 启动迁移：旧版扁平文件按现有 `sub_library_id` 幂等迁移到真实目录树；同名文件自动追加数字后缀
- 前端以递归树形结构展示，`children` 字段由查询时组装

---

### 2.4 attribute_types — 属性类别定义

```sql
CREATE TABLE attribute_types (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT    NOT NULL UNIQUE,   -- 内部标识符（英文）
  display_name TEXT    NOT NULL,          -- 界面显示名
  is_system    INTEGER DEFAULT 0,         -- 1=系统内置（不可删除/停用）
  is_active    INTEGER DEFAULT 1,         -- 0=隐藏（不在筛选和详情中显示）
  sort_order   INTEGER DEFAULT 0          -- 显示排序
);
```

**系统预置属性类别（is_system = 1，不可删除）**

| key | display_name | 说明 |
|---|---|---|
| `camera` | 相机 | 相机型号，如 Nikon F3 |
| `film` | 胶片 | 胶卷品牌型号，支持图标 |
| `imported_at` | 入库时间 | 系统自动记录，供筛选用 |

**预置可停用属性类别（is_system = 0）**

| key | display_name | 说明 |
|---|---|---|
| `lens` | 镜头型号 | 拍摄镜头 |
| `dev_method` | 冲扫方式 | 自冲自扫 / 送冲送扫 / 自冲送扫 / 送冲自扫 |
| `dev_lab` | 冲扫商家 | 冲洗店名称 |
| `film_format` | 胶片格式 | 135/35mm · 120中画幅 · 4×5大画幅 · 8×10大画幅 |

**用户可自定义新增任意属性类别，**并可启用/停用/重命名/删除（系统属性除外）。

---

### 2.5 attribute_values — 属性可选值

```sql
CREATE TABLE attribute_values (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  attribute_type_id INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
  value             TEXT    NOT NULL,
  icon_key          TEXT,              -- 仅 film 类型使用，指向图标文件
  is_preset         INTEGER DEFAULT 0, -- 1=系统预设，0=用户新增
  UNIQUE(attribute_type_id, value)
);
```

**字段说明**

| 字段 | 说明 |
|---|---|
| `id` | 自增主键 |
| `attribute_type_id` | 所属属性类别，级联删除 |
| `value` | 值文本，同一类别内唯一 |
| `icon_key` | 胶卷图标索引键（如 `kodak_portra_400`），用于加载 WebP 图标 |
| `is_preset` | 1=系统内置预设值，0=用户自行添加的值 |

**预置相机值（部分）**

Nikon F3 / FM2 / F100 / FE2 · Canon AE-1 / F-1 / EOS-1V · Leica M2 / M3 / M6 / M7 · Pentax 67 / 6x7 / K1000 · Mamiya RZ67 / RB67 / 7II · Hasselblad 500C/M / 503CW · Contax G2 / T2 / RX · Olympus OM-1 / OM-4T · Minolta X-700 / CLE · Rollei 35 · Rolleiflex 2.8F · Yashica Mat-124G · Bronica SQ-A

**预置镜头值（部分）**

Nikkor 50/1.4 · 50/1.8 · 35/2 · Canon 50/1.4 · 28/2.8 · Leica Summicron 50/2 · Summilux 35/1.4 · Elmarit 28/2.8 · Zeiss Planar 50/0.7 · Distagon 35/1.4 · Voigtlander Nokton 40/1.4 · Color-Skopar 35/2.5

**预置胶卷值** 由 `resources/film-icons/manifest.json` 动态加载，包含图标键名，数量取决于内置资源包。

**胶片图标机制**

- 图标格式：WebP，64px（标准）和 128px @2x（Retina）
- 查找优先级：`{userData}/film-icons/{iconKey}.webp` → `{appPath}/resources/film-icons/{iconKey}.webp`
- 用户可通过"胶卷库"或设置中导入自定义图片（JPG/PNG/WebP），Sharp 自动裁剪缩放为 64/128px

---

### 2.6 photo_attributes — 照片属性关联（多对多）

```sql
CREATE TABLE photo_attributes (
  photo_id           INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  attribute_type_id  INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
  attribute_value_id INTEGER NOT NULL REFERENCES attribute_values(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, attribute_type_id, attribute_value_id)
);

CREATE INDEX idx_photo_attrs_photo    ON photo_attributes(photo_id);
CREATE INDEX idx_photo_attrs_type_val ON photo_attributes(attribute_type_id, attribute_value_id);
```

**业务规则**
- 每张照片对每种属性类别**最多关联一个值**（应用层约束：每次设置属性时先删除该类别旧值再插入新值）
- 删除照片、属性类别或属性值时级联删除
- `photo_id + attribute_type_id` 构成业务唯一键（主键中含 value_id 仅作完整性冗余）

---

### 2.7 locations — 拍摄地点

```sql
CREATE TABLE locations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  address    TEXT DEFAULT '',
  lat        REAL NOT NULL,   -- 纬度
  lng        REAL NOT NULL,   -- 经度
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_photo_locations_loc ON photo_locations(location_id);
```

**预置地点数据**（数据库启动时按名称增量补齐，不覆盖用户已有地点）

- 4 个直辖市（北京、上海、天津、重庆）
- 31 个省会/自治区首府/特别行政区（含香港、澳门、台北）
- 各省主要地级市、自治州和旅行落脚点
- 城市常见机位、历史街区和自然景区（故宫、外滩、洪崖洞、霞浦、元阳梯田、赛里木湖等）
- 北京 10 个区 + 上海 10 个区
- 合计约 345 个不重名预置地点；升级时自动合并旧版坐标相同的重复预置项并保留照片关联

地点搜索通过 **OpenStreetMap Nominatim API** 实时查询，结果可保存至本地数据库。

---

### 2.8 photo_locations — 照片地点关联（多对多）

```sql
CREATE TABLE photo_locations (
  photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, location_id)
);

CREATE INDEX idx_photo_locations_photo ON photo_locations(photo_id);
CREATE INDEX idx_photo_locations_loc   ON photo_locations(location_id);
```

**业务规则**
- 一张照片可关联多个地点（如"上海 → 徐汇区"）
- 地点可关联任意数量照片
- 删除照片或地点时级联删除关联记录

---

### 2.9 color_profiles — ICC 色彩配置文件

```sql
CREATE TABLE color_profiles (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  is_preset INTEGER DEFAULT 0  -- 1=内置预设
);
```

用于 RAW 文件全屏预览时的色彩空间转换。内置配置文件从 `resources/profiles/` 加载，用户可导入自定义 ICC/ICM 文件。

---

## 三、实体关系图

```
sub_libraries ──┐  (树形自引用，parent_id)
                │
photos ─────────┼── sub_library_id (N:1)
   │            └
   │
   ├── photo_attributes ──── attribute_values ──── attribute_types
   │         (多对多)
   │
   └── photo_locations ────── locations
             (多对多)

attribute_values.icon_key → {userData}/film-icons/{key}.webp
photos.thumb_path         → {libraryRoot}/thumbs/{hash}.jpg
color_profiles.file_path  → {resources}/profiles/{name}.icc
```

---

## 四、属性系统详解

### 4.1 设计思路

属性系统采用 EAV（实体-属性-值）变体模式，支持用户自由扩展分类维度，不需要修改数据库 Schema。

**三层结构：**
```
AttributeType（类别）  →  AttributeValue（可选值）  →  photo_attributes（关联）
   "相机"                   "Nikon F3"                   photo#42 → 相机:Nikon F3
   "胶片"                   "Kodak Portra 400"
   "镜头型号"               "Nikkor 50mm f/1.4"
```

### 4.2 属性类别（AttributeType）操作

| 操作 | 系统属性 | 用户自定义属性 |
|---|---|---|
| 查看 | ✓ | ✓ |
| 停用（隐藏） | ✗ | ✓ |
| 重命名 | ✗ | ✓ |
| 删除 | ✗ | ✓ |
| 新增 | — | ✓ |

### 4.3 属性值（AttributeValue）操作

| 操作 | 系统预设值（is_preset=1） | 用户添加值（is_preset=0） |
|---|---|---|
| 在筛选面板显示 | 有照片时显示 | **始终显示** |
| 编辑（重命名） | ✓ | ✓ |
| 删除 | ✓ | ✓ |
| 关联图标（film类型） | ✓ | ✓ |

### 4.4 胶卷库（FilmLibrary）

胶卷属性（`film` 类型）有专属的管理界面：

- **展示**：图标 + 名称 + 关联照片数量
- **新增**：胶卷名称（必填）+ 胶卷规格（必填，固定选项）+ 胶卷图标（可选）
  - 规格选项：`135 / 35mm` · `120 中画幅` · `4×5 大画幅` · `8×10 大画幅`
  - 存储格式：`{名称} [{规格}]`，如 `Kodak Portra 400 [135 / 35mm]`
- **删除**：删除属性值，已关联照片的该属性同步清除

---

## 五、功能模块说明

### 5.1 图片库（照片网格主视图）

**显示模式**
- 三档缩略图尺寸：小（150px）· 中（210px）· 大（290px）
- 虚拟化滚动（@tanstack/react-virtual），支持数万张图片流畅渲染
- 每张卡片底部显示相机型号 / 胶片名称（尺寸小时自动截断）

**交互操作**
- **单击**：选中/取消选中照片
- **鼠标框选（rubber-band）**：在空白处按住左键拖拽，框选矩形内所有照片
- **双击**：打开全屏查看器
- **右键菜单**：在文件管理器中显示 · 复制路径 · 编辑属性和拍摄地点 · 顺时针旋转 90° · 移动到子库 · 从库中移除

**多选操作**
- 选中照片后，顶栏仅保留带选中数量徽标的建卷入口，其他批量操作从照片右键菜单进入
- 批量编辑：打开 BatchEditModal，可同时为所有选中照片设置任意属性，并设置、更换或清除拍摄地点

**筛选与排序**
- 左侧筛选面板：按各属性类别的值筛选，显示每个值的照片数量
- 子库列表每项显示该子库及全部后代子库的照片数量
- 顶栏搜索框：按文件名模糊搜索
- 日期范围筛选：按入库时间或拍摄日期筛选
- 排序：按入库时间（默认降序）/ 文件名（升序）

### 5.2 全屏查看器（PhotoViewer）

以 Ant Design Modal 展示，包含：

**左侧图像区域**
- 全预览图（普通格式直接渲染，RAW 格式通过 Sharp 解码为 JPEG）
- 鼠标滚轮缩放（0.5×—8×），拖拽平移（缩放 > 1 时）
- 左右箭头切换同批照片
- 标题栏按钮顺时针旋转 90°，旋转角度写入数据库并同步更新全屏预览与缩略图
- Esc / Modal × 关闭

**右侧信息面板（宽 288px）**
- **RGB 直方图**：对图片进行下采样（最大边 240px），Canvas 绘制 R/G/B 三通道叠加（screen 混合模式）
- **色彩配置**（仅 RAW）：切换 ICC 配置文件，实时重新解码预览
- **文件信息**：文件名 · 格式 · 分辨率 · 大小 · 拍摄日期（DatePicker 可编辑）· 入库时间
- **属性标签**：可直接修改相机 / 胶片 / 镜头等所有属性（支持 search-to-create）
- **备注**：只读显示（详细编辑在详情抽屉中）

### 5.3 照片详情抽屉（DetailDrawer）

从右侧滑入（宽 320px），包含：

- **缩略图预览**（最大高度 200px）
- **文件信息**：文件名 · 格式 · 尺寸 · 大小 · 入库时间 · 拍摄日期（DatePicker）
- **属性编辑**：所有激活属性类别的 Select 下拉，支持 search-to-create 新增值
  - 胶片属性特殊展示：点击打开 FilmIconPicker 图标选择弹窗
- **子库归属**：下拉选择，可迁移到任意子库
- **拍摄地点**：显示已关联地点列表，可添加（通过 LocationPicker 搜索）或移除
- **备注**：点击可编辑，支持多行文本
- **操作按钮**：在文件管理器中显示 · 重新生成缩略图 · 从库中移除（保留文件）· 删除文件（不可逆）

### 5.4 导入功能（ImportDialog）

**导入方式**
1. 点击按钮 → 系统文件夹选择对话框
2. 拖拽文件夹到对话框 → 暂存路径，等待用户确认属性后导入

**导入流程**
1. 选择/拖入文件夹
2. 配置属性（可选）：选择相机、胶片、子库等
3. 点击"导入"→ 递归扫描所有支持格式的文件，并直接复制到目标子库对应的本地目录
4. **EXIF 自动读取**：每个文件导入时通过 Sharp 提取 EXIF 缓冲区，并由 `exif-reader` 解析标准 IFD 标签
   - 若 EXIF 含 `DateTimeOriginal`（1970–2099 范围内），自动填充 `shot_date`
   - 读取 `Make` + `Model` 生成规范化相机名称，读取 `LensMake` + `LensModel` 生成规范化镜头名称
   - 相机和镜头优先匹配器材库已有值，支持规范化后的精确/包含匹配
   - 开启“自动收录新器材”时，未匹配型号自动写入相机库或镜头库并关联照片
   - RAW 主 EXIF 不可用时，回退读取内嵌 JPEG 预览的 EXIF
5. 实时进度条显示（已导入 / 跳过 / 总数）
6. 后台异步生成缩略图

**同名规则**：目标目录中已有同名文件时自动追加 `_1`、`_2` 等后缀，不覆盖现有文件。

**EXIF 优先级**：用户在导入对话框手动选择的相机、镜头和日期优先于 EXIF；批量属性写入仍在自动识别之后执行，确保手动选择为最终结果。

### 5.5 子库管理

- **树形结构**：左侧边栏与 `{libraryRoot}/files/` 真实目录树一致，支持无限层级
- **操作**：新建同步创建目录；重命名同步移动目录树；删除时直属照片移到根目录、直属子库提升到根级
- **照片计数**：每个子库显示照片数量（含子级）
- **过滤**：点击子库名显示该库及全部后代子库照片；点击叶子子库仍为精确筛选

### 5.6 地点地图（MapView）

基于 **Leaflet** 原生 API，使用 OpenStreetMap 底图：

- 显示所有已标记地点的位置标记
- 点击标记弹出信息框，显示地点名称和照片数量
- 支持通过 Nominatim API 实时搜索新地点
- 底图按 OSM.de → Esri World Street Map → 标准 OpenStreetMap 的顺序加载；单个来源连续报错或 25 秒无瓦片进展后自动切换
- 所有来源失败时显示错误状态和手动重试按钮，切换到备用源时显示当前来源

### 5.7 相机库（CameraLibrary）

基于通用 AttrLibraryModal，操作 `camera` 属性类别：

- 显示所有相机值、关联照片数量、删除按钮（含确认）
- 底部输入框直接新增相机名称
- 删除时照片中的相机属性同步清除

### 5.8 镜头库（LensLibrary）

同上，操作 `lens` 属性类别。

### 5.9 批量编辑照片信息（BatchEditModal）

单张或多选照片后，从右键菜单选择“编辑属性和地点”打开：

- 列出所有激活属性类别（含胶片图标选择器）
- 留空 = 不修改该属性；填写 = 覆盖所有选中照片的对应属性
- 拍摄地点提供“不修改 / 设置或更换 / 清除”三种模式；设置时优先检索本地预置地点
- 支持 search-to-create 内联新增属性值
- 属性调用 `photos.batchSetAttributes` 更新，地点调用 `locations.setForPhotos` 事务更新；操作完成后清除选中状态并刷新列表

### 5.10 批量照片操作

- 右键未选照片时仅选中该照片；右键已选照片时保留当前多选集合，菜单操作作用于全部已选照片
- 右键菜单提供单张/批量属性与拍摄地点编辑、顺时针旋转 90°、移动到子库和“从库中移除”；批量移除前显示确认对话框且保留本地文件
- 选中一张或多张照片后，顶栏只保留带选中数量徽标的建卷入口；其他批量操作统一从右键菜单进入
- 移动弹窗支持任意层级子库或“未分类（根目录）”，同时移动本地文件并更新绝对路径，随后刷新当前列表和子库计数
- 详情抽屉中的“所属子库”下拉继续支持单张照片移动

**属性管理 Tab**
- 左栏：属性类别列表（含系统属性标识 🔒），非系统属性可启用/停用/重命名/删除，底部可新增自定义类别
- 右栏：选中类别的所有可选值，可重命名/删除，胶片类型支持更换图标，底部可新增值

**色彩配置文件 Tab**
- 列出所有内置和用户导入的 ICC/ICM 文件
- 导入按钮：选择文件 → 复制到 `{userData}/profiles/` 并注册

---

## 六、IPC API 汇总

前端通过 `window.api.*` 调用以下 IPC 接口（Electron contextBridge 暴露）：

### 6.1 photos

| 方法 | 描述 |
|---|---|
| `photos.list(params)` | 分页查询，支持属性过滤、搜索、日期范围、排序 |
| `photos.get(id)` | 获取单张照片（含完整属性） |
| `photos.setAttributes(photoId, attrs)` | 替换照片全部属性 |
| `photos.batchSetAttributes(ids, attrs)` | 批量设置属性 |
| `photos.updateNotes(id, notes)` | 更新备注 |
| `photos.setShotDate(id, date)` | 设置拍摄日期 |
| `photos.batchSetShotDate(ids, date)` | 批量设置拍摄日期 |
| `photos.delete(ids, deleteFile)` | 删除照片（deleteFile=true 同时删除磁盘文件） |
| `photos.fullPreview(filePath, iccPath?, rotation?)` | 生成带持久化旋转角度的全屏预览 dataURL（含 RAW 解码） |
| `photos.thumbDataUrl(thumbPath)` | 获取缩略图 dataURL |
| `photos.moveToSubLibrary(ids, subLibId)` | 批量移动照片及本地文件，返回 `{ moved, unchanged, failed }` |
| `photos.setRotation(id, rotation)` | 设置单张照片旋转角度并重建缩略图 |
| `photos.batchRotate(ids, delta?)` | 批量顺时针旋转，默认 90° |

### 6.2 import

| 方法 | 描述 |
|---|---|
| `import.selectAndImport(subLibId?)` | 弹出文件夹选择对话框并导入 |
| `import.importPaths(paths, subLibId?)` | 导入指定路径列表 |
| 事件 `import:progress` | `{ imported, skipped, total? }` |
| 事件 `import:total` | 扫描到的总文件数 |

### 6.3 attrs

| 方法 | 描述 |
|---|---|
| `attrs.listAll()` | 获取所有激活类别（含值列表） |
| `attrs.listTypes()` | 获取所有类别（含非激活） |
| `attrs.listValues(typeId)` | 获取某类别所有值 |
| `attrs.valueCounts(filters)` | 获取每个值关联的照片数 |
| `attrs.addType(displayName)` | 新增属性类别 |
| `attrs.updateType(id, name)` | 重命名类别 |
| `attrs.toggleType(id, active)` | 启用/停用类别 |
| `attrs.deleteType(id)` | 删除类别（非系统） |
| `attrs.addValue(typeId, value, iconKey?)` | 新增属性值 |
| `attrs.updateValue(id, value, iconKey?)` | 修改属性值/图标 |
| `attrs.deleteValue(id)` | 删除属性值 |
| `attrs.reorder(ids)` | 调整类别显示顺序 |
| `attrs.filmIconDataUrl(key, size?)` | 获取胶卷图标 dataURL |
| `attrs.filmIconsBatch(keys, size?)` | 批量获取图标 dataURL |
| `attrs.importCustomIcon()` | 导入自定义胶卷图标 |

### 6.4 sublib

| 方法 | 描述 |
|---|---|
| `sublib.list()` | 获取子库树（含 children） |
| `sublib.create(name, parentId?)` | 新建子库 |
| `sublib.rename(id, name)` | 重命名 |
| `sublib.setDescription(id, desc)` | 设置描述 |
| `sublib.delete(id)` | 删除子库 |
| `sublib.counts()` | 获取各子库照片数 |

### 6.5 library

| 方法 | 描述 |
|---|---|
| `library.info()` | 获取库根路径等信息 |
| `library.revealFile(path)` | 在文件管理器中定位文件 |
| `library.regenThumb(id)` | 重新生成缩略图 |
| `library.listProfiles()` | 列出所有 ICC 配置文件 |
| `library.importProfile()` | 导入 ICC/ICM 文件 |
| `library.stats()` | 库统计信息 |

### 6.6 locations

| 方法 | 描述 |
|---|---|
| `locations.list()` | 获取所有地点（含照片数） |
| `locations.add(name, address, lat, lng)` | 新增地点 |
| `locations.delete(id)` | 删除地点 |
| `locations.update(id, name, address)` | 修改地点 |
| `locations.forPhoto(photoId)` | 获取照片关联的地点 |
| `locations.setForPhotos(photoIds, locationId)` | 批量覆盖拍摄地点；`locationId = null` 时清除 |
| `locations.addToPhoto(photoId, locationId)` | 关联地点 |
| `locations.removeFromPhoto(photoId, locationId)` | 取消关联 |
| `locations.search(query)` | OpenStreetMap 实时搜索 |
| `locations.mapData()` | 获取地图展示数据 |

### 6.7 app

| 方法 | 描述 |
|---|---|
| `app.setLibraryRoot(root)` | 设置库根目录 |
| `app.getLibraryRoot()` | 获取当前库根目录 |
| `app.getInitError()` | 获取主进程初始化错误信息 |

---

## 七、数据存储位置

| 数据类型 | 存储路径 |
|---|---|
| 数据库文件 | `{libraryRoot}/film.db` |
| 原始照片 | `{libraryRoot}/files/{子库}/{子子库}/文件名`；未分类照片位于 `files/` 根目录 |
| 缩略图 | `{libraryRoot}/thumbs/` |
| 内置 ICC 配置文件 | `{appPath}/resources/profiles/` |
| 用户 ICC 配置文件 | `{userData}/profiles/` |
| 内置胶卷图标 | `{appPath}/resources/film-icons/` |
| 用户自定义胶卷图标 | `{userData}/film-icons/` |
| 应用日志 | `{userData}/logs/` （electron-log） |

`libraryRoot` 默认为系统图片目录下的 `FilmManager`，用户可通过 `app.setLibraryRoot()` 修改。

---

## 八、数据迁移策略

数据库采用**增量迁移**方式，保证旧版本数据库可直接升级：

| 迁移版本 | 变更内容 |
|---|---|
| 初始版本 | 创建 sub_libraries, photos, attribute_types, attribute_values, photo_attributes, color_profiles 表及索引 |
| 迁移 1 | `ALTER TABLE attribute_values ADD COLUMN icon_key TEXT`（胶卷图标支持） |
| 迁移 2 | `ALTER TABLE photos ADD COLUMN shot_date TEXT`（拍摄日期支持） |
| 迁移 3 | 创建 locations, photo_locations 表及索引（地点功能） |
| 迁移 4 | `ALTER TABLE photos ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0`（持久化旋转） |
| 迁移 5 | 创建 attribute_value_aliases 表及索引（属性别名） |
| 迁移 6 | 创建 rolls, photo_rolls 表及索引（胶卷卷） |
| 迁移 7 | `ALTER TABLE sub_libraries ADD COLUMN folder_name TEXT`，并把旧版扁平文件迁移到真实子库目录树 |

迁移均使用 `try { ALTER TABLE ... } catch {}` 忽略已存在列的错误，保证幂等性。

---

## 九、版本历史

| 版本 | 主要变更 |
|---|---|
| 1.0.0 | 初始版本：照片导入、属性标注、子库、全屏预览 |
| 1.0.1 | 布局优化，installer 更新 |
| 1.0.2 | 缩略图尺寸优化、拖拽导入优化、全屏查看器（直方图+缩放+平移+框选）、右键上下文菜单 |
| 1.0.3 | 查看器可靠关闭（Modal）、中文属性 search-to-create、查看器属性编辑侧栏、胶卷库管理页 |
| 1.0.4 | 相机库/镜头库 AttrLibraryModal（补充实现） |
| **1.1.0** | **EXIF 自动读取**（拍摄日期 + 相机型号匹配）· **子库照片数统计**显示于筛选面板 · **批量属性编辑** BatchEditModal · **相机库 + 镜头库**独立管理界面 |
| 1.1.1 | 三档视图布局优化、自适应列数、合并自定义标题栏与工具栏 |
| 1.1.2 | 所有 Modal 去除遮罩（mask=false），允许对话框打开时继续操作主窗口 |
| **1.1.3** | **胶卷卷功能**：选照片建卷（rolls 表）、自动/手动命名、卷视图（RollsView）与照片视图切换、未分卷"其他图片"汇总；新增 `rolls` / `photo_rolls` 表与 rolls IPC 模块 |
| **1.1.4** | **增强导入**：ImportDialog 新增"按子文件夹识别为卷"切换；启用后调用 `import:scanFolders` 枚举子目录并模糊匹配属性，逐行确认表格可编辑卷名/属性/地点/日期，确认后调用 `import:importRolls` 批量导入并自动建卷 |
| **1.1.5** | **智能文件夹解析**：父子层级属性推断（父文件夹=相机或胶卷，子文件夹补充另一属性，双向兼容）；复合命名正则解析（`YYYYMMDD` / `YYYY-MM-DD` / `YYMM` 等 6 种日期格式自动提取为拍摄日期）；确认界面每个属性旁显示来源标注（↑父 / ↓子），便于用户核查 |
| **1.1.6** | 目录名识别忽略大小写和常见分隔符 |
| **1.1.7** | 胶片、相机和镜头别名，文件夹与 EXIF 别名匹配，JSON 批量导入 |
| **1.1.8** | **本地树状整理**：子库对应真实目录；已有图库自动迁移，导入、照片移动、子库重命名和删除均同步磁盘文件 |

## 十、功能扩展建议（已实现）

以下原扩展建议已在 1.1.0 中全部落地：

- ✅ **批量属性编辑**：多选 → 批量编辑按钮 → BatchEditModal
- ✅ **子库照片统计**：FilterPanel 子库树每项显示照片数量
- ✅ **相机库 / 镜头库独立管理页**：TopBar 新增 CameraOutlined / AimOutlined 按钮
- ✅ **EXIF 自动读取**：导入时自动填充 shot_date 和相机属性

**待实现建议**

- 导出功能：基于现有查询能力，可导出带元数据的 CSV 或 JSON
- 标签云视图：基于 `valueCounts` 数据，按胶卷/相机型号汇聚展示

## 十一、v1.1.3 新增功能：胶卷卷（Rolls）

### 数据库

新增两张表：

```sql
CREATE TABLE rolls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
  cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE photo_rolls (
  photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  roll_id  INTEGER NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
  PRIMARY KEY (photo_id, roll_id)
);
```

### IPC API（`src/main/ipc/rolls.ts`）

| 频道 | 参数 | 说明 |
|------|------|------|
| `rolls:list` | `subLibraryId?` | 列出所有卷，返回 `{ rolls, photolessCount }` |
| `rolls:create` | `{ photoIds, name?, subLibraryId? }` | 建卷；留空 name 则自动命名 |
| `rolls:rename` | `id, name` | 重命名卷 |
| `rolls:delete` | `id` | 删除卷（照片不受影响） |
| `rolls:photos` | `rollId, params` | 分页查询卷内照片 |
| `rolls:forPhoto` | `photoId` | 查询照片所属卷 |
| `rolls:removePhotos` | `rollId, photoIds` | 从卷中移除照片 |
| `rolls:addPhotos` | `rollId, photoIds` | 向卷中添加照片 |
| `rolls:setCover` | `rollId, photoId` | 设置封面照片 |

### 前端组件

- **`RollsView`**：网格卡片展示所有卷，每卡显示封面缩略图、卷名、胶片类型/格式/地点、照片数，支持重命名和删除
- **`CreateRollModal`**：输入卷名（可留空）后对所选照片建卷
- **TopBar 视图切换**：`BlockOutlined` / `AppstoreOutlined` Segmented 控件切换卷视图与照片视图
- **卷内照片视图**：点击卷卡片后切换到照片视图并限定在该卷范围，顶部面包屑显示当前卷名，`RollbackOutlined` 按钮返回卷视图
- 多库支持：`app.setLibraryRoot()` 已预留接口，可扩展为多个库文件切换

基于现有数据结构，以下功能可较低成本实现：

1. **批量属性编辑**：已有 `batchSetAttributes` IPC，可在多选状态下新增批量编辑入口
2. **子库照片统计**：`sublib.counts()` 已实现，可在左栏显示每个子库的照片数量
3. **导出功能**：基于现有查询能力，可导出带元数据的 CSV 或 JSON
4. **相机库 / 镜头库独立管理页**：与胶卷库（FilmLibraryModal）同等模式，基于 `camera` / `lens` 属性类别
5. **EXIF 自动读取**：导入时通过 Sharp 读取 EXIF，自动填充拍摄时间 / 相机型号等字段
6. **标签云视图**：基于 `valueCounts` 数据，按胶卷/相机型号汇聚展示
7. **多库支持**：`app.setLibraryRoot()` 已预留接口，可扩展为多个库文件切换

---

## 十二、v1.1.4 新增功能：子文件夹批量导入为卷

### 功能概述

ImportDialog 新增"按子文件夹识别为卷"切换开关（`rollModeEnabled`）。

- **关闭（默认）**：保持原有单批次导入流程，拖拽或选择文件夹后统一配置属性并导入。
- **开启**：触发多步骤扫描 → 确认 → 导入流程，每个子文件夹对应一个候选卷。

### 导入步骤（roll 模式）

1. **扫描（scan）**：点击"选择根目录并扫描"按钮 → 调用 `import:scanFolders`
   - 弹出系统文件夹选择对话框，选择包含子文件夹的根目录
   - 后端枚举所有直接子目录，递归统计每目录内支持格式的文件数量
   - 对每个子文件夹名称调用 `matchFolderName()` 进行模糊匹配（normalize + includes，按值长度降序，每类型取最长匹配）
   - 返回 `{ rootPath, folders: FolderScanResult[], rootFileCount }`

2. **确认（confirm）**：每个扫描到的子文件夹显示为一行可编辑配置：
   - **卷名**：预填为文件夹名，可修改
   - **胶片**：自动填入匹配到的 film 属性值，点击打开 FilmIconPicker
   - **其他属性**（film_format / camera / lens）：各自 Select，自动预选匹配值
   - **拍摄地点**：从已有地点列表中选择
   - **拍摄日期**：DatePicker
   - **建卷**：Switch（默认开），关闭则只导入照片不创建卷记录
   - 文件数量显示为只读提示

3. **导入（importing）**：调用 `import:importRolls(configs: RollImportConfig[])`
   - 后端按顺序处理每个文件夹：`importFile` 逐个复制并写 DB、批量写属性/地点/日期、创建 roll 记录 + photo_rolls
   - 实时发送 `import:progress` 事件，前端展示总进度条

4. **完成（done）**：展示每卷导入/跳过数量汇总列表

### 新增 IPC

| 频道 | 参数 | 说明 |
|------|------|------|
| `import:scanFolders` | — | 弹出目录选择对话框，扫描并返回子文件夹列表与属性匹配结果 |
| `import:importRolls` | `configs: RollImportConfig[]` | 按配置批量导入，返回 `{ results, totalImported, totalSkipped }` |

### 模糊匹配算法

```typescript
function matchFolderName(folderName, allValues): AttrMatch[] {
  // 1. 按值字符串长度降序排列（优先匹配更具体的值）
  // 2. 对每种属性类型只取第一个匹配（seenTypes Set）
  // 3. normalize = 去空格 + 小写
  // 4. 匹配条件：folderNorm.includes(valueNorm) || valueNorm.includes(folderNorm)
}
```

匹配的属性类型：`film`、`film_format`、`camera`、`lens`
