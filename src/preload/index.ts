import { contextBridge, ipcRenderer } from 'electron'
import type { AutoOrganizeMode, ImportOptions } from '../shared/import-types'
import type { ExportConfig, ExportPreset, BorderMatchResult } from '../shared/export-types'

export type { AutoOrganizeMode, ImportOptions, ExportConfig, ExportPreset, BorderMatchResult }

const api = {
  // 照片
  photos: {
    list: (params: unknown) => ipcRenderer.invoke('photos:list', params),
    filterOptions: () => ipcRenderer.invoke('photos:filterOptions'),
    get: (id: number) => ipcRenderer.invoke('photos:get', id),
    setAttributes: (photoId: number, attrs: unknown[]) => ipcRenderer.invoke('photos:setAttributes', photoId, attrs),
    batchSetAttributes: (ids: number[], attrs: unknown[]) => ipcRenderer.invoke('photos:batchSetAttributes', ids, attrs),
    updateNotes: (id: number, notes: string) => ipcRenderer.invoke('photos:updateNotes', id, notes),
    setShotDate: (id: number, shotDate: string | null) => ipcRenderer.invoke('photos:setShotDate', id, shotDate),
    batchSetShotDate: (ids: number[], shotDate: string | null) => ipcRenderer.invoke('photos:batchSetShotDate', ids, shotDate),
    delete: (ids: number[], deleteFile: boolean) => ipcRenderer.invoke('photos:delete', ids, deleteFile),
    fullPreview: (filePath: string, iccPath?: string, rotation?: number) => ipcRenderer.invoke('photos:fullPreview', filePath, iccPath, rotation),
    thumbDataUrl: (thumbPath: string) => ipcRenderer.invoke('photos:thumbDataUrl', thumbPath),
    moveToSubLibrary: (ids: number[], subLibId: number | null) => ipcRenderer.invoke('photos:moveToSubLibrary', ids, subLibId),
    setRotation: (id: number, rotation: number) => ipcRenderer.invoke('photos:setRotation', id, rotation),
    batchRotate: (ids: number[], delta?: number) => ipcRenderer.invoke('photos:batchRotate', ids, delta),
    toggleStar: (id: number) => ipcRenderer.invoke('photos:toggleStar', id),
    batchStar: (ids: number[], starred: boolean) => ipcRenderer.invoke('photos:batchStar', ids, starred),
    exif: (id: number) => ipcRenderer.invoke('photos:exif', id),
    timeline: (params?: {
      dateField?: 'imported_at' | 'shot_date'
      filters?: Record<number, number[]>
      subLibraryId?: number
      search?: string
      fileTypes?: string[]
      organizationStatuses?: string[]
      starredOnly?: boolean
      thumbsPerMonth?: number
    }) => ipcRenderer.invoke('photos:timeline', params)
  },
  // 导入
  import: {
    selectAndImport: (options?: ImportOptions) => ipcRenderer.invoke('import:selectAndImport', options),
    importPaths: (paths: string[], options?: ImportOptions) => ipcRenderer.invoke('import:importPaths', paths, options),
    scanFolders: (rootPath?: string) => ipcRenderer.invoke('import:scanFolders', rootPath),
    scanSingleFolder: (folderPath?: string) => ipcRenderer.invoke('import:scanSingleFolder', folderPath),
    importRolls: (configs: unknown[]) => ipcRenderer.invoke('import:importRolls', configs),
    onProgress: (cb: (data: { imported: number; skipped: number; total?: number }) => void) => {
      ipcRenderer.on('import:progress', (_, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('import:progress')
    },
    onTotal: (cb: (total: number) => void) => {
      ipcRenderer.on('import:total', (_, total) => cb(total))
      return () => ipcRenderer.removeAllListeners('import:total')
    },
    onRegistered: (cb: (data: { count: number; total: number }) => void) => {
      ipcRenderer.on('import:registered', (_, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('import:registered')
    }
  },
  // 属性
  attrs: {
    listTypes: () => ipcRenderer.invoke('attrs:listTypes'),
    listValues: (typeId: number) => ipcRenderer.invoke('attrs:listValues', typeId),
    listAll: () => ipcRenderer.invoke('attrs:listAll'),
    valueCounts: (params?: { filters?: Record<number, number[]>; subLibraryId?: number; search?: string; dateFrom?: string; dateTo?: string; dateField?: string; fileTypes?: string[]; organizationStatuses?: string[] }) => ipcRenderer.invoke('attrs:valueCounts', params),
    addType: (displayName: string) => ipcRenderer.invoke('attrs:addType', displayName),
    updateType: (id: number, displayName: string) => ipcRenderer.invoke('attrs:updateType', id, displayName),
    toggleType: (id: number, active: boolean) => ipcRenderer.invoke('attrs:toggleType', id, active),
    deleteType: (id: number) => ipcRenderer.invoke('attrs:deleteType', id),
    addValue: (typeId: number, value: string, iconKey?: string) => ipcRenderer.invoke('attrs:addValue', typeId, value, iconKey),
    updateValue: (id: number, value: string, iconKey?: string) => ipcRenderer.invoke('attrs:updateValue', id, value, iconKey),
    filmIconManifest: () => ipcRenderer.invoke('attrs:filmIconManifest'),
    filmIconDataUrl: (key: string, size?: 64 | 128) => ipcRenderer.invoke('attrs:filmIconDataUrl', key, size),
    filmIconsBatch: (keys: string[], size?: 64 | 128) => ipcRenderer.invoke('attrs:filmIconsBatch', keys, size),
    importCustomIcon: () => ipcRenderer.invoke('attrs:importCustomIcon'),
    deleteValue: (id: number) => ipcRenderer.invoke('attrs:deleteValue', id),
    reorder: (ids: number[]) => ipcRenderer.invoke('attrs:reorder', ids),
    listAliases: (valueId: number) => ipcRenderer.invoke('attrs:listAliases', valueId),
    addAlias: (valueId: number, alias: string) => ipcRenderer.invoke('attrs:addAlias', valueId, alias),
    removeAlias: (aliasId: number) => ipcRenderer.invoke('attrs:removeAlias', aliasId),
    importJson: (typeId: number) => ipcRenderer.invoke('attrs:importJson', typeId)
  },
  // 子库
  sublib: {
    list: () => ipcRenderer.invoke('sublib:list'),
    create: (name: string, parentId?: number) => ipcRenderer.invoke('sublib:create', name, parentId),
    rename: (id: number, name: string) => ipcRenderer.invoke('sublib:rename', id, name),
    setDescription: (id: number, desc: string) => ipcRenderer.invoke('sublib:setDescription', id, desc),
    delete: (id: number) => ipcRenderer.invoke('sublib:delete', id),
    counts: () => ipcRenderer.invoke('sublib:counts')
  },
  // 库管理
  library: {
    info: () => ipcRenderer.invoke('library:info'),
    revealFile: (path: string) => ipcRenderer.invoke('library:revealFile', path),
    regenThumb: (id: number) => ipcRenderer.invoke('library:regenThumb', id),
    listProfiles: () => ipcRenderer.invoke('library:listProfiles'),
    importProfile: () => ipcRenderer.invoke('library:importProfile'),
    stats: () => ipcRenderer.invoke('library:stats')
  },
  // 应用
  app: {
    setLibraryRoot: (root: string) => ipcRenderer.invoke('app:setLibraryRoot', root),
    getLibraryRoot: () => ipcRenderer.invoke('app:getLibraryRoot'),
    pickLibraryRoot: () => ipcRenderer.invoke('app:pickLibraryRoot'),
    getInitError: () => ipcRenderer.invoke('app:getInitError'),
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getLogContent: (maxLines?: number) => ipcRenderer.invoke('app:getLogContent', maxLines),
    getLogPath: () => ipcRenderer.invoke('app:getLogPath'),
    revealLog: () => ipcRenderer.invoke('app:revealLog'),
    openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
    detectImageApps: () => ipcRenderer.invoke('app:detectImageApps'),
    openWithApp: (exePath: string, filePaths: string[]) => ipcRenderer.invoke('app:openWithApp', exePath, filePaths)
  },
  // 窗口控制
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close')
  },
  // 地点
  locations: {
    list: () => ipcRenderer.invoke('locations:list'),
    add: (name: string, address: string, lat: number, lng: number) => ipcRenderer.invoke('locations:add', name, address, lat, lng),
    delete: (id: number) => ipcRenderer.invoke('locations:delete', id),
    update: (id: number, name: string, address: string) => ipcRenderer.invoke('locations:update', id, name, address),
    photos: (locationId: number) => ipcRenderer.invoke('locations:photos', locationId),
    forPhoto: (photoId: number) => ipcRenderer.invoke('locations:forPhoto', photoId),
    setForPhotos: (photoIds: number[], locationId: number | null) => ipcRenderer.invoke('locations:setForPhotos', photoIds, locationId),
    addToPhoto: (photoId: number, locationId: number) => ipcRenderer.invoke('locations:addToPhoto', photoId, locationId),
    removeFromPhoto: (photoId: number, locationId: number) => ipcRenderer.invoke('locations:removeFromPhoto', photoId, locationId),
    clearForPhotos: (photoIds: number[]) => ipcRenderer.invoke('locations:clearForPhotos', photoIds),
    search: (query: string) => ipcRenderer.invoke('locations:search', query),
    reverseGeocode: (lat: number, lng: number) => ipcRenderer.invoke('locations:reverseGeocode', lat, lng),
    mapData: () => ipcRenderer.invoke('locations:mapData')
  },
  // 卷管理
  rolls: {
    list: (params?: { subLibraryId?: number; filters?: Record<number, number[]>; search?: string; dateFrom?: string; dateTo?: string; dateField?: string; fileTypes?: string[]; organizationStatuses?: string[] }) => ipcRenderer.invoke('rolls:list', params),
    checkAttrConsistency: (photoIds: number[]) => ipcRenderer.invoke('rolls:checkAttrConsistency', photoIds),
    create: (params: { photoIds: number[]; name?: string; subLibraryId?: number | null }) => ipcRenderer.invoke('rolls:create', params),
    rename: (id: number, name: string) => ipcRenderer.invoke('rolls:rename', id, name),
    delete: (id: number, deletePhotos?: boolean, deleteFiles?: boolean) => ipcRenderer.invoke('rolls:delete', id, deletePhotos, deleteFiles),
    batchDelete: (ids: number[], deletePhotos?: boolean, deleteFiles?: boolean) => ipcRenderer.invoke('rolls:batchDelete', ids, deletePhotos, deleteFiles),
    batchSetAttributes: (ids: number[], attrs: { typeId: number; valueId: number }[]) => ipcRenderer.invoke('rolls:batchSetAttributes', ids, attrs),
    photos: (rollId: number | null, params: unknown) => ipcRenderer.invoke('rolls:photos', rollId, params),
    forPhoto: (photoId: number) => ipcRenderer.invoke('rolls:forPhoto', photoId),
    removePhotos: (rollId: number, photoIds: number[]) => ipcRenderer.invoke('rolls:removePhotos', rollId, photoIds),
    addPhotos: (rollId: number, photoIds: number[]) => ipcRenderer.invoke('rolls:addPhotos', rollId, photoIds),
    setCover: (rollId: number, photoId: number) => ipcRenderer.invoke('rolls:setCover', rollId, photoId)
  },
  // 导出
  export: {
    matchBorder: (photoId: number) => ipcRenderer.invoke('export:matchBorder', photoId),
    preview: (photoId: number, config: ExportConfig) => ipcRenderer.invoke('export:preview', photoId, config),
    render: (photoId: number, config: ExportConfig) => ipcRenderer.invoke('export:render', photoId, config),
    batch: (photoIds: number[], config: ExportConfig) => ipcRenderer.invoke('export:batch', photoIds, config),
    cancel: () => ipcRenderer.invoke('export:cancel'),
    pickDir: () => ipcRenderer.invoke('export:pickDir'),
    defaultConfig: () => ipcRenderer.invoke('export:defaultConfig'),
    listFonts: () => ipcRenderer.invoke('export:listFonts'),
    presets: {
      list: () => ipcRenderer.invoke('export:presets:list'),
      save: (name: string, config: ExportConfig) => ipcRenderer.invoke('export:presets:save', name, config),
      delete: (id: number) => ipcRenderer.invoke('export:presets:delete', id)
    },
    onProgress: (cb: (d: { done: number; total: number; success: number; failed: number; photoId: number }) => void) => {
      ipcRenderer.on('export:progress', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('export:progress')
    },
    onDone: (cb: (d: { total: number; success: number; failed: number; cancelled: boolean }) => void) => {
      ipcRenderer.on('export:done', (_, d) => cb(d))
      return () => ipcRenderer.removeAllListeners('export:done')
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type FilmManagerAPI = typeof api
