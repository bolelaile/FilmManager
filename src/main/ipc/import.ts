import { ipcMain, dialog, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import { getDb } from '../db/index'
import {
  generateThumbnail,
  getImageMeta,
  getExifData,
  SUPPORTED_EXTENSIONS,
  getFileType
} from '../services/thumbnail'
import { getLibraryRoot, getThumbDir } from './index'

export function registerImportIpc(): void {
  // 打开文件夹选择对话框并导入
  ipcMain.handle('import:selectAndImport', async (event, subLibraryId?: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: '选择要导入的文件夹'
    })
    if (result.canceled || !result.filePaths[0]) return { imported: 0, skipped: 0, importedIds: [] }

    const folderPath = result.filePaths[0]
    return importFolder(folderPath, subLibraryId, event)
  })

  // 拖拽 / 路径导入（支持文件和文件夹混合）
  ipcMain.handle('import:importPaths', async (event, filePaths: string[], subLibraryId?: number) => {
    let imported = 0
    let skipped = 0
    const importedIds: number[] = []

    const allFiles: string[] = []
    for (const p of filePaths) {
      try {
        const stat = fs.statSync(p)
        if (stat.isDirectory()) {
          allFiles.push(...walk(p))
        } else {
          const ext = path.extname(p).toLowerCase()
          if (SUPPORTED_EXTENSIONS.has(ext)) allFiles.push(p)
        }
      } catch {}
    }

    event.sender.send('import:total', allFiles.length)
    for (const filePath of allFiles) {
      const photoId = await importFile(filePath, subLibraryId)
      if (photoId !== null) {
        imported++
        importedIds.push(photoId)
      } else {
        skipped++
      }
      event.sender.send('import:progress', { imported, skipped, total: allFiles.length })
    }
    return { imported, skipped, importedIds }
  })
}

function walk(dir: string): string[] {
  const files: string[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) files.push(...walk(full))
      else {
        const ext = path.extname(entry.name).toLowerCase()
        if (SUPPORTED_EXTENSIONS.has(ext)) files.push(full)
      }
    }
  } catch {}
  return files
}

async function importFolder(
  folderPath: string,
  subLibraryId: number | undefined,
  event: Electron.IpcMainInvokeEvent
): Promise<{ imported: number; skipped: number; importedIds: number[] }> {
  let imported = 0
  let skipped = 0
  const importedIds: number[] = []

  const allFiles = walk(folderPath)
  event.sender.send('import:total', allFiles.length)

  for (const filePath of allFiles) {
    const photoId = await importFile(filePath, subLibraryId)
    if (photoId !== null) {
      imported++
      importedIds.push(photoId)
    } else {
      skipped++
    }
    event.sender.send('import:progress', { imported, skipped, total: allFiles.length })
  }
  return { imported, skipped, importedIds }
}

// 返回新插入的 photo id，若跳过则返回 null
async function importFile(sourcePath: string, subLibraryId?: number): Promise<number | null> {
  const db = getDb()
  const libraryRoot = getLibraryRoot()
  const thumbDir = getThumbDir()

  const destPath = path.join(libraryRoot, 'files', path.basename(sourcePath))
  const finalDest = ensureUniquePath(destPath)

  try {
    const existing = db.prepare('SELECT id FROM photos WHERE file_path = ?').get(finalDest)
    if (existing) return null

    fs.mkdirSync(path.dirname(finalDest), { recursive: true })
    fs.copyFileSync(sourcePath, finalDest)

    const stat = fs.statSync(finalDest)
    const meta = await getImageMeta(finalDest)

    // Read EXIF for shot_date and camera model
    const exif = await getExifData(finalDest)

    const info = db
      .prepare(
        `INSERT INTO photos (file_path, original_name, file_type, width, height, file_size, sub_library_id, shot_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        finalDest,
        path.basename(sourcePath),
        getFileType(sourcePath),
        meta?.width ?? null,
        meta?.height ?? null,
        stat.size,
        subLibraryId ?? null,
        exif.shotDate ?? null
      )

    const photoId = info.lastInsertRowid as number

    // Auto-assign camera attribute from EXIF if matched
    if (exif.cameraModel) {
      try {
        const cameraType = db.prepare("SELECT id FROM attribute_types WHERE key='camera'").get() as { id: number } | undefined
        if (cameraType) {
          // Normalize for fuzzy match: collapse spaces, lowercase
          const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()
          const normModel = normalize(exif.cameraModel)
          // Find best matching camera value
          const cameraValues = db.prepare(
            'SELECT id, value FROM attribute_values WHERE attribute_type_id = ?'
          ).all(cameraType.id) as { id: number; value: string }[]
          const match = cameraValues.find((v) => normalize(v.value) === normModel)
            || cameraValues.find((v) => normModel.includes(normalize(v.value)) || normalize(v.value).includes(normModel))
          if (match) {
            db.prepare(
              'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
            ).run(photoId, cameraType.id, match.id)
          }
        }
      } catch (e) {
        log.warn('EXIF camera match failed', e)
      }
    }

    // 后台生成缩略图
    generateThumbnail(finalDest, thumbDir).then((thumbPath) => {
      if (thumbPath) {
        db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
      }
    })

    return photoId
  } catch (err) {
    log.error('Import file failed', sourcePath, err)
    return null
  }
}

function ensureUniquePath(dest: string): string {
  if (!fs.existsSync(dest)) return dest
  const ext = path.extname(dest)
  const base = dest.slice(0, -ext.length)
  let i = 1
  while (fs.existsSync(`${base}_${i}${ext}`)) i++
  return `${base}_${i}${ext}`
}
