import { ipcMain } from 'electron'
import { getDb } from '../db/index'
import log from 'electron-log'

interface RollRow {
  id: number
  name: string
  sub_library_id: number | null
  cover_photo_id: number | null
  created_at: string
  photo_count?: number
  // joined fields from cover photo
  thumb_path?: string
  thumb_ready?: number
}

interface AttrRow {
  roll_id: number
  attribute_type_id: number
  key: string
  display_name: string
  value: string
  value_id: number
  icon_key?: string
}

export function registerRollsIpc(): void {
  // 列出所有卷（含每卷照片数、封面缩略图、属性摘要）
  ipcMain.handle('rolls:list', (_, subLibraryId?: number) => {
    const db = getDb()
    let sql = `
      SELECT r.*, COUNT(pr.photo_id) as photo_count,
             p.thumb_path, p.thumb_ready
      FROM rolls r
      LEFT JOIN photo_rolls pr ON pr.roll_id = r.id
      LEFT JOIN photos p ON p.id = r.cover_photo_id
    `
    const args: unknown[] = []
    if (subLibraryId != null) {
      sql += ' WHERE r.sub_library_id = ?'
      args.push(subLibraryId)
    }
    sql += ' GROUP BY r.id ORDER BY r.created_at DESC'
    const rolls = db.prepare(sql).all(...args) as RollRow[]

    // 为每个卷查询属性摘要（取第一张照片的属性聚合）
    const rollIds = rolls.map((r) => r.id)
    if (rollIds.length === 0) return { rolls: [], photolessCount: getPhotolessCount(db, subLibraryId) }

    // 批量查询每个卷里所有照片的属性（去重聚合）
    const attrRows = db.prepare(`
      SELECT DISTINCT pr.roll_id, at.id as attribute_type_id, at.key, at.display_name,
             av.value, av.id as value_id, av.icon_key
      FROM photo_rolls pr
      JOIN photo_attributes pa ON pa.photo_id = pr.photo_id
      JOIN attribute_types at ON at.id = pa.attribute_type_id
      JOIN attribute_values av ON av.id = pa.attribute_value_id
      WHERE pr.roll_id IN (${rollIds.map(() => '?').join(',')})
        AND at.key IN ('film', 'film_format', 'camera', 'lens')
      ORDER BY at.sort_order
    `).all(...rollIds) as AttrRow[]

    // 按 roll_id 分组属性（每个类型取第一个值）
    const attrMap = new Map<number, AttrRow[]>()
    for (const row of attrRows) {
      if (!attrMap.has(row.roll_id)) attrMap.set(row.roll_id, [])
      const existing = attrMap.get(row.roll_id)!
      // 每个 key 只保留第一条
      if (!existing.find((e) => e.key === row.key)) {
        existing.push(row)
      }
    }

    // 查询每个卷的拍摄地点（取第一个）
    const locRows = db.prepare(`
      SELECT DISTINCT pr.roll_id, l.name as location_name
      FROM photo_rolls pr
      JOIN photo_locations pl ON pl.photo_id = pr.photo_id
      JOIN locations l ON l.id = pl.location_id
      WHERE pr.roll_id IN (${rollIds.map(() => '?').join(',')})
    `).all(...rollIds) as { roll_id: number; location_name: string }[]

    const locMap = new Map<number, string>()
    for (const row of locRows) {
      if (!locMap.has(row.roll_id)) locMap.set(row.roll_id, row.location_name)
    }

    const result = rolls.map((r) => ({
      ...r,
      attributes: attrMap.get(r.id) ?? [],
      location_name: locMap.get(r.id) ?? null
    }))

    return { rolls: result, photolessCount: getPhotolessCount(db, subLibraryId) }
  })

  // 创建卷
  ipcMain.handle('rolls:create', (_, params: {
    photoIds: number[]
    name?: string
    subLibraryId?: number | null
  }) => {
    const db = getDb()
    const { photoIds, name, subLibraryId } = params
    if (!photoIds || photoIds.length === 0) return null

    // 自动命名：胶片类型-胶片格式-拍摄时间
    let rollName = name?.trim() || ''
    if (!rollName) {
      // 尝试从第一张照片的属性提取
      const firstId = photoIds[0]
      const filmAttr = db.prepare(`
        SELECT av.value FROM photo_attributes pa
        JOIN attribute_types at ON at.id = pa.attribute_type_id
        JOIN attribute_values av ON av.id = pa.attribute_value_id
        WHERE pa.photo_id = ? AND at.key = 'film'
        LIMIT 1
      `).get(firstId) as { value: string } | undefined

      const formatAttr = db.prepare(`
        SELECT av.value FROM photo_attributes pa
        JOIN attribute_types at ON at.id = pa.attribute_type_id
        JOIN attribute_values av ON av.id = pa.attribute_value_id
        WHERE pa.photo_id = ? AND at.key = 'film_format'
        LIMIT 1
      `).get(firstId) as { value: string } | undefined

      const photo = db.prepare('SELECT shot_date, imported_at FROM photos WHERE id = ?').get(firstId) as { shot_date?: string; imported_at: string } | undefined
      const dateStr = photo?.shot_date || photo?.imported_at || ''
      const datePart = dateStr ? dateStr.substring(0, 10).replace(/-/g, '/') : ''

      const parts: string[] = []
      if (filmAttr?.value) parts.push(filmAttr.value)
      if (formatAttr?.value) parts.push(formatAttr.value)
      if (datePart) parts.push(datePart)
      rollName = parts.join('-') || '未命名卷'
    }

    // 选取封面：第一张有缩略图的照片
    const coverPhoto = db.prepare(`
      SELECT id FROM photos WHERE id IN (${photoIds.map(() => '?').join(',')}) AND thumb_ready = 1
      ORDER BY shot_date ASC, imported_at ASC LIMIT 1
    `).get(...photoIds) as { id: number } | undefined

    const info = db.prepare(`
      INSERT INTO rolls (name, sub_library_id, cover_photo_id) VALUES (?, ?, ?)
    `).run(rollName, subLibraryId ?? null, coverPhoto?.id ?? null)

    const rollId = info.lastInsertRowid as number

    // 关联照片
    const insertPhotoRoll = db.prepare('INSERT OR IGNORE INTO photo_rolls (photo_id, roll_id) VALUES (?, ?)')
    const tx = db.transaction(() => {
      for (const pid of photoIds) {
        insertPhotoRoll.run(pid, rollId)
      }
    })
    tx()

    log.info(`Created roll ${rollId}: "${rollName}" with ${photoIds.length} photos`)
    return rollId
  })

  // 重命名卷
  ipcMain.handle('rolls:rename', (_, id: number, name: string) => {
    const db = getDb()
    db.prepare('UPDATE rolls SET name = ? WHERE id = ?').run(name.trim(), id)
    return true
  })

  // 删除卷（仅删除卷记录，不删除照片）
  ipcMain.handle('rolls:delete', (_, id: number) => {
    const db = getDb()
    db.prepare('DELETE FROM rolls WHERE id = ?').run(id)
    return true
  })

  // 获取卷内照片
  ipcMain.handle('rolls:photos', (_, rollId: number, params: {
    page: number
    pageSize: number
    filters?: Record<number, number[]>
    search?: string
    sortBy?: 'imported_at' | 'file_name'
    sortOrder?: 'asc' | 'desc'
  }) => {
    const db = getDb()
    const { page, pageSize, filters = {}, search, sortBy = 'imported_at', sortOrder = 'desc' } = params
    const offset = (page - 1) * pageSize
    const sortCol = sortBy === 'file_name' ? 'original_name' : sortBy

    let sql = `SELECT DISTINCT p.* FROM photos p JOIN photo_rolls pr ON pr.photo_id = p.id AND pr.roll_id = ?`
    const args: unknown[] = [rollId]
    let joinIdx = 0

    for (const [typeId, valueIds] of Object.entries(filters)) {
      if (!valueIds || (valueIds as number[]).length === 0) continue
      const alias = `pa${joinIdx++}`
      sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${typeId} AND ${alias}.attribute_value_id IN (${(valueIds as number[]).map(() => '?').join(',')})`
      args.push(...(valueIds as number[]))
    }

    const wheres: string[] = []
    if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ')
    sql += ` ORDER BY p.${sortCol} ${sortOrder}`

    const countSql = `SELECT COUNT(*) as total FROM (${sql}) t`
    const total = (db.prepare(countSql).get(...args) as { total: number }).total

    sql += ' LIMIT ? OFFSET ?'
    const rows = db.prepare(sql).all(...args, pageSize, offset) as PhotoRow[]

    const ids = rows.map((r) => r.id)
    const attrs = ids.length
      ? db.prepare(`
          SELECT pa.photo_id, at.key, at.display_name, av.value, av.id as value_id, pa.attribute_type_id
          FROM photo_attributes pa
          JOIN attribute_types at ON at.id = pa.attribute_type_id
          JOIN attribute_values av ON av.id = pa.attribute_value_id
          WHERE pa.photo_id IN (${ids.map(() => '?').join(',')})
          ORDER BY at.sort_order
        `).all(...ids) as AttrRow2[]
      : []

    const attrMap = new Map<number, AttrRow2[]>()
    for (const a of attrs) {
      if (!attrMap.has(a.photo_id)) attrMap.set(a.photo_id, [])
      attrMap.get(a.photo_id)!.push(a)
    }

    return { total, rows: rows.map((r) => ({ ...r, attributes: attrMap.get(r.id) ?? [] })) }
  })

  // 获取照片所属的卷
  ipcMain.handle('rolls:forPhoto', (_, photoId: number) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT r.* FROM rolls r
      JOIN photo_rolls pr ON pr.roll_id = r.id
      WHERE pr.photo_id = ?
    `).all(photoId) as RollRow[]
    return rows
  })

  // 从卷中移除照片
  ipcMain.handle('rolls:removePhotos', (_, rollId: number, photoIds: number[]) => {
    const db = getDb()
    const del = db.prepare('DELETE FROM photo_rolls WHERE roll_id = ? AND photo_id = ?')
    const tx = db.transaction(() => {
      for (const pid of photoIds) del.run(rollId, pid)
    })
    tx()
    return true
  })

  // 向卷中添加照片
  ipcMain.handle('rolls:addPhotos', (_, rollId: number, photoIds: number[]) => {
    const db = getDb()
    const ins = db.prepare('INSERT OR IGNORE INTO photo_rolls (photo_id, roll_id) VALUES (?, ?)')
    const tx = db.transaction(() => {
      for (const pid of photoIds) ins.run(pid, rollId)
    })
    tx()
    return true
  })

  // 更新封面照片
  ipcMain.handle('rolls:setCover', (_, rollId: number, photoId: number) => {
    const db = getDb()
    db.prepare('UPDATE rolls SET cover_photo_id = ? WHERE id = ?').run(photoId, rollId)
    return true
  })
}

function getPhotolessCount(db: ReturnType<typeof getDb>, subLibraryId?: number): number {
  let sql = `
    SELECT COUNT(*) as c FROM photos p
    WHERE p.id NOT IN (SELECT photo_id FROM photo_rolls)
  `
  const args: unknown[] = []
  if (subLibraryId != null) {
    sql += ' AND p.sub_library_id = ?'
    args.push(subLibraryId)
  }
  return (db.prepare(sql).get(...args) as { c: number }).c
}

interface PhotoRow {
  id: number
  file_path: string
  original_name: string
  file_type: string
  thumb_path?: string
  thumb_ready: number
  width?: number
  height?: number
  file_size?: number
  sub_library_id?: number
  imported_at: string
  shot_date?: string | null
  notes: string
}

interface AttrRow2 {
  photo_id: number
  attribute_type_id: number
  key: string
  display_name: string
  value: string
  value_id: number
}
