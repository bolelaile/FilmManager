/**
 * 子库数据访问 Repository。迁移自 ipc/sublibraries.ts 的查询逻辑。
 */
import type Database from 'better-sqlite3'

export interface SubLibRow {
  id: number
  name: string
  description: string
  parent_id: number | null
  folder_name?: string | null
  sort_order: number
  created_at: string
}
export interface SubLibNode extends SubLibRow { children: SubLibNode[] }

export class SubLibraryRepository {
  constructor(private db: Database.Database) {}

  /** 完整子库树（递归 buildTree） */
  tree(): SubLibNode[] {
    const rows = this.db.prepare(
      'SELECT * FROM sub_libraries ORDER BY parent_id ASC, sort_order ASC, name ASC'
    ).all() as SubLibRow[]
    return buildTree(rows)
  }

  /** 各子库照片数（含后代，递归 CTE）+ __total */
  counts(): Record<string, number> {
    const direct = this.db.prepare(
      'SELECT sub_library_id, COUNT(*) as count FROM photos WHERE deleted_at IS NULL GROUP BY sub_library_id'
    ).all() as { sub_library_id: number | null; count: number }[]
    const map: Record<string, number> = { null: 0, __total: 0 }
    direct.forEach((r) => { map[String(r.sub_library_id)] = r.count; map.__total += r.count })
    const nested = this.db.prepare(`
      WITH RECURSIVE descendants(root_id, id) AS (
        SELECT id, id FROM sub_libraries
        UNION ALL
        SELECT descendants.root_id, child.id FROM descendants
        JOIN sub_libraries child ON child.parent_id = descendants.id
      )
      SELECT descendants.root_id AS sub_library_id, COUNT(photos.id) AS count
      FROM descendants LEFT JOIN photos ON photos.sub_library_id = descendants.id AND photos.deleted_at IS NULL
      GROUP BY descendants.root_id
    `).all() as { sub_library_id: number; count: number }[]
    nested.forEach((r) => { map[String(r.sub_library_id)] = r.count })
    return map
  }

  /** 新建子库记录（不含磁盘目录，由 LibraryLayoutService 处理） */
  insert(name: string, parentId: number | null, folderName: string, sortOrder: number): number {
    const r = this.db.prepare(
      'INSERT INTO sub_libraries (name, parent_id, folder_name, sort_order) VALUES (?, ?, ?, ?)'
    ).run(name, parentId, folderName, sortOrder)
    return Number(r.lastInsertRowid)
  }

  /** 删除子库记录 */
  delete(id: number): void {
    this.db.prepare('DELETE FROM sub_libraries WHERE id = ?').run(id)
  }

  /** 回滚：删除刚新建的子库（建目录失败时） */
  deleteForRollback(id: number): void {
    this.db.prepare('DELETE FROM sub_libraries WHERE id = ?').run(id)
  }

  /** 设置描述 */
  setDescription(id: number, description: string): void {
    this.db.prepare('UPDATE sub_libraries SET description = ? WHERE id = ?').run(description, id)
  }

  /** 重命名 + folder_name（目录移动由 LibraryLayoutService 处理） */
  rename(id: number, name: string, folderName: string): void {
    this.db.prepare('UPDATE sub_libraries SET name = ?, folder_name = ? WHERE id = ?').run(name, folderName, id)
  }

  /** 更新照片 sub_library_id */
  setPhotoSubLib(photoId: number, subLibId: number | null): void {
    this.db.prepare('UPDATE photos SET sub_library_id = ? WHERE id = ?').run(subLibId, photoId)
  }

  /** 更新照片 file_path */
  setPhotoPath(photoId: number, filePath: string): void {
    this.db.prepare('UPDATE photos SET file_path = ? WHERE id = ?').run(filePath, photoId)
  }

  /** 取子库行 */
  get(id: number): SubLibRow | null {
    const row = this.db.prepare('SELECT * FROM sub_libraries WHERE id = ?').get(id) as SubLibRow | undefined
    return row ?? null
  }

  /** 全部子库（扁平，供 layout 同步用） */
  all(): SubLibRow[] {
    return this.db.prepare('SELECT id, name, parent_id, folder_name FROM sub_libraries ORDER BY id').all() as SubLibRow[]
  }

  /** 设置 folder_name（layout 同步用） */
  setFolderName(id: number, folderName: string): void {
    this.db.prepare('UPDATE sub_libraries SET folder_name = ? WHERE id = ?').run(folderName, id)
  }

  /** 同级 folder_name 占用（供分配唯一 folder 名） */
  siblingFolderNames(parentId: number | null, excludeId?: number): { id: number; folder_name: string | null }[] {
    return this.db.prepare(`
      SELECT id, folder_name FROM sub_libraries
      WHERE parent_id IS ? AND (? IS NULL OR id != ?)
    `).all(parentId ?? null, excludeId ?? null, excludeId ?? null) as { id: number; folder_name: string | null }[]
  }
}

function buildTree(rows: SubLibRow[]): SubLibNode[] {
  const map = new Map<number, SubLibNode>()
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }))
  const roots: SubLibNode[] = []
  rows.forEach((r) => {
    if (r.parent_id == null) roots.push(map.get(r.id)!)
    else map.get(r.parent_id)?.children.push(map.get(r.id)!)
  })
  return roots
}
