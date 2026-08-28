/**
 * 地点数据访问 Repository。迁移自 ipc/locations.ts。
 * OSM 在线搜索/反向地理编码属外部 IO，放在 features/locations 的 OsmaGeocoder，不在此。
 */
import type Database from 'better-sqlite3'

export interface LocationRow {
  id: number; name: string; address: string; lat: number; lng: number; created_at: string
  photo_count?: number
}

export class LocationRepository {
  constructor(private db: Database.Database) {}

  list(): LocationRow[] {
    return this.db.prepare(`
      SELECT l.*, COUNT(pl.photo_id) as photo_count FROM locations l
      LEFT JOIN photo_locations pl ON pl.location_id = l.id GROUP BY l.id ORDER BY l.name ASC
    `).all() as LocationRow[]
  }

  add(name: string, address: string, lat: number, lng: number): number {
    const r = this.db.prepare('INSERT INTO locations (name, address, lat, lng) VALUES (?, ?, ?, ?)').run(name, address, lat, lng)
    return Number(r.lastInsertRowid)
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM locations WHERE id = ?').run(id)
  }

  update(id: number, name: string, address: string): void {
    this.db.prepare('UPDATE locations SET name = ?, address = ? WHERE id = ?').run(name, address, id)
  }

  photosOf(locationId: number): number[] {
    return (this.db.prepare('SELECT photo_id FROM photo_locations WHERE location_id = ?').all(locationId) as { photo_id: number }[]).map((r) => r.photo_id)
  }

  forPhoto(photoId: number): LocationRow[] {
    return this.db.prepare('SELECT l.* FROM locations l JOIN photo_locations pl ON pl.location_id = l.id WHERE pl.photo_id = ?').all(photoId) as LocationRow[]
  }

  /** 批量设置地点（先清后写；null 仅清） */
  setForPhotos(photoIds: number[], locationId: number | null): void {
    if (photoIds.length === 0) return
    const del = this.db.prepare('DELETE FROM photo_locations WHERE photo_id = ?')
    const ins = this.db.prepare('INSERT OR IGNORE INTO photo_locations (photo_id, location_id) VALUES (?, ?)')
    this.db.transaction(() => {
      for (const id of photoIds) {
        del.run(id)
        if (locationId !== null) ins.run(id, locationId)
      }
    })()
  }

  clearForPhotos(photoIds: number[]): void {
    if (photoIds.length === 0) return
    const del = this.db.prepare('DELETE FROM photo_locations WHERE photo_id = ?')
    this.db.transaction(() => { for (const id of photoIds) del.run(id) })()
  }

  addToPhoto(photoId: number, locationId: number): void {
    this.db.prepare('INSERT OR IGNORE INTO photo_locations (photo_id, location_id) VALUES (?, ?)').run(photoId, locationId)
  }

  removeFromPhoto(photoId: number, locationId: number): void {
    this.db.prepare('DELETE FROM photo_locations WHERE photo_id = ? AND location_id = ?').run(photoId, locationId)
  }

  /** 地图视图数据 */
  mapData(): { locations: (LocationRow)[]; photosByLoc: Record<number, number[]> } {
    const locs = this.db.prepare(`
      SELECT l.id, l.name, l.address, l.lat, l.lng, COUNT(pl.photo_id) as photo_count
      FROM locations l JOIN photo_locations pl ON pl.location_id = l.id GROUP BY l.id
    `).all() as LocationRow[]
    const photosByLoc: Record<number, number[]> = {}
    for (const loc of locs) {
      photosByLoc[loc.id] = (this.db.prepare('SELECT photo_id FROM photo_locations WHERE location_id = ?').all(loc.id) as { photo_id: number }[]).map((r) => r.photo_id)
    }
    return { locations: locs, photosByLoc }
  }

  /** 全部地点坐标（GPS 关联用，features/import） */
  allCoords(): { id: number; lat: number; lng: number }[] {
    return this.db.prepare('SELECT id, lat, lng FROM locations').all() as { id: number; lat: number; lng: number }[]
  }

  /** 按名称查地点（导入地点匹配用） */
  findByName(name: string): LocationRow | null {
    const row = this.db.prepare('SELECT id, name, address, lat, lng, created_at FROM locations WHERE name = ? LIMIT 1').get(name) as LocationRow | undefined
    return row ?? null
  }
}
