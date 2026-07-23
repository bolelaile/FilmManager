import { ipcMain } from 'electron'
import { getDb } from '../db/index'
import { renderFullPreview } from '../services/thumbnail'
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
        sortBy?: 'imported_at' | 'file_name'
        sortOrder?: 'asc' | 'desc'
      }
    ) => {
      try {
      const db = getDb()
      const { page, pageSize, filters, subLibraryId, search, dateFrom, dateTo, sortBy = 'imported_at', sortOrder = 'desc' } = params
      const offset = (page - 1) * pageSize
      // 'file_name' is the UI key; actual column is 'original_name'
      const sortCol = sortBy === 'file_name' ? 'original_name' : sortBy

      let sql = `SELECT DISTINCT p.* FROM photos p`
      const args: unknown[] = []
      let joinIdx = 0

      // JOIN 每个筛选属性
      for (const [typeId, valueIds] of Object.entries(filters)) {
        if (!valueIds || (valueIds as number[]).length === 0) continue
        const alias = `pa${joinIdx++}`
        sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${typeId} AND ${alias}.attribute_value_id IN (${(valueIds as number[]).map(() => '?').join(',')})`
        args.push(...(valueIds as number[]))
      }

      const wheres: string[] = []
      if (subLibraryId != null) { wheres.push('p.sub_library_id = ?'); args.push(subLibraryId) }
      if (search) { wheres.push("p.original_name LIKE ?"); args.push(`%${search}%`) }
      if (dateFrom) { wheres.push("p.imported_at >= ?"); args.push(dateFrom) }
      if (dateTo) { wheres.push("p.imported_at <= ?"); args.push(dateTo + ' 23:59:59') }

      if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ')
      sql += ` ORDER BY p.${sortCol} ${sortOrder}`

      const countSql = `SELECT COUNT(*) as total FROM (${sql}) t`
      const total = (db.prepare(countSql).get(...args) as { total: number }).total

      sql += ' LIMIT ? OFFSET ?'
      const rows = db.prepare(sql).all(...args, pageSize, offset) as PhotoRow[]

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

  // 更新照片属性（替换全部）
  ipcMain.handle(
    'photos:setAttributes',
    (_, photoId: number, attrAssignments: { typeId: number; valueId: number }[]) => {
      const db = getDb()
      db.prepare('DELETE FROM photo_attributes WHERE photo_id = ?').run(photoId)
      const ins = db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      )
      for (const { typeId, valueId } of attrAssignments) {
        ins.run(photoId, typeId, valueId)
      }
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

  // 删除照片（从库和磁盘）
  ipcMain.handle('photos:delete', (_, ids: number[], deleteFile: boolean) => {
    const db = getDb()
    for (const id of ids) {
      if (deleteFile) {
        const row = db.prepare('SELECT file_path, thumb_path FROM photos WHERE id = ?').get(id) as { file_path: string; thumb_path?: string } | undefined
        if (row) {
          try { fs.unlinkSync(row.file_path) } catch {}
          if (row.thumb_path) try { fs.unlinkSync(row.thumb_path) } catch {}
        }
      }
      db.prepare('DELETE FROM photos WHERE id = ?').run(id)
    }
    return true
  })

  // 全屏预览：返回 base64 JPEG
  ipcMain.handle('photos:fullPreview', async (_, filePath: string, iccPath?: string) => {
    const result = await renderFullPreview(filePath, iccPath)
    if (!result) return null
    return {
      dataUrl: `data:image/jpeg;base64,${result.buffer.toString('base64')}`,
      width: result.width,
      height: result.height
    }
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
    const db = getDb()
    const stmt = db.prepare('UPDATE photos SET sub_library_id = ? WHERE id = ?')
    const tx = db.transaction(() => { photoIds.forEach((id) => stmt.run(subLibraryId, id)) })
    tx()
    return true
  })
}

interface PhotoRow { id: number; file_path: string; original_name: string; file_type: string; thumb_path?: string; thumb_ready: number; width?: number; height?: number; file_size?: number; sub_library_id?: number; imported_at: string; notes: string }
interface AttrRow { photo_id: number; attribute_type_id: number; key: string; display_name: string; value: string; value_id: number }
