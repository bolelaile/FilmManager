import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'

let db: Database.Database

export function getDb(): Database.Database {
  return db
}

export function initDb(libraryRoot: string): void {
  const dbPath = path.join(libraryRoot, 'film.db')
  fs.mkdirSync(libraryRoot, { recursive: true })
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations()
  log.info('Database initialized at', dbPath)
}

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sub_libraries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      parent_id   INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
      folder_name TEXT,
      sort_order  INTEGER DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS photos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path     TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      file_type     TEXT NOT NULL,
      thumb_path    TEXT,
      thumb_ready   INTEGER DEFAULT 0,
      width         INTEGER,
      height        INTEGER,
      file_size     INTEGER,
      sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
      imported_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      rotation      INTEGER NOT NULL DEFAULT 0,
      notes         TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS attribute_types (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      key          TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      is_system    INTEGER DEFAULT 0,
      is_active    INTEGER DEFAULT 1,
      sort_order   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attribute_values (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      attribute_type_id INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
      value             TEXT NOT NULL,
      icon_key          TEXT,
      is_preset         INTEGER DEFAULT 0,
      UNIQUE(attribute_type_id, value)
    );

    CREATE TABLE IF NOT EXISTS photo_attributes (
      photo_id           INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      attribute_type_id  INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
      attribute_value_id INTEGER NOT NULL REFERENCES attribute_values(id) ON DELETE CASCADE,
      PRIMARY KEY (photo_id, attribute_type_id, attribute_value_id)
    );

    CREATE TABLE IF NOT EXISTS color_profiles (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      is_preset INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_photos_sub_library ON photos(sub_library_id);
    CREATE INDEX IF NOT EXISTS idx_photos_imported_at ON photos(imported_at);
    CREATE INDEX IF NOT EXISTS idx_photo_attrs_photo ON photo_attributes(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_attrs_type_val ON photo_attributes(attribute_type_id, attribute_value_id);
  `)

  // 迁移：为已有数据库添加 icon_key 列
  try { db.exec(`ALTER TABLE attribute_values ADD COLUMN icon_key TEXT`) } catch {}

  // 迁移：shot_date 字段（拍摄日期，可选，默认 NULL 表示用 imported_at）
  try { db.exec(`ALTER TABLE photos ADD COLUMN shot_date TEXT`) } catch {}

  // 迁移：用户手动旋转角度（顺时针 0 / 90 / 180 / 270）
  try { db.exec(`ALTER TABLE photos ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0`) } catch {}

  // 迁移：子库对应的本地物理目录名
  try { db.exec(`ALTER TABLE sub_libraries ADD COLUMN folder_name TEXT`) } catch {}

  // 迁移：地点功能
  db.exec(`
    CREATE TABLE IF NOT EXISTS locations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      address     TEXT DEFAULT '',
      lat         REAL NOT NULL,
      lng         REAL NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS photo_locations (
      photo_id    INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      location_id INTEGER NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
      PRIMARY KEY (photo_id, location_id)
    );
    CREATE INDEX IF NOT EXISTS idx_photo_locations_photo ON photo_locations(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_locations_loc   ON photo_locations(location_id);
  `)

  // 迁移：属性值别名表
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS attribute_value_aliases (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        value_id   INTEGER NOT NULL REFERENCES attribute_values(id) ON DELETE CASCADE,
        alias      TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(value_id, alias)
      );
      CREATE INDEX IF NOT EXISTS idx_aliases_value_id ON attribute_value_aliases(value_id);
    `)
  } catch {}

  // 迁移：胶卷卷功能
  db.exec(`
    CREATE TABLE IF NOT EXISTS rolls (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
      cover_photo_id INTEGER REFERENCES photos(id) ON DELETE SET NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS photo_rolls (
      photo_id INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      roll_id  INTEGER NOT NULL REFERENCES rolls(id) ON DELETE CASCADE,
      PRIMARY KEY (photo_id, roll_id)
    );
    CREATE INDEX IF NOT EXISTS idx_photo_rolls_photo ON photo_rolls(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_rolls_roll  ON photo_rolls(roll_id);
  `)

  // 迁移：original_name 搜索索引（加速文件名 LIKE 查询）
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_original_name ON photos(original_name)`) } catch {}

  // 迁移：content_hash 列（内容指纹，用于重复文件检测）
  try { db.exec(`ALTER TABLE photos ADD COLUMN content_hash TEXT`) } catch {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_photos_content_hash ON photos(content_hash)`) } catch {}

  seedDefaultData()
  try {
    seedChinaLocations()
  } catch (err) {
    log.error('seedChinaLocations failed (non-fatal):', err)
  }
}

// 胶片图标 manifest 映射：iconKey -> displayName
// 反向用：displayName -> iconKey（用于 seed 时匹配）
function buildIconIndex(): Map<string, string> {
  try {
    const manifestPath = path.join(app.getAppPath(), 'resources', 'film-icons', 'manifest.json')
    if (!fs.existsSync(manifestPath)) return new Map()
    const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    // manifest: iconKey -> displayName，构建 normalized(displayName) -> iconKey
    const index = new Map<string, string>()
    for (const [key, name] of Object.entries(manifest)) {
      index.set(normalizeName(name), key)
    }
    return index
  } catch {
    return new Map()
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9一-鿿]/g, '')
}

