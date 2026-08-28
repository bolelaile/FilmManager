/**
 * 照片功能核心服务。
 * 封装列表/属性/旋转/删除/移动/收藏/全屏预览/缩略图/COUNT 缓存。
 * 依赖 PhotoRepository + AttributeRepository + SubLibraryRepository + infra/image，
 * 不直接 getDb()/electron（除 fullPreview 用 Sharp 渲染，属图像处理）。
 */
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import type Database from 'better-sqlite3'
import type { PhotoRepository } from '../../data/repositories/photo-repository'
import type { AttributeRepository } from '../../data/repositories/attribute-repository'
import type { PhotoRow, AttrRow, QueryFilter, Paging } from '../../data/types'
import { normalizeRotation, renderFullPreview } from '../../services/thumbnail'
import { generateThumbnail } from '../../services/thumbnail'
import { thumbnailPool } from '../../workers/worker-pool'
import { movePhotosToSubLibrary } from '../../services/library-layout'

// ── COUNT 缓存（2s TTL + 变更失效） ──
const COUNT_CACHE_TTL = 2000
const COUNT_CACHE_MAX = 64
const countCache = new Map<string, { total: number; ts: number }>()

function countCacheKey(p: QueryFilter): string {
  return JSON.stringify({
    filters: p.filters ?? {}, subLibraryId: p.subLibraryId ?? null, search: p.search ?? '',
    dateFrom: p.dateFrom ?? null, dateTo: p.dateTo ?? null, dateField: p.dateField ?? 'imported_at',
    fileTypes: p.fileTypes ?? [], organizationStatuses: p.organizationStatuses ?? [], starredOnly: p.starredOnly ?? false
  })
}

export function invalidatePhotoCountCache(): void { countCache.clear() }

// ── 全屏预览并发限制（单飞 + 丢弃旧排队） ──
let previewInFlight = false
let pendingPreviewResolve: ((v: null) => void) | null = null

export class PhotoService {
  constructor(
    private db: Database.Database,
    private repo: PhotoRepository,
    private attrs: AttributeRepository,
    private thumbDir: string,
    private libraryRoot: string
  ) {}

  /** 分页查询（含属性批量加载 + COUNT 缓存） */
  list(params: QueryFilter & Paging): { total: number; rows: (PhotoRow & { attributes: AttrRow[] })[] } {
    const { page, pageSize, sortBy, sortOrder, ...filter } = params
    const paging: Paging = { page, pageSize, sortBy, sortOrder }
    const cKey = countCacheKey(filter)
    let total = countCache.get(cKey)?.total ?? null
    if (total === null || Date.now() - (countCache.get(cKey)?.ts ?? 0) > COUNT_CACHE_TTL) {
      const r = this.repo.list(filter, paging)
      total = r.total
      countCache.set(cKey, { total, ts: Date.now() })
      if (countCache.size > COUNT_CACHE_MAX) {
        const firstKey = countCache.keys().next().value
        if (firstKey) countCache.delete(firstKey)
      }
      const rows = this.withAttrs(r.rows)
      return { total, rows }
    }
    const rows = this.withAttrs(this.repo.list(filter, paging).rows)
    return { total, rows }
  }

  private withAttrs(rows: PhotoRow[]): (PhotoRow & { attributes: AttrRow[] })[] {
    const ids = rows.map((r) => r.id)
    const attrs = this.repo.attributesOf(ids)
    const map = new Map<number, AttrRow[]>()
    for (const a of attrs) {
      if (!map.has(a.photo_id!)) map.set(a.photo_id!, [])
      map.get(a.photo_id!)!.push(a)
    }
    return rows.map((r) => ({ ...r, attributes: map.get(r.id) ?? [] }))
  }

  get(id: number): (PhotoRow & { attributes: AttrRow[] }) | null {
    const { photo, attrs } = this.repo.get(id)
    if (!photo) return null
    return { ...photo, attributes: attrs }
  }

  filterOptions() { return this.repo.filterOptions() }

  setAttributes(photoId: number, assignments: { typeId: number; valueId: number }[]) {
    this.repo.setAttributes(photoId, assignments); invalidatePhotoCountCache(); return true
  }
  batchSetAttributes(photoIds: number[], assignments: { typeId: number; valueId: number }[]) {
    this.repo.batchSetAttributes(photoIds, assignments); invalidatePhotoCountCache(); return true
  }
  updateNotes(id: number, notes: string) { this.repo.updateNotes(id, notes); return true }
  setShotDate(id: number, shotDate: string | null) { this.repo.setShotDate(id, shotDate); invalidatePhotoCountCache(); return true }
  batchSetShotDate(ids: number[], shotDate: string | null) { this.repo.batchSetShotDate(ids, shotDate); invalidatePhotoCountCache(); return true }

