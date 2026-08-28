/**
 * 导入 IPC 适配层（薄 adapter）。转发到 ImportService。
 * 仅保留 dialog 文件夹选择（UI 交互）+ 转发，业务逻辑在 features/import。
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { ImportService } from '../features/import'
import type { ImportOptions } from '../../shared/import-types'

export type { AutoOrganizeMode, ImportOptions } from '../../shared/import-types'

const service = new ImportService()

export function registerImportIpc(): void {
  // 选择文件夹并导入
  ipcMain.handle('import:selectAndImport', async (event, options: ImportOptions = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: '选择要导入的文件夹' })
    if (result.canceled || !result.filePaths[0]) return { imported: 0, skipped: 0, importedIds: [] }
    return service.selectAndImport(event, options, result.filePaths[0])
  })

  // 拖拽/路径导入
  ipcMain.handle('import:importPaths', async (event, filePaths: string[], options: ImportOptions = {}) =>
    service.importPaths(event, filePaths, options)
  )

  // 扫描子文件夹（卷模式）
  ipcMain.handle('import:scanFolders', async (event, providedPath?: string) => {
    let rootPath: string
    if (providedPath) { rootPath = providedPath }
    else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: '选择包含子文件夹（每个子文件夹为一卷）的根目录' })
      if (result.canceled || !result.filePaths[0]) return null
      rootPath = result.filePaths[0]
    }
    return service.scanFolders(rootPath)
  })

  // 扫描单文件夹为一卷
  ipcMain.handle('import:scanSingleFolder', async (event, providedPath?: string) => {
    let folderPath: string
    if (providedPath) { folderPath = providedPath }
    else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'], title: '选择要作为一卷导入的文件夹' })
      if (result.canceled || !result.filePaths[0]) return null
      folderPath = result.filePaths[0]
    }
    return service.scanSingleFolder(folderPath)
  })

  // 按卷批量导入
  ipcMain.handle('import:importRolls', async (event, configs) => service.importRolls(configs, event))
}
