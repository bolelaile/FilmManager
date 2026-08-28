/**
 * 库管理 IPC 适配层（薄 adapter）。转发到 LibraryService。
 */
import { ipcMain, dialog, shell, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { LibraryService } from '../features/library'
import { getLibraryRoot, getThumbDir, getProfilesDir } from './index'

let service: LibraryService | null = null
function getService(): LibraryService {
  if (!service) {
    const db = getDb()
    service = new LibraryService(
      createRepositories(db).photos,
      getLibraryRoot(),
      getThumbDir(),
      getProfilesDir()
    )
  }
  return service
}

export function registerLibraryIpc(): void {
  ipcMain.handle('library:info', () => getService().info())
  ipcMain.handle('library:revealFile', (_, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle('library:regenThumb', (_, photoId: number) => getService().regenThumb(photoId))
  ipcMain.handle('library:listProfiles', () => getService().listProfiles())

  ipcMain.handle('library:importProfile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      filters: [{ name: 'ICC Profile', extensions: ['icc', 'icm'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled) return []
    const customDir = path.join(getLibraryRoot(), 'profiles')
    fs.mkdirSync(customDir, { recursive: true })
    const imported: string[] = []
    for (const src of result.filePaths) {
      const dest = path.join(customDir, path.basename(src))
      fs.copyFileSync(src, dest)
      imported.push(path.basename(src, path.extname(src)))
    }
    return imported
  })

  ipcMain.handle('library:stats', () => getService().stats())
}
