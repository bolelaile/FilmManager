import fs from 'fs'
import path from 'path'
import log from 'electron-log'
import type Database from 'better-sqlite3'

interface SubLibraryRow {
  id: number
  name: string
  parent_id: number | null
  folder_name: string | null
}

interface PhotoRow {
  id: number
  file_path: string
  original_name: string
  sub_library_id: number | null
}

export interface FileMoveFailure {
  id: number
  filePath: string
  reason: string
}

export interface FileMoveResult {
  moved: number
  unchanged: number
  failed: FileMoveFailure[]
}

export interface LayoutSyncResult extends FileMoveResult {
  directories: number
}

export function synchronizeLibraryLayout(
  db: Database.Database,
  filesRoot: string
): LayoutSyncResult {
  fs.mkdirSync(filesRoot, { recursive: true })
  assignFolderNames(db, filesRoot)

  const subLibraries = listSubLibraries(db)
  let directories = 0
  for (const subLibrary of sortByDepth(subLibraries)) {
    const directory = getSubLibraryDirectory(db, filesRoot, subLibrary.id)
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true })
      directories++
    }
  }

  const result: LayoutSyncResult = { moved: 0, unchanged: 0, failed: [], directories }
  const photos = db
    .prepare('SELECT id, file_path, original_name, sub_library_id FROM photos ORDER BY id')
    .all() as PhotoRow[]

  for (const photo of photos) {
    const moveResult = relocatePhoto(db, filesRoot, photo, photo.sub_library_id)
    mergeMoveResult(result, moveResult)
  }

  return result
}

export function getSubLibraryDirectory(
  db: Database.Database,
  filesRoot: string,
  subLibraryId: number | null | undefined
): string {
  const root = path.resolve(filesRoot)
  if (subLibraryId == null) return root

  const rows = listSubLibraries(db)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const segments: string[] = []
  const visited = new Set<number>()
  let currentId: number | null = subLibraryId

  while (currentId != null) {
    if (visited.has(currentId)) throw new Error(`子库层级存在循环引用：${currentId}`)
    visited.add(currentId)
    const row = byId.get(currentId)
    if (!row) throw new Error(`子库不存在：${currentId}`)
    segments.unshift(row.folder_name || sanitizeFolderName(row.name))
    currentId = row.parent_id
  }

  const directory = path.resolve(root, ...segments)
  assertInsideRoot(root, directory)
  return directory
}

export function ensureSubLibraryDirectory(
  db: Database.Database,
  filesRoot: string,
  subLibraryId: number | null | undefined
): string {
  const directory = getSubLibraryDirectory(db, filesRoot, subLibraryId)
  fs.mkdirSync(directory, { recursive: true })
  return directory
}