function seedDefaultData(): void {
  const typeCount = db.prepare('SELECT COUNT(*) as c FROM attribute_types').get() as { c: number }
  if (typeCount.c > 0) return

  const iconIndex = buildIconIndex()

  // 内置属性类型
  const insertType = db.prepare(
    'INSERT OR IGNORE INTO attribute_types (key, display_name, is_system, is_active, sort_order) VALUES (?, ?, ?, 1, ?)'
  )
  insertType.run('camera', '相机', 1, 0)
  insertType.run('film', '胶片', 1, 1)
  insertType.run('imported_at', '入库时间', 1, 2)
  insertType.run('lens', '镜头型号', 0, 3)
  insertType.run('dev_method', '冲扫方式', 0, 4)
  insertType.run('dev_lab', '冲扫商家', 0, 5)
  insertType.run('film_format', '胶片格式', 0, 6)

  const cameraType = db.prepare("SELECT id FROM attribute_types WHERE key='camera'").get() as { id: number }
  const filmType = db.prepare("SELECT id FROM attribute_types WHERE key='film'").get() as { id: number }
  const lensType = db.prepare("SELECT id FROM attribute_types WHERE key='lens'").get() as { id: number }
  const devMethodType = db.prepare("SELECT id FROM attribute_types WHERE key='dev_method'").get() as { id: number }
  const filmFormatType = db.prepare("SELECT id FROM attribute_types WHERE key='film_format'").get() as { id: number }

  const insertVal = db.prepare(
    'INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset) VALUES (?, ?, ?, 1)'
  )

  const cameras = [
    'Nikon F3', 'Nikon FM2', 'Nikon F100', 'Nikon FE2',
    'Canon AE-1', 'Canon F-1', 'Canon EOS-1V',
    'Leica M6', 'Leica M7', 'Leica M3', 'Leica M2',
    'Pentax 67', 'Pentax 6x7', 'Pentax K1000',
    'Mamiya RZ67', 'Mamiya RB67', 'Mamiya 7II',
    'Hasselblad 500C/M', 'Hasselblad 503CW',
    'Contax G2', 'Contax T2', 'Contax RX',
    'Olympus OM-1', 'Olympus OM-4T',
    'Minolta X-700', 'Minolta CLE',
    'Rollei 35', 'Rolleiflex 2.8F',
    'Yashica Mat-124G', 'Bronica SQ-A'
  ]
  cameras.forEach(v => insertVal.run(cameraType.id, v, null))

  // 胶片值：直接使用 manifest 中的所有胶片名称（含图标key），加上原有预设
  const manifestPath = path.join(app.getAppPath(), 'resources', 'film-icons', 'manifest.json')
  let filmNames: { name: string; iconKey: string }[] = []
  if (fs.existsSync(manifestPath)) {
    const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    filmNames = Object.entries(manifest).map(([key, name]) => ({ name, iconKey: key }))
  } else {
    // 回退预设
    const fallback = [
      'Kodak Portra 400', 'Kodak Portra 160', 'Kodak Portra 800',
      'Kodak Gold 200', 'Kodak UltraMax 400', 'Kodak Ektar 100',
      'Kodak Tri-X 400', 'Kodak T-MAX 100', 'Kodak T-MAX 400',
      'Fujifilm Superia 400', 'Fujifilm Velvia 50', 'Fujifilm Provia 100F',
      'Ilford HP5 Plus', 'Ilford FP4 Plus', 'Ilford Delta 100',
      'Cinestill 800T', 'Cinestill 400D',
    ]
    filmNames = fallback.map(name => ({ name, iconKey: iconIndex.get(normalizeName(name)) ?? '' }))
  }
  filmNames.forEach(({ name, iconKey }) => insertVal.run(filmType.id, name, iconKey || null))

  const lenses = [
    'Nikkor 50mm f/1.4', 'Nikkor 50mm f/1.8', 'Nikkor 35mm f/2',
    'Canon 50mm f/1.4', 'Canon 28mm f/2.8',
    'Leica Summicron 50mm f/2', 'Leica Summilux 35mm f/1.4', 'Leica Elmarit 28mm f/2.8',
    'Zeiss Planar 50mm f/0.7', 'Zeiss Distagon 35mm f/1.4',
    'Voigtlander Nokton 40mm f/1.4', 'Voigtlander Color-Skopar 35mm f/2.5'
  ]
  lenses.forEach(v => insertVal.run(lensType.id, v, null))

  ;['自冲自扫', '送冲送扫', '自冲送扫', '送冲自扫'].forEach(v =>
    insertVal.run(devMethodType.id, v, null)
  )

  ;['135 / 35mm', '120 中画幅', '4x5 大画幅', '8x10 大画幅'].forEach(v =>
    insertVal.run(filmFormatType.id, v, null)
  )

  log.info('Default data seeded with', filmNames.length, 'film presets')
}

