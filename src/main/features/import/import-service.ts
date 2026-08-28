/**
 * 导入功能核心服务（门面）。
 * 封装两阶段导入、卷扫描、路径导入。从 ipc/import.ts 迁移全部业务逻辑。
 * 子模块：folder-scanner（文件夹解析/匹配）、equipment-resolver（EXIF 器材识别）、
 * gps-linker（GPS 地点关联）、import-concurrency（有界并发+竞态）。
 *
 * 依赖 Repository + infra/image + film-format + library-layout，不直接 electron（dialog 在 adapter）。
 */
import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import type { IpcMainInvokeEvent } from 'electron'
import { getDb } from '../../db/index'
import {
  generateThumbnail, getImageMeta, getExifData, SUPPORTED_EXTENSIONS, getFileType, computeContentHash
} from '../../features/thumbnails/thumbnail'
import {
  getPhotoFilmSizeType, getPhotoCameraFormatInfo, resolveFilmFormat, assignFilmFormatAttribute
} from '../../features/film-format/film-format'
import {
  ensureSubLibraryDirectory, ensureUniqueFilePath, getOrCreateSubLibrary as getOrCreatePhysicalSubLibrary
} from '../../features/library-layout/library-layout'
import { getLibraryRoot, getThumbDir } from '../../ipc/index'
import type { AutoOrganizeMode, ImportOptions } from '../../../shared/import-types'
import { thumbnailPool } from '../../workers/worker-pool'
import { LocationCoord, loadLocationCoords, autoLinkGpsLocation } from './gps-linker'
import { assignEquipmentAttribute } from './equipment-resolver'
import { resolveTargetSubLibrary, sanitizeSubLibraryName } from './sublibrary-resolver'
import { scanFolders, scanSingleFolder, FolderScanResult, RollImportConfig } from './folder-scanner'

export type { AutoOrganizeMode, ImportOptions, FolderScanResult, RollImportConfig }

// ── 递归遍历 ──
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

// ── 单批次导入入口 ──
async function importFolder(
  folderPath: string,
  options: ImportOptions,
  event: Electron.IpcMainInvokeEvent
): Promise<{ imported: number; skipped: number; importedIds: number[] }> {
  const allFiles = walk(folderPath)
  return runTwoPhaseImport(allFiles, options, event)
}

// ── 两阶段导入核心 ──
async function runTwoPhaseImport(
  allFiles: string[],
  options: ImportOptions,
  event: Electron.IpcMainInvokeEvent
): Promise<{ imported: number; skipped: number; importedIds: number[] }> {
  const db = getDb()
  const storageMode = options.storageMode ?? 'managed'

  // 阶段一：快速登记
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
        const placeholderPath = storageMode === 'linked'
          ? filePath
          : `__pending__${Date.now()}_${Math.random().toString(36).slice(2)}_${path.basename(filePath)}`
        const info = registerStmt.run(placeholderPath, path.basename(filePath), getFileType(filePath), stat.size, options.subLibraryId ?? null, storageMode)
        if (info.changes > 0) registrations.push({ photoId: info.lastInsertRowid as number, sourcePath: filePath })
      } catch {}
    }
  })()
  event.sender.send('import:registered', { count: registrations.length, total: allFiles.length })

  // 写入队列
  const insertQueue = db.prepare('INSERT INTO import_queue (source_path, photo_id, status) VALUES (?, ?, ?)')
  const queueItems: { queueId: number; photoId: number; sourcePath: string }[] = []
  db.transaction(() => {
    for (const { photoId, sourcePath } of registrations) {
      const info = insertQueue.run(sourcePath, photoId, 'pending')
      queueItems.push({ queueId: info.lastInsertRowid as number, photoId, sourcePath })
    }
  })()

  // 阶段二：并发处理
  let done = 0
  let skipped = allFiles.length - registrations.length
  const importedIds: number[] = []
  const locationsCache = loadLocationCoords(db)
  const claimedPaths = new Set<string>()
  const workQueue = [...queueItems]

  async function importWorker(): Promise<void> {
    while (workQueue.length > 0) {
      const item = workQueue.shift()
      if (!item) break
      await processQueueItem(item.queueId, item.photoId, item.sourcePath, options, locationsCache, claimedPaths)
      const qRow = db.prepare('SELECT status FROM import_queue WHERE id = ?').get(item.queueId) as { status: string }
      if (qRow.status === 'done') { done++; importedIds.push(item.photoId) }
      else { skipped++ }
      event.sender.send('import:progress', { imported: done, skipped, total: allFiles.length })
    }
  }

  const IMPORT_CONCURRENCY = Math.max(1, Math.min(4, ((await import('os')).cpus().length || 4) - 2))
  await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, () => importWorker()))
  return { imported: done, skipped, importedIds }
}

