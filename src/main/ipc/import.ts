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
  getFileType,
  computeContentHash,
  detectFilmFormat
} from '../services/thumbnail'
import {
  ensureSubLibraryDirectory,
  ensureUniqueFilePath,
  getOrCreateSubLibrary as getOrCreatePhysicalSubLibrary
} from '../services/library-layout'
import { getLibraryRoot, getThumbDir } from './index'
import type { AutoOrganizeMode, ImportOptions } from '../../shared/import-types'

export type { AutoOrganizeMode, ImportOptions }

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
    return runTwoPhaseImport(allFiles, options, event)
  })

  // ── 3. 扫描文件夹：枚举子文件夹，匹配属性 ────────────────────────────────
  ipcMain.handle('import:scanFolders', async (event, providedPath?: string) => {
    let rootPath: string
    if (providedPath) {
      rootPath = providedPath
    } else {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win!, {
        properties: ['openDirectory'],
        title: '选择包含子文件夹（每个子文件夹为一卷）的根目录'
      })
      if (result.canceled || !result.filePaths[0]) return null
      rootPath = result.filePaths[0]
    }
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
      const files = walk(folderPath)
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
      totalFiles += walk(cfg.folderPath).length
    }
    event.sender.send('import:total', totalFiles)

    let globalImported = 0
    let globalSkipped = 0

    for (const cfg of configs) {
      const files = walk(cfg.folderPath)
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
        lensName: configuredAttrs.find((attr) => attr.key === 'lens')?.value ?? null,
        filmName: configuredAttrs.find((attr) => attr.key === 'film')?.value ?? null
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

/** Walk a directory recursively, returning only supported image files. */
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
  const allFiles = walk(folderPath)
  return runTwoPhaseImport(allFiles, options, event)
}

// ── 两阶段导入核心 ────────────────────────────────────────────────────────────

/**
 * 两阶段导入入口：
 * 阶段一 — 批量快速登记，立即通知前端文件总数，让图库刷新出占位卡片
 * 阶段二 — 逐张后台处理（EXIF、拷贝、缩略图），每完成一张推送进度
 */
async function runTwoPhaseImport(
  allFiles: string[],
  options: ImportOptions,
  event: Electron.IpcMainInvokeEvent
): Promise<{ imported: number; skipped: number; importedIds: number[] }> {
  const db = getDb()
  const storageMode = options.storageMode ?? 'managed'

  // ── 阶段一：快速登记 ──────────────────────────────────────────────────────
  event.sender.send('import:total', allFiles.length)

  const registrations: { photoId: number; sourcePath: string }[] = []
  const registerStmt = db.prepare(`
    INSERT OR IGNORE INTO photos
      (file_path, original_name, file_type, file_size, sub_library_id, import_status, storage_mode)
    VALUES (?, ?, ?, ?, ?, 'indexing', ?)
  `)

  db.transaction(() => {
    for (const filePath of allFiles) {
      try {
        const stat = fs.statSync(filePath)
        // linked 模式直接用原路径；managed 模式先用临时占位路径
        const placeholderPath = storageMode === 'linked'
          ? filePath
          : `__pending__${Date.now()}_${Math.random().toString(36).slice(2)}_${path.basename(filePath)}`
        const info = registerStmt.run(
          placeholderPath,
          path.basename(filePath),
          getFileType(filePath),
          stat.size,
          options.subLibraryId ?? null,
          storageMode
        )
        if (info.changes > 0) {
          registrations.push({ photoId: info.lastInsertRowid as number, sourcePath: filePath })
        }
      } catch {}
    }
  })()

  // 通知前端已登记（立即刷新图库出占位卡片）
  event.sender.send('import:registered', { count: registrations.length, total: allFiles.length })

  // 将任务写入队列
  const insertQueue = db.prepare('INSERT INTO import_queue (source_path, photo_id, status) VALUES (?, ?, ?)')
  const queueItems: { queueId: number; photoId: number; sourcePath: string }[] = []
  db.transaction(() => {
    for (const { photoId, sourcePath } of registrations) {
      const info = insertQueue.run(sourcePath, photoId, 'pending')
      queueItems.push({ queueId: info.lastInsertRowid as number, photoId, sourcePath })
    }
  })()

  // ── 阶段二：后台逐张处理 ──────────────────────────────────────────────────
  let done = 0
  let skipped = allFiles.length - registrations.length // 文件路径已存在而被 IGNORE 的
  const importedIds: number[] = []

  for (const { queueId, photoId, sourcePath } of queueItems) {
    await processQueueItem(queueId, photoId, sourcePath, options)

    const qRow = db.prepare('SELECT status FROM import_queue WHERE id = ?').get(queueId) as { status: string }
    if (qRow.status === 'done') {
      done++
      importedIds.push(photoId)
    } else {
      // skipped（内容重复）或 error
      skipped++
    }
    event.sender.send('import:progress', { imported: done, skipped, total: allFiles.length })
  }

  return { imported: done, skipped, importedIds }
}

