/**
 * 导出 IPC 适配层（薄 adapter）。转发到 ExportService。
 */
import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { ExportService } from '../features/export'
import type { ExportConfig } from '../../shared/export-types'

let service: ExportService | null = null
function getService(): ExportService {
  if (!service) service = new ExportService(createRepositories(getDb()).exportPresets)
  return service
}

export function registerExportIpc(): void {
  ipcMain.handle('export:matchBorder', (_e, photoId: number) => getService().matchBorder(photoId))
  ipcMain.handle('export:preview', (_e, photoId: number, config: ExportConfig) => getService().preview(photoId, config))

  ipcMain.handle('export:render', (_e, photoId: number, config: ExportConfig) =>
    getService().render(photoId, config, app.getPath('pictures'))
  )

  ipcMain.handle('export:batch', async (event, photoIds: number[], config: ExportConfig) => {
    const sender = event.sender
    const win = BrowserWindow.fromWebContents(sender)
    return getService().batch(
      photoIds, config, app.getPath('pictures'),
      () => !!win?.isDestroyed(),
      (channel, data) => { if (!win?.isDestroyed()) sender.send(channel, data) }
    )
  })

  ipcMain.handle('export:cancel', () => getService().cancel())
  ipcMain.handle('export:pickDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  // 预设 CRUD
  ipcMain.handle('export:presets:list', () => getService().listPresets())
  ipcMain.handle('export:presets:save', (_e, name: string, config: ExportConfig) => getService().savePreset(name, config))
  ipcMain.handle('export:presets:delete', (_e, id: number) => getService().deletePreset(id))

  ipcMain.handle('export:listFonts', () => getService().listFonts())
  ipcMain.handle('export:defaultConfig', () => getService().defaultConfig())
}