  /** 删除（先收集文件→事务删 DB→删磁盘文件） */
  delete(ids: number[], deleteFile: boolean): boolean {
    const files = deleteFile ? this.repo.collectFilesForDelete(ids) : []
    this.repo.delete(ids)
    for (const f of files) {
      try { fs.unlinkSync(f.file_path) } catch {}
      if (f.thumb_path) try { fs.unlinkSync(f.thumb_path) } catch {}
    }
    invalidatePhotoCountCache()
    return true
  }

  /** 全屏预览（单飞 + 丢弃旧排队） */
  async fullPreview(filePath: string, iccPath?: string, rotation = 0): Promise<{ dataUrl: string; width: number; height: number } | null> {
    const oldResolve: ((v: null) => void) | null = pendingPreviewResolve
    if (oldResolve) { pendingPreviewResolve = null; oldResolve(null) }
    if (previewInFlight) {
      return new Promise<null>((resolve) => { pendingPreviewResolve = resolve })
    }
    previewInFlight = true
    try {
      const result = await renderFullPreview(filePath, iccPath, rotation)
      if (!result) return null
      return { dataUrl: `data:image/jpeg;base64,${result.buffer.toString('base64')}`, width: result.width, height: result.height }
    } finally {
      previewInFlight = false
      const resolve: ((v: null) => void) | null = pendingPreviewResolve
      if (resolve) { pendingPreviewResolve = null; resolve(null) }
    }
  }

  thumbDataUrl(thumbPath: string): string | null {
    try {
      const resolved = path.resolve(thumbPath)
      if (!resolved.startsWith(path.resolve(this.thumbDir) + path.sep)) return null
      const buf = fs.readFileSync(resolved)
      return `data:image/webp;base64,${buf.toString('base64')}`
    } catch { return null }
  }

  /** 移动到子库（委托 library-layout） */
  moveToSubLibrary(photoIds: number[], subLibraryId: number | null) {
    const result = movePhotosToSubLibrary(this.db, path.join(this.libraryRoot, 'files'), photoIds, subLibraryId)
    invalidatePhotoCountCache()
    return result
  }

  /** 设置旋转（持久化 + 重建缩略图） */
  async setRotation(id: number, rotation: number) {
    const next = normalizeRotation(rotation)
    const filePath = this.repo.getFilePath(id)
    if (!filePath) return null
    this.repo.setRotation(id, next)
    const thumbPath = await generateThumbnail(filePath, this.thumbDir, next)
    if (thumbPath) this.repo.setThumb(id, thumbPath, true)
    return { id, rotation: next, thumbPath: thumbPath ?? null }
  }

  /** 批量旋转 */
  async batchRotate(photoIds: number[], delta = 90) {
    const nd = normalizeRotation(delta)
    const targets: { id: number; filePath: string; nextRotation: 0 | 90 | 180 | 270 }[] = []
    for (const id of photoIds) {
      const r = this.repo.get(id)
      if (!r.photo) continue
      const next = normalizeRotation((r.photo.rotation ?? 0) + nd) as 0 | 90 | 180 | 270
      this.repo.setRotation(id, next)
      targets.push({ id, filePath: r.photo.file_path, nextRotation: next })
    }
    // 缩略图并行（Worker Pool + 回退）
    Promise.all(targets.map(async ({ id, filePath, nextRotation }) => {
      const tp = await thumbnailPool.generate(filePath, this.thumbDir, nextRotation).catch(() => null)
        ?? await generateThumbnail(filePath, this.thumbDir, nextRotation).catch(() => null)
      if (tp) this.repo.setThumb(id, tp, true)
    })).catch((err) => log.warn('batchRotate thumb gen error', err))
    return { updated: targets.length }
  }

  toggleStar(id: number): boolean {
    const r = this.repo.get(id)
    if (!r.photo) return false
    const newVal = r.photo.starred ? 0 : 1
    this.repo.setStarred(id, newVal === 1)
    invalidatePhotoCountCache()
    return newVal === 1
  }
  batchStar(photoIds: number[], starred: boolean) {
    this.repo.batchSetStarred(photoIds, starred); invalidatePhotoCountCache(); return true
  }

  async exif(id: number) {
    const filePath = this.repo.getFilePath(id)
    if (!filePath) return null
    try {
      const { getExifData } = await import('../../services/thumbnail')
      return await getExifData(filePath)
    } catch { return null }
  }

  /** 时间线 */
  timeline(params: QueryFilter & { dateField?: 'imported_at' | 'shot_date'; thumbsPerMonth?: number }) {
    const { dateField = 'shot_date', thumbsPerMonth = 6, ...filter } = params
    const counts = this.repo.timelineCounts(filter, dateField)
    return counts.map((row) => ({
      month: row.month,
      count: row.count,
      thumbs: this.repo.timelineThumbs(filter, dateField, row.month, thumbsPerMonth)
    }))
  }
}