/**
 * 阶段二：处理单个队列项——EXIF、拷贝（managed）、更新 DB、生成缩略图
 */
async function processQueueItem(
  queueId: number,
  photoId: number,
  sourcePath: string,
  options: ImportOptions
): Promise<void> {
  const db = getDb()
  const storageMode = options.storageMode ?? 'managed'
  const thumbDir = getThumbDir()
  const filesRoot = path.join(getLibraryRoot(), 'files')
  // 在 try 块外追踪已拷贝路径，确保错误时能正确撤销
  let copiedPath: string | null = null

  try {
    // 内容哈希去重（快速登记时跳过，此处补做）
    const contentHash = computeContentHash(sourcePath)
    if (contentHash) {
      const dup = db.prepare('SELECT id FROM photos WHERE content_hash = ? AND id != ?').get(contentHash, photoId)
      if (dup) {
        // 重复内容：删除占位记录
        db.prepare('DELETE FROM photos WHERE id = ?').run(photoId)
        db.prepare(`UPDATE import_queue SET status = 'skipped', done_at = datetime('now','localtime') WHERE id = ?`).run(queueId)
        return
      }
    }

    const meta = await getImageMeta(sourcePath)
    const exif = await getExifData(sourcePath)
    const effectiveShotDate = options.shotDate ?? exif.shotDate

    let finalPath = sourcePath
    let targetSubLibraryId: number | undefined | null = options.subLibraryId ?? null

    if (storageMode === 'managed') {
      targetSubLibraryId = resolveTargetSubLibrary(options, sourcePath, effectiveShotDate, exif.cameraModel, filesRoot)
      const targetDirectory = ensureSubLibraryDirectory(db, filesRoot, targetSubLibraryId)
      finalPath = ensureUniqueFilePath(path.join(targetDirectory, path.basename(sourcePath)))
      fs.copyFileSync(sourcePath, finalPath)
      copiedPath = finalPath
    }

    // 将占位记录更新为完整记录
    db.prepare(`
      UPDATE photos SET
        file_path = ?, width = ?, height = ?, shot_date = ?,
        content_hash = ?, sub_library_id = ?, import_status = 'ready'
      WHERE id = ?
    `).run(
      finalPath,
      meta?.width ?? null,
      meta?.height ?? null,
      effectiveShotDate ?? null,
      contentHash ?? null,
      targetSubLibraryId ?? null,
      photoId
    )

    const autoCreateEquipment = options.autoCreateEquipment !== false
    assignEquipmentAttribute(photoId, 'camera', options.cameraName ?? exif.cameraModel, autoCreateEquipment)
    assignEquipmentAttribute(photoId, 'lens', options.lensName ?? exif.lensModel, autoCreateEquipment)
    if (meta) {
      const filmSizeType = getPhotoFilmSizeType(photoId, options.filmName)
      const cameraInfo = getPhotoCameraFormatInfo(photoId, options.cameraName ?? exif.cameraModel)
      const detectedFormat = await resolveFilmFormat(sourcePath, meta.width, meta.height, filmSizeType, cameraInfo)
      if (detectedFormat) assignFilmFormatAttribute(photoId, detectedFormat)
    }

    db.prepare(`UPDATE import_queue SET status = 'done', done_at = datetime('now','localtime') WHERE id = ?`).run(queueId)

    // 缩略图后台生成（不阻塞进度）
    generateThumbnail(finalPath, thumbDir).then((thumbPath) => {
      if (thumbPath) db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
    })
  } catch (err) {
    log.error('Queue item processing failed', sourcePath, err)
    // managed 模式下如果文件已拷贝但 DB 更新失败，需撤销拷贝
    if (copiedPath) {
      try { fs.unlinkSync(copiedPath) } catch {}
    }
    db.prepare(`UPDATE import_queue SET status = 'error', error_msg = ?, done_at = datetime('now','localtime') WHERE id = ?`)
      .run(String(err), queueId)
    db.prepare(`UPDATE photos SET import_status = 'error' WHERE id = ?`).run(photoId)
  }
}

