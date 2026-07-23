import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // 照片
  photos: {
    list: (params: unknown) => ipcRenderer.invoke('photos:list', params),
    get: (id: number) => ipcRenderer.invoke('photos:get', id),
    setAttributes: (photoId: number, attrs: unknown[]) => ipcRenderer.invoke('photos:setAttributes', photoId, attrs),
    batchSetAttributes: (ids: number[], attrs: unknown[]) => ipcRenderer.invoke('photos:batchSetAttributes', ids, attrs),
    updateNotes: (id: number, notes: string) => ipcRenderer.invoke('photos:updateNotes', id, notes),
    setShotDate: (id: number, shotDate: string | null) => ipcRenderer.invoke('photos:setShotDate', id, shotDate),
    batchSetShotDate: (ids: number[], shotDate: string | null) => ipcRenderer.invoke('photos:batchSetShotDate', ids, shotDate),
    delete: (ids: number[], deleteFile: boolean) => ipcRenderer.invoke('photos:delete', ids, deleteFile),
    fullPreview: (filePath: string, iccPath?: string) => ipcRenderer.invoke('photos:fullPreview', filePath, iccPath),
    thumbDataUrl: (thumbPath: string) => ipcRenderer.invoke('photos:thumbDataUrl', thumbPath),
    moveToSubLibrary: (ids: number[], subLibId: number | null) => ipcRenderer.invoke('photos:moveToSubLibrary', ids, subLibId)
  },
  // 导入
  import: {
    selectAndImport: (subLibId?: number) => ipcRenderer.invoke('import:selectAndImport', subLibId),
    importPaths: (paths: string[], subLibId?: number) => ipcRenderer.invoke('import:importPaths', paths, subLibId),
    scanFolders: () => ipcRenderer.invoke('import:scanFolders'),
    importRolls: (configs: unknown[]) => ipcRenderer.invoke('import:importRolls', configs),
    onProgress: (cb: (data: { imported: number; skipped: number; total?: number }) => void) => {
      ipcRenderer.on('import:progress', (_, data) => cb(data))
      return () => ipcRenderer.removeAllListeners('import:progress')
    },
    onTotal: (cb: (total: number) => void) => {
      ipcRenderer.on('import:total', (_, total) => cb(total))
      return () => ipcRenderer.removeAllListeners('import:total')
    }
  },
  // 属性
  attrs: {
    listTypes: () => ipcRenderer.invoke('attrs:listTypes'),
    listValues: (typeId: number) => ipcRenderer.invoke('attrs:listValues', typeId),
    listAll: () => ipcRenderer.invoke('attrs:listAll'),
    valueCounts: (filters: unknown) => ipcRenderer.invoke('attrs:valueCounts', filters),
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
    getInitError: () => ipcRenderer.invoke('app:getInitError')
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
    setForPhotos: (photoIds: number[], locationId: number) => ipcRenderer.invoke('locations:setForPhotos', photoIds, locationId),
    addToPhoto: (photoId: number, locationId: number) => ipcRenderer.invoke('locations:addToPhoto', photoId, locationId),
    removeFromPhoto: (photoId: number, locationId: number) => ipcRenderer.invoke('locations:removeFromPhoto', photoId, locationId),
    search: (query: string) => ipcRenderer.invoke('locations:search', query),
    mapData: () => ipcRenderer.invoke('locations:mapData')
  },
  // 卷管理
  rolls: {
    list: (subLibraryId?: number) => ipcRenderer.invoke('rolls:list', subLibraryId),
    create: (params: { photoIds: number[]; name?: string; subLibraryId?: number | null }) => ipcRenderer.invoke('rolls:create', params),
    rename: (id: number, name: string) => ipcRenderer.invoke('rolls:rename', id, name),
    delete: (id: number) => ipcRenderer.invoke('rolls:delete', id),
    photos: (rollId: number, params: unknown) => ipcRenderer.invoke('rolls:photos', rollId, params),
    forPhoto: (photoId: number) => ipcRenderer.invoke('rolls:forPhoto', photoId),
    removePhotos: (rollId: number, photoIds: number[]) => ipcRenderer.invoke('rolls:removePhotos', rollId, photoIds),
    addPhotos: (rollId: number, photoIds: number[]) => ipcRenderer.invoke('rolls:addPhotos', rollId, photoIds),
    setCover: (rollId: number, photoId: number) => ipcRenderer.invoke('rolls:setCover', rollId, photoId)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type FilmManagerAPI = typeof api