function seedChinaLocations(): void {
  const findByName = db.prepare('SELECT id FROM locations WHERE name = ? LIMIT 1')
  const ins = db.prepare('INSERT INTO locations (name, address, lat, lng) VALUES (?, ?, ?, ?)')
  const findDuplicates = db.prepare('SELECT id, lat, lng FROM locations WHERE name = ? ORDER BY id')
  const relinkPhotos = db.prepare(`
    INSERT OR IGNORE INTO photo_locations (photo_id, location_id)
    SELECT photo_id, ? FROM photo_locations WHERE location_id = ?
  `)
  const deleteLocation = db.prepare('DELETE FROM locations WHERE id = ?')
  const renameLegacyLocation = db.prepare(`
    UPDATE locations SET name = ?
    WHERE name = ? AND address = ? AND lat = ? AND lng = ?
  `)
  const updateLegacyCoordinates = db.prepare(`
    UPDATE locations SET lat = ?, lng = ?
    WHERE name = ? AND address = ? AND lat = ? AND lng = ?
  `)

  // 直辖市
  const municipalities = [
    ['北京', '北京市', 39.9042, 116.4074],
    ['上海', '上海市', 31.2304, 121.4737],
    ['天津', '天津市', 39.3434, 117.3616],
    ['重庆', '重庆市', 29.5630, 106.5516],
  ]

  // 省会 / 自治区首府 / 特别行政区
  const capitals = [
    ['石家庄', '河北省', 38.0428, 114.5149],
    ['太原', '山西省', 37.8706, 112.5489],
    ['呼和浩特', '内蒙古自治区', 40.8414, 111.7519],
    ['沈阳', '辽宁省', 41.8057, 123.4315],
    ['长春', '吉林省', 43.8171, 125.3235],
    ['哈尔滨', '黑龙江省', 45.8038, 126.5350],
    ['南京', '江苏省', 32.0603, 118.7969],
    ['杭州', '浙江省', 30.2741, 120.1551],
    ['合肥', '安徽省', 31.8206, 117.2272],
    ['福州', '福建省', 26.0745, 119.2965],
    ['南昌', '江西省', 28.6820, 115.8579],
    ['济南', '山东省', 36.6512, 117.1201],
    ['郑州', '河南省', 34.7466, 113.6254],
    ['武汉', '湖北省', 30.5928, 114.3055],
    ['长沙', '湖南省', 28.2282, 112.9388],
    ['广州', '广东省', 23.1291, 113.2644],
    ['南宁', '广西壮族自治区', 22.8170, 108.3665],
    ['海口', '海南省', 20.0444, 110.1999],
    ['成都', '四川省', 30.5728, 104.0668],
    ['贵阳', '贵州省', 26.6470, 106.6302],
    ['昆明', '云南省', 25.0453, 102.7097],
    ['拉萨', '西藏自治区', 29.6500, 91.1000],
    ['西安', '陕西省', 34.3416, 108.9398],
    ['兰州', '甘肃省', 36.0611, 103.8343],
    ['西宁', '青海省', 36.6171, 101.7782],
    ['银川', '宁夏回族自治区', 38.4872, 106.2309],
    ['乌鲁木齐', '新疆维吾尔自治区', 43.8256, 87.6168],
    ['香港', '香港特别行政区', 22.3193, 114.1694],
    ['澳门', '澳门特别行政区', 22.1987, 113.5439],
    ['台北', '台湾省', 25.0330, 121.5654],
  ]

  // 主要副省级城市 / 计划单列市 / 热门旅游城市
  const majorCities = [
    ['深圳', '广东省深圳市', 22.5431, 114.0579],
    ['苏州', '江苏省苏州市', 31.2989, 120.5853],
    ['宁波', '浙江省宁波市', 29.8683, 121.5440],
    ['青岛', '山东省青岛市', 36.0671, 120.3826],
    ['大连', '辽宁省大连市', 38.9140, 121.6147],
    ['厦门', '福建省厦门市', 24.4798, 118.0894],
    ['无锡', '江苏省无锡市', 31.4912, 120.3119],
    ['佛山', '广东省佛山市', 23.0218, 113.1219],
    ['东莞', '广东省东莞市', 23.0207, 113.7518],
    ['温州', '浙江省温州市', 28.0000, 120.6720],
    ['泉州', '福建省泉州市', 24.8741, 118.6757],
    ['济宁', '山东省济宁市', 35.4154, 116.5871],
    ['南通', '江苏省南通市', 31.9793, 120.8946],
    ['昆山', '江苏省昆山市', 31.3850, 120.9800],
    ['洛阳', '河南省洛阳市', 34.6197, 112.4540],
    ['烟台', '山东省烟台市', 37.4638, 121.4479],
    ['常州', '江苏省常州市', 31.7717, 119.9736],
    ['徐州', '江苏省徐州市', 34.2044, 117.2851],
    ['扬州', '江苏省扬州市', 32.3939, 119.4139],
    ['绍兴', '浙江省绍兴市', 30.0297, 120.5800],
    ['金华', '浙江省金华市', 29.0785, 119.6470],
    ['汕头', '广东省汕头市', 23.3535, 116.6820],
    ['桂林', '广西壮族自治区桂林市', 25.2736, 110.2990],
    ['三亚', '海南省三亚市', 18.2528, 109.5119],
    ['丽江', '云南省丽江市', 26.8721, 100.2334],
    ['大理', '云南省大理市', 25.6065, 100.2679],
    ['西双版纳', '云南省西双版纳傣族自治州', 22.0170, 100.7984],
    ['张家界', '湖南省张家界市', 29.1166, 110.4792],
    ['九寨沟', '四川省阿坝藏族羌族自治州', 33.2600, 103.9170],
    ['黄山', '安徽省黄山市', 29.7149, 118.3378],
    ['武夷山', '福建省南平市武夷山市', 27.7565, 118.0350],
    ['峨眉山', '四川省乐山市峨眉山市', 29.5997, 103.4849],
    ['泰山', '山东省泰安市', 36.2569, 117.1010],
    ['华山', '陕西省渭南市华阴市', 34.4866, 110.0856],
    ['庐山', '江西省九江市', 29.5588, 115.9895],
    ['阳朔', '广西壮族自治区桂林市阳朔县', 24.7783, 110.4960],
    ['凤凰古城', '湖南省湘西土家族苗族自治州凤凰县', 27.9443, 109.5986],
    ['西塘', '浙江省嘉兴市西塘镇', 30.9517, 120.8840],
    ['乌镇', '浙江省嘉兴市乌镇镇', 30.7430, 120.4890],
    ['周庄', '江苏省苏州市昆山市周庄镇', 31.1117, 120.8567],
    ['平遥古城', '山西省晋中市平遥县', 37.1944, 112.1756],
    ['宏村', '安徽省黄山市黟县宏村镇', 29.8960, 118.0820],
    ['稻城亚丁', '四川省甘孜藏族自治州稻城县', 28.0200, 100.2980],
    ['色达', '四川省甘孜藏族自治州色达县', 32.2687, 100.3327],
    ['喀纳斯', '新疆维吾尔自治区阿勒泰地区布尔津县', 48.9958, 87.0975],
    ['敦煌', '甘肃省酒泉市敦煌市', 40.1425, 94.6614],
    ['张掖', '甘肃省张掖市', 38.9200, 100.4500],
    ['嘉峪关', '甘肃省嘉峪关市', 39.7824, 98.2893],
    ['青海湖', '青海省海南藏族自治州共和县', 36.9500, 100.3000],
  ]

  // 直辖市下属主要区
  const districts = [
    // 北京
    ['朝阳区', '北京市朝阳区', 39.9219, 116.4551],
    ['海淀区', '北京市海淀区', 39.9609, 116.2977],
    ['东城区', '北京市东城区', 39.9284, 116.4173],
    ['西城区', '北京市西城区', 39.9116, 116.3638],
    ['丰台区', '北京市丰台区', 39.8585, 116.2874],
    ['石景山区', '北京市石景山区', 39.9143, 116.2229],
    ['通州区', '北京市通州区', 39.9090, 116.6573],
    ['顺义区', '北京市顺义区', 40.1302, 116.6544],
    ['昌平区', '北京市昌平区', 40.2206, 116.2317],
    ['大兴区', '北京市大兴区', 39.7267, 116.3398],
    // 上海
    ['浦东新区', '上海市浦东新区', 31.2231, 121.5444],
    ['黄浦区', '上海市黄浦区', 31.2282, 121.4846],
    ['徐汇区', '上海市徐汇区', 31.1884, 121.4362],
    ['静安区', '上海市静安区', 31.2288, 121.4474],
    ['虹口区', '上海市虹口区', 31.2646, 121.5052],
    ['长宁区', '上海市长宁区', 31.2204, 121.4244],
    ['杨浦区', '上海市杨浦区', 31.2597, 121.5255],
    ['闵行区', '上海市闵行区', 31.1126, 121.3810],
    ['宝山区', '上海市宝山区', 31.4038, 121.4897],
    ['松江区', '上海市松江区', 31.0323, 121.2278],
  ]

  // 各省主要地级市、自治州和摄影旅行常用落脚点
  const regionalCities = [
    // 河北 / 山西 / 内蒙古
    ['唐山', '河北省唐山市', 39.6305, 118.1802],
    ['秦皇岛', '河北省秦皇岛市', 39.9354, 119.5996],
    ['保定', '河北省保定市', 38.8739, 115.4646],
    ['承德', '河北省承德市', 40.9515, 117.9634],
    ['张家口', '河北省张家口市', 40.7676, 114.8863],
    ['邯郸', '河北省邯郸市', 36.6256, 114.5391],
    ['廊坊', '河北省廊坊市', 39.5380, 116.6838],
    ['沧州', '河北省沧州市', 38.3044, 116.8388],
    ['大同', '山西省大同市', 40.0768, 113.3001],
    ['晋中', '山西省晋中市', 37.6870, 112.7527],
    ['临汾', '山西省临汾市', 36.0880, 111.5190],
    ['运城', '山西省运城市', 35.0263, 111.0073],
    ['包头', '内蒙古自治区包头市', 40.6574, 109.8403],
    ['鄂尔多斯', '内蒙古自治区鄂尔多斯市', 39.6086, 109.7813],
    ['呼伦贝尔', '内蒙古自治区呼伦贝尔市', 49.2116, 119.7657],
    ['赤峰', '内蒙古自治区赤峰市', 42.2578, 118.8889],
    ['阿拉善', '内蒙古自治区阿拉善盟', 38.8515, 105.7289],

    // 东北
    ['鞍山', '辽宁省鞍山市', 41.1087, 122.9946],
    ['丹东', '辽宁省丹东市', 40.0008, 124.3547],
    ['锦州', '辽宁省锦州市', 41.0951, 121.1270],
    ['抚顺', '辽宁省抚顺市', 41.8809, 123.9572],
    ['本溪', '辽宁省本溪市', 41.4868, 123.6851],
    ['盘锦', '辽宁省盘锦市', 41.1199, 122.0708],
    ['吉林', '吉林省吉林市', 43.8378, 126.5494],
    ['延边', '吉林省延边朝鲜族自治州', 42.9094, 129.5089],
    ['通化', '吉林省通化市', 41.7283, 125.9397],
    ['齐齐哈尔', '黑龙江省齐齐哈尔市', 47.3543, 123.9182],
    ['大庆', '黑龙江省大庆市', 46.5893, 125.1038],
    ['牡丹江', '黑龙江省牡丹江市', 44.5527, 129.6324],
    ['佳木斯', '黑龙江省佳木斯市', 46.8000, 130.3189],
    ['黑河', '黑龙江省黑河市', 50.2451, 127.5286],
    ['漠河', '黑龙江省大兴安岭地区漠河市', 52.9721, 122.5386],

    // 华东
    ['连云港', '江苏省连云港市', 34.5967, 119.2216],
    ['镇江', '江苏省镇江市', 32.1878, 119.4250],
    ['泰州', '江苏省泰州市', 32.4559, 119.9231],
    ['盐城', '江苏省盐城市', 33.3474, 120.1635],
    ['淮安', '江苏省淮安市', 33.6104, 119.0153],
    ['嘉兴', '浙江省嘉兴市', 30.7461, 120.7555],
    ['湖州', '浙江省湖州市', 30.8927, 120.0881],
    ['台州', '浙江省台州市', 28.6564, 121.4208],
    ['衢州', '浙江省衢州市', 28.9701, 118.8594],
    ['舟山', '浙江省舟山市', 29.9853, 122.2072],
    ['丽水', '浙江省丽水市', 28.4676, 119.9229],
    ['芜湖', '安徽省芜湖市', 31.3525, 118.4331],
    ['蚌埠', '安徽省蚌埠市', 32.9163, 117.3897],
    ['安庆', '安徽省安庆市', 30.5319, 117.1151],
    ['池州', '安徽省池州市', 30.6648, 117.4916],
    ['宣城', '安徽省宣城市', 30.9407, 118.7588],
    ['莆田', '福建省莆田市', 25.4541, 119.0077],
    ['漳州', '福建省漳州市', 24.5130, 117.6471],
    ['龙岩', '福建省龙岩市', 25.0751, 117.0173],
    ['宁德', '福建省宁德市', 26.6656, 119.5479],
    ['赣州', '江西省赣州市', 25.8311, 114.9350],
    ['景德镇', '江西省景德镇市', 29.2687, 117.1784],
    ['上饶', '江西省上饶市', 28.4549, 117.9436],
    ['九江', '江西省九江市', 29.7051, 116.0019],
    ['宜春', '江西省宜春市', 27.8144, 114.4168],
    ['威海', '山东省威海市', 37.5131, 122.1204],
    ['日照', '山东省日照市', 35.4164, 119.5269],
    ['淄博', '山东省淄博市', 36.8131, 118.0548],
    ['潍坊', '山东省潍坊市', 36.7069, 119.1618],
    ['临沂', '山东省临沂市', 35.1047, 118.3564],
    ['东营', '山东省东营市', 37.4346, 118.6747],
    ['泰安', '山东省泰安市', 36.2000, 117.0876],
    ['曲阜', '山东省济宁市曲阜市', 35.5811, 116.9865],

    // 中部
    ['开封', '河南省开封市', 34.7973, 114.3076],
    ['安阳', '河南省安阳市', 36.0976, 114.3924],
    ['南阳', '河南省南阳市', 32.9908, 112.5283],
    ['信阳', '河南省信阳市', 32.1471, 114.0928],
    ['焦作', '河南省焦作市', 35.2159, 113.2418],
    ['宜昌', '湖北省宜昌市', 30.6919, 111.2865],
    ['襄阳', '湖北省襄阳市', 32.0090, 112.1224],
    ['恩施', '湖北省恩施土家族苗族自治州', 30.2722, 109.4882],
    ['十堰', '湖北省十堰市', 32.6292, 110.7980],
    ['荆州', '湖北省荆州市', 30.3348, 112.2407],
    ['岳阳', '湖南省岳阳市', 29.3571, 113.1292],
    ['衡阳', '湖南省衡阳市', 26.8942, 112.5719],
    ['郴州', '湖南省郴州市', 25.7705, 113.0147],
    ['湘西', '湖南省湘西土家族苗族自治州', 28.3119, 109.7389],
    ['常德', '湖南省常德市', 29.0317, 111.6985],

    // 华南
    ['珠海', '广东省珠海市', 22.2710, 113.5767],
    ['惠州', '广东省惠州市', 23.1115, 114.4152],
    ['中山', '广东省中山市', 22.5176, 113.3926],
    ['江门', '广东省江门市', 22.5789, 113.0815],
    ['肇庆', '广东省肇庆市', 23.0472, 112.4651],
    ['韶关', '广东省韶关市', 24.8104, 113.5972],
    ['潮州', '广东省潮州市', 23.6567, 116.6226],
    ['湛江', '广东省湛江市', 21.2707, 110.3594],
    ['北海', '广西壮族自治区北海市', 21.4811, 109.1202],
    ['柳州', '广西壮族自治区柳州市', 24.3264, 109.4281],
    ['防城港', '广西壮族自治区防城港市', 21.6869, 108.3538],
    ['崇左', '广西壮族自治区崇左市', 22.3771, 107.3649],
    ['万宁', '海南省万宁市', 18.7953, 110.3911],
    ['陵水', '海南省陵水黎族自治县', 18.5050, 110.0372],
    ['文昌', '海南省文昌市', 19.5434, 110.7977],
    ['琼海', '海南省琼海市', 19.2584, 110.4745],
    ['儋州', '海南省儋州市', 19.5209, 109.5808],

    // 西南
    ['乐山', '四川省乐山市', 29.5521, 103.7654],
    ['阿坝', '四川省阿坝藏族羌族自治州', 31.8994, 102.2248],
    ['甘孜', '四川省甘孜藏族自治州', 30.0495, 101.9623],
    ['绵阳', '四川省绵阳市', 31.4675, 104.6796],
    ['雅安', '四川省雅安市', 30.0154, 103.0398],
    ['宜宾', '四川省宜宾市', 28.7518, 104.6432],
    ['自贡', '四川省自贡市', 29.3390, 104.7784],
    ['西昌', '四川省凉山彝族自治州西昌市', 27.8945, 102.2644],
    ['遵义', '贵州省遵义市', 27.7257, 106.9272],
    ['安顺', '贵州省安顺市', 26.2531, 105.9476],
    ['黔东南', '贵州省黔东南苗族侗族自治州', 26.5834, 107.9829],
    ['黔南', '贵州省黔南布依族苗族自治州', 26.2541, 107.5223],
    ['铜仁', '贵州省铜仁市', 27.7183, 109.1896],
    ['毕节', '贵州省毕节市', 27.2985, 105.3050],
    ['香格里拉', '云南省迪庆藏族自治州香格里拉市', 27.8297, 99.7008],
    ['腾冲', '云南省保山市腾冲市', 25.0205, 98.4903],
    ['红河', '云南省红河哈尼族彝族自治州', 23.3642, 103.3756],
    ['普洱', '云南省普洱市', 22.8250, 100.9665],
    ['曲靖', '云南省曲靖市', 25.4900, 103.7962],
    ['怒江', '云南省怒江傈僳族自治州', 25.8176, 98.8567],
    ['日喀则', '西藏自治区日喀则市', 29.2675, 88.8811],
    ['林芝', '西藏自治区林芝市', 29.6489, 94.3615],
    ['山南', '西藏自治区山南市', 29.2377, 91.7731],
    ['阿里', '西藏自治区阿里地区', 32.5008, 80.1055],
    ['那曲', '西藏自治区那曲市', 31.4760, 92.0514],

    // 西北
    ['延安', '陕西省延安市', 36.5853, 109.4897],
    ['汉中', '陕西省汉中市', 33.0676, 107.0238],
    ['宝鸡', '陕西省宝鸡市', 34.3619, 107.2372],
    ['榆林', '陕西省榆林市', 38.2852, 109.7341],
    ['渭南', '陕西省渭南市', 34.4994, 109.5098],
    ['天水', '甘肃省天水市', 34.5809, 105.7249],
    ['酒泉', '甘肃省酒泉市', 39.7326, 98.4943],
    ['甘南', '甘肃省甘南藏族自治州', 34.9833, 102.9110],
    ['陇南', '甘肃省陇南市', 33.4009, 104.9218],
    ['临夏', '甘肃省临夏回族自治州', 35.6012, 103.2106],
    ['海西', '青海省海西蒙古族藏族自治州', 37.3771, 97.3698],
    ['玉树', '青海省玉树藏族自治州', 33.0053, 97.0065],
    ['果洛', '青海省果洛藏族自治州', 34.4714, 100.2452],
    ['海北', '青海省海北藏族自治州', 36.9545, 100.9009],
    ['中卫', '宁夏回族自治区中卫市', 37.5003, 105.1968],
    ['固原', '宁夏回族自治区固原市', 36.0158, 106.2426],
    ['吴忠', '宁夏回族自治区吴忠市', 37.9976, 106.1984],
    ['喀什', '新疆维吾尔自治区喀什地区', 39.4704, 75.9898],
    ['吐鲁番', '新疆维吾尔自治区吐鲁番市', 42.9513, 89.1895],
    ['克拉玛依', '新疆维吾尔自治区克拉玛依市', 45.5799, 84.8892],
    ['伊犁', '新疆维吾尔自治区伊犁哈萨克自治州', 43.9169, 81.3242],
    ['阿勒泰', '新疆维吾尔自治区阿勒泰地区', 47.8449, 88.1413],
    ['和田', '新疆维吾尔自治区和田地区', 37.1142, 79.9222],
    ['库尔勒', '新疆维吾尔自治区巴音郭楞蒙古自治州库尔勒市', 41.7264, 86.1737],
    ['塔城', '新疆维吾尔自治区塔城地区', 46.7453, 82.9803],

    // 港澳台
    ['九龙', '香港特别行政区九龙', 22.3193, 114.1722],
    ['大屿山', '香港特别行政区大屿山', 22.2635, 113.9461],
    ['澳门半岛', '澳门特别行政区澳门半岛', 22.2000, 113.5460],
    ['氹仔', '澳门特别行政区氹仔', 22.1577, 113.5577],
    ['新北', '台湾省新北市', 25.0169, 121.4628],
    ['台中', '台湾省台中市', 24.1477, 120.6736],
    ['台南', '台湾省台南市', 22.9999, 120.2269],
    ['高雄', '台湾省高雄市', 22.6273, 120.3014],
    ['花莲', '台湾省花莲县', 23.9911, 121.6112],
    ['台东', '台湾省台东县', 22.7554, 121.1500],
    ['嘉义', '台湾省嘉义市', 23.4801, 120.4491],
    ['南投', '台湾省南投县', 23.9609, 120.9719],
  ]

  // 常见城市机位、历史街区和自然景区，便于离线快速检索
  const photoDestinations = [
    ['故宫', '北京市东城区景山前街4号', 39.9163, 116.3972],
    ['颐和园', '北京市海淀区新建宫门路19号', 39.9999, 116.2755],
    ['八达岭长城', '北京市延庆区八达岭镇', 40.3598, 116.0200],
    ['天坛', '北京市东城区天坛东里甲1号', 39.8822, 116.4066],
    ['798艺术区', '北京市朝阳区酒仙桥路4号', 39.9842, 116.4956],
    ['外滩', '上海市黄浦区中山东一路', 31.2400, 121.4904],
    ['陆家嘴', '上海市浦东新区陆家嘴', 31.2397, 121.4998],
    ['武康路', '上海市徐汇区武康路', 31.2050, 121.4388],
    ['田子坊', '上海市黄浦区泰康路210弄', 31.2085, 121.4688],
    ['五大道', '天津市和平区重庆道', 39.1165, 117.1961],
    ['洪崖洞', '重庆市渝中区嘉陵江滨江路88号', 29.5647, 106.5791],
    ['李子坝', '重庆市渝中区李子坝正街', 29.5525, 106.5477],
    ['磁器口古镇', '重庆市沙坪坝区磁南街1号', 29.5817, 106.4491],
    ['山海关', '河北省秦皇岛市山海关区', 40.0061, 119.7548],
    ['坝上草原', '河北省承德市丰宁满族自治县', 41.2095, 116.6467],
    ['云冈石窟', '山西省大同市云冈区', 40.1093, 113.1220],
    ['壶口瀑布', '山西省临汾市吉县壶口镇', 36.1451, 110.4429],
    ['呼伦贝尔草原', '内蒙古自治区呼伦贝尔市', 49.2500, 119.7500],
    ['额济纳旗', '内蒙古自治区阿拉善盟额济纳旗', 41.9545, 101.0556],
    ['红海滩', '辽宁省盘锦市大洼区赵圈河镇', 40.8721, 121.9698],
    ['长白山', '吉林省延边朝鲜族自治州安图县', 42.0063, 128.0554],
    ['雪乡', '黑龙江省牡丹江市海林市', 44.5295, 128.4549],
    ['北极村', '黑龙江省大兴安岭地区漠河市北极镇', 53.4870, 122.3500],
    ['中山陵', '江苏省南京市玄武区石象路7号', 32.0647, 118.8490],
    ['夫子庙', '江苏省南京市秦淮区贡院街', 32.0205, 118.7887],
    ['平江路', '江苏省苏州市姑苏区平江路', 31.3144, 120.6292],
    ['拙政园', '江苏省苏州市姑苏区东北街178号', 31.3243, 120.6294],
    ['西湖', '浙江省杭州市西湖区', 30.2431, 120.1503],
    ['南浔古镇', '浙江省湖州市南浔区', 30.8769, 120.4290],
    ['东极岛', '浙江省舟山市普陀区东极镇', 30.1949, 122.6819],
    ['呈坎', '安徽省黄山市徽州区呈坎镇', 29.9224, 118.2865],
    ['鼓浪屿', '福建省厦门市思明区鼓浪屿', 24.4471, 118.0639],
    ['霞浦', '福建省宁德市霞浦县', 26.8857, 120.0051],
    ['福建土楼', '福建省龙岩市永定区', 24.6587, 116.9276],
    ['婺源', '江西省上饶市婺源县', 29.2484, 117.8619],
    ['景德镇陶溪川', '江西省景德镇市珠山区新厂西路', 29.2805, 117.2276],
    ['栈桥', '山东省青岛市市南区太平路12号', 36.0617, 120.3181],
    ['蓬莱阁', '山东省烟台市蓬莱区迎宾路7号', 37.8256, 120.7589],
    ['少林寺', '河南省郑州市登封市嵩山五乳峰下', 34.5079, 112.9352],
    ['龙门石窟', '河南省洛阳市洛龙区龙门镇', 34.5595, 112.4697],
    ['黄鹤楼', '湖北省武汉市武昌区蛇山西山坡特1号', 30.5447, 114.3042],
    ['神农架', '湖北省神农架林区', 31.7444, 110.6758],
    ['橘子洲', '湖南省长沙市岳麓区橘子洲头', 28.1739, 112.9624],
    ['东江湖', '湖南省郴州市资兴市', 25.8670, 113.3952],
    ['广州塔', '广东省广州市海珠区阅江西路222号', 23.1065, 113.3245],
    ['沙面', '广东省广州市荔湾区沙面街', 23.1097, 113.2390],
    ['南澳岛', '广东省汕头市南澳县', 23.4217, 117.0235],
    ['开平碉楼', '广东省江门市开平市塘口镇', 22.3636, 112.5640],
    ['涠洲岛', '广西壮族自治区北海市海城区', 21.0395, 109.1160],
    ['德天瀑布', '广西壮族自治区崇左市大新县硕龙镇', 22.8535, 106.7226],
    ['蜈支洲岛', '海南省三亚市海棠区', 18.3101, 109.7627],
    ['石梅湾', '海南省万宁市礼纪镇', 18.6730, 110.2773],
    ['都江堰', '四川省成都市都江堰市', 31.0052, 103.6194],
    ['四姑娘山', '四川省阿坝藏族羌族自治州小金县', 31.1024, 102.9016],
    ['牛背山', '四川省雅安市荥经县', 29.8417, 102.7704],
    ['黄果树瀑布', '贵州省安顺市镇宁布依族苗族自治县', 25.9927, 105.6675],
    ['西江千户苗寨', '贵州省黔东南苗族侗族自治州雷山县', 26.4964, 108.1738],
    ['梵净山', '贵州省铜仁市江口县', 27.9060, 108.7044],
    ['元阳梯田', '云南省红河哈尼族彝族自治州元阳县', 23.0938, 102.7425],
    ['泸沽湖', '云南省丽江市宁蒗彝族自治县', 27.7007, 100.7831],
    ['梅里雪山', '云南省迪庆藏族自治州德钦县', 28.4375, 98.6867],
    ['珠穆朗玛峰大本营', '西藏自治区日喀则市定日县', 28.1411, 86.8515],
    ['纳木错', '西藏自治区拉萨市当雄县', 30.7276, 90.8078],
    ['羊卓雍措', '西藏自治区山南市浪卡子县', 28.9446, 90.6803],
    ['西安城墙', '陕西省西安市碑林区', 34.2550, 108.9421],
    ['兵马俑', '陕西省西安市临潼区秦陵北路', 34.3841, 109.2785],
    ['麦积山石窟', '甘肃省天水市麦积区', 34.3526, 106.0097],
    ['扎尕那', '甘肃省甘南藏族自治州迭部县', 34.2387, 103.1647],
    ['茶卡盐湖', '青海省海西蒙古族藏族自治州乌兰县', 36.6904, 99.0765],
    ['水上雅丹', '青海省海西蒙古族藏族自治州大柴旦', 37.2674, 93.1520],
    ['沙坡头', '宁夏回族自治区中卫市沙坡头区', 37.4573, 105.0005],
    ['赛里木湖', '新疆维吾尔自治区博尔塔拉蒙古自治州', 44.6052, 81.1695],
    ['那拉提草原', '新疆维吾尔自治区伊犁哈萨克自治州新源县', 43.2365, 84.0211],
    ['独库公路', '新疆维吾尔自治区独山子至库车', 43.1000, 84.3000],
    ['帕米尔高原', '新疆维吾尔自治区喀什地区塔什库尔干县', 37.7730, 75.2280],
    ['禾木', '新疆维吾尔自治区阿勒泰地区布尔津县', 48.5772, 87.4370],
    ['白沙湖', '新疆维吾尔自治区喀什地区阿克陶县', 38.4407, 75.0523],
    ['维多利亚港', '香港特别行政区维多利亚港', 22.2931, 114.1694],
    ['太平山顶', '香港特别行政区香港岛太平山', 22.2759, 114.1455],
    ['大三巴牌坊', '澳门特别行政区花王堂区', 22.1977, 113.5409],
    ['九份', '台湾省新北市瑞芳区九份', 25.1099, 121.8452],
    ['日月潭', '台湾省南投县鱼池乡', 23.8659, 120.9159],
    ['阿里山', '台湾省嘉义县阿里山乡', 23.5100, 120.8000],
  ]

  let inserted = 0
  let merged = 0
  let corrected = 0
  const tx = db.transaction(() => {
    corrected += renameLegacyLocation.run(
      '喀纳斯',
      '哈纳斯',
      '新疆维吾尔自治区阿勒泰地区布尔津县',
      48.9958,
      87.0975
    ).changes
    corrected += updateLegacyCoordinates.run(
      22.2000,
      113.5460,
      '澳门半岛',
      '澳门特别行政区澳门半岛',
      22.1987,
      113.5439
    ).changes

    for (const name of ['哈尔滨', '南昌', '乌鲁木齐']) {
      const matches = findDuplicates.all(name) as Array<{ id: number; lat: number; lng: number }>
      const canonical = matches[0]
      if (!canonical) continue
      for (const duplicate of matches.slice(1)) {
        const sameCoordinates = Math.abs(duplicate.lat - canonical.lat) < 0.0001
          && Math.abs(duplicate.lng - canonical.lng) < 0.0001
        if (!sameCoordinates) continue
        relinkPhotos.run(canonical.id, duplicate.id)
        deleteLocation.run(duplicate.id)
        merged++
      }
    }

    for (const [name, address, lat, lng] of [
      ...municipalities,
      ...capitals,
      ...majorCities,
      ...districts,
      ...regionalCities,
      ...photoDestinations
    ]) {
      if (findByName.get(name)) continue
      ins.run(name, address, lat, lng)
      inserted++
    }
  })
  tx()

  const total = (db.prepare('SELECT COUNT(*) as c FROM locations').get() as { c: number }).c
  log.info('China locations synchronized', { inserted, merged, corrected, total })
}