// 返回新插入的 photo id，若跳过则返回 null（保留旧接口，供 importRolls 使用）
async function importFile(sourcePath: string, options: ImportOptions): Promise<number | null> {
  const db = getDb()
  const libraryRoot = getLibraryRoot()
  const filesRoot = path.join(libraryRoot, 'files')
  const thumbDir = getThumbDir()
  let copiedPath: string | null = null

  try {
    // ① 内容哈希去重：在任何 IO 操作之前检查
    const contentHash = computeContentHash(sourcePath)
    if (contentHash) {
      const dup = db.prepare('SELECT id FROM photos WHERE content_hash = ?').get(contentHash)
      if (dup) return null // 内容相同，跳过
    }

    const meta = await getImageMeta(sourcePath)
    const exif = await getExifData(sourcePath)
    const effectiveShotDate = options.shotDate ?? exif.shotDate
    const targetSubLibraryId = resolveTargetSubLibrary(
      options,
      sourcePath,
      effectiveShotDate,
      exif.cameraModel,
      filesRoot
    )
    const targetDirectory = ensureSubLibraryDirectory(db, filesRoot, targetSubLibraryId)
    const finalDest = ensureUniqueFilePath(path.join(targetDirectory, path.basename(sourcePath)))
    fs.copyFileSync(sourcePath, finalDest)
    copiedPath = finalDest
    const stat = fs.statSync(finalDest)

    const info = db
      .prepare(
        `INSERT INTO photos (file_path, original_name, file_type, width, height, file_size, sub_library_id, shot_date, content_hash, storage_mode, import_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'managed', 'ready')`
      )
      .run(
        finalDest,
        path.basename(sourcePath),
        getFileType(sourcePath),
        meta?.width ?? null,
        meta?.height ?? null,
        stat.size,
        targetSubLibraryId ?? null,
        effectiveShotDate ?? null,
        contentHash ?? null
      )

    const photoId = info.lastInsertRowid as number

    const autoCreateEquipment = options.autoCreateEquipment !== false
    assignEquipmentAttribute(photoId, 'camera', options.cameraName ?? exif.cameraModel, autoCreateEquipment)
    assignEquipmentAttribute(photoId, 'lens', options.lensName ?? exif.lensModel, autoCreateEquipment)
    if (meta) {
      const filmSizeType = getPhotoFilmSizeType(photoId, options.filmName)
      const cameraInfo = getPhotoCameraFormatInfo(photoId, options.cameraName ?? exif.cameraModel)
      const detectedFormat = await resolveFilmFormat(sourcePath, meta.width, meta.height, filmSizeType, cameraInfo)
      if (detectedFormat) assignFilmFormatAttribute(photoId, detectedFormat)
    }

    // 后台生成缩略图
    generateThumbnail(finalDest, thumbDir).then((thumbPath) => {
      if (thumbPath) {
        db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
      }
    })

    return photoId
  } catch (err) {
    if (copiedPath) {
      const imported = db.prepare('SELECT id FROM photos WHERE file_path = ?').get(copiedPath)
      if (!imported) {
        try { fs.unlinkSync(copiedPath) } catch {}
      }
    }
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
  cameraModel: string | null,
  filesRoot: string
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
    parentId = getOrCreatePhysicalSubLibrary(getDb(), filesRoot, sanitizeSubLibraryName(rawName), parentId)
  }
  return parentId
}

