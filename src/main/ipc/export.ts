import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import os from 'os'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { getDb } from '../db/index'
import {
  resolveBorderForPhoto,
  renderExport,
  renderExportPreview,
  resolveTokens,
  buildFilename,
  extForFormat,
  resolveConflict
} from '../services/export/exportPipeline'
import type { ExportConfig, ExportPreset } from '../../shared/export-types'
import { DEFAULT_EXPORT_CONFIG } from '../../shared/export-types'

let batchCancelled = false

export function registerExportIpc(): void {
  // 自动匹配边框
  ipcMain.handle('export:matchBorder', async (_e, photoId: number) => {
    return resolveBorderForPhoto(photoId)
  })

  // 预览
  ipcMain.handle('export:preview', async (_e, photoId: number, config: ExportConfig) => {
    const buf = await renderExportPreview(photoId, config, 800)
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  })

  // 单张导出
  ipcMain.handle('export:render', async (_e, photoId: number, config: ExportConfig) => {
    const ext = extForFormat(config.image.format)
    const dir = config.output.dir || app.getPath('pictures')
    const tokens = await resolveTokens(photoId, 1, config)
    const filename = buildFilename(config.output.filenameTemplate, tokens, 1, ext)
    const outPath = path.join(dir, filename)
    fs.mkdirSync(dir, { recursive: true })
    const result = await renderExport(photoId, config, 1, outPath)
    return { ...result, path: outPath }
  })

  // 批量导出
  ipcMain.handle(
    'export:batch',
    async (event, photoIds: number[], config: ExportConfig) => {
      batchCancelled = false
      const sender = event.sender
      const win = BrowserWindow.fromWebContents(sender)
      const total = photoIds.length
      const ext = extForFormat(config.image.format)
      const dir = config.output.dir || app.getPath('pictures')
      fs.mkdirSync(dir, { recursive: true })

      // 预扫描已存在文件名（用于 rename/skip 判重）
      const existing = new Set<string>()
      try {
        for (const f of fs.readdirSync(dir)) existing.add(f.toLowerCase())
      } catch {}

      const concurrency = Math.max(1, Math.min(4, (os.cpus().length || 4) - 2))
      let done = 0
      let success = 0
      let failed = 0
      const results: { photoId: number; ok: boolean; path?: string; error?: string }[] = []

      const queue = [...photoIds.map((id, i) => ({ id, index: i + 1 }))]

      async function worker(): Promise<void> {
        while (queue.length > 0 && !batchCancelled) {
          const item = queue.shift()
          if (!item) break
          const { id, index } = item
          const frameNo = index
          try {
            const tokens = await resolveTokens(id, frameNo, config)
            const filename = buildFilename(config.output.filenameTemplate, tokens, index, ext)
            const outPath = resolveConflict(dir, filename, config.output.overwrite, existing)
            if (!outPath) {
              // skip
              results.push({ photoId: id, ok: false, error: 'skipped (exists)' })
            } else {
              await renderExport(id, config, frameNo, outPath)
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
          if (!win?.isDestroyed()) {
            sender.send('export:progress', { done, total, success, failed, photoId: id })
          }
        }
      }

      await Promise.all(Array.from({ length: concurrency }, () => worker()))

      if (!win?.isDestroyed()) {
        sender.send('export:done', { total, success, failed, cancelled: batchCancelled, results })
      }
      return { total, success, failed, cancelled: batchCancelled }
    }
  )

  ipcMain.handle('export:cancel', () => {
    batchCancelled = true
    return true
  })

  // 目录选择
  ipcMain.handle('export:pickDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  // 预设 CRUD
  ipcMain.handle('export:presets:list', () => {
    const db = getDb()
    const rows = db
      .prepare('SELECT * FROM export_presets ORDER BY is_builtin DESC, name ASC')
      .all() as (Omit<ExportPreset, 'config'> & { config: string })[]
    return rows.map((r) => ({ ...r, config: JSON.parse(r.config) })) as ExportPreset[]
  })

  ipcMain.handle(
    'export:presets:save',
    async (_e, name: string, config: ExportConfig) => {
      const db = getDb()
      const existing = db
        .prepare('SELECT id, is_builtin FROM export_presets WHERE name = ?')
        .get(name) as { id: number; is_builtin: number } | undefined
      if (existing) {
        if (existing.is_builtin) {
          // 内置预设不允许覆盖，自动另存为带后缀
          const newName = `${name} (自定义)`
          db.prepare(
            'INSERT INTO export_presets (name, is_builtin, config) VALUES (?, 0, ?)'
          ).run(newName, JSON.stringify(config))
          return { id: (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id, name: newName }
        }
        db.prepare(
          "UPDATE export_presets SET config = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(JSON.stringify(config), existing.id)
        return { id: existing.id, name }
      }
      db.prepare(
        'INSERT INTO export_presets (name, is_builtin, config) VALUES (?, 0, ?)'
      ).run(name, JSON.stringify(config))
      const id = (db.prepare('SELECT last_insert_rowid() as id').get() as { id: number }).id
      return { id, name }
    }
  )

  ipcMain.handle('export:presets:delete', async (_e, id: number) => {
    const db = getDb()
    const row = db.prepare('SELECT is_builtin FROM export_presets WHERE id = ?').get(id) as
      | { is_builtin: number }
      | undefined
    if (row?.is_builtin) return false
    db.prepare('DELETE FROM export_presets WHERE id = ?').run(id)
    return true
  })

  // 字体列表（返回常用字体族字符串，供渲染层下拉）
  ipcMain.handle('export:listFonts', () => {
    const isWin = process.platform === 'win32'
    if (isWin) {
      return [
        'Microsoft YaHei, Segoe UI, Arial, sans-serif',
        'Microsoft YaHei UI, sans-serif',
        'SimHei, sans-serif',
        'SimSun, serif',
        'KaiTi, serif',
        'Segoe UI, Arial, sans-serif',
        'Arial, sans-serif',
        'Times New Roman, serif',
        'Courier New, monospace'
      ]
    }
    if (process.platform === 'darwin') {
      return [
        'PingFang SC, Helvetica Neue, Arial, sans-serif',
        'Heiti SC, sans-serif',
        'STHeiti, sans-serif',
        'Helvetica Neue, Arial, sans-serif',
        'Times New Roman, serif'
      ]
    }
    return [
      'Noto Sans CJK SC, sans-serif',
      'WenQuanYi Micro Hei, sans-serif',
      'DejaVu Sans, sans-serif',
      'Arial, sans-serif'
    ]
  })

  // 默认配置
  ipcMain.handle('export:defaultConfig', () => DEFAULT_EXPORT_CONFIG)
}
