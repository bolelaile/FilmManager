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
  const count = (db.prepare('SELECT COUNT(*) as c FROM locations').get() as { c: number }).c
  if (count > 0) return  // 已有数据，不重复写入

  const ins = db.prepare('INSERT OR IGNORE INTO locations (name, address, lat, lng) VALUES (?, ?, ?, ?)')

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
    ['哈尔滨', '黑龙江省哈尔滨市', 45.8038, 126.5350],
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
    ['南昌', '江西省南昌市', 28.6820, 115.8579],
    ['乌鲁木齐', '新疆维吾尔自治区乌鲁木齐市', 43.8256, 87.6168],
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
    ['哈纳斯', '新疆维吾尔自治区阿勒泰地区布尔津县', 48.9958, 87.0975],
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

  const tx = db.transaction(() => {
    for (const [name, address, lat, lng] of [...municipalities, ...capitals, ...majorCities, ...districts]) {
      ins.run(name, address, lat, lng)
    }
  })
  tx()

  log.info('China locations seeded')
}