function sanitizeSubLibraryName(name: string): string {
  return name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100) || '未命名'
}

/**
 * 查找照片已分配的胶卷属性值的 film_size_type（'135'|'120'|'both'|null）。
 * 若 options 中提供了 filmName，优先按名称从 DB 中找；否则按 photo_attributes 中已存在的记录查。
 */
function getPhotoFilmSizeType(photoId: number, filmName?: string | null): '135' | '120' | 'both' | null {
  try {
    const db = getDb()
    const filmAttrType = db.prepare("SELECT id FROM attribute_types WHERE key = 'film'").get() as { id: number } | undefined
    if (!filmAttrType) return null

    let sizeType: string | null = null

    if (filmName) {
      // 按名称直接查
      const row = db.prepare(
        `SELECT film_size_type FROM attribute_values WHERE attribute_type_id = ? AND LOWER(value) = LOWER(?)`
      ).get(filmAttrType.id, filmName) as { film_size_type: string | null } | undefined
      sizeType = row?.film_size_type ?? null
    }

    if (!sizeType) {
      // 按已关联的 photo_attributes 查
      const row = db.prepare(`
        SELECT av.film_size_type FROM photo_attributes pa
        JOIN attribute_values av ON av.id = pa.attribute_value_id
        WHERE pa.photo_id = ? AND pa.attribute_type_id = ?
        LIMIT 1
      `).get(photoId, filmAttrType.id) as { film_size_type: string | null } | undefined
      sizeType = row?.film_size_type ?? null
    }

    if (sizeType === '135' || sizeType === '120' || sizeType === 'both') return sizeType
    return null
  } catch {
    return null
  }
}

/**
 * 相机画幅令牌 → film_format 属性值映射
 */
const CAMERA_FORMAT_TOKEN_MAP: Record<string, string> = {
  '135':  '135 / 35mm',
  '半格': '半格 / 17.5mm',
  '645':  '645 中画幅',
  '6x6':  '6x6 中画幅',
  '6x7':  '6x7 中画幅',
  '6x8':  '6x8 中画幅',
  '6x9':  '6x9 中画幅',
  '6x12': '6x12 中画幅',
  'xpan': '135 宽幅 / Xpan',
  '4x5':  '4x5 大画幅',
  '8x10': '8x10 大画幅',
}

/**
 * 查找相机画幅信息。
 * 返回 { formats: string[](film_format值列表), defaultFormat: string | null } 或 null（未知相机）。
 */
function getPhotoCameraFormatInfo(
  photoId: number,
  cameraName?: string | null
): { formats: string[]; defaultFormat: string | null } | null {
  try {
    const db = getDb()
    const camAttrType = db.prepare("SELECT id FROM attribute_types WHERE key = 'camera'").get() as { id: number } | undefined
    if (!camAttrType) return null

    let row: { camera_formats: string | null; camera_default_format: string | null } | undefined

    if (cameraName) {
      row = db.prepare(
        `SELECT camera_formats, camera_default_format FROM attribute_values
         WHERE attribute_type_id = ? AND LOWER(value) = LOWER(?)`
      ).get(camAttrType.id, cameraName) as typeof row
    }

    if (!row) {
      row = db.prepare(`
        SELECT av.camera_formats, av.camera_default_format FROM photo_attributes pa
        JOIN attribute_values av ON av.id = pa.attribute_value_id
        WHERE pa.photo_id = ? AND pa.attribute_type_id = ?
        LIMIT 1
      `).get(photoId, camAttrType.id) as typeof row
    }

    if (!row?.camera_formats) return null

    const tokens = row.camera_formats.split(',').map(t => t.trim()).filter(Boolean)
    const formats = tokens.map(t => CAMERA_FORMAT_TOKEN_MAP[t]).filter(Boolean)
    const defaultFormat = row.camera_default_format
      ? (CAMERA_FORMAT_TOKEN_MAP[row.camera_default_format] ?? null)
      : null

    return formats.length > 0 ? { formats, defaultFormat } : null
  } catch {
    return null
  }
}

