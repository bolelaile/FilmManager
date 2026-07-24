import { ipcMain } from 'electron'
import path from 'path'
import { getDb } from '../db/index'
import {
  createSubLibrary,
  deleteSubLibrary,
  renameSubLibrary
} from '../services/library-layout'
import { getLibraryRoot } from './index'

export function registerSubLibrariesIpc(): void {
  // 获取完整子库树
  ipcMain.handle('sublib:list', () => {
    const rows = getDb()
      .prepare('SELECT * FROM sub_libraries ORDER BY parent_id ASC, sort_order ASC, name ASC')
      .all() as SubLibRow[]
    return buildTree(rows)
  })

  // 新建子库
  ipcMain.handle('sublib:create', (_, name: string, parentId?: number) => {
    return createSubLibrary(getDb(), getFilesRoot(), name, parentId)
  })

  // 重命名
  ipcMain.handle('sublib:rename', (_, id: number, name: string) => {
    renameSubLibrary(getDb(), getFilesRoot(), id, name)
    return true
  })

  // 修改描述
  ipcMain.handle('sublib:setDescription', (_, id: number, description: string) => {
    getDb().prepare('UPDATE sub_libraries SET description = ? WHERE id = ?').run(description, id)
    return true
  })

  // 删除（将内部照片置为未分类）
  ipcMain.handle('sublib:delete', (_, id: number) => {
    deleteSubLibrary(getDb(), getFilesRoot(), id)
    return true
  })

  // 获取子库下照片数
  ipcMain.handle('sublib:counts', () => {
    const db = getDb()
    const directRows = db
      .prepare('SELECT sub_library_id, COUNT(*) as count FROM photos GROUP BY sub_library_id')
      .all() as { sub_library_id: number | null; count: number }[]
    const map: Record<string, number> = { null: 0, __total: 0 }
    directRows.forEach((r) => {
      map[String(r.sub_library_id)] = r.count
      map.__total += r.count
    })

    // 父库计数包含所有后代子库，避免“年份父库”看起来为空。
    const nestedRows = db.prepare(`
      WITH RECURSIVE descendants(root_id, id) AS (
        SELECT id, id FROM sub_libraries
        UNION ALL
        SELECT descendants.root_id, child.id
        FROM descendants
        JOIN sub_libraries child ON child.parent_id = descendants.id
      )
      SELECT descendants.root_id AS sub_library_id, COUNT(photos.id) AS count
      FROM descendants
      LEFT JOIN photos ON photos.sub_library_id = descendants.id
      GROUP BY descendants.root_id
    `).all() as { sub_library_id: number; count: number }[]
    nestedRows.forEach((row) => { map[String(row.sub_library_id)] = row.count })
    return map
  })
}

function getFilesRoot(): string {
  return path.join(getLibraryRoot(), 'files')
}

interface SubLibRow { id: number; name: string; description: string; parent_id: number | null; folder_name?: string | null; sort_order: number; created_at: string }
interface SubLibNode extends SubLibRow { children: SubLibNode[] }

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
