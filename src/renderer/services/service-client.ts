/**
 * 渲染层服务客户端（UI 层与 IPC 的边界）。
 * 对 window.api 的类型化封装，UI 组件经此调用而非直接 window.api。
 * 价值：① 统一调用入口便于审计；② 后续可在此加缓存/重试/错误处理；③ 便于 mock 测试。
 *
 * 现阶段为薄委托（直接转发 window.api），批次5+ 可逐步增强。
 */
import type { FilmManagerAPI } from '../../preload'

type API = FilmManagerAPI

/** 获取底层 api（封装一层，避免 UI 直接访问 window） */
function api(): API {
  return (window as unknown as { api: API }).api
}

/** 照片服务 */
export const photoService = {
  list: (params: Parameters<API['photos']['list']>[0]) => api().photos.list(params),
  get: (id: number) => api().photos.get(id),
  filterOptions: () => api().photos.filterOptions(),
  setAttributes: (photoId: number, attrs: Parameters<API['photos']['setAttributes']>[1]) => api().photos.setAttributes(photoId, attrs),
  batchSetAttributes: (ids: number[], attrs: Parameters<API['photos']['batchSetAttributes']>[1]) => api().photos.batchSetAttributes(ids, attrs),
  updateNotes: (id: number, notes: string) => api().photos.updateNotes(id, notes),
  setShotDate: (id: number, shotDate: string | null) => api().photos.setShotDate(id, shotDate),
  batchSetShotDate: (ids: number[], shotDate: string | null) => api().photos.batchSetShotDate(ids, shotDate),
  delete: (ids: number[], deleteFile: boolean) => api().photos.delete(ids, deleteFile),
  fullPreview: (filePath: string, iccPath?: string, rotation?: number) => api().photos.fullPreview(filePath, iccPath, rotation),
  thumbDataUrl: (thumbPath: string) => api().photos.thumbDataUrl(thumbPath),
  moveToSubLibrary: (ids: number[], subLibId: number | null) => api().photos.moveToSubLibrary(ids, subLibId),
  setRotation: (id: number, rotation: number) => api().photos.setRotation(id, rotation),
  batchRotate: (ids: number[], delta?: number) => api().photos.batchRotate(ids, delta),
  toggleStar: (id: number) => api().photos.toggleStar(id),
  batchStar: (ids: number[], starred: boolean) => api().photos.batchStar(ids, starred),
  exif: (id: number) => api().photos.exif(id),
  timeline: (params?: Parameters<API['photos']['timeline']>[0]) => api().photos.timeline(params),
}

/** 导入服务 */
export const importService = {
  selectAndImport: (options?: Parameters<API['import']['selectAndImport']>[0]) => api().import.selectAndImport(options),
  importPaths: (paths: string[], options?: Parameters<API['import']['importPaths']>[1]) => api().import.importPaths(paths, options),
  scanFolders: (rootPath?: string) => api().import.scanFolders(rootPath),
  scanSingleFolder: (folderPath?: string) => api().import.scanSingleFolder(folderPath),
  importRolls: (configs: Parameters<API['import']['importRolls']>[0]) => api().import.importRolls(configs),
  onProgress: (cb: Parameters<API['import']['onProgress']>[0]) => api().import.onProgress(cb),
  onTotal: (cb: Parameters<API['import']['onTotal']>[0]) => api().import.onTotal(cb),
  onRegistered: (cb: Parameters<API['import']['onRegistered']>[0]) => api().import.onRegistered(cb),
}

/** 属性服务 */
export const attributeService = {
  listTypes: () => api().attrs.listTypes(),
  listValues: (typeId: number) => api().attrs.listValues(typeId),
  listAll: () => api().attrs.listAll(),
  valueCounts: (params?: Parameters<API['attrs']['valueCounts']>[0]) => api().attrs.valueCounts(params),
  addType: (displayName: string) => api().attrs.addType(displayName),
  updateType: (id: number, name: string) => api().attrs.updateType(id, name),
  toggleType: (id: number, active: boolean) => api().attrs.toggleType(id, active),
  deleteType: (id: number) => api().attrs.deleteType(id),
  addValue: (typeId: number, value: string, iconKey?: string) => api().attrs.addValue(typeId, value, iconKey),
  updateValue: (id: number, value: string, iconKey?: string) => api().attrs.updateValue(id, value, iconKey),
  deleteValue: (id: number) => api().attrs.deleteValue(id),
  reorder: (ids: number[]) => api().attrs.reorder(ids),
  filmIconDataUrl: (key: string, size?: 64 | 128) => api().attrs.filmIconDataUrl(key, size),
  filmIconsBatch: (keys: string[], size?: 64 | 128) => api().attrs.filmIconsBatch(keys, size),
  importCustomIcon: () => api().attrs.importCustomIcon(),
  filmIconManifest: () => api().attrs.filmIconManifest(),
  listAliases: (valueId: number) => api().attrs.listAliases(valueId),
  addAlias: (valueId: number, alias: string) => api().attrs.addAlias(valueId, alias),
  removeAlias: (aliasId: number) => api().attrs.removeAlias(aliasId),
  importJson: (typeId: number) => api().attrs.importJson(typeId),
}

