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

// ── types ────────────────────────────────────────────────────────────────────

interface AttrMatch {
  typeId: number
  valueId: number
  value: string
  key: string
  iconKey?: string | null
  matchedAlias: string | null  // null = matched by primary name; non-null = alias that triggered match
}

interface AliasRow {
  alias: string
  value_id: number
  attribute_type_id: number
  icon_key?: string | null
  type_key: string
}

export interface FolderScanResult {
  name: string
  folderPath: string
  fileCount: number
  matches: AttrMatch[]       // best-match per attribute type from child folder name
  parentMatches: AttrMatch[] // best-match from parent folder name (may overlap)
  parsedDate: string | null  // YYYY-MM-DD extracted from folder name, if any
  inferredRollName: string   // pre-computed suggested roll name
}

export interface RollImportConfig {
  folderPath: string
  rollName: string
  attrs: { typeId: number; valueId: number }[]
  locationId?: number | null
  shotDate?: string | null
  subLibraryId?: number | null
  createRoll: boolean // false → just import photos without creating a roll
}

// ── helpers ──────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  // Strip whitespace, common separators, and lowercase — ensures case-insensitive
  // matching across different naming styles (spaces, hyphens, underscores, dots)
  return s.replace(/[\s\-_.]/g, '').toLowerCase()
}

/** Fuzzy-match a folder name against attribute values and aliases. Returns best match per type. */
function matchFolderName(
  folderName: string,
  allValues: { id: number; attribute_type_id: number; value: string; key: string; icon_key?: string | null }[],
  aliases: AliasRow[] = []
): AttrMatch[] {
  const norm = normalize(folderName)
  const matched: AttrMatch[] = []
  const seenTypes = new Set<number>()

  // ── Pass 1: primary value matching ────────────────────────────────────────
  // Prefer longer matches (more specific)
  const sorted = [...allValues].sort((a, b) => b.value.length - a.value.length)

  for (const v of sorted) {
    if (seenTypes.has(v.attribute_type_id)) continue
    const normVal = normalize(v.value)
    if (normVal.length < 2) continue
    if (norm.includes(normVal) || normVal.includes(norm)) {
      matched.push({
        typeId: v.attribute_type_id,
        valueId: v.id,
        value: v.value,
        key: v.key,
        iconKey: v.icon_key ?? null,
        matchedAlias: null
      })
      seenTypes.add(v.attribute_type_id)
    }
  }

  // ── Pass 2: alias matching (fills gaps not covered by primary) ────────────
  // Sort aliases by length descending for specificity
  const sortedAliases = [...aliases].sort((a, b) => b.alias.length - a.alias.length)

  for (const a of sortedAliases) {
    if (seenTypes.has(a.attribute_type_id)) continue
    const normAlias = normalize(a.alias)
    if (normAlias.length < 2) continue
    if (norm.includes(normAlias) || normAlias.includes(norm)) {
      // Find the primary value record to get its value string and key
      const primaryVal = allValues.find((v) => v.id === a.value_id)
      if (!primaryVal) continue
      matched.push({
        typeId: a.attribute_type_id,
        valueId: a.value_id,
        value: primaryVal.value,
        key: a.type_key,
        iconKey: a.icon_key ?? null,
        matchedAlias: a.alias  // preserve original (un-normalized) alias for display
      })
      seenTypes.add(a.attribute_type_id)
    }
  }

  return matched
}

/**
 * Merge two match arrays, preferring child matches over parent matches
 * for the same attribute type (parent fills in gaps only).
 */
function mergeMatches(child: AttrMatch[], parent: AttrMatch[]): AttrMatch[] {
  const result = [...child]
  const seenTypes = new Set(child.map((m) => m.typeId))
  for (const m of parent) {
    if (!seenTypes.has(m.typeId)) {
      result.push(m)
      seenTypes.add(m.typeId)
    }
  }
  return result
}

/**
 * Parse date from a folder/file name segment.
 * Recognises common patterns:
 *   YYYYMMDD, YYYY-MM-DD, YYYY/MM/DD, YYYYMM, YYYY-MM, YYYY_MM,
 *   also two-digit year variants like 240305 or 2403.
 * Returns YYYY-MM-DD or YYYY-MM-01 (when only year+month found).
 */
