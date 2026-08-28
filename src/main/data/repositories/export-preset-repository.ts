/**
 * 导出预设数据访问 Repository。迁移自 ipc/export.ts 的预设 CRUD。
 */
import type Database from 'better-sqlite3'

export interface ExportPresetRow {
  id: number; name: string; is_builtin: number; config: string; created_at: string; updated_at: string
}

export class ExportPresetRepository {
  constructor(private db: Database.Database) {}

  list(): ExportPresetRow[] {
    return this.db.prepare('SELECT * FROM export_presets ORDER BY is_builtin DESC, name ASC').all() as ExportPresetRow[]
  }

  /** 内置预设幂等插入 */
  insertBuiltin(name: string, config: string): void {
    this.db.prepare('INSERT OR IGNORE INTO export_presets (name, is_builtin, config) VALUES (?, 1, ?)').run(name, config)
  }

  /** 查同名预设 */
  findByName(name: string): ExportPresetRow | null {
    const row = this.db.prepare('SELECT * FROM export_presets WHERE name = ?').get(name) as ExportPresetRow | undefined
    return row ?? null
  }

  /** 更新自定义预设配置 */
  updateConfig(id: number, config: string): void {
    this.db.prepare("UPDATE export_presets SET config = ?, updated_at = datetime('now') WHERE id = ?").run(config, id)
  }

  /** 新增自定义预设 */
  insert(name: string, config: string): number {
    const r = this.db.prepare('INSERT INTO export_presets (name, is_builtin, config) VALUES (?, 0, ?)').run(name, config)
    return Number(r.lastInsertRowid)
  }

  delete(id: number): boolean {
    const row = this.db.prepare('SELECT is_builtin FROM export_presets WHERE id = ?').get(id) as { is_builtin: number } | undefined
    if (row?.is_builtin) return false
    this.db.prepare('DELETE FROM export_presets WHERE id = ?').run(id)
    return true
  }

  /** 迁移旧版预设（templateId→formatId 等），由 database.ts 迁移编排调用 */
  migrateLegacyConfigs(transform: (config: string) => string): void {
    const rows = this.db.prepare("SELECT id, config FROM export_presets WHERE config LIKE '%\"templateId\"%'").all() as { id: number; config: string }[]
    if (rows.length === 0) return
    const upd = this.db.prepare("UPDATE export_presets SET config = ?, updated_at = datetime('now') WHERE id = ?")
    for (const { id, config } of rows) {
      try { upd.run(transform(config), id) } catch {}
    }
  }
}