/** 子库服务 */
export const subLibraryService = {
  list: () => api().sublib.list(),
  create: (name: string, parentId?: number) => api().sublib.create(name, parentId),
  rename: (id: number, name: string) => api().sublib.rename(id, name),
  setDescription: (id: number, desc: string) => api().sublib.setDescription(id, desc),
  delete: (id: number) => api().sublib.delete(id),
  counts: () => api().sublib.counts(),
}

/** 库管理服务 */
export const libraryService = {
  info: () => api().library.info(),
  revealFile: (p: string) => api().library.revealFile(p),
  regenThumb: (id: number) => api().library.regenThumb(id),
  listProfiles: () => api().library.listProfiles(),
  importProfile: () => api().library.importProfile(),
  stats: () => api().library.stats(),
}

/** 地点服务 */
export const locationService = {
  list: () => api().locations.list(),
  add: (name: string, address: string, lat: number, lng: number) => api().locations.add(name, address, lat, lng),
  delete: (id: number) => api().locations.delete(id),
  update: (id: number, name: string, address: string) => api().locations.update(id, name, address),
  photos: (locationId: number) => api().locations.photos(locationId),
  forPhoto: (photoId: number) => api().locations.forPhoto(photoId),
  setForPhotos: (photoIds: number[], locationId: number | null) => api().locations.setForPhotos(photoIds, locationId),
  addToPhoto: (photoId: number, locationId: number) => api().locations.addToPhoto(photoId, locationId),
  removeFromPhoto: (photoId: number, locationId: number) => api().locations.removeFromPhoto(photoId, locationId),
  clearForPhotos: (photoIds: number[]) => api().locations.clearForPhotos(photoIds),
  search: (query: string) => api().locations.search(query),
  reverseGeocode: (lat: number, lng: number) => api().locations.reverseGeocode(lat, lng),
  mapData: () => api().locations.mapData(),
}

/** 胶卷服务 */
export const rollService = {
  list: (params?: Parameters<API['rolls']['list']>[0]) => api().rolls.list(params),
  checkAttrConsistency: (photoIds: number[]) => api().rolls.checkAttrConsistency(photoIds),
  create: (params: Parameters<API['rolls']['create']>[0]) => api().rolls.create(params),
  rename: (id: number, name: string) => api().rolls.rename(id, name),
  delete: (id: number, deletePhotos?: boolean, deleteFiles?: boolean) => api().rolls.delete(id, deletePhotos, deleteFiles),
  batchDelete: (ids: number[], deletePhotos?: boolean, deleteFiles?: boolean) => api().rolls.batchDelete(ids, deletePhotos, deleteFiles),
  batchSetAttributes: (ids: number[], attrs: Parameters<API['rolls']['batchSetAttributes']>[1]) => api().rolls.batchSetAttributes(ids, attrs),
  photos: (rollId: number | null, params: Parameters<API['rolls']['photos']>[1]) => api().rolls.photos(rollId, params),
  forPhoto: (photoId: number) => api().rolls.forPhoto(photoId),
  removePhotos: (rollId: number, photoIds: number[]) => api().rolls.removePhotos(rollId, photoIds),
  addPhotos: (rollId: number, photoIds: number[]) => api().rolls.addPhotos(rollId, photoIds),
  setCover: (rollId: number, photoId: number) => api().rolls.setCover(rollId, photoId),
}

/** 导出服务 */
export const exportService = {
  matchBorder: (photoId: number) => api().export.matchBorder(photoId),
  preview: (photoId: number, config: Parameters<API['export']['preview']>[1]) => api().export.preview(photoId, config),
  render: (photoId: number, config: Parameters<API['export']['render']>[1]) => api().export.render(photoId, config),
  batch: (photoIds: number[], config: Parameters<API['export']['batch']>[1]) => api().export.batch(photoIds, config),
  cancel: () => api().export.cancel(),
  pickDir: () => api().export.pickDir(),
  defaultConfig: () => api().export.defaultConfig(),
  listFonts: () => api().export.listFonts(),
  presets: {
    list: () => api().export.presets.list(),
    save: (name: string, config: Parameters<API['export']['presets']['save']>[1]) => api().export.presets.save(name, config),
    delete: (id: number) => api().export.presets.delete(id),
  },
  onProgress: (cb: Parameters<API['export']['onProgress']>[0]) => api().export.onProgress(cb),
  onDone: (cb: Parameters<API['export']['onDone']>[0]) => api().export.onDone(cb),
}

/** 应用/窗口服务 */
export const appService = {
  setLibraryRoot: (root: string) => api().app.setLibraryRoot(root),
  getLibraryRoot: () => api().app.getLibraryRoot(),
  pickLibraryRoot: () => api().app.pickLibraryRoot(),
  getInitError: () => api().app.getInitError(),
  getVersion: () => api().app.getVersion(),
  getLogContent: (maxLines?: number) => api().app.getLogContent(maxLines),
  getLogPath: () => api().app.getLogPath(),
  revealLog: () => api().app.revealLog(),
  openExternal: (url: string) => api().app.openExternal(url),
  detectImageApps: () => api().app.detectImageApps(),
  openWithApp: (exePath: string, filePaths: string[]) => api().app.openWithApp(exePath, filePaths),
}

export const windowService = {
  minimize: () => api().win.minimize(),
  maximize: () => api().win.maximize(),
  close: () => api().win.close(),
}