function parseDateFromName(name: string): string | null {
  // Full ISO or condensed 8-digit: 2024-03-05 / 20240305
  const fullDate = name.match(/\b(20\d{2})[-_./]?(0[1-9]|1[0-2])[-_./]?(0[1-9]|[12]\d|3[01])\b/)
  if (fullDate) return `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`

  // Year + month only: 2024-03 / 202403 / 2024_03
  const yearMonth = name.match(/\b(20\d{2})[-_./]?(0[1-9]|1[0-2])\b/)
  if (yearMonth) return `${yearMonth[1]}-${yearMonth[2]}-01`

  // Two-digit year + month + day: 240305 (interpreted as 2024-03-05)
  const shortDate = name.match(/\b([2-9]\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])\b/)
  if (shortDate) return `20${shortDate[1]}-${shortDate[2]}-${shortDate[3]}`

  // Two-digit year + month: 2403 → 2024-03
  const shortYM = name.match(/\b([2-9]\d)(0[1-9]|1[0-2])\b/)
  if (shortYM) return `20${shortYM[1]}-${shortYM[2]}-01`

  return null
}

/**
 * Build a human-readable roll name suggestion from matched attributes and date.
 * E.g. "Kodak Portra 400 · 135/35mm · 2024-03"
 */
function buildRollName(
  folderName: string,
  mergedMatches: AttrMatch[],
  parsedDate: string | null
): string {
  const film = mergedMatches.find((m) => m.key === 'film')
  const fmt = mergedMatches.find((m) => m.key === 'film_format')

  if (!film && !fmt) return folderName

  const parts: string[] = []
  if (film) parts.push(film.value)
  if (fmt) parts.push(fmt.value)
  if (parsedDate) parts.push(parsedDate.slice(0, 7)) // YYYY-MM
  return parts.join(' · ')
}

