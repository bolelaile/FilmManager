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

export type AutoOrganizeMode = 'none' | 'year' | 'year-month' | 'camera' | 'film' | 'source-folder'

export interface ImportOptions {
  subLibraryId?: number
  organizeBy?: AutoOrganizeMode
  shotDate?: string | null
  filmName?: string | null
  cameraName?: string | null
  lensName?: string | null
  autoCreateEquipment?: boolean
}

export function registerImportIpc(): void {
  // 打开文件夹选择对话框并导入
  ipcMain.handle('import:selectAndImport', async (event, options: ImportOptions = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: '选择要导入的文件夹'
    })
    if (result.canceled || !result.filePaths[0]) return { imported: 0, skipped: 0, importedIds: [] }

    const folderPath = result.filePaths[0]
    return importFolder(folderPath, options, event)
  })

  // 拖拽 / 路径导入（支持文件和文件夹混合）
  ipcMain.handle('import:importPaths', async (event, filePaths: string[], options: ImportOptions = {}) => {
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
      const photoId = await importFile(filePath, options)
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
  options: ImportOptions,
  event: Electron.IpcMainInvokeEvent
): Promise<{ imported: number; skipped: number; importedIds: number[] }> {
  let imported = 0
  let skipped = 0
  const importedIds: number[] = []

  const allFiles = walk(folderPath)
  event.sender.send('import:total', allFiles.length)

  for (const filePath of allFiles) {
    const photoId = await importFile(filePath, options)
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
async function importFile(sourcePath: string, options: ImportOptions): Promise<number | null> {
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
    const effectiveShotDate = options.shotDate ?? exif.shotDate
    const targetSubLibraryId = resolveTargetSubLibrary(options, sourcePath, effectiveShotDate, exif.cameraModel)

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
        targetSubLibraryId ?? null,
        effectiveShotDate ?? null
      )

    const photoId = info.lastInsertRowid as number

    const autoCreateEquipment = options.autoCreateEquipment !== false
    assignEquipmentAttribute(photoId, 'camera', options.cameraName ?? exif.cameraModel, autoCreateEquipment)
    assignEquipmentAttribute(photoId, 'lens', options.lensName ?? exif.lensModel, autoCreateEquipment)

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

function normalizeEquipmentValue(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\b(corporation|corp|company|co|limited|ltd)\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
}

function findEquipmentValue(
  values: { id: number; value: string }[],
  model: string
): { id: number; value: string } | undefined {
  const modelKey = normalizeEquipmentValue(model)
  const exact = values.find((value) => normalizeEquipmentValue(value.value) === modelKey)
  if (exact) return exact

  return values
    .filter((value) => {
      const valueKey = normalizeEquipmentValue(value.value)
      return valueKey.length >= 4 && (modelKey.includes(valueKey) || valueKey.includes(modelKey))
    })
    .sort((a, b) => normalizeEquipmentValue(b.value).length - normalizeEquipmentValue(a.value).length)[0]
}

function assignEquipmentAttribute(
  photoId: number,
  typeKey: 'camera' | 'lens',
  model: string | null,
  autoCreate: boolean
): void {
  if (!model) return
  try {
    const db = getDb()
    const attributeType = db
      .prepare('SELECT id FROM attribute_types WHERE key = ?')
      .get(typeKey) as { id: number } | undefined
    if (!attributeType) return

    const values = db
      .prepare('SELECT id, value FROM attribute_values WHERE attribute_type_id = ?')
      .all(attributeType.id) as { id: number; value: string }[]
    let value = findEquipmentValue(values, model)

    if (!value && autoCreate) {
      db.prepare(
        'INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, is_preset) VALUES (?, ?, 0)'
      ).run(attributeType.id, model)
      value = db
        .prepare('SELECT id, value FROM attribute_values WHERE attribute_type_id = ? AND value = ? COLLATE NOCASE')
        .get(attributeType.id, model) as { id: number; value: string } | undefined
    }

    if (value) {
      db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      ).run(photoId, attributeType.id, value.id)
    }
  } catch (err) {
    log.warn(`EXIF ${typeKey} match failed`, err)
  }
}

function resolveTargetSubLibrary(
  options: ImportOptions,
  sourcePath: string,
  shotDate: string | null,
  cameraModel: string | null
): number | undefined {
  const mode = options.organizeBy ?? 'none'
  if (mode === 'none') return options.subLibraryId

  let pathNames: string[]
  switch (mode) {
    case 'year':
      pathNames = [shotDate?.slice(0, 4) || '日期未知']
      break
    case 'year-month':
      pathNames = shotDate
        ? [shotDate.slice(0, 4), shotDate.slice(0, 7)]
        : ['日期未知']
      break
    case 'camera':
      pathNames = [options.cameraName || cameraModel || '相机未知']
      break
    case 'film':
      pathNames = [options.filmName || '胶片未指定']
      break
    case 'source-folder':
      pathNames = [path.basename(path.dirname(sourcePath)) || '来源未知']
      break
  }

  let parentId = options.subLibraryId
  for (const rawName of pathNames) {
    parentId = getOrCreateSubLibrary(sanitizeSubLibraryName(rawName), parentId)
  }
  return parentId
}

function sanitizeSubLibraryName(name: string): string {
  return name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) || '未命名'
}

function getOrCreateSubLibrary(name: string, parentId?: number): number {
  const db = getDb()
  const existing = db
    .prepare('SELECT id FROM sub_libraries WHERE parent_id IS ? AND name = ? COLLATE NOCASE LIMIT 1')
    .get(parentId ?? null, name) as { id: number } | undefined
  if (existing) return existing.id

  const maxOrder = (
    db.prepare('SELECT MAX(sort_order) as value FROM sub_libraries WHERE parent_id IS ?').get(parentId ?? null) as {
      value: number | null
    }
  ).value ?? 0
  const result = db
    .prepare('INSERT INTO sub_libraries (name, parent_id, sort_order) VALUES (?, ?, ?)')
    .run(name, parentId ?? null, maxOrder + 1)
  return Number(result.lastInsertRowid)
}

function ensureUniquePath(dest: string): string {
  if (!fs.existsSync(dest)) return dest
  const ext = path.extname(dest)
  const base = dest.slice(0, -ext.length)
  let i = 1
  while (fs.existsSync(`${base}_${i}${ext}`)) i++
  return `${base}_${i}${ext}`
}
