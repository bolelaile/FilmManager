import { ipcMain } from 'electron'
import path from 'path'
import { getDb } from '../db/index'
import { generateThumbnail, normalizeRotation, renderFullPreview } from '../services/thumbnail'
import { movePhotosToSubLibrary } from '../services/library-layout'
import { getLibraryRoot, getThumbDir } from './index'
import fs from 'fs'
import log from 'electron-log'

export function registerPhotosIpc(): void {
  // 查询照片列表（分页 + 多属性筛选）
  ipcMain.handle(
    'photos:list',
    (
      _,
      params: {
        page: number
        pageSize: number
        filters: Record<number, number[]> // attributeTypeId -> [valueId, ...]
        subLibraryId?: number
        search?: string
        dateFrom?: string
        dateTo?: string
        dateField?: 'imported_at' | 'shot_date'
        fileTypes?: string[]
        organizationStatuses?: ('unclassified' | 'missing_date' | 'missing_camera')[]
        sortBy?: 'imported_at' | 'shot_date' | 'file_name'
        sortOrder?: 'asc' | 'desc'
        starredOnly?: boolean
      }
    ) => {
      try {
      const db = getDb()
      const {
        page,
        pageSize,
        filters,
        subLibraryId,
        search,
        dateFrom,
        dateTo,
        dateField = 'imported_at',
        fileTypes = [],
        organizationStatuses = [],
        sortBy = 'imported_at',
        sortOrder = 'desc',
        starredOnly = false
      } = params
      const offset = (page - 1) * pageSize
      const sortExpression = sortBy === 'file_name'
        ? 'p.original_name'
        : sortBy === 'shot_date'
          ? 'COALESCE(p.shot_date, p.imported_at)'
          : 'p.imported_at'
      const dateColumn = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'

      let fromClause = `FROM photos p`
      const args: unknown[] = []
      let joinIdx = 0

      // JOIN 每个筛选属性
      for (const [typeId, valueIds] of Object.entries(filters)) {
        if (!valueIds || (valueIds as number[]).length === 0) continue
        const alias = `pa${joinIdx++}`
        fromClause += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${typeId} AND ${alias}.attribute_value_id IN (${(valueIds as number[]).map(() => '?').join(',')})`
        args.push(...(valueIds as number[]))
      }

      const wheres: string[] = []
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
      if (search) { wheres.push("p.original_name LIKE ?"); args.push(`%${search}%`) }
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
      if (starredOnly) {
        wheres.push('p.starred = 1')
      }

      if (wheres.length) fromClause += ' WHERE ' + wheres.join(' AND ')

      // COUNT 查询：COUNT(DISTINCT p.id) 避免子查询包裹的双重开销
      const countSql = `SELECT COUNT(DISTINCT p.id) as total ${fromClause}`
      const total = (db.prepare(countSql).get(...args) as { total: number }).total

      // 数据查询：加 ORDER BY + LIMIT/OFFSET
      const dataSql = `SELECT DISTINCT p.* ${fromClause} ORDER BY ${sortExpression} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`
      const rows = db.prepare(dataSql).all(...args, pageSize, offset) as PhotoRow[]

      // 批量查询每张图的属性标签
      const ids = rows.map((r) => r.id)
      const attrs = ids.length
        ? (db
            .prepare(
              `SELECT pa.photo_id, at.key, at.display_name, av.value, av.id as value_id, pa.attribute_type_id
               FROM photo_attributes pa
               JOIN attribute_types at ON at.id = pa.attribute_type_id
               JOIN attribute_values av ON av.id = pa.attribute_value_id
               WHERE pa.photo_id IN (${ids.map(() => '?').join(',')})
               ORDER BY at.sort_order`
            )
            .all(...ids) as AttrRow[])
        : []

      const attrMap = new Map<number, AttrRow[]>()
      for (const a of attrs) {
        if (!attrMap.has(a.photo_id)) attrMap.set(a.photo_id, [])
        attrMap.get(a.photo_id)!.push(a)
      }

      return { total, rows: rows.map((r) => ({ ...r, attributes: attrMap.get(r.id) ?? [] })) }
      } catch (err) {
        log.error('photos:list error:', err)
        throw err
      }
    }
  )

  ipcMain.handle('photos:filterOptions', () => {
    const db = getDb()
    const fileTypes = db
      .prepare('SELECT file_type as value, COUNT(*) as count FROM photos GROUP BY file_type ORDER BY file_type')
      .all() as { value: string; count: number }[]
    const statusCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN p.sub_library_id IS NULL THEN 1 ELSE 0 END) AS unclassified,
        SUM(CASE WHEN p.shot_date IS NULL OR p.shot_date = '' THEN 1 ELSE 0 END) AS missing_date,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM photo_attributes pa
          JOIN attribute_types at ON at.id = pa.attribute_type_id
          WHERE pa.photo_id = p.id AND at.key = 'camera'
        ) THEN 1 ELSE 0 END) AS missing_camera
      FROM photos p
    `).get() as { unclassified: number | null; missing_date: number | null; missing_camera: number | null }

    return {
      fileTypes,
      statusCounts: {
        unclassified: statusCounts.unclassified ?? 0,
        missing_date: statusCounts.missing_date ?? 0,
        missing_camera: statusCounts.missing_camera ?? 0
      }
    }
  })

  // 获取单张照片详情
  ipcMain.handle('photos:get', (_, id: number) => {
    const db = getDb()
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id)
    if (!photo) return null
    const attrs = db
      .prepare(
        `SELECT pa.attribute_type_id, at.key, at.display_name, av.value, av.id as value_id
         FROM photo_attributes pa
         JOIN attribute_types at ON at.id = pa.attribute_type_id
         JOIN attribute_values av ON av.id = pa.attribute_value_id
         WHERE pa.photo_id = ?
         ORDER BY at.sort_order`
      )
      .all(id)
    return { ...photo, attributes: attrs }
  })

  // 更新照片属性（替换全部，事务保证原子性）
  ipcMain.handle(
    'photos:setAttributes',
    (_, photoId: number, attrAssignments: { typeId: number; valueId: number }[]) => {
      const db = getDb()
      const delStmt = db.prepare('DELETE FROM photo_attributes WHERE photo_id = ?')
      const insStmt = db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      )
      // DELETE + INSERT 在同一事务内，任一失败则全部回滚
      db.transaction(() => {
        delStmt.run(photoId)
        for (const { typeId, valueId } of attrAssignments) {
          insStmt.run(photoId, typeId, valueId)
        }
      })()
      return true
    }
  )

  // 批量设置属性
  ipcMain.handle(
    'photos:batchSetAttributes',
    (_, photoIds: number[], attrAssignments: { typeId: number; valueId: number }[]) => {
      const db = getDb()
      const deleteStmt = db.prepare('DELETE FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?')
      const ins = db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      )
      const tx = db.transaction(() => {
        for (const photoId of photoIds) {
          for (const { typeId, valueId } of attrAssignments) {
            deleteStmt.run(photoId, typeId)
            ins.run(photoId, typeId, valueId)
          }
        }
      })
      tx()
      return true
    }
  )

  // 更新备注
  ipcMain.handle('photos:updateNotes', (_, id: number, notes: string) => {
    getDb().prepare('UPDATE photos SET notes = ? WHERE id = ?').run(notes, id)
    return true
  })

  // 设置拍摄日期（单张）
  ipcMain.handle('photos:setShotDate', (_, id: number, shotDate: string | null) => {
    getDb().prepare('UPDATE photos SET shot_date = ? WHERE id = ?').run(shotDate ?? null, id)
    return true
  })

  // 批量设置拍摄日期
  ipcMain.handle('photos:batchSetShotDate', (_, ids: number[], shotDate: string | null) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE photos SET shot_date = ? WHERE id = ?')
    const tx = db.transaction(() => { ids.forEach((id) => stmt.run(shotDate ?? null, id)) })
    tx()
    return true
  })

  // 删除照片（先收集路径，事务原子删 DB，再删磁盘文件）
  ipcMain.handle('photos:delete', (_, ids: number[], deleteFile: boolean) => {
    const db = getDb()

    // 先收集待删文件路径（DB 操作前查询，避免删后无法找到路径）
    // linked 模式的源文件不属于图库管理，不随照片记录删除
    const filesToDelete: { file_path: string; thumb_path?: string }[] = []
    if (deleteFile) {
      const sel = db.prepare('SELECT file_path, thumb_path, storage_mode FROM photos WHERE id = ?')
      for (const id of ids) {
        const row = sel.get(id) as { file_path: string; thumb_path?: string; storage_mode: string } | undefined
        if (row && row.storage_mode !== 'linked') filesToDelete.push(row)
      }
    }

    // 事务原子性删除 DB 记录（任一失败则全部回滚）
    const delStmt = db.prepare('DELETE FROM photos WHERE id = ?')
    db.transaction(() => {
      for (const id of ids) delStmt.run(id)
    })()

    // DB 提交成功后再删磁盘文件（文件删除失败不影响 DB 一致性）
    for (const { file_path, thumb_path } of filesToDelete) {
      try { fs.unlinkSync(file_path) } catch {}
      if (thumb_path) try { fs.unlinkSync(thumb_path) } catch {}
    }
    return true
  })

  // 全屏预览：返回 base64 JPEG
  ipcMain.handle('photos:fullPreview', async (_, filePath: string, iccPath?: string, rotation = 0) => {
    const result = await renderFullPreview(filePath, iccPath, rotation)
    if (!result) return null
    return {
      dataUrl: `data:image/jpeg;base64,${result.buffer.toString('base64')}`,
      width: result.width,
      height: result.height
    }
  })

  ipcMain.handle('photos:setRotation', async (_, photoId: number, rotation: number) => {
    const db = getDb()
    const nextRotation = normalizeRotation(rotation)
    const row = db
      .prepare('SELECT file_path FROM photos WHERE id = ?')
      .get(photoId) as { file_path: string } | undefined
    if (!row) return null

    db.prepare('UPDATE photos SET rotation = ? WHERE id = ?').run(nextRotation, photoId)
    const thumbPath = await generateThumbnail(row.file_path, getThumbDir(), nextRotation)
    if (thumbPath) {
      db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
    }
    return { id: photoId, rotation: nextRotation, thumbPath: thumbPath ?? null }
  })

  ipcMain.handle('photos:batchRotate', async (_, photoIds: number[], delta = 90) => {
    const db = getDb()
    const normalizedDelta = normalizeRotation(delta)
    let updated = 0
    for (const photoId of photoIds) {
      const row = db
        .prepare('SELECT file_path, rotation FROM photos WHERE id = ?')
        .get(photoId) as { file_path: string; rotation?: number } | undefined
      if (!row) continue
      const nextRotation = normalizeRotation((row.rotation ?? 0) + normalizedDelta)
      db.prepare('UPDATE photos SET rotation = ? WHERE id = ?').run(nextRotation, photoId)
      const thumbPath = await generateThumbnail(row.file_path, getThumbDir(), nextRotation)
      if (thumbPath) {
        db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
      }
      updated++
    }
    return { updated }
  })

  // 获取缩略图 base64（用于已有 thumb_path 的快速读取）
  ipcMain.handle('photos:thumbDataUrl', (_, thumbPath: string) => {
    try {
      const buf = fs.readFileSync(thumbPath)
      return `data:image/webp;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })

  // 移动到子库
  ipcMain.handle('photos:moveToSubLibrary', (_, photoIds: number[], subLibraryId: number | null) => {
    return movePhotosToSubLibrary(
      getDb(),
      path.join(getLibraryRoot(), 'files'),
      photoIds,
      subLibraryId
    )
  })

  // 切换单张照片的收藏状态
  ipcMain.handle('photos:toggleStar', (_, photoId: number) => {
    const db = getDb()
    const row = db.prepare('SELECT starred FROM photos WHERE id = ?').get(photoId) as { starred: number } | undefined
    if (!row) return false
    const newVal = row.starred ? 0 : 1
    db.prepare('UPDATE photos SET starred = ? WHERE id = ?').run(newVal, photoId)
    return newVal === 1
  })

  // 批量设置收藏状态
  ipcMain.handle('photos:batchStar', (_, photoIds: number[], starred: boolean) => {
    const db = getDb()
    const val = starred ? 1 : 0
    const stmt = db.prepare('UPDATE photos SET starred = ? WHERE id = ?')
    db.transaction(() => { for (const id of photoIds) stmt.run(val, id) })()
    return true
  })
}

interface PhotoRow { id: number; file_path: string; original_name: string; file_type: string; thumb_path?: string; thumb_ready: number; width?: number; height?: number; file_size?: number; sub_library_id?: number; imported_at: string; notes: string; storage_mode: string; import_status: string }
interface AttrRow { photo_id: number; attribute_type_id: number; key: string; display_name: string; value: string; value_id: number }
