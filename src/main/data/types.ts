/**
 * 数据访问层共享类型（Repository 行类型 + 查询过滤参数）。
 * 与渲染层 FilterState 概念一致但独立定义，避免数据层依赖渲染层。
 */

export type DateField = 'imported_at' | 'shot_date'
export type SortBy = 'imported_at' | 'shot_date' | 'file_name'
export type SortOrder = 'asc' | 'desc'
export type OrganizationStatus = 'unclassified' | 'missing_date' | 'missing_camera'

/** 照片/卷查询的过滤参数（统一供 PhotoRepository/RollRepository 复用） */
export interface QueryFilter {
  filters?: Record<number, number[]> // typeId -> [valueId, ...]
  subLibraryId?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  dateField?: DateField
  fileTypes?: string[]
  organizationStatuses?: OrganizationStatus[]
  starredOnly?: boolean
}

/** 分页参数 */
export interface Paging {
  page: number
  pageSize: number
  sortBy?: SortBy
  sortOrder?: SortOrder
}

/** 照片行（数据库原始字段） */
export interface PhotoRow {
  id: number
  file_path: string
  original_name: string
  file_type: string
  thumb_path?: string
  thumb_ready: number
  width?: number
  height?: number
  file_size?: number
  sub_library_id?: number
  imported_at: string
  shot_date?: string | null
  rotation: number
  notes: string
  content_hash?: string
  storage_mode: string
  import_status: string
  starred: number
  deleted_at?: string | null
}

/** 属性行（含类型与值） */
export interface AttrRow {
  photo_id?: number
  roll_id?: number
  attribute_type_id: number
  key: string
  display_name: string
  value: string
  value_id: number
  icon_key?: string
}
