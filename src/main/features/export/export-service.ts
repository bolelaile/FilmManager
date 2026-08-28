/**
 * 导出功能核心服务。
 * 封装自动匹配、预览、单张/批量导出、取消、预设 CRUD。
 * 复用 features/export/{exportPipeline,film-frame-renderer,stock-presets}（批次3迁入 features/export）。
 */
import os from 'os'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import type { ExportConfig, ExportPreset } from '../../../shared/export-types'
import { DEFAULT_EXPORT_CONFIG } from '../../../shared/export-types'
import {
  resolveBorderForPhoto, renderExport, renderExportPreview, resolveTokens, buildFilename, extForFormat, resolveConflict
} from '../../features/export/exportPipeline'
import type { ExportPresetRepository } from '../../data/repositories/export-preset-repository'

let batchCancelled = false

export class ExportService {
  constructor(private presetRepo: ExportPresetRepository) {}

  /** 自动匹配画幅 + stock */
  async matchBorder(photoId: number) { return resolveBorderForPhoto(photoId) }

  /** 预览（小图 dataURL） */
  async preview(photoId: number, config: ExportConfig): Promise<string> {
    const buf = await renderExportPreview(photoId, config, 800)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  }

  /** 单张导出 */
  async render(photoId: number, config: ExportConfig, picturesDir: string) {
    const ext = extForFormat(config.image.format)
    const dir = config.output.dir || picturesDir
    const tokens = await resolveTokens(photoId, 1, config)
    const filename = buildFilename(config.output.filenameTemplate, tokens, 1, ext)
    const outPath = path.join(dir, filename)
    fs.mkdirSync(dir, { recursive: true })
    const result = await renderExport(photoId, config, 1, outPath)
    return { ...result, path: outPath }
  }

  /**
   * 批量导出（有界并发 worker 队列 + 进度/取消）。
   * @param onProgress 进度回调（done/total/success/failed/photoId）
   * @param onDone 完成回调
   */
  async batch(
    photoIds: number[],
    config: ExportConfig,
    picturesDir: string,
    isWinDestroyed: () => boolean,
    send: (channel: string, data: unknown) => void
  ): Promise<{ total: number; success: number; failed: number; cancelled: boolean }> {
    batchCancelled = false
    const total = photoIds.length
    const ext = extForFormat(config.image.format)
    const dir = config.output.dir || picturesDir
    fs.mkdirSync(dir, { recursive: true })

    const existing = new Set<string>()
    try { for (const f of fs.readdirSync(dir)) existing.add(f.toLowerCase()) } catch {}

    const concurrency = Math.max(1, Math.min(4, (os.cpus().length || 4) - 2))
    let done = 0, success = 0, failed = 0
    const results: { photoId: number; ok: boolean; path?: string; error?: string }[] = []
    const queue = [...photoIds.map((id, i) => ({ id, index: i + 1 }))]

    const worker = async () => {
      while (queue.length > 0 && !batchCancelled) {
        const item = queue.shift()
        if (!item) break
        const { id, index } = item
        try {
          const tokens = await resolveTokens(id, index, config)
          const filename = buildFilename(config.output.filenameTemplate, tokens, index, ext)
          const outPath = resolveConflict(dir, filename, config.output.overwrite, existing)
          if (!outPath) {
            results.push({ photoId: id, ok: false, error: 'skipped (exists)' })
          } else {
            await renderExport(id, config, index, outPath)
            results.push({ photoId: id, ok: true, path: outPath })
            success++
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn('export batch item failed', id, msg)
          results.push({ photoId: id, ok: false, error: msg })
          failed++
        }
        done++
        if (!isWinDestroyed()) send('export:progress', { done, total, success, failed, photoId: id })
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    if (!isWinDestroyed()) send('export:done', { total, success, failed, cancelled: batchCancelled, results })
    return { total, success, failed, cancelled: batchCancelled }
  }

  cancel(): boolean { batchCancelled = true; return true }

  // ── 预设 CRUD ──
  listPresets(): ExportPreset[] {
    const rows = this.presetRepo.list()
    return rows.map((r) => ({ ...r, config: JSON.parse(r.config) })) as ExportPreset[]
  }

  savePreset(name: string, config: ExportConfig): { id: number; name: string } {
    const existing = this.presetRepo.findByName(name)
    if (existing) {
      if (existing.is_builtin) {
        const newName = `${name} (自定义)`
        const id = this.presetRepo.insert(newName, JSON.stringify(config))
        return { id, name: newName }
      }
      this.presetRepo.updateConfig(existing.id, JSON.stringify(config))
      return { id: existing.id, name }
    }
    const id = this.presetRepo.insert(name, JSON.stringify(config))
    return { id, name }
  }

  deletePreset(id: number): boolean { return this.presetRepo.delete(id) }

  defaultConfig(): ExportConfig { return DEFAULT_EXPORT_CONFIG }

  /** 字体列表（按平台） */
  listFonts(): string[] {
    const isWin = process.platform === 'win32'
    if (isWin) {
      return [
        'Microsoft YaHei, Segoe UI, Arial, sans-serif',
        'Microsoft YaHei UI, sans-serif', 'SimHei, sans-serif', 'SimSun, serif',
        'KaiTi, serif', 'Segoe UI, Arial, sans-serif', 'Arial, sans-serif',
        'Times New Roman, serif', 'Courier New, monospace'
      ]
    }
    if (process.platform === 'darwin') {
      return ['PingFang SC, Helvetica Neue, Arial, sans-serif', 'Heiti SC, sans-serif',
        'STHeiti, sans-serif', 'Helvetica Neue, Arial, sans-serif', 'Times New Roman, serif']
    }
    return ['Noto Sans CJK SC, sans-serif', 'WenQuanYi Micro Hei, sans-serif', 'DejaVu Sans, sans-serif', 'Arial, sans-serif']
  }
}
