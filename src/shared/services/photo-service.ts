/**
 * 照片功能核心服务接口（契约骨架）。
 * 由 main/features/photos/PhotoService 实现，ipc-adapters/photos-adapter 转发。
 *
 * 批次 0 仅建接口骨架与查询参数 DTO；完整方法签名在批次 2（照片功能核心抽取）补全，
 * 届时 Photo 等领域模型从 renderer/types 提取到 shared/types。
 */

/** 照片列表查询参数（从现有 photos:list 提取） */
export interface PhotoListParams {
  page: number
  pageSize: number
  filters: Record<number, number[]>
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

/**
 * 照片功能核心服务接口。
 * 本接口是功能核心与 IPC/UI 之间的契约，便于单独升级或替换实现。
 */
export interface IPhotoService {
  /** 分页查询照片（含属性批量加载）。返回 { total, rows }，rows 类型在批次 2 细化。 */
  list(params: PhotoListParams): Promise<{ total: number; rows: unknown[] }>

  /** 单张照片详情（含属性） */
  get(id: number): Promise<unknown | null>

  /** 删除照片（先 DB 后文件，原子化） */
  delete(ids: number[], deleteFile: boolean): Promise<boolean>

  /** 设置旋转（持久化 + 重建缩略图） */
  setRotation(id: number, rotation: number): Promise<{ id: number; rotation: number; thumbPath: string | null } | null>

  /** 切换收藏 */
  toggleStar(id: number): Promise<boolean>

  // 其余方法（setAttributes/batchSetAttributes/updateNotes/setShotDate/moveToSubLibrary/
  // batchRotate/batchStar/fullPreview/thumbDataUrl/exif/timeline/filterOptions）
  // 在批次 2 补全签名
}
