/**
 * GPS 地点关联子模块（features/import 内部）。
 * 批次内共享地点坐标缓存，N 张 GPS 照片由 N 次全表扫描降为 1 次。
 */
import type Database from 'better-sqlite3'
import log from 'electron-log'

export interface LocationCoord { id: number; lat: number; lng: number }

/** 一次性加载所有地点坐标，供导入批次内复用 */
export function loadLocationCoords(db: Database.Database): LocationCoord[] {
  return db.prepare('SELECT id, lat, lng FROM locations').all() as LocationCoord[]
}

/**
 * 将照片与最近的已有地点关联，或自动创建新地点。
 * cache 为批次内共享数组：新建地点时 push，使同批次后续照片可见。
 */
export function autoLinkGpsLocation(
  db: Database.Database, photoId: number, lat: number, lng: number, cache: LocationCoord[]
): void {
  try {
    const THRESHOLD_M = 100
    let bestId: number | null = null
    let bestDist = Infinity
    for (const loc of cache) {
      const dlat = (loc.lat - lat) * 111320
      const dlng = (loc.lng - lng) * 111320 * Math.cos(lat * Math.PI / 180)
      const dist = Math.sqrt(dlat * dlat + dlng * dlng)
      if (dist < bestDist) { bestDist = dist; bestId = loc.id }
    }
    let locationId: number
    if (bestId != null && bestDist <= THRESHOLD_M) {
      locationId = bestId
    } else {
      const name = `GPS (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      const address = `${lat.toFixed(6)}, ${lng.toFixed(6)}`
      const result = db.prepare('INSERT INTO locations (name, address, lat, lng) VALUES (?, ?, ?, ?)').run(name, address, lat, lng)
      locationId = result.lastInsertRowid as number
      cache.push({ id: locationId, lat, lng })
    }
    db.prepare('INSERT OR IGNORE INTO photo_locations (photo_id, location_id) VALUES (?, ?)').run(photoId, locationId)
  } catch (err) {
    log.warn('autoLinkGpsLocation failed', err)
  }
}
