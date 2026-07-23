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

export interface FolderScanResult {
  name: string
  folderPath: string
  fileCount: number
  matches: FolderAttrMatch[]        // matches from child folder name
  parentMatches: FolderAttrMatch[]  // matches from parent (root) folder name
  parsedDate: string | null         // YYYY-MM-DD or YYYY-MM-01 extracted from name
  inferredRollName: string          // pre-built suggested roll name
}

export interface FolderAttrMatch {
  typeId: number
  valueId: number
  value: string
  key: string
  iconKey?: string | null
  matchedAlias: string | null  // null = matched by primary name; non-null = matched via this alias
}

export interface RollImportConfig {
  folderPath: string
  rollName: string
  attrs: { typeId: number; valueId: number }[]
  locationId?: number | null
  shotDate?: string | null
  subLibraryId?: number | null
  createRoll: boolean
}

export interface Roll {
  id: number
  name: string
  sub_library_id: number | null
  cover_photo_id: number | null
  created_at: string
  photo_count: number
  thumb_path?: string
  thumb_ready?: number
  attributes: RollAttribute[]
  location_name: string | null
}

export interface RollAttribute {
  roll_id: number
  attribute_type_id: number
  key: string
  display_name: string
  value: string
  value_id: number
  icon_key?: string
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

export interface FilterState {
  filters: Record<number, number[]> // typeId -> [valueId, ...]
  subLibraryId?: number
  search?: string
  dateFrom?: string
  dateTo?: string
  sortBy: 'imported_at' | 'file_name'
  sortOrder: 'asc' | 'desc'
}
