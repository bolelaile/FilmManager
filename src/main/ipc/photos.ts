/**
 * 照片 IPC 适配层（薄 adapter）。转发到 PhotoService。
 * 业务逻辑/SQL 在 features/photos/PhotoService + data/repositories/PhotoRepository。
 */
import { ipcMain } from 'electron'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { PhotoService } from '../features/photos'
import { getThumbDir, getLibraryRoot } from './index'

let service: PhotoService | null = null
function getService(): PhotoService {
  if (!service) {
    const db = getDb()
    const repos = createRepositories(db)
    service = new PhotoService(db, repos.photos, repos.attributes, getThumbDir(), getLibraryRoot())
  }
  return service
}

export function registerPhotosIpc(): void {
  ipcMain.handle('photos:list', (_, params) => getService().list(params))
  ipcMain.handle('photos:filterOptions', () => getService().filterOptions())
  ipcMain.handle('photos:get', (_, id: number) => getService().get(id))
  ipcMain.handle('photos:setAttributes', (_, photoId: number, attrs) => getService().setAttributes(photoId, attrs))
  ipcMain.handle('photos:batchSetAttributes', (_, photoIds: number[], attrs) => getService().batchSetAttributes(photoIds, attrs))
  ipcMain.handle('photos:updateNotes', (_, id: number, notes: string) => getService().updateNotes(id, notes))
  ipcMain.handle('photos:setShotDate', (_, id: number, shotDate: string | null) => getService().setShotDate(id, shotDate))
  ipcMain.handle('photos:batchSetShotDate', (_, ids: number[], shotDate: string | null) => getService().batchSetShotDate(ids, shotDate))
  ipcMain.handle('photos:delete', (_, ids: number[], deleteFile: boolean) => getService().delete(ids, deleteFile))
  ipcMain.handle('photos:fullPreview', (_, filePath: string, iccPath?: string, rotation = 0) => getService().fullPreview(filePath, iccPath, rotation))
  ipcMain.handle('photos:setRotation', (_, photoId: number, rotation: number) => getService().setRotation(photoId, rotation))
  ipcMain.handle('photos:batchRotate', (_, photoIds: number[], delta = 90) => getService().batchRotate(photoIds, delta))
  ipcMain.handle('photos:thumbDataUrl', (_, thumbPath: string) => getService().thumbDataUrl(thumbPath))
  ipcMain.handle('photos:moveToSubLibrary', (_, photoIds: number[], subLibraryId: number | null) => getService().moveToSubLibrary(photoIds, subLibraryId))
  ipcMain.handle('photos:toggleStar', (_, photoId: number) => getService().toggleStar(photoId))
  ipcMain.handle('photos:batchStar', (_, photoIds: number[], starred: boolean) => getService().batchStar(photoIds, starred))
  ipcMain.handle('photos:exif', (_, photoId: number) => getService().exif(photoId))
  ipcMain.handle('photos:timeline', (_, params) => getService().timeline(params))
}
