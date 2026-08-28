/**
 * 属性 IPC 适配层（薄 adapter）。转发到 AttributeService。
 * 仅保留 dialog 文件选择（UI 交互）+ 转发，业务逻辑在 Service。
 */
import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { AttributeService } from '../features/attributes'

let service: AttributeService | null = null
function getService(): AttributeService {
  if (!service) {
    const db = getDb()
    service = new AttributeService(
      createRepositories(db).attributes,
      path.join(app.getAppPath(), 'resources', 'film-icons'),
      path.join(app.getPath('userData'), 'film-icons')
    )
  }
  return service
}

export function registerAttributesIpc(): void {
  ipcMain.handle('attrs:listTypes', () => getService().listTypes())
  ipcMain.handle('attrs:listValues', (_, typeId: number) => getService().listValues(typeId))
  ipcMain.handle('attrs:listAll', () => getService().listAllWithValues())
  ipcMain.handle('attrs:valueCounts', (_, params) => getService().valueCounts(params))

  ipcMain.handle('attrs:filmIconManifest', () => getService().filmIconManifest())
  ipcMain.handle('attrs:filmIconDataUrl', (_, iconKey: string, size?: 64 | 128) => getService().filmIconDataUrl(iconKey, size ?? 64))
  ipcMain.handle('attrs:filmIconsBatch', (_, iconKeys: string[], size?: 64 | 128) => getService().filmIconsBatch(iconKeys, size ?? 64))

  ipcMain.handle('attrs:importCustomIcon', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }],
      title: '选择胶片图标'
    })
    if (result.canceled || !result.filePaths[0]) return null
    return getService().importCustomIcon(result.filePaths[0])
  })

  ipcMain.handle('attrs:addType', (_, displayName: string) => getService().addType(displayName))
  ipcMain.handle('attrs:updateType', (_, id: number, displayName: string) => { getService().updateType(id, displayName); return true })
  ipcMain.handle('attrs:toggleType', (_, id: number, active: boolean) => { getService().toggleType(id, active); return true })
  ipcMain.handle('attrs:deleteType', (_, id: number) => { getService().deleteType(id); return true })
  ipcMain.handle('attrs:addValue', (_, typeId: number, value: string, iconKey?: string) => getService().addValue(typeId, value, iconKey))
  ipcMain.handle('attrs:updateValue', (_, id: number, value: string, iconKey?: string) => { getService().updateValue(id, value, iconKey); return true })
  ipcMain.handle('attrs:deleteValue', (_, id: number) => { getService().deleteValue(id); return true })
  ipcMain.handle('attrs:reorder', (_, orderedIds: number[]) => { getService().reorder(orderedIds); return true })

  ipcMain.handle('attrs:listAliases', (_, valueId: number) => getService().listAliases(valueId))
  ipcMain.handle('attrs:addAlias', (_, valueId: number, alias: string) => getService().addAlias(valueId, alias))
  ipcMain.handle('attrs:removeAlias', (_, aliasId: number) => { getService().removeAlias(aliasId); return true })

  ipcMain.handle('attrs:importJson', async (event, typeId: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'JSON 文件', extensions: ['json'] }],
      title: '选择要导入的 JSON 文件'
    })
    if (result.canceled || !result.filePaths[0]) return null
    try {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return { error: '文件内容不是数组' }
      return getService().importJson(typeId, parsed)
    } catch (e) {
      return { error: 'JSON 解析失败：' + String(e) }
    }
  })
}
