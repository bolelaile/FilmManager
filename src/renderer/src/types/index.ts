export interface Photo {
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
  rotation: 0 | 90 | 180 | 270
  notes: string
  attributes: PhotoAttribute[]
}

export interface PhotoAttribute {
  photo_id: number
  attribute_type_id: number
  key: string
  display_name: string
  value: string
  value_id: number
}

export interface AttributeType {
  id: number
  key: string
  display_name: string
  is_system: number
  is_active: number
  sort_order: number
  values?: AttributeValue[]
}

export interface AttributeValue {
  id: number
  attribute_type_id: number
  value: string
  icon_key?: string
  is_preset: number
}

export interface SubLibrary {
  id: number
  name: string
  description: string
  parent_id: number | null
  sort_order: number
  created_at: string
  children: SubLibrary[]
}

export interface IccProfile {
  name: string
  path: string
  isPreset: boolean
}

export interface Location {
  id: number
  name: string
  address: string
  lat: number
  lng: number
  created_at: string
  photo_count?: number
}

export interface LocationSearchResult {
  name: string
  address: string
  lat: number
  lng: number
}

export type AutoOrganizeMode = 'none' | 'year' | 'year-month' | 'camera' | 'film' | 'source-folder'

export type OrganizationStatus = 'unclassified' | 'missing_date' | 'missing_camera'

export interface PhotoFilterOptions {
  fileTypes: { value: string; count: number }[]
  statusCounts: Record<OrganizationStatus, number>
}

export interface FilterState {
  filters: Record<number, number[]> // typeId -> [valueId, ...]
  subLibraryId?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  dateField: 'imported_at' | 'shot_date'
  fileTypes?: string[]
  organizationStatuses?: OrganizationStatus[]
  sortBy: 'imported_at' | 'shot_date' | 'file_name'
  sortOrder: 'asc' | 'desc'
}
