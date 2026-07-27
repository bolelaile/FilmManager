import { ipcMain, app, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { getLibraryRoot, getThumbDir, getProfilesDir } from './index'
import { generateThumbnail } from '../services/thumbnail'
import { getDb } from '../db/index'

export function registerLibraryIpc(): void {
  // 获取库信息
  ipcMain.handle('library:info', () => {
    return {
      root: getLibraryRoot(),
      thumbDir: getThumbDir(),
      profilesDir: getProfilesDir()
    }
  })

  // 在文件管理器中打开文件
  ipcMain.handle('library:revealFile', (_, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // 重新生成指定照片的缩略图
  ipcMain.handle('library:regenThumb', async (_, photoId: number) => {
    const db = getDb()
    const row = db.prepare('SELECT file_path, rotation FROM photos WHERE id = ?').get(photoId) as { file_path: string; rotation?: number } | undefined
    if (!row) return false
    const thumbPath = await generateThumbnail(row.file_path, getThumbDir(), row.rotation ?? 0)
    if (thumbPath) {
      db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
    }
    return thumbPath ?? null
  })

  // 获取可用 ICC 配置文件列表
  ipcMain.handle('library:listProfiles', () => {
    const profilesDir = getProfilesDir()
    const customDir = path.join(getLibraryRoot(), 'profiles')
    const collect = (dir: string, isPreset: boolean) => {
      if (!fs.existsSync(dir)) return []
      return fs.readdirSync(dir)
        .filter((f) => /\.(icc|icm)$/i.test(f))
        .map((f) => ({
          name: path.basename(f, path.extname(f)),
          path: path.join(dir, f),
          isPreset
        }))
    }
    return [...collect(profilesDir, true), ...collect(customDir, false)]
  })

  // 导入自定义 ICC 配置文件
  ipcMain.handle('library:importProfile', async (event) => {
    const win = require('electron').BrowserWindow.fromWebContents(event.sender)
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

  // 库统计
  ipcMain.handle('library:stats', () => {
    const db = getDb()
    const total = (db.prepare('SELECT COUNT(*) as c FROM photos').get() as { c: number }).c
    const byType = db
      .prepare('SELECT file_type, COUNT(*) as count FROM photos GROUP BY file_type')
      .all() as { file_type: string; count: number }[]
    const librarySize = getFolderSize(path.join(getLibraryRoot(), 'files'))
    return { total, byType, librarySize }
  })
}

function getFolderSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let size = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) size += getFolderSize(full)
    else size += fs.statSync(full).size
  }
  return size
}