export function createSubLibrary(
  db: Database.Database,
  filesRoot: string,
  name: string,
  parentId?: number
): number {
  const normalizedName = normalizeDisplayName(name)
  if (parentId != null) getSubLibraryDirectory(db, filesRoot, parentId)

  const maxOrder = (
    db.prepare('SELECT MAX(sort_order) AS value FROM sub_libraries WHERE parent_id IS ?')
      .get(parentId ?? null) as { value: number | null }
  ).value ?? 0
  const folderName = allocateFolderName(db, filesRoot, normalizedName, parentId ?? null)
  const result = db.prepare(`
    INSERT INTO sub_libraries (name, parent_id, folder_name, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(normalizedName, parentId ?? null, folderName, maxOrder + 1)
  const id = Number(result.lastInsertRowid)

  try {
    ensureSubLibraryDirectory(db, filesRoot, id)
  } catch (error) {
    db.prepare('DELETE FROM sub_libraries WHERE id = ?').run(id)
    throw error
  }
  return id
}

export function getOrCreateSubLibrary(
  db: Database.Database,
  filesRoot: string,
  name: string,
  parentId?: number
): number {
  const normalizedName = normalizeDisplayName(name)
  const existing = db.prepare(`
    SELECT id FROM sub_libraries
    WHERE parent_id IS ? AND name = ? COLLATE NOCASE
    LIMIT 1
  `).get(parentId ?? null, normalizedName) as { id: number } | undefined

  if (existing) {
    ensureSubLibraryDirectory(db, filesRoot, existing.id)
    return existing.id
  }
  return createSubLibrary(db, filesRoot, normalizedName, parentId)
}

export function renameSubLibrary(
  db: Database.Database,
  filesRoot: string,
  id: number,
  name: string
): void {
  const row = getSubLibrary(db, id)
  relocateSubLibrary(db, filesRoot, row, row.parent_id, normalizeDisplayName(name))
}

export function deleteSubLibrary(
  db: Database.Database,
  filesRoot: string,
  id: number
): void {
  const row = getSubLibrary(db, id)
  const directory = getSubLibraryDirectory(db, filesRoot, id)
  const photoIds = db.prepare('SELECT id FROM photos WHERE sub_library_id = ? ORDER BY id')
    .all(id) as { id: number }[]
  const photoResult = movePhotosToSubLibrary(db, filesRoot, photoIds.map((photo) => photo.id), null)
  if (photoResult.failed.length > 0) {
    throw new Error(`有 ${photoResult.failed.length} 张照片无法移出子库“${row.name}”`)
  }

  const children = db.prepare(`
    SELECT id, name, parent_id, folder_name
    FROM sub_libraries
    WHERE parent_id = ?
    ORDER BY sort_order, id
  `).all(id) as SubLibraryRow[]
  for (const child of children) {
    relocateSubLibrary(db, filesRoot, child, null, child.name)
  }

  db.prepare('DELETE FROM sub_libraries WHERE id = ?').run(id)
  tryRemoveEmptyDirectory(directory)
}

export function movePhotosToSubLibrary(
  db: Database.Database,
  filesRoot: string,
  photoIds: number[],
  subLibraryId: number | null
): FileMoveResult {
  ensureSubLibraryDirectory(db, filesRoot, subLibraryId)
  const result: FileMoveResult = { moved: 0, unchanged: 0, failed: [] }

  for (const id of new Set(photoIds)) {
    const photo = db.prepare(`
      SELECT id, file_path, original_name, sub_library_id, storage_mode
      FROM photos WHERE id = ?
    `).get(id) as (PhotoRow & { storage_mode?: string }) | undefined
    if (!photo) {
      result.failed.push({ id, filePath: '', reason: '照片记录不存在' })
      continue
    }
    // linked 模式只更新 sub_library_id，不移动源文件
    if (photo.storage_mode === 'linked') {
      db.prepare('UPDATE photos SET sub_library_id = ? WHERE id = ?').run(subLibraryId, id)
      result.unchanged++
      continue
    }
    mergeMoveResult(result, relocatePhoto(db, filesRoot, photo, subLibraryId))
  }

  return result
}

export function ensureUniqueFilePath(
  destination: string,
  sourcePath?: string,
  claimed?: Set<string>
): string {
  // claimed：导入批次内已"认领"但尚未落盘的路径集合，消除并行导入同名文件的 TOCTOU 竞态
  const isTaken = (p: string): boolean => {
    if (sourcePath && pathsReferToSameLocation(p, sourcePath)) return false
    if (fs.existsSync(p)) return true
    return claimed?.has(pathKey(p)) ?? false
  }

  if (!isTaken(destination)) {
    return destination
  }

  const extension = path.extname(destination)
  const base = destination.slice(0, destination.length - extension.length)
  let index = 1
  let candidate = `${base}_${index}${extension}`
  while (isTaken(candidate)) {
    index++
    candidate = `${base}_${index}${extension}`
  }
  return candidate
}

export function sanitizeFolderName(name: string): string {
  let value = name
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!value || value === '.' || value === '..') value = '未命名'
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`
  return value.slice(0, 100).replace(/[. ]+$/g, '') || '未命名'
}

function assignFolderNames(db: Database.Database, filesRoot: string): void {
  const rows = sortByDepth(listSubLibraries(db))
  const usedByParent = new Map<string, Set<string>>()
  const update = db.prepare('UPDATE sub_libraries SET folder_name = ? WHERE id = ?')
  const transaction = db.transaction(() => {
    for (const row of rows) {
      const parentKey = String(row.parent_id ?? 'root')
      const used = usedByParent.get(parentKey) ?? new Set<string>()
      usedByParent.set(parentKey, used)
      const base = sanitizeFolderName(row.folder_name || row.name)
      const parentDirectory = getSubLibraryDirectory(db, filesRoot, row.parent_id)
      let folderName = base
      let index = 1
      while (
        used.has(pathKey(folderName)) ||
        (fs.existsSync(path.join(parentDirectory, folderName)) &&
          !fs.statSync(path.join(parentDirectory, folderName)).isDirectory())
      ) {
        index++
        folderName = withFolderSuffix(base, index)
      }
      used.add(pathKey(folderName))
      if (row.folder_name !== folderName) {
        update.run(folderName, row.id)
        row.folder_name = folderName
      }
    }
  })
  transaction()
}

function allocateFolderName(
  db: Database.Database,
  filesRoot: string,
  name: string,
  parentId: number | null,
  excludeId?: number
): string {
  const siblings = db.prepare(`
    SELECT id, folder_name FROM sub_libraries
    WHERE parent_id IS ? AND (? IS NULL OR id != ?)
  `).all(parentId, excludeId ?? null, excludeId ?? null) as { id: number; folder_name: string | null }[]
  const used = new Set(siblings.map((row) => pathKey(row.folder_name || '')))
  const parentDirectory = getSubLibraryDirectory(db, filesRoot, parentId)
  const currentDirectory = excludeId == null ? null : getSubLibraryDirectory(db, filesRoot, excludeId)
  const base = sanitizeFolderName(name)
  let index = 1
  let candidate = base

  while (
    used.has(pathKey(candidate)) ||
    (fs.existsSync(path.join(parentDirectory, candidate)) &&
      !(currentDirectory && pathsReferToSameLocation(path.join(parentDirectory, candidate), currentDirectory)))
  ) {
    index++
    candidate = withFolderSuffix(base, index)
  }
  return candidate
}

function relocatePhoto(
  db: Database.Database,
  filesRoot: string,
  photo: PhotoRow,
  targetSubLibraryId: number | null
): FileMoveResult {
  const result: FileMoveResult = { moved: 0, unchanged: 0, failed: [] }
  const targetDirectory = ensureSubLibraryDirectory(db, filesRoot, targetSubLibraryId)
  const fileName = path.basename(photo.file_path || photo.original_name)
  const desiredPath = path.join(targetDirectory, fileName)
  const targetPath = ensureUniqueFilePath(desiredPath, photo.file_path)

  if (pathsReferToSameLocation(photo.file_path, targetPath)) {
    db.prepare('UPDATE photos SET sub_library_id = ? WHERE id = ?').run(targetSubLibraryId, photo.id)
    result.unchanged++
    return result
  }

  if (!fs.existsSync(photo.file_path)) {
    result.failed.push({ id: photo.id, filePath: photo.file_path, reason: '源文件不存在' })
    return result
  }

  try {
    moveFile(photo.file_path, targetPath)
    try {
      db.prepare('UPDATE photos SET file_path = ?, sub_library_id = ? WHERE id = ?')
        .run(targetPath, targetSubLibraryId, photo.id)
    } catch (error) {
      try {
        moveFile(targetPath, photo.file_path)
      } catch (rollbackError) {
        log.error('Failed to roll back photo move', rollbackError)
      }
      throw error
    }
    result.moved++
  } catch (error) {
    result.failed.push({
      id: photo.id,
      filePath: photo.file_path,
      reason: error instanceof Error ? error.message : String(error)
    })
  }
  return result
}

function relocateSubLibrary(
  db: Database.Database,
  filesRoot: string,
  row: SubLibraryRow,
  targetParentId: number | null,
  targetName: string
): void {
  const oldDirectory = getSubLibraryDirectory(db, filesRoot, row.id)
  const folderName = allocateFolderName(db, filesRoot, targetName, targetParentId, row.id)
  const targetParentDirectory = ensureSubLibraryDirectory(db, filesRoot, targetParentId)
  const newDirectory = path.join(targetParentDirectory, folderName)
  assertInsideRoot(path.resolve(filesRoot), path.resolve(newDirectory))

  const affectedPhotos = (db.prepare('SELECT id, file_path FROM photos').all() as { id: number; file_path: string }[])
    .filter((photo) => isInsideDirectory(oldDirectory, photo.file_path))
    .map((photo) => ({
      id: photo.id,
      oldPath: photo.file_path,
      newPath: path.join(newDirectory, path.relative(oldDirectory, photo.file_path))
    }))

  const directoryMove = moveDirectory(oldDirectory, newDirectory)
  try {
    const updatePhoto = db.prepare('UPDATE photos SET file_path = ? WHERE id = ?')
    const transaction = db.transaction(() => {
      db.prepare('UPDATE sub_libraries SET name = ?, parent_id = ?, folder_name = ? WHERE id = ?')
        .run(targetName, targetParentId, folderName, row.id)
      for (const photo of affectedPhotos) updatePhoto.run(photo.newPath, photo.id)
    })
    transaction()
  } catch (error) {
    rollbackDirectoryMove(directoryMove)
    throw error
  }
}

interface DirectoryMove {
  source: string
  destination: string
  moved: boolean
  created: boolean
}

function moveDirectory(source: string, destination: string): DirectoryMove {
  if (pathsExactlyEqual(source, destination)) {
    fs.mkdirSync(destination, { recursive: true })
    return { source, destination, moved: false, created: false }
  }

  fs.mkdirSync(path.dirname(destination), { recursive: true })
  if (!fs.existsSync(source)) {
    fs.mkdirSync(destination, { recursive: true })
    return { source, destination, moved: false, created: true }
  }

  if (pathsReferToSameLocation(source, destination)) {
    const temporary = `${source}.__filmmanager_${Date.now()}`
    fs.renameSync(source, temporary)
    try {
      fs.renameSync(temporary, destination)
    } catch (error) {
      fs.renameSync(temporary, source)
      throw error
    }
  } else {
    if (fs.existsSync(destination)) throw new Error(`目标目录已存在：${destination}`)
    fs.renameSync(source, destination)
  }
  return { source, destination, moved: true, created: false }
}

function rollbackDirectoryMove(move: DirectoryMove): void {
  try {
    if (move.moved && fs.existsSync(move.destination)) {
      fs.renameSync(move.destination, move.source)
    } else if (move.created) {
      tryRemoveEmptyDirectory(move.destination)
    }
  } catch (error) {
    log.error('Failed to roll back sub-library directory move', error)
  }
}

function moveFile(source: string, destination: string): void {
  if (pathsReferToSameLocation(source, destination)) return
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  try {
    fs.renameSync(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL)
    try {
      fs.unlinkSync(source)
    } catch (unlinkError) {
      try { fs.unlinkSync(destination) } catch {}
      throw unlinkError
    }
  }
}

function listSubLibraries(db: Database.Database): SubLibraryRow[] {
  return db.prepare(`
    SELECT id, name, parent_id, folder_name
    FROM sub_libraries
    ORDER BY id
  `).all() as SubLibraryRow[]
}

function getSubLibrary(db: Database.Database, id: number): SubLibraryRow {
  const row = db.prepare(`
    SELECT id, name, parent_id, folder_name
    FROM sub_libraries WHERE id = ?
  `).get(id) as SubLibraryRow | undefined
  if (!row) throw new Error(`子库不存在：${id}`)
  return row
}

function sortByDepth(rows: SubLibraryRow[]): SubLibraryRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const depths = new Map<number, number>()

  const depthOf = (id: number, visiting = new Set<number>()): number => {
    const known = depths.get(id)
    if (known != null) return known
    if (visiting.has(id)) throw new Error(`子库层级存在循环引用：${id}`)
    visiting.add(id)
    const row = byId.get(id)
    const depth = row?.parent_id == null ? 0 : depthOf(row.parent_id, visiting) + 1
    visiting.delete(id)
    depths.set(id, depth)
    return depth
  }

  return [...rows].sort((a, b) => depthOf(a.id) - depthOf(b.id) || a.id - b.id)
}

function normalizeDisplayName(name: string): string {
  const value = name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 100)
  if (!value) throw new Error('子库名称不能为空')
  return value
}

function withFolderSuffix(base: string, index: number): string {
  const suffix = ` (${index})`
  const maxBaseLength = Math.max(1, 100 - suffix.length)
  return `${base.slice(0, maxBaseLength).replace(/[. ]+$/g, '')}${suffix}`
}

function mergeMoveResult(target: FileMoveResult, source: FileMoveResult): void {
  target.moved += source.moved
  target.unchanged += source.unchanged
  target.failed.push(...source.failed)
}

export function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function pathsExactlyEqual(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b)
}

function pathsReferToSameLocation(a: string, b: string): boolean {
  return pathKey(path.resolve(a)) === pathKey(path.resolve(b))
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(candidate))
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
}

function assertInsideRoot(root: string, candidate: string): void {
  if (pathsReferToSameLocation(root, candidate)) return
  if (!isInsideDirectory(root, candidate)) throw new Error(`目录超出图库范围：${candidate}`)
}

function tryRemoveEmptyDirectory(directory: string): void {
  try {
    fs.rmdirSync(directory)
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      log.warn('Failed to remove empty sub-library directory', directory, error)
    }
  }
}
