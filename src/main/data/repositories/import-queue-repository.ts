/**
 * 导入任务队列数据访问 Repository。迁移自 ipc/import.ts 的 import_queue 读写。
 */
import type Database from 'better-sqlite3'

export interface ImportQueueRow {
  id: number; source_path: string; status: string; photo_id: number | null
  error_msg: string | null; queued_at: string; done_at: string | null
}

export class ImportQueueRepository {
  constructor(private db: Database.Database) {}

  enqueue(sourcePath: string, photoId: number, status = 'pending'): number {
    const r = this.db.prepare('INSERT INTO import_queue (source_path, photo_id, status) VALUES (?, ?, ?)').run(sourcePath, photoId, status)
    return Number(r.lastInsertRowid)
  }

  getStatus(id: number): string | null {
    const row = this.db.prepare('SELECT status FROM import_queue WHERE id = ?').get(id) as { status: string } | undefined
    return row?.status ?? null
  }

  markDone(id: number): void {
    this.db.prepare("UPDATE import_queue SET status = 'done', done_at = datetime('now','localtime') WHERE id = ?").run(id)
  }
  markSkipped(id: number): void {
    this.db.prepare("UPDATE import_queue SET status = 'skipped', done_at = datetime('now','localtime') WHERE id = ?").run(id)
  }
  markError(id: number, errMsg: string): void {
    this.db.prepare("UPDATE import_queue SET status = 'error', error_msg = ?, done_at = datetime('now','localtime') WHERE id = ?").run(errMsg, id)
  }
}
