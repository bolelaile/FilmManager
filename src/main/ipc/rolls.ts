import { ipcMain } from 'electron'
import fs from 'fs'
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

interface RollQueryParams {
  subLibraryId?: number
  filters?: Record<number, number[]>
  search?: string
  dateFrom?: string
  dateTo?: string
  dateField?: 'imported_at' | 'shot_date'
  fileTypes?: string[]
  organizationStatuses?: ('unclassified' | 'missing_date' | 'missing_camera')[]
}

export function registerRollsIpc(): void {
  // 检查照片属性一致性（胶卷类型、相机型号）
  ipcMain.handle('rolls:checkAttrConsistency', (_, photoIds: number[]) => {
    if (!photoIds || photoIds.length === 0) return { ok: true, warnings: [] }
    const db = getDb()
    const ph = photoIds.map(() => '?').join(',')

    const filmValues = db.prepare(`
      SELECT DISTINCT av.value FROM photo_attributes pa
      JOIN attribute_types at ON at.id = pa.attribute_type_id
      JOIN attribute_values av ON av.id = pa.attribute_value_id
      WHERE pa.photo_id IN (${ph}) AND at.key = 'film'
    `).all(...photoIds) as { value: string }[]

    const cameraValues = db.prepare(`
      SELECT DISTINCT av.value FROM photo_attributes pa
      JOIN attribute_types at ON at.id = pa.attribute_type_id
      JOIN attribute_values av ON av.id = pa.attribute_value_id
      WHERE pa.photo_id IN (${ph}) AND at.key = 'camera'
    `).all(...photoIds) as { value: string }[]

    const warnings: string[] = []
    if (filmValues.length > 1) {
      warnings.push(`胶卷类型不一致：${filmValues.map((v) => v.value).join('、')}`)
    }
    if (cameraValues.length > 1) {
      warnings.push(`相机型号不一致：${cameraValues.map((v) => v.value).join('、')}`)
    }
    return { ok: warnings.length === 0, warnings }
  })

  // 列出所有卷（含每卷照片数、封面缩略图、属性摘要）
  ipcMain.handle('rolls:list', (_, rawParams?: RollQueryParams | number) => {
    const db = getDb()
    const params: RollQueryParams = typeof rawParams === 'number'
      ? { subLibraryId: rawParams }
      : rawParams ?? {}
    const {
      subLibraryId,
      filters = {},
      search,
      dateFrom,
      dateTo,
      dateField = 'imported_at',
      fileTypes = [],
      organizationStatuses = []
    } = params
    const dateColumn = dateField === 'shot_date' ? 'member.shot_date' : 'member.imported_at'

    let sql = `
      SELECT r.*, COUNT(DISTINCT pr.photo_id) as photo_count,
             cover.thumb_path, cover.thumb_ready,
             MIN(member.shot_date) as shot_date_min
      FROM rolls r
      LEFT JOIN photo_rolls pr ON pr.roll_id = r.id
      LEFT JOIN photos member ON member.id = pr.photo_id
      LEFT JOIN photos cover ON cover.id = r.cover_photo_id
    `
    const args: unknown[] = []
    let joinIdx = 0
    let hasPhotoFilters = false
    for (const [typeId, valueIds] of Object.entries(filters)) {
      if (!valueIds || valueIds.length === 0) continue
      const tid = parseInt(typeId, 10)
      if (isNaN(tid)) continue
      const alias = `roll_pa${joinIdx++}`
      sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = member.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
      args.push(...valueIds)
      hasPhotoFilters = true
    }

    const wheres: string[] = []
    if (subLibraryId != null) {
      wheres.push(`r.sub_library_id IN (
        WITH RECURSIVE descendants(id) AS (
          SELECT ?
          UNION ALL
          SELECT child.id
          FROM sub_libraries child
          JOIN descendants parent ON child.parent_id = parent.id
        )
        SELECT id FROM descendants
      )`)
      args.push(subLibraryId)
    }
    if (search) {
      wheres.push('member.original_name LIKE ?')
      args.push(`%${search}%`)
      hasPhotoFilters = true
    }
    if (dateFrom) {
      wheres.push(`${dateColumn} >= ?`)
      args.push(dateFrom)
      hasPhotoFilters = true
    }
    if (dateTo) {
      wheres.push(`${dateColumn} <= ?`)
      args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59')
      hasPhotoFilters = true
    }
    if (fileTypes.length > 0) {
      wheres.push(`member.file_type IN (${fileTypes.map(() => '?').join(',')})`)
      args.push(...fileTypes)
      hasPhotoFilters = true
    }
    if (organizationStatuses.includes('unclassified')) {
      wheres.push('member.sub_library_id IS NULL')
      hasPhotoFilters = true
    }
    if (organizationStatuses.includes('missing_date')) {
      wheres.push("(member.shot_date IS NULL OR member.shot_date = '')")
      hasPhotoFilters = true
    }
    if (organizationStatuses.includes('missing_camera')) {
      wheres.push(`NOT EXISTS (
        SELECT 1 FROM photo_attributes status_pa
        JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id
        WHERE status_pa.photo_id = member.id AND status_at.key = 'camera'
      )`)
      hasPhotoFilters = true
    }
    if (hasPhotoFilters) wheres.push('member.id IS NOT NULL')
    if (wheres.length > 0) sql += ' WHERE ' + wheres.join(' AND ')
    sql += ' GROUP BY r.id ORDER BY r.created_at DESC'
    const rolls = db.prepare(sql).all(...args) as RollRow[]

    // 为每个卷查询属性摘要（取第一张照片的属性聚合）
    const rollIds = rolls.map((r) => r.id)
    if (rollIds.length === 0) return { rolls: [], photolessCount: getPhotolessCount(db, params) }

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

    return { rolls: result, photolessCount: getPhotolessCount(db, params) }
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

  // 删除卷（可选同时删除照片/物理文件）
  ipcMain.handle('rolls:delete', (_, id: number, deletePhotos?: boolean, deleteFiles?: boolean) => {
    const db = getDb()
    if (deletePhotos) {
      const photoRows = db.prepare(`
        SELECT p.id, p.file_path, p.thumb_path, p.storage_mode FROM photos p
        JOIN photo_rolls pr ON pr.photo_id = p.id WHERE pr.roll_id = ?
      `).all(id) as { id: number; file_path: string; thumb_path?: string; storage_mode?: string }[]

      db.transaction(() => {
        for (const p of photoRows) db.prepare('DELETE FROM photos WHERE id = ?').run(p.id)
        db.prepare('DELETE FROM rolls WHERE id = ?').run(id)
      })()

      if (deleteFiles) {
        for (const p of photoRows) {
          if (p.storage_mode === 'linked') continue // cannot delete files outside library
          try { fs.unlinkSync(p.file_path) } catch {}
          if (p.thumb_path) try { fs.unlinkSync(p.thumb_path) } catch {}
        }
      }
    } else {
      db.prepare('DELETE FROM rolls WHERE id = ?').run(id)
    }
    return true
  })

  // 批量删除卷
  ipcMain.handle('rolls:batchDelete', (_, ids: number[], deletePhotos?: boolean, deleteFiles?: boolean) => {
    if (!ids || ids.length === 0) return true
    const db = getDb()
    const ph = ids.map(() => '?').join(',')

    if (deletePhotos) {
      const photoRows = db.prepare(`
        SELECT p.id, p.file_path, p.thumb_path, p.storage_mode FROM photos p
        JOIN photo_rolls pr ON pr.photo_id = p.id WHERE pr.roll_id IN (${ph})
      `).all(...ids) as { id: number; file_path: string; thumb_path?: string; storage_mode?: string }[]

      db.transaction(() => {
        for (const p of photoRows) db.prepare('DELETE FROM photos WHERE id = ?').run(p.id)
        db.prepare(`DELETE FROM rolls WHERE id IN (${ph})`).run(...ids)
      })()

      if (deleteFiles) {
        for (const p of photoRows) {
          if (p.storage_mode === 'linked') continue
          try { fs.unlinkSync(p.file_path) } catch {}
          if (p.thumb_path) try { fs.unlinkSync(p.thumb_path) } catch {}
        }
      }
    } else {
      db.prepare(`DELETE FROM rolls WHERE id IN (${ph})`).run(...ids)
    }
    log.info(`Batch deleted ${ids.length} rolls, deletePhotos=${deletePhotos}, deleteFiles=${deleteFiles}`)
    return true
  })

  // 批量设置卷内照片的属性
  ipcMain.handle('rolls:batchSetAttributes', (_, rollIds: number[], attrs: { typeId: number; valueId: number }[]) => {
    if (!rollIds || rollIds.length === 0) return true
    if (!attrs || attrs.length === 0) return true
    const db = getDb()
    const ph = rollIds.map(() => '?').join(',')

    const photoIds = (db.prepare(`
      SELECT DISTINCT photo_id FROM photo_rolls WHERE roll_id IN (${ph})
    `).all(...rollIds) as { photo_id: number }[]).map((r) => r.photo_id)

    if (photoIds.length === 0) return true

    const delStmt = db.prepare('DELETE FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?')
    const insStmt = db.prepare(
      'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
    )
    db.transaction(() => {
      for (const pid of photoIds) {
        for (const { typeId, valueId } of attrs) {
          delStmt.run(pid, typeId)
          insStmt.run(pid, typeId, valueId)
        }
      }
    })()
    log.info(`Batch set attributes for ${photoIds.length} photos across ${rollIds.length} rolls`)
    return true
  })

  // 获取卷内照片
  ipcMain.handle('rolls:photos', (_, rollId: number | null, params: {
    page: number
    pageSize: number
    filters?: Record<number, number[]>
    subLibraryId?: number
    search?: string
    dateFrom?: string
    dateTo?: string
    dateField?: 'imported_at' | 'shot_date'
    fileTypes?: string[]
    organizationStatuses?: ('unclassified' | 'missing_date' | 'missing_camera')[]
    sortBy?: 'imported_at' | 'shot_date' | 'file_name'
    sortOrder?: 'asc' | 'desc'
  }) => {
    const db = getDb()
    const {
      page,
      pageSize,
      filters = {},
      subLibraryId,
      search,
      dateFrom,
      dateTo,
      dateField = 'imported_at',
      fileTypes = [],
      organizationStatuses = [],
      sortBy = 'imported_at',
      sortOrder = 'desc'
    } = params
    const offset = (page - 1) * pageSize
    const sortExpression = sortBy === 'file_name'
      ? 'p.original_name'
      : sortBy === 'shot_date'
        ? 'COALESCE(p.shot_date, p.imported_at)'
        : 'p.imported_at'
    const dateColumn = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'

    let sql = 'SELECT DISTINCT p.* FROM photos p'
    const args: unknown[] = []
    const wheres: string[] = []
    if (rollId == null) {
      wheres.push('NOT EXISTS (SELECT 1 FROM photo_rolls unassigned_pr WHERE unassigned_pr.photo_id = p.id)')
    } else {
      sql += ' JOIN photo_rolls pr ON pr.photo_id = p.id AND pr.roll_id = ?'
      args.push(rollId)
    }
    let joinIdx = 0

    for (const [typeId, valueIds] of Object.entries(filters)) {
      if (!valueIds || (valueIds as number[]).length === 0) continue
      const tid = parseInt(typeId, 10)
      if (isNaN(tid)) continue
      const alias = `pa${joinIdx++}`
      sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${(valueIds as number[]).map(() => '?').join(',')})`
      args.push(...(valueIds as number[]))
    }

    if (subLibraryId != null) {
      wheres.push(`p.sub_library_id IN (
        WITH RECURSIVE descendants(id) AS (
          SELECT ?
          UNION ALL
          SELECT child.id
          FROM sub_libraries child
          JOIN descendants parent ON child.parent_id = parent.id
        )
        SELECT id FROM descendants
      )`)
      args.push(subLibraryId)
    }
    if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
    if (dateFrom) { wheres.push(`${dateColumn} >= ?`); args.push(dateFrom) }
    if (dateTo) {
      wheres.push(`${dateColumn} <= ?`)
      args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59')
    }
    if (fileTypes.length > 0) {
      wheres.push(`p.file_type IN (${fileTypes.map(() => '?').join(',')})`)
      args.push(...fileTypes)
    }
    if (organizationStatuses.includes('unclassified')) {
      wheres.push('p.sub_library_id IS NULL')
    }
    if (organizationStatuses.includes('missing_date')) {
      wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
    }
    if (organizationStatuses.includes('missing_camera')) {
      wheres.push(`NOT EXISTS (
        SELECT 1 FROM photo_attributes status_pa
        JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id
        WHERE status_pa.photo_id = p.id AND status_at.key = 'camera'
      )`)
    }
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ')
    sql += ` ORDER BY ${sortExpression} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`

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

function getPhotolessCount(db: ReturnType<typeof getDb>, params: RollQueryParams): number {
  const {
    subLibraryId,
    filters = {},
    search,
    dateFrom,
    dateTo,
    dateField = 'imported_at',
    fileTypes = [],
    organizationStatuses = []
  } = params
  const dateColumn = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'
  let sql = 'SELECT COUNT(DISTINCT p.id) as c FROM photos p'
  const args: unknown[] = []
  let joinIdx = 0
  for (const [typeId, valueIds] of Object.entries(filters)) {
    if (!valueIds || valueIds.length === 0) continue
    const tid = parseInt(typeId, 10)
    if (isNaN(tid)) continue
    const alias = `other_pa${joinIdx++}`
    sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
    args.push(...valueIds)
  }
  const wheres = ['NOT EXISTS (SELECT 1 FROM photo_rolls other_pr WHERE other_pr.photo_id = p.id)']
  if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
  if (dateFrom) { wheres.push(`${dateColumn} >= ?`); args.push(dateFrom) }
  if (dateTo) {
    wheres.push(`${dateColumn} <= ?`)
    args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59')
  }
  if (fileTypes.length > 0) {
    wheres.push(`p.file_type IN (${fileTypes.map(() => '?').join(',')})`)
    args.push(...fileTypes)
  }
  if (organizationStatuses.includes('unclassified')) wheres.push('p.sub_library_id IS NULL')
  if (organizationStatuses.includes('missing_date')) wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
  if (organizationStatuses.includes('missing_camera')) {
    wheres.push(`NOT EXISTS (
      SELECT 1 FROM photo_attributes status_pa
      JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id
      WHERE status_pa.photo_id = p.id AND status_at.key = 'camera'
    )`)
  }
  if (subLibraryId != null) {
    wheres.push(`p.sub_library_id IN (
      WITH RECURSIVE descendants(id) AS (
        SELECT ?
        UNION ALL
        SELECT child.id
        FROM sub_libraries child
        JOIN descendants parent ON child.parent_id = parent.id
      )
      SELECT id FROM descendants
    )`)
    args.push(subLibraryId)
  }
  sql += ' WHERE ' + wheres.join(' AND ')
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
  rotation: number
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
