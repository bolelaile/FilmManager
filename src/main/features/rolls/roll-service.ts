/**
 * 胶卷功能核心服务。
 * 封装卷列表/建卷/删除三档/批量/卷内查询/封面/属性一致性检查。
 * 依赖 RollRepository + AttributeRepository + PhotoRepository，不直接 getDb()/electron。
 */
import fs from 'fs'
import log from 'electron-log'
import type { RollRepository, RollRow } from '../../data/repositories/roll-repository'
import type { AttributeRepository } from '../../data/repositories/attribute-repository'
import type { PhotoRepository } from '../../data/repositories/photo-repository'
import type { PhotoRow, AttrRow, QueryFilter, Paging } from '../../data/types'

export class RollService {
  constructor(
    private repo: RollRepository,
    private attrs: AttributeRepository,
    private photoRepo: PhotoRepository
  ) {}

  /** 属性一致性检查（胶卷类型/相机型号） */
  checkAttrConsistency(photoIds: number[]): { ok: boolean; warnings: string[] } {
    if (!photoIds || photoIds.length === 0) return { ok: true, warnings: [] }
    // 复用 photoRepo.attributesOf 取 DISTINCT 属性值
    const rows = this.photoRepo.attributesOf(photoIds)
    const films = new Set<string>(); const cameras = new Set<string>()
    for (const r of rows) {
      if (r.key === 'film') films.add(r.value)
      if (r.key === 'camera') cameras.add(r.value)
    }
    const warnings: string[] = []
    if (films.size > 1) warnings.push(`胶卷类型不一致：${[...films].join('、')}`)
    if (cameras.size > 1) warnings.push(`相机型号不一致：${[...cameras].join('、')}`)
    return { ok: warnings.length === 0, warnings }
  }

  list(params: QueryFilter): { rolls: RollRow[]; photolessCount: number } {
    return this.repo.list(params)
  }

  /** 建卷（自动命名 + 封面选取 + 关联照片） */
  create(params: { photoIds: number[]; name?: string; subLibraryId?: number | null }): number | null {
    const { photoIds, name, subLibraryId } = params
    if (!photoIds || photoIds.length === 0) return null

    let rollName = name?.trim() || ''
    if (!rollName) {
      // 从第一张照片属性提取命名
      const firstId = photoIds[0]
      const attrs = this.photoRepo.attributesOf([firstId])
      const film = attrs.find((a) => a.key === 'film')?.value
      const format = attrs.find((a) => a.key === 'film_format')?.value
      const photo = this.photoRepo.get(firstId).photo
      const dateStr = photo?.shot_date || photo?.imported_at || ''
      const datePart = dateStr ? dateStr.substring(0, 10).replace(/-/g, '/') : ''
      const parts: string[] = []
      if (film) parts.push(film)
      if (format) parts.push(format)
      if (datePart) parts.push(datePart)
      rollName = parts.join('-') || '未命名卷'
    }

    // 封面：第一张有缩略图的照片
    const cover = photoIds.map((id) => this.photoRepo.get(id).photo).find((p) => p && p.thumb_ready === 1)
    const rollId = this.repo.create(rollName, subLibraryId ?? null, cover?.id ?? null)
    this.repo.addPhotos(rollId, photoIds)
    log.info(`Created roll ${rollId}: "${rollName}" with ${photoIds.length} photos`)
    return rollId
  }

  rename(id: number, name: string) { this.repo.rename(id, name) }

  /** 删除卷（三档：仅索引/DB 照片/物理文件） */
  delete(id: number, deletePhotos?: boolean, deleteFiles?: boolean): boolean {
    if (deletePhotos) {
      const photoIds = this.repo.photoIdsOfRolls([id])
      if (deleteFiles) {
        // 彻底删除：删 DB + 删磁盘文件
        const files = this.photoRepo.collectFilesForDelete(photoIds)
        this.photoRepo.delete(photoIds)
        this.repo.delete(id)
        for (const f of files) {
          try { fs.unlinkSync(f.file_path) } catch {}
          if (f.thumb_path) try { fs.unlinkSync(f.thumb_path) } catch {}
        }
      } else {
        // 移入回收站：软删照片，文件保留
        this.photoRepo.softDelete(photoIds, new Date().toISOString().replace('T', ' ').slice(0, 19))
        this.repo.delete(id)
      }
    } else {
      this.repo.delete(id)
    }
    return true
  }

  batchDelete(ids: number[], deletePhotos?: boolean, deleteFiles?: boolean): boolean {
    if (!ids || ids.length === 0) return true
    if (deletePhotos) {
      const photoIds = this.repo.photoIdsOfRolls(ids)
      if (deleteFiles) {
        const files = this.photoRepo.collectFilesForDelete(photoIds)
        this.photoRepo.delete(photoIds)
        this.repo.batchDelete(ids)
        for (const f of files) {
          try { fs.unlinkSync(f.file_path) } catch {}
          if (f.thumb_path) try { fs.unlinkSync(f.thumb_path) } catch {}
        }
      } else {
        this.photoRepo.softDelete(photoIds, new Date().toISOString().replace('T', ' ').slice(0, 19))
        this.repo.batchDelete(ids)
      }
    } else {
      this.repo.batchDelete(ids)
    }
    log.info(`Batch deleted ${ids.length} rolls, deletePhotos=${deletePhotos}, deleteFiles=${deleteFiles}`)
    return true
  }

  /** 批量设置卷内照片属性 */
  batchSetAttributes(rollIds: number[], assignments: { typeId: number; valueId: number }[]): boolean {
    if (!rollIds || rollIds.length === 0 || !assignments || assignments.length === 0) return true
    const photoIds = this.repo.photoIdsOfRolls(rollIds)
    if (photoIds.length === 0) return true
    this.photoRepo.batchSetAttributes(photoIds, assignments)
    log.info(`Batch set attributes for ${photoIds.length} photos across ${rollIds.length} rolls`)
    return true
  }

  /** 卷内照片分页（含属性） */
  photos(rollId: number | null, filter: QueryFilter, paging: Paging): { total: number; rows: (PhotoRow & { attributes: AttrRow[] })[] } {
    const { total, rows } = this.repo.photos(rollId, filter, paging)
    const ids = rows.map((r) => r.id)
    const attrs = this.photoRepo.attributesOf(ids)
    const attrMap = new Map<number, AttrRow[]>()
    for (const a of attrs) {
      if (!attrMap.has(a.photo_id!)) attrMap.set(a.photo_id!, [])
      attrMap.get(a.photo_id!)!.push(a)
    }
    return { total, rows: rows.map((r) => ({ ...r, attributes: attrMap.get(r.id) ?? [] })) }
  }

  forPhoto(photoId: number): RollRow[] { return this.repo.forPhoto(photoId) }
  removePhotos(rollId: number, photoIds: number[]) { this.repo.removePhotos(rollId, photoIds); return true }
  addPhotos(rollId: number, photoIds: number[]) { this.repo.addPhotos(rollId, photoIds); return true }
  setCover(rollId: number, photoId: number) { this.repo.setCover(rollId, photoId); return true }
}
