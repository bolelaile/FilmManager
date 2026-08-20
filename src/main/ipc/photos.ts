import { ipcMain } from 'electron'
import path from 'path'
import { getDb } from '../db/index'
import { generateThumbnail, normalizeRotation, renderFullPreview, getExifData } from '../services/thumbnail'
import { movePhotosToSubLibrary } from '../services/library-layout'
import { getLibraryRoot, getThumbDir } from './index'
import { thumbnailPool } from '../workers/worker-pool'
import fs from 'fs'
import log from 'electron-log'

// 全屏预览并发限制：最多同时运行 1 个，新请求到来时丢弃排队中的旧请求
let previewInFlight = false
let pendingPreviewResolve: ((v: null) => void) | null = null

// ─── 共享 FROM/JOIN/WHERE 构建辅助 ────────────────────────────────────────────
// 供 photos:list 和 photos:timeline 复用，避免重复逻辑
interface FilterParams {
  filters: Record<number, number[]>
  subLibraryId?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  dateField?: 'imported_at' | 'shot_date'
  fileTypes?: string[]
  organizationStatuses?: ('unclassified' | 'missing_date' | 'missing_camera')[]
  starredOnly?: boolean
}

function buildFromClause(p: FilterParams): { fromClause: string; args: unknown[] } {
  const {
    filters = {},
    subLibraryId,
    search,
    dateFrom,
    dateTo,
    dateField = 'imported_at',
    fileTypes = [],
    organizationStatuses = [],
    starredOnly = false
  } = p

  const dateColumn = dateField === 'shot_date' ? 'p.shot_date' : 'p.imported_at'
  let fromClause = `FROM photos p`
  const args: unknown[] = []
  let joinIdx = 0

  for (const [typeId, valueIds] of Object.entries(filters)) {
    const tid = parseInt(typeId, 10)
    if (isNaN(tid) || !valueIds || (valueIds as number[]).length === 0) continue
    const alias = `pa${joinIdx++}`
    fromClause += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${tid} AND ${alias}.attribute_value_id IN (${(valueIds as number[]).map(() => '?').join(',')})`
    args.push(...(valueIds as number[]))
  }

  const wheres: string[] = ['p.import_status = \'ready\'']
  if (subLibraryId != null) {
    wheres.push(`p.sub_library_id IN (
      WITH RECURSIVE descendants(id) AS (
        SELECT ?
        UNION ALL
        SELECT child.id
        FROM sub_libraries child
        JOIN descendants parent ON child.parent_id = parent.id
      )
      SELECT id FROM descendants
    )`)
    args.push(subLibraryId)
  }
  if (search) { wheres.push('p.original_name LIKE ?'); args.push(`%${search}%`) }
  if (dateFrom) { wheres.push(`${dateColumn} >= ?`); args.push(dateFrom) }
  if (dateTo) {
    wheres.push(`${dateColumn} <= ?`)
    args.push(dateField === 'shot_date' ? dateTo : dateTo + ' 23:59:59')
  }
  if (fileTypes.length > 0) {
    wheres.push(`p.file_type IN (${fileTypes.map(() => '?').join(',')})`)
    args.push(...fileTypes)
  }
  if (organizationStatuses.includes('unclassified')) wheres.push('p.sub_library_id IS NULL')
  if (organizationStatuses.includes('missing_date')) wheres.push("(p.shot_date IS NULL OR p.shot_date = '')")
  if (organizationStatuses.includes('missing_camera')) {
    wheres.push(`NOT EXISTS (
      SELECT 1 FROM photo_attributes status_pa
      JOIN attribute_types status_at ON status_at.id = status_pa.attribute_type_id
      WHERE status_pa.photo_id = p.id AND status_at.key = 'camera'
    )`)
  }
  if (starredOnly) wheres.push('p.starred = 1')

  fromClause += ' WHERE ' + wheres.join(' AND ')
  return { fromClause, args }
}

// ── COUNT 缓存 ──────────────────────────────────────────────────────────────
// photos:list 每次分页都跑 COUNT(DISTINCT p.id)（含全部属性 JOIN），翻页时对同一
// filter 重复计算。按 filter 签名缓存总数，TTL 短到能覆盖导入期间的 3s 轮询即可
// （TTL 2s < 3s，轮询总能拿到新值）。用户变更操作（删除/编辑/移动/收藏）显式失效。
const COUNT_CACHE_TTL = 2000
const COUNT_CACHE_MAX = 64
const countCache = new Map<string, { total: number; ts: number }>()

/** 计算 filter 签名（排除分页/排序，仅含影响结果集大小的字段） */
function countCacheKey(p: FilterParams): string {
  const normalized: Record<string, unknown> = {
    filters: p.filters ?? {},
    subLibraryId: p.subLibraryId ?? null,
    search: p.search ?? '',
    dateFrom: p.dateFrom ?? null,
    dateTo: p.dateTo ?? null,
    dateField: p.dateField ?? 'imported_at',
    fileTypes: p.fileTypes ?? [],
    organizationStatuses: p.organizationStatuses ?? [],
    starredOnly: p.starredOnly ?? false
  }
  return JSON.stringify(normalized)
}

function getCachedCount(key: string): number | null {
  const entry = countCache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > COUNT_CACHE_TTL) {
    countCache.delete(key)
    return null
  }
  return entry.total
}

function setCachedCount(key: string, total: number): void {
  countCache.set(key, { total, ts: Date.now() })
  // 简单容量控制：超出上限淘汰最早插入项
  if (countCache.size > COUNT_CACHE_MAX) {
    const firstKey = countCache.keys().next().value
    if (firstKey) countCache.delete(firstKey)
  }
}

/** 照片集发生变更时失效 COUNT 缓存（删除/编辑属性/移动/收藏等） */
export function invalidatePhotoCountCache(): void {
  countCache.clear()
}

export function registerPhotosIpc(): void {
  // 查询照片列表（分页 + 多属性筛选）
  ipcMain.handle(
    'photos:list',
    (
      _,
      params: {
        page: number
        pageSize: number
        filters: Record<number, number[]> // attributeTypeId -> [valueId, ...]
        subLibraryId?: number
        search?: string
        dateFrom?: string
        dateTo?: string
        dateField?: 'imported_at' | 'shot_date'
        fileTypes?: string[]
        organizationStatuses?: ('unclassified' | 'missing_date' | 'missing_camera')[]
        sortBy?: 'imported_at' | 'shot_date' | 'file_name'
        sortOrder?: 'asc' | 'desc'
        starredOnly?: boolean
      }
    ) => {
      try {
      const db = getDb()
      const {
        page,
        pageSize,
        filters,
        subLibraryId,
        search,
        dateFrom,
        dateTo,
        dateField = 'imported_at',
        fileTypes = [],
        organizationStatuses = [],
        sortBy = 'imported_at',
        sortOrder = 'desc',
        starredOnly = false
      } = params
      const offset = (page - 1) * pageSize
      const sortExpression = sortBy === 'file_name'
        ? 'p.original_name'
        : sortBy === 'shot_date'
          ? 'COALESCE(p.shot_date, p.imported_at)'
          : 'p.imported_at'

      const { fromClause, args } = buildFromClause({
        filters, subLibraryId, search, dateFrom, dateTo, dateField,
        fileTypes, organizationStatuses, starredOnly
      })

      // COUNT 查询：COUNT(DISTINCT p.id) 避免子查询包裹的双重开销
      // 同一 filter 签名在 TTL 内复用总数，避免翻页时重算
      const cKey = countCacheKey({ filters, subLibraryId, search, dateFrom, dateTo, dateField, fileTypes, organizationStatuses, starredOnly })
      let total = getCachedCount(cKey)
      if (total === null) {
        const countSql = `SELECT COUNT(DISTINCT p.id) as total ${fromClause}`
        total = (db.prepare(countSql).get(...args) as { total: number }).total
        setCachedCount(cKey, total)
      }

      // 数据查询：加 ORDER BY + LIMIT/OFFSET
      const dataSql = `SELECT DISTINCT p.* ${fromClause} ORDER BY ${sortExpression} ${sortOrder === 'asc' ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`
      const rows = db.prepare(dataSql).all(...args, pageSize, offset) as PhotoRow[]

      // 批量查询每张图的属性标签
      const ids = rows.map((r) => r.id)
      const attrs = ids.length
        ? (db
            .prepare(
              `SELECT pa.photo_id, at.key, at.display_name, av.value, av.id as value_id, pa.attribute_type_id
               FROM photo_attributes pa
               JOIN attribute_types at ON at.id = pa.attribute_type_id
               JOIN attribute_values av ON av.id = pa.attribute_value_id
               WHERE pa.photo_id IN (${ids.map(() => '?').join(',')})
               ORDER BY at.sort_order`
            )
            .all(...ids) as AttrRow[])
        : []

      const attrMap = new Map<number, AttrRow[]>()
      for (const a of attrs) {
        if (!attrMap.has(a.photo_id)) attrMap.set(a.photo_id, [])
        attrMap.get(a.photo_id)!.push(a)
      }

      return { total, rows: rows.map((r) => ({ ...r, attributes: attrMap.get(r.id) ?? [] })) }
      } catch (err) {
        log.error('photos:list error:', err)
        throw err
      }
    }
  )

  ipcMain.handle('photos:filterOptions', () => {
    const db = getDb()
    const fileTypes = db
      .prepare("SELECT file_type as value, COUNT(*) as count FROM photos WHERE import_status = 'ready' GROUP BY file_type ORDER BY file_type")
      .all() as { value: string; count: number }[]
    const statusCounts = db.prepare(`
      SELECT
        SUM(CASE WHEN p.sub_library_id IS NULL THEN 1 ELSE 0 END) AS unclassified,
        SUM(CASE WHEN p.shot_date IS NULL OR p.shot_date = '' THEN 1 ELSE 0 END) AS missing_date,
        SUM(CASE WHEN NOT EXISTS (
          SELECT 1 FROM photo_attributes pa
          JOIN attribute_types at ON at.id = pa.attribute_type_id
          WHERE pa.photo_id = p.id AND at.key = 'camera'
        ) THEN 1 ELSE 0 END) AS missing_camera
      FROM photos p WHERE p.import_status = 'ready'
    `).get() as { unclassified: number | null; missing_date: number | null; missing_camera: number | null }

    return {
      fileTypes,
      statusCounts: {
        unclassified: statusCounts.unclassified ?? 0,
        missing_date: statusCounts.missing_date ?? 0,
        missing_camera: statusCounts.missing_camera ?? 0
      }
    }
  })

  // 获取单张照片详情
  ipcMain.handle('photos:get', (_, id: number) => {
    const db = getDb()
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(id)
    if (!photo) return null
    const attrs = db
      .prepare(
        `SELECT pa.attribute_type_id, at.key, at.display_name, av.value, av.id as value_id
         FROM photo_attributes pa
         JOIN attribute_types at ON at.id = pa.attribute_type_id
         JOIN attribute_values av ON av.id = pa.attribute_value_id
         WHERE pa.photo_id = ?
         ORDER BY at.sort_order`
      )
      .all(id)
    return { ...photo, attributes: attrs }
  })

  // 更新照片属性（替换全部，事务保证原子性）
  ipcMain.handle(
    'photos:setAttributes',
    (_, photoId: number, attrAssignments: { typeId: number; valueId: number }[]) => {
      const db = getDb()
      const delStmt = db.prepare('DELETE FROM photo_attributes WHERE photo_id = ?')
      const insStmt = db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      )
      // DELETE + INSERT 在同一事务内，任一失败则全部回滚
      db.transaction(() => {
        delStmt.run(photoId)
        for (const { typeId, valueId } of attrAssignments) {
          insStmt.run(photoId, typeId, valueId)
        }
      })()
      invalidatePhotoCountCache()
      return true
    }
  )

  // 批量设置属性
  ipcMain.handle(
    'photos:batchSetAttributes',
    (_, photoIds: number[], attrAssignments: { typeId: number; valueId: number }[]) => {
      const db = getDb()
      const deleteStmt = db.prepare('DELETE FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?')
      const ins = db.prepare(
        'INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)'
      )
      const tx = db.transaction(() => {
        for (const photoId of photoIds) {
          for (const { typeId, valueId } of attrAssignments) {
            deleteStmt.run(photoId, typeId)
            ins.run(photoId, typeId, valueId)
          }
        }
      })
      tx()
      invalidatePhotoCountCache()
      return true
    }
  )

  // 更新备注
  ipcMain.handle('photos:updateNotes', (_, id: number, notes: string) => {
    getDb().prepare('UPDATE photos SET notes = ? WHERE id = ?').run(notes, id)
    return true
  })

  // 设置拍摄日期（单张）
  ipcMain.handle('photos:setShotDate', (_, id: number, shotDate: string | null) => {
    getDb().prepare('UPDATE photos SET shot_date = ? WHERE id = ?').run(shotDate ?? null, id)
    invalidatePhotoCountCache()
    return true
  })

  // 批量设置拍摄日期
  ipcMain.handle('photos:batchSetShotDate', (_, ids: number[], shotDate: string | null) => {
    const db = getDb()
    const stmt = db.prepare('UPDATE photos SET shot_date = ? WHERE id = ?')
    const tx = db.transaction(() => { ids.forEach((id) => stmt.run(shotDate ?? null, id)) })
    tx()
    invalidatePhotoCountCache()
    return true
  })

  // 删除照片（先收集路径，事务原子删 DB，再删磁盘文件）
  ipcMain.handle('photos:delete', (_, ids: number[], deleteFile: boolean) => {
    const db = getDb()

    // 先收集待删文件路径（DB 操作前查询，避免删后无法找到路径）
    // linked 模式的源文件不属于图库管理，不随照片记录删除
    const filesToDelete: { file_path: string; thumb_path?: string }[] = []
    if (deleteFile) {
      const sel = db.prepare('SELECT file_path, thumb_path, storage_mode FROM photos WHERE id = ?')
      for (const id of ids) {
        const row = sel.get(id) as { file_path: string; thumb_path?: string; storage_mode: string } | undefined
        if (row && row.storage_mode !== 'linked') filesToDelete.push(row)
      }
    }

    // 事务原子性删除 DB 记录（任一失败则全部回滚）
    const delStmt = db.prepare('DELETE FROM photos WHERE id = ?')
    db.transaction(() => {
      for (const id of ids) delStmt.run(id)
    })()

    // DB 提交成功后再删磁盘文件（文件删除失败不影响 DB 一致性）
    for (const { file_path, thumb_path } of filesToDelete) {
      try { fs.unlinkSync(file_path) } catch {}
      if (thumb_path) try { fs.unlinkSync(thumb_path) } catch {}
    }
    invalidatePhotoCountCache()
    return true
  })

  // 全屏预览：返回 base64 JPEG（最多同时处理 1 个，新请求到来时丢弃旧的排队请求）
  ipcMain.handle('photos:fullPreview', async (_, filePath: string, iccPath?: string, rotation = 0) => {
    // 若有排队中的旧请求，令其立即返回 null
    if (pendingPreviewResolve) {
      pendingPreviewResolve(null)
      pendingPreviewResolve = null
    }
    // 若正在处理中，将本次请求排队（旧排队已被上面取消）
    if (previewInFlight) {
      return new Promise<null>((resolve) => { pendingPreviewResolve = resolve })
    }
    previewInFlight = true
    try {
      const result = await renderFullPreview(filePath, iccPath, rotation)
      if (!result) return null
      return {
        dataUrl: `data:image/jpeg;base64,${result.buffer.toString('base64')}`,
        width: result.width,
        height: result.height
      }
    } finally {
      previewInFlight = false
      // 若排队中有新请求，通知它继续（但它已持有新的 filePath 故直接返回 null 让前端重试）
      if (pendingPreviewResolve) {
        pendingPreviewResolve(null)
        pendingPreviewResolve = null
      }
    }
  })

  ipcMain.handle('photos:setRotation', async (_, photoId: number, rotation: number) => {
    const db = getDb()
    const nextRotation = normalizeRotation(rotation)
    const row = db
      .prepare('SELECT file_path FROM photos WHERE id = ?')
      .get(photoId) as { file_path: string } | undefined
    if (!row) return null

    db.prepare('UPDATE photos SET rotation = ? WHERE id = ?').run(nextRotation, photoId)
    const thumbPath = await generateThumbnail(row.file_path, getThumbDir(), nextRotation)
    if (thumbPath) {
      db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?').run(thumbPath, photoId)
    }
    return { id: photoId, rotation: nextRotation, thumbPath: thumbPath ?? null }
  })

  ipcMain.handle('photos:batchRotate', async (_, photoIds: number[], delta = 90) => {
    const db = getDb()
    const normalizedDelta = normalizeRotation(delta)
    const thumbDir = getThumbDir()

    // 第一阶段：事务内批量更新旋转角度
    interface RotateTarget { id: number; filePath: string; nextRotation: 0 | 90 | 180 | 270 }
    const targets: RotateTarget[] = []
    const selStmt = db.prepare('SELECT file_path, rotation FROM photos WHERE id = ?')
    const updStmt = db.prepare('UPDATE photos SET rotation = ? WHERE id = ?')
    db.transaction(() => {
      for (const photoId of photoIds) {
        const row = selStmt.get(photoId) as { file_path: string; rotation?: number } | undefined
        if (!row) continue
        const nextRotation = normalizeRotation((row.rotation ?? 0) + normalizedDelta) as 0 | 90 | 180 | 270
        updStmt.run(nextRotation, photoId)
        targets.push({ id: photoId, filePath: row.file_path, nextRotation })
      }
    })()

    // 第二阶段：Worker Pool 并行生成缩略图（不阻塞 IPC 响应）
    const thumbStmt = db.prepare('UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?')
    Promise.all(targets.map(async ({ id, filePath, nextRotation }) => {
      const thumbPath = await thumbnailPool.generate(filePath, thumbDir, nextRotation)
        .catch(() => null) ?? await generateThumbnail(filePath, thumbDir, nextRotation).catch(() => null)
      if (thumbPath) thumbStmt.run(thumbPath, id)
    })).catch((err) => log.warn('batchRotate thumb gen error', err))

    return { updated: targets.length }
  })

  // 获取缩略图 base64（用于已有 thumb_path 的快速读取）
  ipcMain.handle('photos:thumbDataUrl', (_, thumbPath: string) => {
    try {
      // Restrict reads to within the library thumbs directory
      const resolved = path.resolve(thumbPath)
      if (!resolved.startsWith(path.resolve(getThumbDir()) + path.sep)) return null
      const buf = fs.readFileSync(resolved)
      return `data:image/webp;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  })

  // 移动到子库
  ipcMain.handle('photos:moveToSubLibrary', (_, photoIds: number[], subLibraryId: number | null) => {
    const result = movePhotosToSubLibrary(
      getDb(),
      path.join(getLibraryRoot(), 'files'),
      photoIds,
      subLibraryId
    )
    invalidatePhotoCountCache()
    return result
  })

  // 切换单张照片的收藏状态
  ipcMain.handle('photos:toggleStar', (_, photoId: number) => {
    const db = getDb()
    const row = db.prepare('SELECT starred FROM photos WHERE id = ?').get(photoId) as { starred: number } | undefined
    if (!row) return false
    const newVal = row.starred ? 0 : 1
    db.prepare('UPDATE photos SET starred = ? WHERE id = ?').run(newVal, photoId)
    invalidatePhotoCountCache()
    return newVal === 1
  })

  // 批量设置收藏状态
  ipcMain.handle('photos:batchStar', (_, photoIds: number[], starred: boolean) => {
    const db = getDb()
    const val = starred ? 1 : 0
    const stmt = db.prepare('UPDATE photos SET starred = ? WHERE id = ?')
    db.transaction(() => { for (const id of photoIds) stmt.run(val, id) })()
    invalidatePhotoCountCache()
    return true
  })

  // 按需读取照片完整 EXIF（含拍摄参数），供 Viewer 侧栏展示
  ipcMain.handle('photos:exif', async (_, photoId: number) => {
    const db = getDb()
    const row = db.prepare('SELECT file_path FROM photos WHERE id = ?').get(photoId) as { file_path: string } | undefined
    if (!row) return null
    try {
      return await getExifData(row.file_path)
    } catch {
      return null
    }
  })

  // 时间线数据：按年月分组，每月返回数量 + 代表性缩略图（最多 N 张）
  // 接受完整 filter 参数，与 photos:list 联动筛选
  ipcMain.handle('photos:timeline', (_, params: {
    dateField?: 'imported_at' | 'shot_date'
    filters?: Record<number, number[]>
    subLibraryId?: number
    search?: string
    dateFrom?: string
    dateTo?: string
    fileTypes?: string[]
    organizationStatuses?: ('unclassified' | 'missing_date' | 'missing_camera')[]
    starredOnly?: boolean
    thumbsPerMonth?: number
  } = {}) => {
    const db = getDb()
    const {
      dateField = 'shot_date',
      thumbsPerMonth = 6
    } = params

    // 白名单校验 dateField
    const safeField: 'imported_at' | 'shot_date' = dateField === 'imported_at' ? 'imported_at' : 'shot_date'
    // 时间线用 COALESCE 回退：拍摄日期缺失时用入库日期
    const col = safeField === 'shot_date'
      ? "COALESCE(NULLIF(p.shot_date, ''), p.imported_at)"
      : 'p.imported_at'

    // 复用共享 WHERE/JOIN 构建（dateFrom/dateTo 不传入，保留全量时间跨度供月份分组）
    const { fromClause, args } = buildFromClause({
      filters: params.filters ?? {},
      subLibraryId: params.subLibraryId,
      search: params.search,
      fileTypes: params.fileTypes,
      organizationStatuses: params.organizationStatuses,
      starredOnly: params.starredOnly,
      // 时间线视图不用 dateFrom/dateTo 过滤（由年份/月份多选在前端控制），
      // 但需要按 dateField 口径分组，所以传 dateField 影响 dateColumn 选取
      dateField: safeField
    })

    // 按月统计（在 fromClause 的 WHERE 基础上再加时间列有效约束）
    const countSql = `
      SELECT strftime('%Y-%m', ${col}) as month, COUNT(DISTINCT p.id) as count
      ${fromClause}
        AND ${col} IS NOT NULL AND ${col} != ''
      GROUP BY month
      ORDER BY month DESC
    `
    const counts = db.prepare(countSql).all(...args) as { month: string; count: number }[]

    // 每月取前 N 张有缩略图的照片
    const thumbSql = `
      SELECT DISTINCT p.id, p.thumb_path, p.thumb_ready, p.file_type, p.original_name, p.rotation
      ${fromClause}
        AND strftime('%Y-%m', ${col}) = ?
        AND p.thumb_ready = 1
        AND p.thumb_path IS NOT NULL
      ORDER BY ${col} ASC
      LIMIT ${thumbsPerMonth}
    `
    const thumbStmt = db.prepare(thumbSql)

    return counts.map((row) => ({
      month: row.month,
      count: row.count,
      thumbs: thumbStmt.all(...args, row.month) as {
        id: number; thumb_path: string; thumb_ready: number
        file_type: string; original_name: string; rotation: number
      }[]
    }))
  })
}

interface PhotoRow { id: number; file_path: string; original_name: string; file_type: string; thumb_path?: string; thumb_ready: number; width?: number; height?: number; file_size?: number; sub_library_id?: number; imported_at: string; notes: string; storage_mode: string; import_status: string }
interface AttrRow { photo_id: number; attribute_type_id: number; key: string; display_name: string; value: string; value_id: number }
