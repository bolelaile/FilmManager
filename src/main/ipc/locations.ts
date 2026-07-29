import { ipcMain } from 'electron'
import { getDb } from '../db/index'

interface Location {
  id: number
  name: string
  address: string
  lat: number
  lng: number
  created_at: string
}

export function registerLocationsIpc(): void {
  // 列出所有地点（含照片数）
  ipcMain.handle('locations:list', () => {
    return getDb()
      .prepare(`
        SELECT l.*, COUNT(pl.photo_id) as photo_count
        FROM locations l
        LEFT JOIN photo_locations pl ON pl.location_id = l.id
        GROUP BY l.id
        ORDER BY l.name ASC
      `)
      .all()
  })

  // 新增地点
  ipcMain.handle('locations:add', (_, name: string, address: string, lat: number, lng: number) => {
    const r = getDb()
      .prepare('INSERT INTO locations (name, address, lat, lng) VALUES (?, ?, ?, ?)')
      .run(name, address, lat, lng)
    return r.lastInsertRowid
  })

  // 删除地点（联级清除 photo_locations）
  ipcMain.handle('locations:delete', (_, id: number) => {
    getDb().prepare('DELETE FROM locations WHERE id = ?').run(id)
    return true
  })

  // 修改地点名称 / 地址
  ipcMain.handle('locations:update', (_, id: number, name: string, address: string) => {
    getDb().prepare('UPDATE locations SET name = ?, address = ? WHERE id = ?').run(name, address, id)
    return true
  })

  // 获取某地点的所有照片 ID
  ipcMain.handle('locations:photos', (_, locationId: number) => {
    return (getDb()
      .prepare('SELECT photo_id FROM photo_locations WHERE location_id = ?')
      .all(locationId) as { photo_id: number }[])
      .map((r) => r.photo_id)
  })

  // 获取某张照片的地点列表
  ipcMain.handle('locations:forPhoto', (_, photoId: number) => {
    return getDb()
      .prepare(`
        SELECT l.* FROM locations l
        JOIN photo_locations pl ON pl.location_id = l.id
        WHERE pl.photo_id = ?
      `)
      .all(photoId)
  })

  // 批量为照片设置地点（先清除旧地点，再写入新地点）
  ipcMain.handle('locations:setForPhotos', (_, photoIds: number[], locationId: number) => {
    const db = getDb()
    const del = db.prepare('DELETE FROM photo_locations WHERE photo_id = ?')
    const ins = db.prepare('INSERT OR IGNORE INTO photo_locations (photo_id, location_id) VALUES (?, ?)')
    const tx = db.transaction(() => {
      for (const id of photoIds) {
        del.run(id)
        ins.run(id, locationId)
      }
    })
    tx()
    return true
  })

  // 批量清除照片的地点记录
  ipcMain.handle('locations:clearForPhotos', (_, photoIds: number[]) => {
    const db = getDb()
    const del = db.prepare('DELETE FROM photo_locations WHERE photo_id = ?')
    const tx = db.transaction(() => {
      for (const id of photoIds) {
        del.run(id)
      }
    })
    tx()
    return true
  })

  // 为单张照片添加 / 移除地点
  ipcMain.handle('locations:addToPhoto', (_, photoId: number, locationId: number) => {
    getDb()
      .prepare('INSERT OR IGNORE INTO photo_locations (photo_id, location_id) VALUES (?, ?)')
      .run(photoId, locationId)
    return true
  })
  ipcMain.handle('locations:removeFromPhoto', (_, photoId: number, locationId: number) => {
    getDb()
      .prepare('DELETE FROM photo_locations WHERE photo_id = ? AND location_id = ?')
      .run(photoId, locationId)
    return true
  })

  // 通过 OpenStreetMap Nominatim 搜索地点（需联网）
  ipcMain.handle('locations:search', async (_, query: string) => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&accept-language=zh`
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'FilmManager/1.0' }
      })
      if (!resp.ok) return []
      const data = await resp.json() as Array<{
        place_id: number
        display_name: string
        lat: string
        lon: string
        address?: Record<string, string>
      }>
      return data.map((d) => ({
        name: d.display_name.split(',')[0].trim(),
        address: d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon)
      }))
    } catch {
      return []
    }
  })

  // 反向地理编码：经纬度 → 附近地名（Nominatim /reverse）
  ipcMain.handle('locations:reverseGeocode', async (_, lat: number, lng: number) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=zh&addressdetails=1&zoom=14`
      const resp = await fetch(url, { headers: { 'User-Agent': 'FilmManager/1.0' } })
      if (!resp.ok) return null
      const d = await resp.json() as {
        display_name?: string
        address?: Record<string, string>
      }
      if (!d.display_name) return null
      const name = d.address
        ? (d.address.village || d.address.suburb || d.address.town || d.address.city || d.address.county || d.address.state || d.display_name.split(',')[0]).trim()
        : d.display_name.split(',')[0].trim()
      return { name, address: d.display_name, lat, lng }
    } catch {
      return null
    }
  })

  // 获取所有带地点的照片（用于地图视图）
  ipcMain.handle('locations:mapData', () => {
    const db = getDb()
    const locs = db
      .prepare(`
        SELECT l.id, l.name, l.address, l.lat, l.lng,
               COUNT(pl.photo_id) as photo_count
        FROM locations l
        JOIN photo_locations pl ON pl.location_id = l.id
        GROUP BY l.id
      `)
      .all() as (Location & { photo_count: number })[]

    const photosByLoc: Record<number, number[]> = {}
    for (const loc of locs) {
      const photos = (db
        .prepare('SELECT photo_id FROM photo_locations WHERE location_id = ?')
        .all(loc.id) as { photo_id: number }[])
        .map((r) => r.photo_id)
      photosByLoc[loc.id] = photos
    }

    return { locations: locs, photosByLoc }
  })
}
