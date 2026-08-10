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
