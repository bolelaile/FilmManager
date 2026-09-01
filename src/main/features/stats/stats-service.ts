/**
 * 统计仪表盘服务。
 * 组合各 Repository 的聚合查询，返回仪表盘所需数据。
 * 所有计数均排除回收站（deleted_at IS NULL，已在各查询内过滤）。
 */
import fs from 'fs'
import path from 'path'
import type { PhotoRepository } from '../../data/repositories/photo-repository'
import type { AttributeRepository } from '../../data/repositories/attribute-repository'
import type { LocationRepository } from '../../data/repositories/location-repository'
import type { RollRepository } from '../../data/repositories/roll-repository'

export interface DashboardData {
  total: number
  librarySize: number
  rollCount: number
  locationCount: number
  byMonth: { month: string; count: number }[]
  byFilm: { value: string; icon_key?: string | null; count: number }[]
  byCamera: { value: string; count: number }[]
  byLens: { value: string; count: number }[]
  byLocation: { name: string; count: number; lat: number; lng: number }[]
  byRoll: { name: string; count: number }[]
}

export class StatsService {
  constructor(
    private photos: PhotoRepository,
    private attrs: AttributeRepository,
    private locations: LocationRepository,
    private rolls: RollRepository,
    private libraryRoot: string
  ) {}

  dashboard(): DashboardData {
    const total = this.photos.countAll()
    const byMonth = this.photos.timelineCounts({}, 'shot_date').slice(0, 24)
    const byFilm = this.attrs.countsByTypeKey('film').slice(0, 20)
    const byCamera = this.attrs.countsByTypeKey('camera').slice(0, 20)
    const byLens = this.attrs.countsByTypeKey('lens').slice(0, 20)

    // 地点（已排除回收站，list() 的 photo_count 已过滤）
    const locRows = this.locations.list().filter((l) => (l.photo_count ?? 0) > 0)
    const byLocation = locRows
      .map((l) => ({ name: l.name, count: l.photo_count ?? 0, lat: l.lat, lng: l.lng }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    // 卷（photo_count 已排除回收站）
    const rollList = this.rolls.list({}).rolls
    const byRoll = rollList
      .map((r) => ({ name: r.name, count: (r as { photo_count?: number }).photo_count ?? 0 }))
      .filter((r) => r.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20)

    return {
      total,
      librarySize: this.folderSize(path.join(this.libraryRoot, 'files')),
      rollCount: rollList.length,
      locationCount: locRows.length,
      byMonth,
      byFilm,
      byCamera,
      byLens,
      byLocation,
      byRoll,
    }
  }

  private folderSize(dir: string): number {
    let size = 0
    const walk = (d: string) => {
      try {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, entry.name)
          if (entry.isDirectory()) walk(full)
          else try { size += fs.statSync(full).size } catch {}
        }
      } catch {}
    }
    walk(dir)
    return size
  }
}