export function registerImportIpc(): void {
  // ── 1. 打开文件夹选择对话框并导入（旧有，单批次） ──────────────────────────
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

  // ── 2. 拖拽 / 路径导入（单批次） ─────────────────────────────────────────
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

  // ── 3. 扫描文件夹：枚举子文件夹，匹配属性 ────────────────────────────────
  ipcMain.handle('import:scanFolders', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory'],
      title: '选择包含子文件夹（每个子文件夹为一卷）的根目录'
    })
    if (result.canceled || !result.filePaths[0]) return null

    const rootPath = result.filePaths[0]
    const db = getDb()

    // Load all matchable attribute values (film, film_format, camera, lens)
    const matchableKeys = ['film', 'film_format', 'camera', 'lens']
    const allValues = db.prepare(`
      SELECT av.id, av.attribute_type_id, av.value, av.icon_key, at.key
      FROM attribute_values av
      JOIN attribute_types at ON at.id = av.attribute_type_id
      WHERE at.key IN (${matchableKeys.map(() => '?').join(',')})
      ORDER BY LENGTH(av.value) DESC
    `).all(...matchableKeys) as { id: number; attribute_type_id: number; value: string; key: string; icon_key?: string | null }[]

    // Load aliases for all matchable values
    const allAliases = db.prepare(`
      SELECT ava.alias, ava.value_id, av.attribute_type_id, av.icon_key, at.key as type_key
      FROM attribute_value_aliases ava
      JOIN attribute_values av ON av.id = ava.value_id
      JOIN attribute_types at ON at.id = av.attribute_type_id
      WHERE at.key IN (${matchableKeys.map(() => '?').join(',')})
      ORDER BY LENGTH(ava.alias) DESC
    `).all(...matchableKeys) as AliasRow[]

    // Enumerate immediate subdirectories
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(rootPath, { withFileTypes: true })
    } catch {
      return { rootPath, folders: [] }
    }

    // ── Determine parent-folder role ──────────────────────────────────────
    const rootName = path.basename(rootPath)
    const rootMatches = matchFolderName(rootName, allValues, allAliases)

    const folders: FolderScanResult[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folderPath = path.join(rootPath, entry.name)
      const files = walkDirect(folderPath)
      if (files.length === 0) continue

      // Match child folder name (primary + alias)
      const childMatches = matchFolderName(entry.name, allValues, allAliases)

      // Parse date from child name (fallback to root name)
      const parsedDate = parseDateFromName(entry.name) ?? parseDateFromName(rootName)

      // Merge: child takes priority, parent fills gaps
      // Exception: if parent provides the same type as child, child wins.
      const mergedMatches = mergeMatches(childMatches, rootMatches)

      const inferredRollName = buildRollName(entry.name, mergedMatches, parsedDate)

      folders.push({
        name: entry.name,
        folderPath,
        fileCount: files.length,
        matches: childMatches,
        parentMatches: rootMatches,
        parsedDate,
        inferredRollName
      })
    }

    // Also count loose files in the root (no subfolder) as a potential "other" batch
    const rootFiles = fs.readdirSync(rootPath, { withFileTypes: true })
      .filter((e) => !e.isDirectory())
      .map((e) => path.join(rootPath, e.name))
      .filter((f) => SUPPORTED_EXTENSIONS.has(path.extname(f).toLowerCase()))

    return {
      rootPath,
      folders,
      rootFileCount: rootFiles.length,
      rootMatches  // send to frontend so it can show the parent-level hint
    }
  })

  // ── 4. 按卷批量导入（用户确认后） ────────────────────────────────────────
  ipcMain.handle('import:importRolls', async (event, configs: RollImportConfig[]) => {
    const db = getDb()
    const results: { rollName: string; imported: number; skipped: number; rollId: number | null }[] = []

    // Count total files
    let totalFiles = 0
    for (const cfg of configs) {
      totalFiles += walkDirect(cfg.folderPath).length
    }
    event.sender.send('import:total', totalFiles)

    let globalImported = 0
    let globalSkipped = 0

    for (const cfg of configs) {
      const files = walkDirect(cfg.folderPath)
      let imported = 0
      let skipped = 0
      const importedIds: number[] = []

      for (const filePath of files) {
        const photoId = await importFile(filePath, cfg.subLibraryId ?? undefined)
        if (photoId !== null) {
          imported++
          globalImported++
          importedIds.push(photoId)
        } else {
          skipped++
          globalSkipped++
        }
        event.sender.send('import:progress', {
          imported: globalImported,
          skipped: globalSkipped,
          total: totalFiles
        })
      }

      // Apply attributes
      if (importedIds.length > 0 && cfg.attrs.length > 0) {
        const insertAttr = db.prepare(
          'INSERT OR REPLACE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
        )
        const tx = db.transaction(() => {
          for (const id of importedIds) {
            for (const attr of cfg.attrs) {
              insertAttr.run(id, attr.typeId, attr.valueId)
            }
          }
        })
        tx()
      }

      // Apply location
      if (importedIds.length > 0 && cfg.locationId) {
        const insertLoc = db.prepare('INSERT OR IGNORE INTO photo_locations (photo_id, location_id) VALUES (?, ?)')
        const tx = db.transaction(() => {
          for (const id of importedIds) insertLoc.run(id, cfg.locationId)
        })
        tx()
      }

      // Apply shot date
      if (importedIds.length > 0 && cfg.shotDate) {
        db.prepare(`UPDATE photos SET shot_date = ? WHERE id IN (${importedIds.map(() => '?').join(',')})`).run(
          cfg.shotDate, ...importedIds
        )
      }

      // Create roll
      let rollId: number | null = null
      if (cfg.createRoll && importedIds.length > 0) {
        const coverPhoto = db.prepare(`
          SELECT id FROM photos WHERE id IN (${importedIds.map(() => '?').join(',')}) AND thumb_ready = 1
          ORDER BY shot_date ASC, imported_at ASC LIMIT 1
        `).get(...importedIds) as { id: number } | undefined

        const info = db.prepare(
          'INSERT INTO rolls (name, sub_library_id, cover_photo_id) VALUES (?, ?, ?)'
        ).run(cfg.rollName, cfg.subLibraryId ?? null, coverPhoto?.id ?? importedIds[0])
        rollId = info.lastInsertRowid as number

        const insertPhotoRoll = db.prepare('INSERT OR IGNORE INTO photo_rolls (photo_id, roll_id) VALUES (?, ?)')
        const tx = db.transaction(() => {
          for (const id of importedIds) insertPhotoRoll.run(id, rollId)
        })
        tx()
      }

      results.push({ rollName: cfg.rollName, imported, skipped, rollId })
    }

    return { results, totalImported: globalImported, totalSkipped: globalSkipped }
  })
}

// ── internal helpers ─────────────────────────────────────────────────────────

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

/** Walk a single folder (recursive), returning only supported image files. */
function walkDirect(dir: string): string[] {
  return walk(dir)
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
          const normModel = normalize(exif.cameraModel)
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
