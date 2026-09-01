/**
 * 照片数据访问 Repository。
 * 封装 photos 表的所有 SQL，对外暴露 typed 方法。迁移自 ipc/photos.ts 的查询逻辑。
 * 功能核心层（features/photos）与 IPC 适配层经此访问数据，不直接写 SQL。
 */
import type Database from 'better-sqlite3'
import type { PhotoRow, AttrRow, QueryFilter, Paging } from '../types'

/** 构建 FROM/JOIN/WHERE 子句（photos:list 与 photos:timeline 复用） */
export function buildPhotoFromClause(p: QueryFilter): { fromClause: string; args: unknown[] } {
  const {
    filters = {},
    subLibraryId,
    search,
    dateFrom,
    dateTo,
    dateField = 'imported_at',
    fileTypes = [],
    organizationStatuses = [],
    starredOnly = false
  } = p

  const dateColumn = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'
  let fromClause = `FROM photos p`
  const args: unknown[] = []
  let joinIdx = 0

  for (const [typeId, valueIds] of Object.entries(filters)) {
    const tid = parseInt(typeId, 10)
    if (isNaN(tid) || !valueIds || valueIds.length === 0) continue
    const alias = `pa${joinIdx++}`
    fromClause += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
    args.push(...valueIds)
  }

  const wheres: string[] = [`p.import_status = 'ready'`, `(p.deleted_at IS NULL)`]
  if (subLibraryId != null) {
    wheres.push(`p.sub_library_id IN (
      WITH RECURSIVE descendants(id) AS (
        SELECT ?
        UNION ALL
        SELECT child.id FROM sub_libraries child JOIN descendants parent ON child.parent_id = parent.id
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
  if (organizationStatuses.includes('unclassified')) wheres.push('p.sub_library_id IS NULL')
  if (organizationStatuses.includes('missing_date')) wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
  if (organizationStatuses.includes('missing_camera')) {
    wheres.push(`NOT EXISTS (
      SELECT 1 FROM photo_attributes status_pa
      JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id
      WHERE status_pa.photo_id = p.id AND status_at.key = 'camera'
    )`)
  }
  if (starredOnly) wheres.push('p.starred = 1')

  fromClause += ' WHERE ' + wheres.join(' AND ')
  return { fromClause, args }
}

function sortExpression(sortBy?: string): string {
  if (sortBy === 'file_name') return 'p.original_name'
  if (sortBy === 'shot_date') return 'COALESCE(p.shot_date, p.imported_at)'
  return 'p.imported_at'
}

export class PhotoRepository {
  constructor(private db: Database.Database) {}

  /** 分页查询照片 */
  list(filter: QueryFilter, paging: Paging): { total: number; rows: PhotoRow[] } {
    const { fromClause, args } = buildPhotoFromClause(filter)
    const offset = (paging.page - 1) * paging.pageSize
    const sort = sortExpression(paging.sortBy)
    const order = paging.sortOrder === 'asc' ? 'ASC' : 'DESC'

    const total = (this.db.prepare(`SELECT COUNT(DISTINCT p.id) as total ${fromClause}`).get(...args) as { total: number }).total
    const rows = this.db.prepare(
      `SELECT DISTINCT p.* ${fromClause} ORDER BY ${sort} ${order} LIMIT ? OFFSET ?`
    ).all(...args, paging.pageSize, offset) as PhotoRow[]
    return { total, rows }
  }

  /** 批量查询照片属性（按 photo_id IN） */
  attributesOf(photoIds: number[]): AttrRow[] {
    if (photoIds.length === 0) return []
    return this.db.prepare(
      `SELECT pa.photo_id, at.key, at.display_name, av.value, av.id as value_id, pa.attribute_type_id
       FROM photo_attributes pa
       JOIN attribute_types at ON at.id = pa.attribute_type_id
       JOIN attribute_values av ON av.id = pa.attribute_value_id
       WHERE pa.photo_id IN (${photoIds.map(() => '?').join(',')})
       ORDER BY at.sort_order`
    ).all(...photoIds) as AttrRow[]
  }

  /** 单张照片（含属性） */
  get(id: number): { photo: PhotoRow | null; attrs: AttrRow[] } {
    const photo = this.db.prepare('SELECT * FROM photos WHERE id = ?').get(id) as PhotoRow | undefined
    if (!photo) return { photo: null, attrs: [] }
    const attrs = this.db.prepare(
      `SELECT pa.attribute_type_id, at.key, at.display_name, av.value, av.id as value_id
       FROM photo_attributes pa
       JOIN attribute_types at ON at.id = pa.attribute_type_id
       JOIN attribute_values av ON av.id = pa.attribute_value_id
       WHERE pa.photo_id = ? ORDER BY at.sort_order`
    ).all(id) as AttrRow[]
    return { photo, attrs }
  }

  /** 文件类型计数 + 整理状态计数（filterOptions） */
  filterOptions(): {
    fileTypes: { value: string; count: number }[]
    statusCounts: { unclassified: number; missing_date: number; missing_camera: number }
  } {
    const fileTypes = this.db.prepare(
      "SELECT file_type as value, COUNT(*) as count FROM photos WHERE import_status = 'ready' AND deleted_at IS NULL GROUP BY file_type ORDER BY file_type"
    ).all() as { value: string; count: number }[]
    const s = this.db.prepare(`
      SELECT
        SUM(CASE WHEN p.sub_library_id IS NULL THEN 1 ELSE 0 END) AS unclassified,
        SUM(CASE WHEN p.shot_date IS NULL OR p.shot_date = '' THEN 1 ELSE 0 END) AS missing_date,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM photo_attributes pa JOIN attribute_types at ON at.id = pa.attribute_type_id
          WHERE pa.photo_id = p.id AND at.key = 'camera'
        ) THEN 1 ELSE 0 END) AS missing_camera
      FROM photos p WHERE p.import_status = 'ready' AND p.deleted_at IS NULL
    `).get() as { unclassified: number | null; missing_date: number | null; missing_camera: number | null }
    return {
      fileTypes,
      statusCounts: {
        unclassified: s.unclassified ?? 0,
        missing_date: s.missing_date ?? 0,
        missing_camera: s.missing_camera ?? 0
      }
    }
  }

  /** 按年月分组统计（时间线） */
  timelineCounts(filter: QueryFilter, dateField: 'imported_at' | 'shot_date'): { month: string; count: number }[] {
    const { fromClause, args } = buildPhotoFromClause({ ...filter, dateField })
    const col = dateField === 'shot_date'
      ? "COALESCE(NULLIF(p.shot_date, ''), p.imported_at)"
      : 'p.imported_at'
    return this.db.prepare(`
      SELECT strftime('%Y-%m', ${col}) as month, COUNT(DISTINCT p.id) as count
      ${fromClause} AND ${col} IS NOT NULL AND ${col} != ''
      GROUP BY month ORDER BY month DESC
    `).all(...args) as { month: string; count: number }[]
  }

  /** 时间线每月缩略图 */
  timelineThumbs(filter: QueryFilter, dateField: 'imported_at' | 'shot_date', month: string, limit: number): PhotoRow[] {
    const { fromClause, args } = buildPhotoFromClause({ ...filter, dateField })
    const col = dateField === 'shot_date'
      ? "COALESCE(NULLIF(p.shot_date, ''), p.imported_at)"
      : 'p.imported_at'
    return this.db.prepare(`
      SELECT DISTINCT p.id, p.thumb_path, p.thumb_ready, p.file_type, p.original_name, p.rotation
      ${fromClause} AND strftime('%Y-%m', ${col}) = ? AND p.thumb_ready = 1 AND p.thumb_path IS NOT NULL
      ORDER BY ${col} ASC LIMIT ${limit}
    `).all(...args, month) as PhotoRow[]
  }

  /** 全量照片数（库统计用，排除回收站） */
  countAll(): number {
    return (this.db.prepare('SELECT COUNT(*) as c FROM photos WHERE deleted_at IS NULL').get() as { c: number }).c
  }

  /** 软删除（移入回收站）：仅标记 deleted_at，文件不动，可恢复 */
  softDelete(ids: number[], deletedAt: string): void {
    if (ids.length === 0) return
    const stmt = this.db.prepare('UPDATE photos SET deleted_at = ? WHERE id = ?')
    this.db.transaction(() => { for (const id of ids) stmt.run(deletedAt, id) })()
  }

  /** 从回收站恢复 */
  restore(ids: number[]): void {
    if (ids.length === 0) return
    const stmt = this.db.prepare('UPDATE photos SET deleted_at = NULL WHERE id = ?')
    this.db.transaction(() => { for (const id of ids) stmt.run(id) })()
  }

  /** 回收站列表（分页，含属性） */
  listTrash(paging: Paging): { total: number; rows: PhotoRow[] } {
    const page = paging.page ?? 1
    const pageSize = paging.pageSize ?? 80
    const offset = (page - 1) * pageSize
    const total = (this.db.prepare('SELECT COUNT(*) as c FROM photos WHERE deleted_at IS NOT NULL').get() as { c: number }).c
    const rows = this.db.prepare(
      'SELECT * FROM photos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT ? OFFSET ?'
    ).all(pageSize, offset) as PhotoRow[]
    return { total, rows }
  }

  /** 回收站全部 id（清空回收站用） */
  listTrashIds(): number[] {
    const rows = this.db.prepare('SELECT id FROM photos WHERE deleted_at IS NOT NULL').all() as { id: number }[]
    return rows.map((r) => r.id)
  }

  /** 重复照片分组（content_hash 相同且未在回收站） */
  duplicateGroups(): { content_hash: string; count: number }[] {
    return this.db.prepare(`
      SELECT content_hash, COUNT(*) as count FROM photos
      WHERE deleted_at IS NULL AND content_hash IS NOT NULL
      GROUP BY content_hash HAVING COUNT(*) > 1 ORDER BY count DESC
    `).all() as { content_hash: string; count: number }[]
  }

  /** 取某 content_hash 的照片（含 file_path/original_name/file_size/imported_at/thumb_path/id/rotation/file_type） */
  photosByHash(hash: string): PhotoRow[] {
    return this.db.prepare(
      'SELECT * FROM photos WHERE content_hash = ? AND deleted_at IS NULL ORDER BY imported_at ASC'
    ).all(hash) as PhotoRow[]
  }

  /** 彻底删除照片记录（事务）—— 回收站清空用，依赖 FK ON DELETE CASCADE 清理关联表 */
  delete(ids: number[]): void {
    if (ids.length === 0) return
    const del = this.db.prepare('DELETE FROM photos WHERE id = ?')
    this.db.transaction(() => { for (const id of ids) del.run(id) })()
  }

  /** 路径是否为已入库照片的 file_path（含 linked 模式下库外路径）。
   *  用于 fullPreview 路径校验：仅允许预览库内已登记的照片，防止渲染层被攻陷后任意文件读取。
   *  走 file_path UNIQUE 索引，单次点查。 */
  pathIsRegistered(filePath: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM photos WHERE file_path = ? LIMIT 1').get(filePath)
    return !!row
  }

  /** 收集待删文件路径（linked 不删源文件） */
  collectFilesForDelete(ids: number[]): { file_path: string; thumb_path?: string }[] {
    if (ids.length === 0) return []
    const sel = this.db.prepare('SELECT file_path, thumb_path, storage_mode FROM photos WHERE id = ?')
    const out: { file_path: string; thumb_path?: string }[] = []
    for (const id of ids) {
      const row = sel.get(id) as { file_path: string; thumb_path?: string; storage_mode: string } | undefined
      if (row && row.storage_mode !== 'linked') out.push({ file_path: row.file_path, thumb_path: row.thumb_path })
    }
    return out
  }

  /** 设置旋转 */
  setRotation(id: number, rotation: number): void {
    this.db.prepare('UPDATE photos SET rotation = ? WHERE id = ?').run(rotation, id)
  }

  /** 更新缩略图 */
  setThumb(id: number, thumbPath: string | null, ready: boolean): void {
    this.db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = ? WHERE id = ?').run(thumbPath, ready ? 1 : 0, id)
  }

  /** 设置收藏 */
  setStarred(id: number, starred: boolean): void {
    this.db.prepare('UPDATE photos SET starred = ? WHERE id = ?').run(starred ? 1 : 0, id)
  }

  /** 批量设置收藏 */
  batchSetStarred(ids: number[], starred: boolean): void {
    if (ids.length === 0) return
    const val = starred ? 1 : 0
    const stmt = this.db.prepare('UPDATE photos SET starred = ? WHERE id = ?')
    this.db.transaction(() => { for (const id of ids) stmt.run(val, id) })()
  }

  /** 更新备注 */
  updateNotes(id: number, notes: string): void {
    this.db.prepare('UPDATE photos SET notes = ? WHERE id = ?').run(notes, id)
  }

  /** 设置拍摄日期 */
  setShotDate(id: number, shotDate: string | null): void {
    this.db.prepare('UPDATE photos SET shot_date = ? WHERE id = ?').run(shotDate, id)
  }

  /** 批量设置拍摄日期 */
  batchSetShotDate(ids: number[], shotDate: string | null): void {
    if (ids.length === 0) return
    const stmt = this.db.prepare('UPDATE photos SET shot_date = ? WHERE id = ?')
    this.db.transaction(() => { for (const id of ids) stmt.run(shotDate, id) })()
  }

  /** 取照片文件路径与旋转 */
  getFilePathRotation(id: number): { file_path: string; rotation: number } | null {
    const row = this.db.prepare('SELECT file_path, rotation FROM photos WHERE id = ?').get(id) as
      { file_path: string; rotation: number } | undefined
    return row ?? null
  }

  /** 取照片 file_path */
  getFilePath(id: number): string | null {
    const row = this.db.prepare('SELECT file_path FROM photos WHERE id = ?').get(id) as { file_path: string } | undefined
    return row?.file_path ?? null
  }

  /** 设置属性（替换全部，事务原子化） */
  setAttributes(photoId: number, assignments: { typeId: number; valueId: number }[]): void {
    const del = this.db.prepare('DELETE FROM photo_attributes WHERE photo_id = ?')
    const ins = this.db.prepare('INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)')
    this.db.transaction(() => {
      del.run(photoId)
      for (const { typeId, valueId } of assignments) ins.run(photoId, typeId, valueId)
    })()
  }

  /** 批量设置属性（per-type per-photo） */
  batchSetAttributes(photoIds: number[], assignments: { typeId: number; valueId: number }[]): void {
    if (photoIds.length === 0 || assignments.length === 0) return
    const del = this.db.prepare('DELETE FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?')
    const ins = this.db.prepare('INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)')
    this.db.transaction(() => {
      for (const photoId of photoIds) {
        for (const { typeId, valueId } of assignments) {
          del.run(photoId, typeId)
          ins.run(photoId, typeId, valueId)
        }
      }
    })()
  }
}
