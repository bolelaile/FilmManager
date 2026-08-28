/**
 * 库管理功能核心服务。
 * 封装库信息、文件定位、缩略图重生成、ICC profile、库统计。
 */
import fs from 'fs'
import path from 'path'
import type { PhotoRepository } from '../../data/repositories/photo-repository'
import { generateThumbnail } from '../../features/thumbnails/thumbnail'

export interface IccProfile { name: string; path: string; isPreset: boolean }

export class LibraryService {
  constructor(
    private repo: PhotoRepository,
    private libraryRoot: string,
    private thumbDir: string,
    private builtinProfilesDir: string
  ) {}

  info() {
    return { root: this.libraryRoot, thumbDir: this.thumbDir, profilesDir: this.builtinProfilesDir }
  }

  /** 重新生成单张缩略图 */
  async regenThumb(photoId: number): Promise<boolean> {
    const r = this.repo.get(photoId)
    if (!r.photo) return false
    const tp = await generateThumbnail(r.photo.file_path, this.thumbDir, r.photo.rotation ?? 0)
    if (tp) this.repo.setThumb(photoId, tp, true)
    return !!tp
  }

  /** ICC profile 列表（内置 + 用户） */
  listProfiles(): IccProfile[] {
    const customDir = path.join(this.libraryRoot, 'profiles')
    const collect = (dir: string, isPreset: boolean): IccProfile[] => {
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir)
        .filter((f) => /\.(icc|icm)$/i.test(f))
        .map((f) => ({ name: path.basename(f, path.extname(f)), path: path.join(dir, f), isPreset }))
    }
    return [...collect(this.builtinProfilesDir, true), ...collect(customDir, false)]
  }

  /** 库统计 */
  stats(): { total: number; byType: { file_type: string; count: number }[]; librarySize: number } {
    const opts = this.repo.filterOptions()
    return {
      total: this.repo.countAll(),
      byType: opts.fileTypes.map((f) => ({ file_type: f.value, count: f.count })),
      librarySize: this.folderSize(path.join(this.libraryRoot, 'files'))
    }
  }

  private folderSize(dir: string): number {
    if (!fs.existsSync(dir)) return 0
    let size = 0
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) size += this.folderSize(full)
      else size += fs.statSync(full).size
    }
    return size
  }
}