/**
 * 综合相机画幅信息和胶卷类型约束，确定最终胶片格式。
 * - 相机只有一种画幅：直接返回，无需像素分析
 * - 相机有多种画幅：取与 filmSizeType 相交后调用 detectFilmFormat
 * - 无相机信息：仅用 filmSizeType 约束调用 detectFilmFormat
 */
async function resolveFilmFormat(
  filePath: string,
  width: number,
  height: number,
  filmSizeType: '135' | '120' | 'both' | null,
  cameraInfo: { formats: string[]; defaultFormat: string | null } | null
): Promise<string | null> {
  if (cameraInfo) {
    if (cameraInfo.formats.length === 1) {
      // 单画幅相机：不需要像素分析
      return cameraInfo.formats[0]
    }
    // 多画幅相机：filmSizeType 与 cameraInfo.formats 取交集
    if (filmSizeType && filmSizeType !== 'both') {
      // 把 filmSizeType 转换为对应的 film_format 值集合
      let filmFormatSet: Set<string>
      if (filmSizeType === '135') {
        filmFormatSet = new Set(['135 / 35mm', '半格 / 17.5mm', '135 宽幅 / Xpan'])
      } else {
        // '120'
        filmFormatSet = new Set(['645 中画幅', '6x6 中画幅', '6x7 中画幅', '6x8 中画幅', '6x9 中画幅', '6x12 中画幅', '120 中画幅'])
      }
      const intersection = cameraInfo.formats.filter(f => filmFormatSet.has(f))
      if (intersection.length === 1) return intersection[0]
      if (intersection.length === 0) {
        // 无交集（数据矛盾）：降级到默认画幅
        return cameraInfo.defaultFormat
      }
      // 还有多个候选：继续像素分析（传 filmSizeType）
    }
    // 多画幅且无法缩减：使用像素分析
  }
  return detectFilmFormat(filePath, width, height, filmSizeType)
}

function assignFilmFormatAttribute(photoId: number, formatValue: string): void {
  try {
    const db = getDb()
    const attrType = db.prepare("SELECT id FROM attribute_types WHERE key = 'film_format'").get() as { id: number } | undefined
    if (!attrType) return

    // 照片已有该属性则跳过
    const existing = db.prepare(
      'SELECT 1 FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?'
    ).get(photoId, attrType.id)
    if (existing) return

    // 查找或创建对应的 attribute_value
    let val = db.prepare(
      'SELECT id FROM attribute_values WHERE attribute_type_id = ? AND value = ?'
    ).get(attrType.id, formatValue) as { id: number } | undefined

    if (!val) {
      // 自动检测到的格式值如果不在预设里，就创建一个非预设条目
      db.prepare(
        'INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, is_preset) VALUES (?, ?, 0)'
      ).run(attrType.id, formatValue)
      val = db.prepare(
        'SELECT id FROM attribute_values WHERE attribute_type_id = ? AND value = ?'
      ).get(attrType.id, formatValue) as { id: number } | undefined
    }

    if (val) {
      db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      ).run(photoId, attrType.id, val.id)
    }
  } catch (err) {
    log.warn('assignFilmFormatAttribute failed', err)
  }
}