// ── 阶段二：处理单个队列项 ──
async function processQueueItem(
  queueId: number, photoId: number, sourcePath: string, options: ImportOptions,
  locationsCache: LocationCoord[], claimedPaths: Set<string>
): Promise<void> {
  const db = getDb()
  const storageMode = options.storageMode ?? 'managed'
  const thumbDir = getThumbDir()
  const filesRoot = path.join(getLibraryRoot(), 'files')
  let copiedPath: string | null = null

  try {
    const contentHash = computeContentHash(sourcePath)
    if (contentHash) {
      const dup = db.prepare('SELECT id FROM photos WHERE content_hash = ? AND id != ?').get(contentHash, photoId)
      if (dup) {
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
      finalPath = ensureUniqueFilePath(path.join(targetDirectory, path.basename(sourcePath)), undefined, claimedPaths)
      claimedPaths.add(pathKey(finalPath))
      await fs.promises.copyFile(sourcePath, finalPath)
      copiedPath = finalPath
    }

    db.prepare(`
      UPDATE photos SET file_path = ?, width = ?, height = ?, shot_date = ?, content_hash = ?, sub_library_id = ?, import_status = 'ready' WHERE id = ?
    `).run(finalPath, meta?.width ?? null, meta?.height ?? null, effectiveShotDate ?? null, contentHash ?? null, targetSubLibraryId ?? null, photoId)

    const autoCreateEquipment = options.autoCreateEquipment !== false
    assignEquipmentAttribute(photoId, 'camera', options.cameraName ?? exif.cameraModel, autoCreateEquipment)
    assignEquipmentAttribute(photoId, 'lens', options.lensName ?? exif.lensModel, autoCreateEquipment)
    if (meta) {
      const filmSizeType = getPhotoFilmSizeType(photoId, options.filmName)
      const cameraInfo = getPhotoCameraFormatInfo(photoId, options.cameraName ?? exif.cameraModel)
      const detectedFormat = await resolveFilmFormat(sourcePath, meta.width, meta.height, filmSizeType, cameraInfo)
      if (detectedFormat) assignFilmFormatAttribute(photoId, detectedFormat)
    }
    if (exif.gpsLat != null && exif.gpsLng != null) {
      autoLinkGpsLocation(db, photoId, exif.gpsLat, exif.gpsLng, locationsCache)
    }
    db.prepare(`UPDATE import_queue SET status = 'done', done_at = datetime('now','localtime') WHERE id = ?`).run(queueId)

    thumbnailPool.generate(finalPath, thumbDir).then((thumbPath) => {
      if (!thumbPath) return generateThumbnail(finalPath, thumbDir)
      return thumbPath
    }).then((thumbPath) => {
      if (thumbPath) db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
    }).catch((err) => { log.warn('thumbnail gen failed for photo', photoId, err) })
  } catch (err) {
    log.error('Queue item processing failed', sourcePath, err)
    if (copiedPath) { try { fs.unlinkSync(copiedPath) } catch {} }
    db.prepare(`UPDATE import_queue SET status = 'error', error_msg = ?, done_at = datetime('now','localtime') WHERE id = ?`).run(String(err), queueId)
    db.prepare(`UPDATE photos SET import_status = 'error' WHERE id = ?`).run(photoId)
  }
}

// pathKey 从 library-layout 导入（claimed 集合用）
function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

// ── 旧 importFile（供 importRolls 使用） ──
async function importFile(
  sourcePath: string, options: ImportOptions, locationsCache: LocationCoord[], claimedPaths: Set<string>
): Promise<number | null> {
  const db = getDb()
  const libraryRoot = getLibraryRoot()
  const filesRoot = path.join(libraryRoot, 'files')
  const thumbDir = getThumbDir()
  const storageMode = options.storageMode ?? 'managed'
  let copiedPath: string | null = null
  try {
    const contentHash = computeContentHash(sourcePath)
    if (contentHash) {
      const dup = db.prepare('SELECT id FROM photos WHERE content_hash = ?').get(contentHash)
      if (dup) return null
    }
    const meta = await getImageMeta(sourcePath)
    const exif = await getExifData(sourcePath)
    const effectiveShotDate = options.shotDate ?? exif.shotDate
    let finalDest: string
    let targetSubLibraryId: number | undefined | null
    if (storageMode === 'linked') { finalDest = sourcePath; targetSubLibraryId = options.subLibraryId ?? null }
    else {
      targetSubLibraryId = resolveTargetSubLibrary(options, sourcePath, effectiveShotDate, exif.cameraModel, filesRoot)
      const targetDirectory = ensureSubLibraryDirectory(db, filesRoot, targetSubLibraryId)
      finalDest = ensureUniqueFilePath(path.join(targetDirectory, path.basename(sourcePath)), undefined, claimedPaths)
      claimedPaths.add(pathKey(finalDest))
      await fs.promises.copyFile(sourcePath, finalDest)
      copiedPath = finalDest
    }
    const stat = fs.statSync(finalDest)
    const info = db.prepare(
      `INSERT INTO photos (file_path, original_name, file_type, width, height, file_size, sub_library_id, shot_date, content_hash, storage_mode, import_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')`
    ).run(finalDest, path.basename(sourcePath), getFileType(sourcePath), meta?.width ?? null, meta?.height ?? null, stat.size, targetSubLibraryId ?? null, effectiveShotDate ?? null, contentHash ?? null, storageMode)
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
    if (exif.gpsLat != null && exif.gpsLng != null) autoLinkGpsLocation(db, photoId, exif.gpsLat, exif.gpsLng, locationsCache)
    generateThumbnail(finalDest, thumbDir).then((thumbPath) => {
      if (thumbPath) db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
    })
    return photoId
  } catch (err) {
    if (copiedPath) {
      const imported = db.prepare('SELECT id FROM photos WHERE file_path = ?').get(copiedPath)
      if (!imported) { try { fs.unlinkSync(copiedPath) } catch {} }
    }
    log.error('Import file failed', sourcePath, err)
    return null
  }
}

// ── 卷导入 ──
async function importRolls(configs: RollImportConfig[], event: Electron.IpcMainInvokeEvent): Promise<{ results: { rollName: string; imported: number; skipped: number; rollId: number | null }[]; totalImported: number; totalSkipped: number }> {
  const db = getDb()
  const results: { rollName: string; imported: number; skipped: number; rollId: number | null }[] = []
  let totalFiles = 0
  for (const cfg of configs) totalFiles += walk(cfg.folderPath).length
  event.sender.send('import:total', totalFiles)

  let globalImported = 0
  let globalSkipped = 0
  const locationsCache = loadLocationCoords(db)
  const claimedPaths = new Set<string>()

  for (const cfg of configs) {
    const files = walk(cfg.folderPath)
    let imported = 0
    let skipped = 0
    const importedIds: number[] = []
    const configuredAttrs = cfg.attrs.length > 0
      ? db.prepare(`SELECT at.key, av.value FROM attribute_values av JOIN attribute_types at ON at.id = av.attribute_type_id WHERE av.id IN (${cfg.attrs.map(() => '?').join(',')})`).all(...cfg.attrs.map((attr) => attr.valueId)) as { key: string; value: string }[]
      : []
    const importOptions: ImportOptions = {
      subLibraryId: cfg.subLibraryId ?? undefined, shotDate: cfg.shotDate ?? null,
      cameraName: configuredAttrs.find((attr) => attr.key === 'camera')?.value ?? null,
      lensName: configuredAttrs.find((attr) => attr.key === 'lens')?.value ?? null,
      filmName: configuredAttrs.find((attr) => attr.key === 'film')?.value ?? null,
      storageMode: cfg.storageMode ?? 'managed'
    }

    const fileQueue = [...files]
    async function rollWorker(): Promise<void> {
      while (fileQueue.length > 0) {
        const filePath = fileQueue.shift()
        if (!filePath) break
        const photoId = await importFile(filePath, importOptions, locationsCache, claimedPaths)
        if (photoId !== null) { imported++; globalImported++; importedIds.push(photoId) }
        else { skipped++; globalSkipped++ }
        event.sender.send('import:progress', { imported: globalImported, skipped: globalSkipped, total: totalFiles })
      }
    }
    const IMPORT_CONCURRENCY = Math.max(1, Math.min(4, ((await import('os')).cpus().length || 4) - 2))
    await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, () => rollWorker()))

    // 应用属性
    if (importedIds.length > 0 && cfg.attrs.length > 0) {
      const insertAttr = db.prepare('INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)')
      const deleteAttr = db.prepare('DELETE FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?')
      db.transaction(() => {
        for (const id of importedIds) for (const attr of cfg.attrs) { deleteAttr.run(id, attr.typeId); insertAttr.run(id, attr.typeId, attr.valueId) }
      })()
    }
    // 地点
    if (importedIds.length > 0 && cfg.locationId) {
      const insertLoc = db.prepare('INSERT OR IGNORE INTO photo_locations (photo_id, location_id) VALUES (?, ?)')
      db.transaction(() => { for (const id of importedIds) insertLoc.run(id, cfg.locationId!) })()
    }
    // 拍摄日期
    if (importedIds.length > 0 && cfg.shotDate) {
      db.prepare(`UPDATE photos SET shot_date = ? WHERE id IN (${importedIds.map(() => '?').join(',')})`).run(cfg.shotDate, ...importedIds)
    }
    // 建卷
    let rollId: number | null = null
    if (cfg.createRoll && importedIds.length > 0) {
      const coverPhoto = db.prepare(`SELECT id FROM photos WHERE id IN (${importedIds.map(() => '?').join(',')}) AND thumb_ready = 1 ORDER BY shot_date ASC, imported_at ASC LIMIT 1`).get(...importedIds) as { id: number } | undefined
      const info = db.prepare('INSERT INTO rolls (name, sub_library_id, cover_photo_id) VALUES (?, ?, ?)').run(cfg.rollName, cfg.subLibraryId ?? null, coverPhoto?.id ?? importedIds[0])
      rollId = info.lastInsertRowid as number
      const insertPhotoRoll = db.prepare('INSERT OR IGNORE INTO photo_rolls (photo_id, roll_id) VALUES (?, ?)')
      db.transaction(() => { for (const id of importedIds) insertPhotoRoll.run(id, rollId) })()
    }
    results.push({ rollName: cfg.rollName, imported, skipped, rollId })
  }
  return { results, totalImported: globalImported, totalSkipped: globalSkipped }
}

// ── Service 门面 ──
export class ImportService {
  async selectAndImport(event: IpcMainInvokeEvent, options: ImportOptions, folderPath: string) {
    return importFolder(folderPath, options, event)
  }

  async importPaths(event: IpcMainInvokeEvent, filePaths: string[], options: ImportOptions) {
    const allFiles: string[] = []
    for (const p of filePaths) {
      try {
        const stat = fs.statSync(p)
        if (stat.isDirectory()) allFiles.push(...walk(p))
        else { const ext = path.extname(p).toLowerCase(); if (SUPPORTED_EXTENSIONS.has(ext)) allFiles.push(p) }
      } catch {}
    }
    return runTwoPhaseImport(allFiles, options, event)
  }

  async scanFolders(rootPath: string) { return scanFolders(rootPath) }
  async scanSingleFolder(folderPath: string) { return scanSingleFolder(folderPath) }
  async importRolls(configs: RollImportConfig[], event: IpcMainInvokeEvent) { return importRolls(configs, event) }
}
