/**
 * 地点 IPC 适配层（薄 adapter）。
 * 仅注册 IPC + 参数转换 + 转发到 LocationService，无业务逻辑/SQL。
 * 业务逻辑在 features/locations/LocationService，数据访问在 data/repositories/LocationRepository。
 */
import { ipcMain } from 'electron'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { LocationService } from '../features/locations'

// 懒构造 Service（批次5 bootstrap 统一装配前，保持各 adapter 自给自足）
let service: LocationService | null = null
function getService(): LocationService {
  if (!service) service = new LocationService(createRepositories(getDb()).locations)
  return service
}

export function registerLocationsIpc(): void {
  ipcMain.handle('locations:list', () => getService().list())

  ipcMain.handle('locations:add', (_, name: string, address: string, lat: number, lng: number) =>
    getService().add(name, address, lat, lng)
  )

  ipcMain.handle('locations:delete', (_, id: number) => { getService().delete(id); return true })

  ipcMain.handle('locations:update', (_, id: number, name: string, address: string) => {
    getService().update(id, name, address); return true
  })

  ipcMain.handle('locations:photos', (_, locationId: number) => getService().photosOf(locationId))

  ipcMain.handle('locations:forPhoto', (_, photoId: number) => getService().forPhoto(photoId))

  ipcMain.handle('locations:setForPhotos', (_, photoIds: number[], locationId: number | null) =>
    getService().setForPhotos(photoIds, locationId)
  )

  ipcMain.handle('locations:clearForPhotos', (_, photoIds: number[]) => getService().clearForPhotos(photoIds))

  ipcMain.handle('locations:addToPhoto', (_, photoId: number, locationId: number) => {
    getService().addToPhoto(photoId, locationId); return true
  })

  ipcMain.handle('locations:removeFromPhoto', (_, photoId: number, locationId: number) => {
    getService().removeFromPhoto(photoId, locationId); return true
  })

  ipcMain.handle('locations:search', (_, query: string) => getService().search(query))

  ipcMain.handle('locations:reverseGeocode', (_, lat: number, lng: number) => getService().reverseGeocode(lat, lng))

  ipcMain.handle('locations:mapData', () => getService().mapData())
}
