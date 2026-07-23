import { ipcMain } from 'electron'
import { getDb } from '../db/index'

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
    const db = getDb()
    const maxOrder = (
      db
        .prepare('SELECT MAX(sort_order) as m FROM sub_libraries WHERE parent_id IS ?')
        .get(parentId ?? null) as { m: number }
    ).m ?? 0
    const r = db
      .prepare('INSERT INTO sub_libraries (name, parent_id, sort_order) VALUES (?, ?, ?)')
      .run(name.trim(), parentId ?? null, maxOrder + 1)
    return r.lastInsertRowid
  })

  // 重命名
  ipcMain.handle('sublib:rename', (_, id: number, name: string) => {
    getDb().prepare('UPDATE sub_libraries SET name = ? WHERE id = ?').run(name.trim(), id)
    return true
  })

  // 修改描述
  ipcMain.handle('sublib:setDescription', (_, id: number, description: string) => {
    getDb().prepare('UPDATE sub_libraries SET description = ? WHERE id = ?').run(description, id)
    return true
  })

  // 删除（将内部照片置为未分类）
  ipcMain.handle('sublib:delete', (_, id: number) => {
    const db = getDb()
    db.prepare('UPDATE photos SET sub_library_id = NULL WHERE sub_library_id = ?').run(id)
    // 子子库也上移
    db.prepare('UPDATE sub_libraries SET parent_id = NULL WHERE parent_id = ?').run(id)
    db.prepare('DELETE FROM sub_libraries WHERE id = ?').run(id)
    return true
  })

  // 获取子库下照片数
  ipcMain.handle('sublib:counts', () => {
    const rows = getDb()
      .prepare('SELECT sub_library_id, COUNT(*) as count FROM photos GROUP BY sub_library_id')
      .all() as { sub_library_id: number | null; count: number }[]
    const map: Record<string, number> = { null: 0 }
    rows.forEach((r) => { map[String(r.sub_library_id)] = r.count })
    return map
  })
}

interface SubLibRow { id: number; name: string; description: string; parent_id: number | null; sort_order: number; created_at: string }
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
