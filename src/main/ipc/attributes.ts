import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import { getDb } from '../db/index'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'

export function registerAttributesIpc(): void {
  // 获取所有属性类型（含激活状态）
  ipcMain.handle('attrs:listTypes', () => {
    return getDb()
      .prepare('SELECT * FROM attribute_types ORDER BY sort_order, id')
      .all()
  })

  // 获取某类型的所有值（含 icon_key）
  ipcMain.handle('attrs:listValues', (_, typeId: number) => {
    return getDb()
      .prepare('SELECT * FROM attribute_values WHERE attribute_type_id = ? ORDER BY is_preset DESC, value ASC')
      .all(typeId)
  })

  // 获取所有类型及其值（用于筛选面板）
  ipcMain.handle('attrs:listAll', () => {
    const db = getDb()
    const types = db
      .prepare('SELECT * FROM attribute_types WHERE is_active = 1 ORDER BY sort_order, id')
      .all() as AttrType[]
    const values = db.prepare('SELECT * FROM attribute_values ORDER BY is_preset DESC, value ASC').all() as AttrValue[]
    const valuesByType = new Map<number, AttrValue[]>()
    for (const v of values) {
      if (!valuesByType.has(v.attribute_type_id)) valuesByType.set(v.attribute_type_id, [])
      valuesByType.get(v.attribute_type_id)!.push(v)
    }
    return types.map((t) => ({ ...t, values: valuesByType.get(t.id) ?? [] }))
  })

interface ValueCountParams {
  filters?: Record<number, number[]>
  subLibraryId?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  dateField?: string
  fileTypes?: string[]
  organizationStatuses?: string[]
}

type CountRow = { attribute_type_id: number; attribute_value_id: number; count: number }

/** 构建"符合非属性类筛选 + 指定属性筛选（排除 excludeTypeId）"的照片 id 子查询 */
function buildFilteredPhotoSql(
  params: ValueCountParams,
  excludeTypeId: number
): { sql: string; args: unknown[] } {
  const {
    filters = {},
    subLibraryId,
    search,
    dateFrom,
    dateTo,
    dateField = 'imported_at',
    fileTypes = [],
    organizationStatuses = []
  } = params

  let sql = 'SELECT DISTINCT p.id FROM photos p'
  const args: unknown[] = []
  let joinIdx = 0

  for (const [typeId, valueIds] of Object.entries(filters)) {
    const tid = parseInt(typeId, 10)
    if (isNaN(tid) || tid === excludeTypeId || !valueIds || valueIds.length === 0) continue
    const alias = `pa${joinIdx++}`
    sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id`
      + ` AND ${alias}.attribute_type_id = ${tid}`
      + ` AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
    args.push(...valueIds)
  }

  const wheres: string[] = []
  if (subLibraryId != null) {
    wheres.push(`p.sub_library_id IN (
      WITH RECURSIVE descendants(id) AS (
        SELECT ?
        UNION ALL
        SELECT child.id FROM sub_libraries child
        JOIN descendants parent ON child.parent_id = parent.id
      )
      SELECT id FROM descendants
    )`)
    args.push(subLibraryId)
  }
  if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
  const dateCol = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'
  if (dateFrom) { wheres.push(`${dateCol} >= ?`); args.push(dateFrom) }
  if (dateTo) {
    wheres.push(`${dateCol} <= ?`)
    args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59')
  }
  if ((fileTypes as string[]).length > 0) {
    wheres.push(`p.file_type IN (${(fileTypes as string[]).map(() => '?').join(',')})`)
    args.push(...(fileTypes as string[]))
  }
  if ((organizationStatuses as string[]).includes('unclassified')) wheres.push('p.sub_library_id IS NULL')
  if ((organizationStatuses as string[]).includes('missing_date')) wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
  if ((organizationStatuses as string[]).includes('missing_camera')) {
    wheres.push(`NOT EXISTS (
      SELECT 1 FROM photo_attributes status_pa
      JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id
      WHERE status_pa.photo_id = p.id AND status_at.key = 'camera'
    )`)
  }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ')
  return { sql, args }
}

  // 获取各属性值的照片数量（用于筛选面板显示数量）
  // 当传入 filters 等参数时，对每个属性类型使用"排除自身类型筛选"的联动计数（faceted search）
  ipcMain.handle('attrs:valueCounts', (_, params?: ValueCountParams) => {
    const db = getDb()
    const filters = params?.filters ?? {}
    const hasAttrFilters = Object.values(filters).some((v) => v.length > 0)
    const hasNonAttrFilters = !!(
      params?.subLibraryId != null ||
      params?.dateFrom ||
      params?.dateTo ||
      (params?.fileTypes ?? []).length > 0 ||
      (params?.organizationStatuses ?? []).length > 0 ||
      params?.search
    )

    // 无任何筛选条件：走快速路径，返回全局计数
    if (!hasAttrFilters && !hasNonAttrFilters) {
      return db.prepare(
        `SELECT attribute_type_id, attribute_value_id, COUNT(DISTINCT photo_id) as count
         FROM photo_attributes GROUP BY attribute_type_id, attribute_value_id`
      ).all() as CountRow[]
    }

    // 有筛选条件：对每个活跃属性类型分别查询（排除该类型自身的筛选）
    const allTypes = db
      .prepare('SELECT id FROM attribute_types WHERE is_active = 1')
      .all() as { id: number }[]

    const result: CountRow[] = []
    for (const { id: typeId } of allTypes) {
      const { sql, args } = buildFilteredPhotoSql(params!, typeId)
      const rows = db.prepare(
        `SELECT ? as attribute_type_id, pa.attribute_value_id, COUNT(DISTINCT pa.photo_id) as count
         FROM photo_attributes pa
         WHERE pa.attribute_type_id = ? AND pa.photo_id IN (${sql})
         GROUP BY pa.attribute_value_id`
      ).all(typeId, typeId, ...args) as CountRow[]
      result.push(...rows)
    }
    return result
  })

  // 获取胶片图标 manifest（iconKey -> displayName）及图标 base64 dataURL 字典
  ipcMain.handle('attrs:filmIconManifest', () => {
    try {
      const iconsDir = path.join(app.getAppPath(), 'resources', 'film-icons')
      const manifestPath = path.join(iconsDir, 'manifest.json')
      if (!fs.existsSync(manifestPath)) return {}
      const manifest: Record<string, string> = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      return manifest
    } catch {
      return {}
    }
  })

  // 读取单个胶片图标为 dataURL（64 或 128px）
  ipcMain.handle('attrs:filmIconDataUrl', (_, iconKey: string, size: 64 | 128 = 64) => {
    const iconPath = resolveIconPath(iconKey, size === 128 ? '@2x' : '')
    if (!iconPath) return null
    try {
      const buf = fs.readFileSync(iconPath)
      return `data:image/webp;base64,${buf.toString('base64')}`
    } catch { return null }
  })

  // 批量获取图标 dataURL
  ipcMain.handle('attrs:filmIconsBatch', (_, iconKeys: string[], size: 64 | 128 = 64) => {
    const result: Record<string, string> = {}
    const suffix = size === 128 ? '@2x' : ''
    for (const key of iconKeys) {
      const iconPath = resolveIconPath(key, suffix)
      if (iconPath) {
        try {
          const buf = fs.readFileSync(iconPath)
          result[key] = `data:image/webp;base64,${buf.toString('base64')}`
        } catch {}
      }
    }
    return result
  })

  // 导入自定义胶片图标：用户选图片 → sharp 缩放 → 保存至 userData/film-icons/
  ipcMain.handle('attrs:importCustomIcon', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
      title: '选择胶片图标'
    })
    if (result.canceled || !result.filePaths[0]) return null

    const src = result.filePaths[0]
    const key = `custom_${Date.now()}`
    const userIconsDir = path.join(app.getPath('userData'), 'film-icons')
    fs.mkdirSync(userIconsDir, { recursive: true })

    try {
      await sharp(src).resize(64, 64, { fit: 'cover' }).webp({ quality: 90 }).toFile(path.join(userIconsDir, `${key}.webp`))
      await sharp(src).resize(128, 128, { fit: 'cover' }).webp({ quality: 90 }).toFile(path.join(userIconsDir, `${key}@2x.webp`))
      return key
    } catch (err) {
      return null
    }
  })

  // 新增属性类型
  ipcMain.handle('attrs:addType', (_, displayName: string, key?: string) => {
    const db = getDb()
    const k = key || displayName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_一-鿿]/g, '')
    const maxOrder = (db.prepare('SELECT MAX(sort_order) as m FROM attribute_types').get() as { m: number }).m ?? 0
    const r = db
      .prepare('INSERT INTO attribute_types (key, display_name, is_system, is_active, sort_order) VALUES (?, ?, 0, 1, ?)')
      .run(k + '_' + Date.now(), displayName, maxOrder + 1)
    return r.lastInsertRowid
  })

  // 修改属性类型名称
  ipcMain.handle('attrs:updateType', (_, id: number, displayName: string) => {
    getDb().prepare('UPDATE attribute_types SET display_name = ? WHERE id = ?').run(displayName, id)
    return true
  })

  // 切换属性类型激活状态（非系统属性）
  ipcMain.handle('attrs:toggleType', (_, id: number, active: boolean) => {
    getDb()
      .prepare('UPDATE attribute_types SET is_active = ? WHERE id = ? AND is_system = 0')
      .run(active ? 1 : 0, id)
    return true
  })

  // 删除属性类型（非系统）
  ipcMain.handle('attrs:deleteType', (_, id: number) => {
    getDb().prepare('DELETE FROM attribute_types WHERE id = ? AND is_system = 0').run(id)
    return true
  })

  // 新增属性值（支持 icon_key）
  ipcMain.handle('attrs:addValue', (_, typeId: number, value: string, iconKey?: string) => {
    const r = getDb()
      .prepare('INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset) VALUES (?, ?, ?, 0)')
      .run(typeId, value.trim(), iconKey ?? null)
    return r.lastInsertRowid
  })

  // 修改属性值（支持更新 icon_key）
  ipcMain.handle('attrs:updateValue', (_, id: number, value: string, iconKey?: string) => {
    if (iconKey !== undefined) {
      getDb().prepare('UPDATE attribute_values SET value = ?, icon_key = ? WHERE id = ?').run(value.trim(), iconKey || null, id)
    } else {
      getDb().prepare('UPDATE attribute_values SET value = ? WHERE id = ?').run(value.trim(), id)
    }
    return true
  })

  // 删除属性值
  ipcMain.handle('attrs:deleteValue', (_, id: number) => {
    getDb().prepare('DELETE FROM attribute_values WHERE id = ?').run(id)
    return true
  })

  // 调整属性类型排序
  ipcMain.handle('attrs:reorder', (_, orderedIds: number[]) => {
    const db = getDb()
    const tx = db.transaction(() => {
      orderedIds.forEach((id, idx) => {
        db.prepare('UPDATE attribute_types SET sort_order = ? WHERE id = ?').run(idx, id)
      })
    })
    tx()
    return true
  })

  // ── 别名管理 ─────────────────────────────────────────────────────────────

  // 获取某属性值的所有别名
  ipcMain.handle('attrs:listAliases', (_, valueId: number) => {
    return getDb()
      .prepare('SELECT id, alias FROM attribute_value_aliases WHERE value_id = ? ORDER BY created_at ASC')
      .all(valueId) as { id: number; alias: string }[]
  })

  // 新增别名
  ipcMain.handle('attrs:addAlias', (_, valueId: number, alias: string) => {
    const trimmed = alias.trim()
    if (!trimmed) return null
    const r = getDb()
      .prepare('INSERT OR IGNORE INTO attribute_value_aliases (value_id, alias) VALUES (?, ?)')
      .run(valueId, trimmed)
    return r.changes > 0 ? r.lastInsertRowid : null
  })

  // 删除别名
  ipcMain.handle('attrs:removeAlias', (_, aliasId: number) => {
    getDb().prepare('DELETE FROM attribute_value_aliases WHERE id = ?').run(aliasId)
    return true
  })

  // JSON 批量导入属性值（含别名）
  ipcMain.handle('attrs:importJson', async (event, typeId: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      title: '选择要导入的 JSON 文件'
    })
    if (result.canceled || !result.filePaths[0]) return null

    let entries: { value: string; aliases?: string[]; icon_key?: string }[]
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return { error: '文件内容不是数组' }
      entries = parsed
    } catch (e) {
      return { error: 'JSON 解析失败：' + String(e) }
    }

    const db = getDb()
    let added = 0
    let updated = 0
    let aliasesAdded = 0

    const tx = db.transaction(() => {
      const insertVal = db.prepare(
        'INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset) VALUES (?, ?, ?, 0)'
      )
      const getVal = db.prepare(
        'SELECT id FROM attribute_values WHERE attribute_type_id = ? AND value = ?'
      )
      const updateIcon = db.prepare(
        'UPDATE attribute_values SET icon_key = ? WHERE id = ?'
      )
      const insertAlias = db.prepare(
        'INSERT OR IGNORE INTO attribute_value_aliases (value_id, alias) VALUES (?, ?)'
      )

      for (const entry of entries) {
        if (!entry.value || typeof entry.value !== 'string') continue
        const val = entry.value.trim()
        if (!val) continue

        const r = insertVal.run(typeId, val, entry.icon_key ?? null)
        let valueId: number
        if (r.changes > 0) {
          valueId = r.lastInsertRowid as number
          added++
        } else {
          const existing = getVal.get(typeId, val) as { id: number } | undefined
          if (!existing) continue
          valueId = existing.id
          // Merge-update icon_key if provided
          if (entry.icon_key) {
            updateIcon.run(entry.icon_key, valueId)
          }
          updated++
        }

        for (const alias of entry.aliases ?? []) {
          if (typeof alias !== 'string') continue
          const a = alias.trim()
          if (!a) continue
          const ar = insertAlias.run(valueId, a)
          if (ar.changes > 0) aliasesAdded++
        }
      }
    })
    tx()

    return { added, updated, aliasesAdded }
  })
}

interface AttrType { id: number; key: string; display_name: string; is_system: number; is_active: number; sort_order: number }
interface AttrValue { id: number; attribute_type_id: number; value: string; icon_key?: string; is_preset: number }

/** 优先从 userData/film-icons 查找，找不到再去 app resources/film-icons */
function resolveIconPath(iconKey: string, suffix: string): string | null {
  // Reject keys containing path separators or dots to prevent directory traversal
  if (!/^[a-zA-Z0-9_-]+$/.test(iconKey)) return null
  const userPath = path.join(app.getPath('userData'), 'film-icons', `${iconKey}${suffix}.webp`)
  if (fs.existsSync(userPath)) return userPath
  const builtinPath = path.join(app.getAppPath(), 'resources', 'film-icons', `${iconKey}${suffix}.webp`)
  if (fs.existsSync(builtinPath)) return builtinPath
  return null
}
