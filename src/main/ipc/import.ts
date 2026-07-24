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
      const configuredAttrs = cfg.attrs.length > 0
        ? db.prepare(`
            SELECT at.key, av.value
            FROM attribute_values av
            JOIN attribute_types at ON at.id = av.attribute_type_id
            WHERE av.id IN (${cfg.attrs.map(() => '?').join(',')})
          `).all(...cfg.attrs.map((attr) => attr.valueId)) as { key: string; value: string }[]
        : []
      const importOptions: ImportOptions = {
        subLibraryId: cfg.subLibraryId ?? undefined,
        shotDate: cfg.shotDate ?? null,
        cameraName: configuredAttrs.find((attr) => attr.key === 'camera')?.value ?? null,
        lensName: configuredAttrs.find((attr) => attr.key === 'lens')?.value ?? null
      }

      for (const filePath of files) {
        const photoId = await importFile(filePath, importOptions)
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
          'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
        )
        const deleteAttr = db.prepare(
          'DELETE FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?'
        )
        const tx = db.transaction(() => {
          for (const id of importedIds) {
            for (const attr of cfg.attrs) {
              deleteAttr.run(id, attr.typeId)
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
    const aliases = db.prepare(`
      SELECT ava.value_id AS id, ava.alias AS value
      FROM attribute_value_aliases ava
      JOIN attribute_values av ON av.id = ava.value_id
      WHERE av.attribute_type_id = ?
    `).all(attributeType.id) as { id: number; value: string }[]
    let value = findEquipmentValue(values, model) ?? findEquipmentValue(aliases, model)

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
