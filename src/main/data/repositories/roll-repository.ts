/**
 * 胶卷数据访问 Repository。迁移自 ipc/rolls.ts。
 */
import type Database from 'better-sqlite3'
import type { PhotoRow, AttrRow, QueryFilter, Paging } from '../types'

export interface RollRow {
  id: number; name: string; sub_library_id: number | null; cover_photo_id: number | null; created_at: string
  photo_count?: number; thumb_path?: string; thumb_ready?: number; shot_date_min?: string | null
  attributes?: AttrRow[]; location_name?: string | null
}

export class RollRepository {
  constructor(private db: Database.Database) {}

  /** 列出卷（含照片数/封面/属性摘要/地点/shot_date_min，复用 photos 筛选） */
  list(params: QueryFilter): { rolls: RollRow[]; photolessCount: number } {
    const { subLibraryId, filters = {}, search, dateFrom, dateTo, dateField = 'imported_at', fileTypes = [], organizationStatuses = [] } = params
    const dateColumn = dateField === 'shot_date' ? 'member.shot_date' : 'member.imported_at'
    let sql = `
      SELECT r.*, COUNT(DISTINCT CASE WHEN member.deleted_at IS NULL THEN pr.photo_id END) as photo_count, cover.thumb_path, cover.thumb_ready, MIN(member.shot_date) as shot_date_min
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
      const tid = parseInt(typeId, 10); if (isNaN(tid)) continue
      const alias = `roll_pa${joinIdx++}`
      sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = member.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
      args.push(...valueIds); hasPhotoFilters = true
    }
    const wheres: string[] = []
    if (subLibraryId != null) {
      wheres.push(`r.sub_library_id IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION ALL SELECT child.id FROM sub_libraries child JOIN descendants parent ON child.parent_id = parent.id) SELECT id FROM descendants)`)
      args.push(subLibraryId)
    }
    if (search) { wheres.push('member.original_name LIKE ?'); args.push(`%${search}%`); hasPhotoFilters = true }
    if (dateFrom) { wheres.push(`${dateColumn} >= ?`); args.push(dateFrom); hasPhotoFilters = true }
    if (dateTo) { wheres.push(`${dateColumn} <= ?`); args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59'); hasPhotoFilters = true }
    if (fileTypes.length > 0) { wheres.push(`member.file_type IN (${fileTypes.map(() => '?').join(',')})`); args.push(...fileTypes); hasPhotoFilters = true }
    if (organizationStatuses.includes('unclassified')) { wheres.push('member.sub_library_id IS NULL'); hasPhotoFilters = true }
    if (organizationStatuses.includes('missing_date')) { wheres.push("(member.shot_date IS NULL OR member.shot_date = '')"); hasPhotoFilters = true }
    if (organizationStatuses.includes('missing_camera')) { wheres.push(`NOT EXISTS (SELECT 1 FROM photo_attributes status_pa JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id WHERE status_pa.photo_id = member.id AND status_at.key = 'camera')`); hasPhotoFilters = true }
    if (hasPhotoFilters) wheres.push('member.id IS NOT NULL')
    if (wheres.length > 0) sql += ' WHERE ' + wheres.join(' AND ')
    sql += ' GROUP BY r.id ORDER BY r.created_at DESC'
    const rolls = this.db.prepare(sql).all(...args) as RollRow[]
    const photolessCount = this.photolessCount(params)
    if (rolls.length === 0) return { rolls: [], photolessCount }

    // 属性摘要 + 地点
    const rollIds = rolls.map((r) => r.id)
    const attrRows = this.db.prepare(`
      SELECT DISTINCT pr.roll_id, at.id as attribute_type_id, at.key, at.display_name, av.value, av.id as value_id, av.icon_key
      FROM photo_rolls pr JOIN photo_attributes pa ON pa.photo_id = pr.photo_id
      JOIN attribute_types at ON at.id = pa.attribute_type_id JOIN attribute_values av ON av.id = pa.attribute_value_id
      WHERE pr.roll_id IN (${rollIds.map(() => '?').join(',')}) AND at.key IN ('film','film_format','camera','lens') ORDER BY at.sort_order
    `).all(...rollIds) as AttrRow[]
    const attrMap = new Map<number, AttrRow[]>()
    for (const row of attrRows) {
      if (!attrMap.has(row.roll_id!)) attrMap.set(row.roll_id!, [])
      const existing = attrMap.get(row.roll_id!)!
      if (!existing.find((e) => e.key === row.key)) existing.push(row)
    }
    const locRows = this.db.prepare(`
      SELECT DISTINCT pr.roll_id, l.name as location_name FROM photo_rolls pr
      JOIN photo_locations pl ON pl.photo_id = pr.photo_id JOIN locations l ON l.id = pl.location_id
      WHERE pr.roll_id IN (${rollIds.map(() => '?').join(',')})
    `).all(...rollIds) as { roll_id: number; location_name: string }[]
    const locMap = new Map<number, string>()
    for (const row of locRows) { if (!locMap.has(row.roll_id)) locMap.set(row.roll_id, row.location_name) }

    return {
      rolls: rolls.map((r) => ({ ...r, attributes: attrMap.get(r.id) ?? [], location_name: locMap.get(r.id) ?? null })),
      photolessCount
    }
  }

  /** 未分卷照片计数 */
  photolessCount(params: QueryFilter): number {
    const { subLibraryId, filters = {}, search, dateFrom, dateTo, dateField = 'imported_at', fileTypes = [], organizationStatuses = [] } = params
    const dateColumn = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'
    let sql = 'SELECT COUNT(DISTINCT p.id) as c FROM photos p'
    const args: unknown[] = []
    let joinIdx = 0
    for (const [typeId, valueIds] of Object.entries(filters)) {
      if (!valueIds || valueIds.length === 0) continue
      const tid = parseInt(typeId, 10); if (isNaN(tid)) continue
      const alias = `other_pa${joinIdx++}`
      sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
      args.push(...valueIds)
    }
    const wheres = ['NOT EXISTS (SELECT 1 FROM photo_rolls other_pr WHERE other_pr.photo_id = p.id)', 'p.deleted_at IS NULL']
    if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
    if (dateFrom) { wheres.push(`${dateColumn} >= ?`); args.push(dateFrom) }
    if (dateTo) { wheres.push(`${dateColumn} <= ?`); args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59') }
    if (fileTypes.length > 0) { wheres.push(`p.file_type IN (${fileTypes.map(() => '?').join(',')})`); args.push(...fileTypes) }
    if (organizationStatuses.includes('unclassified')) wheres.push('p.sub_library_id IS NULL')
    if (organizationStatuses.includes('missing_date')) wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
    if (organizationStatuses.includes('missing_camera')) wheres.push(`NOT EXISTS (SELECT 1 FROM photo_attributes status_pa JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id WHERE status_pa.photo_id = p.id AND status_at.key = 'camera')`)
    if (subLibraryId != null) {
      wheres.push(`p.sub_library_id IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION ALL SELECT child.id FROM sub_libraries child JOIN descendants parent ON child.parent_id = parent.id) SELECT id FROM descendants)`)
      args.push(subLibraryId)
    }
    sql += ' WHERE ' + wheres.join(' AND ')
    return (this.db.prepare(sql).get(...args) as { c: number }).c
  }

  /** 卷内照片分页（rollId=null 为未分卷） */
  photos(rollId: number | null, filter: QueryFilter, paging: Paging): { total: number; rows: PhotoRow[] } {
    const { filters = {}, subLibraryId, search, dateFrom, dateTo, dateField = 'imported_at', fileTypes = [], organizationStatuses = [] } = filter
    const { sortBy = 'imported_at', sortOrder = 'desc' } = paging
    const offset = (paging.page - 1) * paging.pageSize
    const sort = sortBy === 'file_name' ? 'p.original_name' : sortBy === 'shot_date' ? 'COALESCE(p.shot_date, p.imported_at)' : 'p.imported_at'
    const dateColumn = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'
    let sql = 'SELECT DISTINCT p.* FROM photos p'
    const args: unknown[] = []
    const wheres: string[] = ['p.deleted_at IS NULL']
    if (rollId == null) wheres.push('NOT EXISTS (SELECT 1 FROM photo_rolls unassigned_pr WHERE unassigned_pr.photo_id = p.id)')
    else { sql += ' JOIN photo_rolls pr ON pr.photo_id = p.id AND pr.roll_id = ?'; args.push(rollId) }
    let joinIdx = 0
    for (const [typeId, valueIds] of Object.entries(filters)) {
      if (!valueIds || valueIds.length === 0) continue
      const tid = parseInt(typeId, 10); if (isNaN(tid)) continue
      const alias = `pa${joinIdx++}`
      sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
      args.push(...valueIds)
    }
    if (subLibraryId != null) {
      wheres.push(`p.sub_library_id IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION ALL SELECT child.id FROM sub_libraries child JOIN descendants parent ON child.parent_id = parent.id) SELECT id FROM descendants)`)
      args.push(subLibraryId)
    }
    if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
    if (dateFrom) { wheres.push(`${dateColumn} >= ?`); args.push(dateFrom) }
    if (dateTo) { wheres.push(`${dateColumn} <= ?`); args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59') }
    if (fileTypes.length > 0) { wheres.push(`p.file_type IN (${fileTypes.map(() => '?').join(',')})`); args.push(...fileTypes) }
    if (organizationStatuses.includes('unclassified')) wheres.push('p.sub_library_id IS NULL')
    if (organizationStatuses.includes('missing_date')) wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
    if (organizationStatuses.includes('missing_camera')) wheres.push(`NOT EXISTS (SELECT 1 FROM photo_attributes status_pa JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id WHERE status_pa.photo_id = p.id AND status_at.key = 'camera')`)
    if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ')
    sql += ` ORDER BY ${sort} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`
    const total = (this.db.prepare(`SELECT COUNT(*) as total FROM (${sql}) t`).get(...args) as { total: number }).total
    sql += ' LIMIT ? OFFSET ?'
    const rows = this.db.prepare(sql).all(...args, paging.pageSize, offset) as PhotoRow[]
    return { total, rows }
  }

  create(name: string, subLibraryId: number | null, coverPhotoId: number | null): number {
    const r = this.db.prepare('INSERT INTO rolls (name, sub_library_id, cover_photo_id) VALUES (?, ?, ?)').run(name, subLibraryId, coverPhotoId)
    return Number(r.lastInsertRowid)
  }
  rename(id: number, name: string): void {
    this.db.prepare('UPDATE rolls SET name = ? WHERE id = ?').run(name.trim(), id)
  }
  setCover(rollId: number, photoId: number): void {
    this.db.prepare('UPDATE rolls SET cover_photo_id = ? WHERE id = ?').run(photoId, rollId)
  }
  delete(id: number): void {
    this.db.prepare('DELETE FROM rolls WHERE id = ?').run(id)
  }
  batchDelete(ids: number[]): void {
    if (ids.length === 0) return
    const ph = ids.map(() => '?').join(',')
    this.db.prepare(`DELETE FROM rolls WHERE id IN (${ph})`).run(...ids)
  }
  addPhotos(rollId: number, photoIds: number[]): void {
    if (photoIds.length === 0) return
    const ins = this.db.prepare('INSERT OR IGNORE INTO photo_rolls (photo_id, roll_id) VALUES (?, ?)')
    this.db.transaction(() => { for (const pid of photoIds) ins.run(pid, rollId) })()
  }
  removePhotos(rollId: number, photoIds: number[]): void {
    if (photoIds.length === 0) return
    const del = this.db.prepare('DELETE FROM photo_rolls WHERE roll_id = ? AND photo_id = ?')
    this.db.transaction(() => { for (const pid of photoIds) del.run(rollId, pid) })()
  }
  /** 卷内照片 id */
  photoIdsOfRolls(rollIds: number[]): number[] {
    if (rollIds.length === 0) return []
    const ph = rollIds.map(() => '?').join(',')
    return (this.db.prepare(`SELECT DISTINCT photo_id FROM photo_rolls WHERE roll_id IN (${ph})`).all(...rollIds) as { photo_id: number }[]).map((r) => r.photo_id)
  }
  /** 照片所属卷 */
  forPhoto(photoId: number): RollRow[] {
    return this.db.prepare('SELECT r.* FROM rolls r JOIN photo_rolls pr ON pr.roll_id = r.id WHERE pr.photo_id = ?').all(photoId) as RollRow[]
  }
  /** 卷内照片属性（批量，用于属性摘要） */
  attributesOfRolls(rollIds: number[]): AttrRow[] {
    if (rollIds.length === 0) return []
    const ph = rollIds.map(() => '?').join(',')
    return this.db.prepare(`
      SELECT DISTINCT pr.roll_id, at.id as attribute_type_id, at.key, at.display_name, av.value, av.id as value_id, av.icon_key
      FROM photo_rolls pr JOIN photo_attributes pa ON pa.photo_id = pr.photo_id
      JOIN attribute_types at ON at.id = pa.attribute_type_id JOIN attribute_values av ON av.id = pa.attribute_value_id
      WHERE pr.roll_id IN (${ph}) ORDER BY at.sort_order
    `).all(...rollIds) as AttrRow[]
  }
}
