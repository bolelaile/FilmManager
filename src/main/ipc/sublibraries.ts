/**
 * 子库 IPC 适配层（薄 adapter）。转发到 SubLibraryService。
 */
import { ipcMain } from 'electron'
import path from 'path'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { SubLibraryService } from '../features/sublibrary'
import { getLibraryRoot } from './index'

let service: SubLibraryService | null = null
function getService(): SubLibraryService {
  if (!service) {
    const db = getDb()
    service = new SubLibraryService(db, createRepositories(db).subLibraries, path.join(getLibraryRoot(), 'files'))
  }
  return service
}

export function registerSubLibrariesIpc(): void {
  ipcMain.handle('sublib:list', () => getService().tree())
  ipcMain.handle('sublib:create', (_, name: string, parentId?: number) => getService().create(name, parentId))
  ipcMain.handle('sublib:rename', (_, id: number, name: string) => { getService().rename(id, name); return true })
  ipcMain.handle('sublib:setDescription', (_, id: number, description: string) => { getService().setDescription(id, description); return true })
  ipcMain.handle('sublib:delete', (_, id: number) => { getService().delete(id); return true })
  ipcMain.handle('sublib:counts', () => getService().counts())
}
