/**
 * 属性数据访问 Repository。迁移自 ipc/attributes.ts。
 * 含 faceted search（valueCounts 排除自身类型的联动计数）。
 */
import type Database from 'better-sqlite3'
import type { QueryFilter } from '../types'

export interface AttrTypeRow {
  id: number; key: string; display_name: string; is_system: number; is_active: number; sort_order: number
}
export interface AttrValueRow {
  id: number; attribute_type_id: number; value: string; icon_key?: string | null; is_preset: number
  film_size_type?: string | null
  camera_formats?: string | null
  camera_default_format?: string | null
}
export interface AliasRow { id: number; alias: string }

/** 构建"符合非属性类筛选 + 指定属性筛选（排除 excludeTypeId）"的照片 id 子查询 */
function buildFilteredPhotoSql(params: QueryFilter, excludeTypeId: number): { sql: string; args: unknown[] } {
  const { filters = {}, subLibraryId, search, dateFrom, dateTo, dateField = 'imported_at', fileTypes = [], organizationStatuses = [] } = params
  let sql = 'SELECT DISTINCT p.id FROM photos p'
  const args: unknown[] = []
  let joinIdx = 0
  for (const [typeId, valueIds] of Object.entries(filters)) {
    const tid = parseInt(typeId, 10)
    if (isNaN(tid) || tid === excludeTypeId || !valueIds || valueIds.length === 0) continue
    const alias = `pa${joinIdx++}`
    sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${valueIds.map(() => '?').join(',')})`
    args.push(...valueIds)
  }
  const wheres: string[] = ['p.deleted_at IS NULL']
  if (subLibraryId != null) {
    wheres.push(`p.sub_library_id IN (
      WITH RECURSIVE descendants(id) AS (
        SELECT ? UNION ALL
        SELECT child.id FROM sub_libraries child JOIN descendants parent ON child.parent_id = parent.id
      ) SELECT id FROM descendants
    )`)
    args.push(subLibraryId)
  }
  if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
  const dateCol = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'
  if (dateFrom) { wheres.push(`${dateCol} >= ?`); args.push(dateFrom) }
  if (dateTo) { wheres.push(`${dateCol} <= ?`); args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59') }
  if (fileTypes.length > 0) { wheres.push(`p.file_type IN (${fileTypes.map(() => '?').join(',')})`); args.push(...fileTypes) }
  if (organizationStatuses.includes('unclassified')) wheres.push('p.sub_library_id IS NULL')
  if (organizationStatuses.includes('missing_date')) wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
  if (organizationStatuses.includes('missing_camera')) {
    wheres.push(`NOT EXISTS (SELECT 1 FROM photo_attributes status_pa JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id WHERE status_pa.photo_id = p.id AND status_at.key = 'camera')`)
  }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ')
  return { sql, args }
}

export class AttributeRepository {
  constructor(private db: Database.Database) {}

  listTypes(): AttrTypeRow[] {
    return this.db.prepare('SELECT * FROM attribute_types ORDER BY sort_order, id').all() as AttrTypeRow[]
  }
  listActiveTypes(): AttrTypeRow[] {
    return this.db.prepare('SELECT * FROM attribute_types WHERE is_active = 1 ORDER BY sort_order, id').all() as AttrTypeRow[]
  }
  listValues(typeId: number): AttrValueRow[] {
    return this.db.prepare('SELECT * FROM attribute_values WHERE attribute_type_id = ? ORDER BY is_preset DESC, value ASC').all(typeId) as AttrValueRow[]
  }
  listAllValues(): AttrValueRow[] {
    return this.db.prepare('SELECT * FROM attribute_values ORDER BY is_preset DESC, value ASC').all() as AttrValueRow[]
  }
  /** 类型 + 值（筛选面板用） */
  listAllWithValues(): (AttrTypeRow & { values: AttrValueRow[] })[] {
    const types = this.listActiveTypes()
    const values = this.listAllValues()
    const byType = new Map<number, AttrValueRow[]>()
    for (const v of values) {
      if (!byType.has(v.attribute_type_id)) byType.set(v.attribute_type_id, [])
      byType.get(v.attribute_type_id)!.push(v)
    }
    return types.map((t) => ({ ...t, values: byType.get(t.id) ?? [] }))
  }

  /** faceted 联动计数 */
  valueCounts(params?: QueryFilter): { attribute_type_id: number; attribute_value_id: number; count: number }[] {
    const filters = params?.filters ?? {}
    const hasAttr = Object.values(filters).some((v) => v.length > 0)
    const hasNonAttr = !!(params?.subLibraryId != null || params?.dateFrom || params?.dateTo || (params?.fileTypes ?? []).length > 0 || (params?.organizationStatuses ?? []).length > 0 || params?.search)
    if (!hasAttr && !hasNonAttr) {
      return this.db.prepare(
        `SELECT pa.attribute_type_id, pa.attribute_value_id, COUNT(DISTINCT pa.photo_id) as count
         FROM photo_attributes pa JOIN photos p ON p.id = pa.photo_id AND p.deleted_at IS NULL
         GROUP BY pa.attribute_type_id, pa.attribute_value_id`
      ).all() as { attribute_type_id: number; attribute_value_id: number; count: number }[]
    }
    const types = this.db.prepare('SELECT id FROM attribute_types WHERE is_active = 1').all() as { id: number }[]
    const result: { attribute_type_id: number; attribute_value_id: number; count: number }[] = []
    for (const { id: typeId } of types) {
      const { sql, args } = buildFilteredPhotoSql(params!, typeId)
      const rows = this.db.prepare(
        `SELECT ? as attribute_type_id, pa.attribute_value_id, COUNT(DISTINCT pa.photo_id) as count FROM photo_attributes pa WHERE pa.attribute_type_id = ? AND pa.photo_id IN (${sql}) GROUP BY pa.attribute_value_id`
      ).all(typeId, typeId, ...args) as { attribute_type_id: number; attribute_value_id: number; count: number }[]
      result.push(...rows)
    }
    return result
  }

  /** 按属性类型 key 统计各值照片数（统计仪表盘用，排除回收站） */
  countsByTypeKey(key: string): { value: string; icon_key?: string | null; count: number }[] {
    return this.db.prepare(`
      SELECT av.value, av.icon_key, COUNT(DISTINCT pa.photo_id) as count
      FROM photo_attributes pa
      JOIN attribute_types at ON at.id = pa.attribute_type_id AND at.key = ?
      JOIN attribute_values av ON av.id = pa.attribute_value_id
      JOIN photos p ON p.id = pa.photo_id AND p.deleted_at IS NULL
      GROUP BY av.id ORDER BY count DESC
    `).all(key) as { value: string; icon_key?: string | null; count: number }[]
  }

  addType(displayName: string, key: string, sortOrder: number): number {
    const r = this.db.prepare('INSERT INTO attribute_types (key, display_name, is_system, is_active, sort_order) VALUES (?, ?, 0, 1, ?)').run(key, displayName, sortOrder)
    return Number(r.lastInsertRowid)
  }
  updateType(id: number, displayName: string): void {
    this.db.prepare('UPDATE attribute_types SET display_name = ? WHERE id = ?').run(displayName, id)
  }
  toggleType(id: number, active: boolean): void {
    this.db.prepare('UPDATE attribute_types SET is_active = ? WHERE id = ? AND is_system = 0').run(active ? 1 : 0, id)
  }
  deleteType(id: number): void {
    this.db.prepare('DELETE FROM attribute_types WHERE id = ? AND is_system = 0').run(id)
  }
  addValue(typeId: number, value: string, iconKey?: string | null): number {
    const r = this.db.prepare('INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset) VALUES (?, ?, ?, 0)').run(typeId, value.trim(), iconKey ?? null)
    return Number(r.lastInsertRowid)
  }
  updateValue(id: number, value: string, iconKey?: string): void {
    if (iconKey !== undefined) this.db.prepare('UPDATE attribute_values SET value = ?, icon_key = ? WHERE id = ?').run(value.trim(), iconKey || null, id)
    else this.db.prepare('UPDATE attribute_values SET value = ? WHERE id = ?').run(value.trim(), id)
  }
  deleteValue(id: number): void {
    this.db.prepare('DELETE FROM attribute_values WHERE id = ?').run(id)
  }
  reorder(orderedIds: number[]): void {
    const stmt = this.db.prepare('UPDATE attribute_types SET sort_order = ? WHERE id = ?')
    this.db.transaction(() => { orderedIds.forEach((id, idx) => stmt.run(idx, id)) })()
  }
  listAliases(valueId: number): AliasRow[] {
    return this.db.prepare('SELECT id, alias FROM attribute_value_aliases WHERE value_id = ? ORDER BY created_at ASC').all(valueId) as AliasRow[]
  }
  addAlias(valueId: number, alias: string): number | null {
    const r = this.db.prepare('INSERT OR IGNORE INTO attribute_value_aliases (value_id, alias) VALUES (?, ?)').run(valueId, alias.trim())
    return r.changes > 0 ? Number(r.lastInsertRowid) : null
  }
  removeAlias(aliasId: number): void {
    this.db.prepare('DELETE FROM attribute_value_aliases WHERE id = ?').run(aliasId)
  }
  /** JSON 批量导入（幂等 upsert，事务） */
  importJson(typeId: number, entries: { value: string; aliases?: string[]; icon_key?: string }[]): { added: number; updated: number; aliasesAdded: number } {
    let added = 0, updated = 0, aliasesAdded = 0
    const insertVal = this.db.prepare('INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset) VALUES (?, ?, ?, 0)')
    const getVal = this.db.prepare('SELECT id FROM attribute_values WHERE attribute_type_id = ? AND value = ?')
    const updateIcon = this.db.prepare('UPDATE attribute_values SET icon_key = ? WHERE id = ?')
    const insertAlias = this.db.prepare('INSERT OR IGNORE INTO attribute_value_aliases (value_id, alias) VALUES (?, ?)')
    this.db.transaction(() => {
      for (const entry of entries) {
        if (!entry.value || typeof entry.value !== 'string') continue
        const val = entry.value.trim()
        if (!val) continue
        const r = insertVal.run(typeId, val, entry.icon_key ?? null)
        let valueId: number
        if (r.changes > 0) { valueId = Number(r.lastInsertRowid); added++ }
        else {
          const existing = getVal.get(typeId, val) as { id: number } | undefined
          if (!existing) continue
          valueId = existing.id
          if (entry.icon_key) updateIcon.run(entry.icon_key, valueId)
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
    })()
    return { added, updated, aliasesAdded }
  }
  /** 按类型 key 查 type id */
  typeIdByKey(key: string): number | null {
    const row = this.db.prepare('SELECT id FROM attribute_types WHERE key = ?').get(key) as { id: number } | undefined
    return row?.id ?? null
  }
  /** 按类型 + 值查 value 行 */
  valueByTypeAndValue(typeId: number, value: string): AttrValueRow | null {
    const row = this.db.prepare('SELECT * FROM attribute_values WHERE attribute_type_id = ? AND value = ?').get(typeId, value) as AttrValueRow | undefined
    return row ?? null
  }
  /** 插入属性值（INSERT OR IGNORE，返回 id） */
  insertValueIgnore(typeId: number, value: string, isPreset = 0, iconKey?: string, filmSizeType?: string): number | null {
    const r = this.db.prepare('INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset, film_size_type) VALUES (?, ?, ?, ?, ?)').run(typeId, value, iconKey ?? null, isPreset, filmSizeType ?? null)
    return r.changes > 0 ? Number(r.lastInsertRowid) : null
  }
  /** 照片某属性值（用于 film_format / film 等） */
  photoAttrValue(photoId: number, typeKey: string): { value: string; icon_key?: string } | null {
    const row = this.db.prepare(`
      SELECT av.value, av.icon_key FROM photo_attributes pa
      JOIN attribute_types at ON at.id = pa.attribute_type_id
      JOIN attribute_values av ON av.id = pa.attribute_value_id
      WHERE pa.photo_id = ? AND at.key = ? LIMIT 1
    `).get(photoId, typeKey) as { value: string; icon_key?: string } | undefined
    return row ?? null
  }
}
