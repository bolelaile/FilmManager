/**
 * 胶卷 IPC 适配层（薄 adapter）。转发到 RollService。
 */
import { ipcMain } from 'electron'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { RollService } from '../features/rolls'

let service: RollService | null = null
function getService(): RollService {
  if (!service) {
    const repos = createRepositories(getDb())
    service = new RollService(repos.rolls, repos.attributes, repos.photos)
  }
  return service
}

export function registerRollsIpc(): void {
  ipcMain.handle('rolls:checkAttrConsistency', (_, photoIds: number[]) => getService().checkAttrConsistency(photoIds))

  ipcMain.handle('rolls:list', (_, rawParams?) => {
    const params = typeof rawParams === 'number' ? { subLibraryId: rawParams } : rawParams ?? {}
    return getService().list(params)
  })

  ipcMain.handle('rolls:create', (_, params: { photoIds: number[]; name?: string; subLibraryId?: number | null }) =>
    getService().create(params)
  )
  ipcMain.handle('rolls:rename', (_, id: number, name: string) => { getService().rename(id, name); return true })
  ipcMain.handle('rolls:delete', (_, id: number, deletePhotos?: boolean, deleteFiles?: boolean) =>
    getService().delete(id, deletePhotos, deleteFiles)
  )
  ipcMain.handle('rolls:batchDelete', (_, ids: number[], deletePhotos?: boolean, deleteFiles?: boolean) =>
    getService().batchDelete(ids, deletePhotos, deleteFiles)
  )
  ipcMain.handle('rolls:batchSetAttributes', (_, rollIds: number[], attrs: { typeId: number; valueId: number }[]) =>
    getService().batchSetAttributes(rollIds, attrs)
  )
  ipcMain.handle('rolls:photos', (_, rollId: number | null, params) => {
    const { page, pageSize, sortBy, sortOrder, ...filter } = params ?? {}
    return getService().photos(rollId, filter, { page: page ?? 1, pageSize: pageSize ?? 80, sortBy, sortOrder })
  })
  ipcMain.handle('rolls:forPhoto', (_, photoId: number) => getService().forPhoto(photoId))
  ipcMain.handle('rolls:removePhotos', (_, rollId: number, photoIds: number[]) => getService().removePhotos(rollId, photoIds))
  ipcMain.handle('rolls:addPhotos', (_, rollId: number, photoIds: number[]) => getService().addPhotos(rollId, photoIds))
  ipcMain.handle('rolls:setCover', (_, rollId: number, photoId: number) => getService().setCover(rollId, photoId))
}
