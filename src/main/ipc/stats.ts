/**
 * 统计 IPC 适配层。转发到 StatsService。
 */
import { ipcMain } from 'electron'
import { getDb } from '../db/index'
import { createRepositories } from '../data'
import { StatsService } from '../features/stats'
import { getLibraryRoot } from './index'

let service: StatsService | null = null
function getService(): StatsService {
  if (!service) {
    const db = getDb()
    const repos = createRepositories(db)
    service = new StatsService(repos.photos, repos.attributes, repos.locations, repos.rolls, getLibraryRoot())
  }
  return service
}

export function registerStatsIpc(): void {
  ipcMain.handle('stats:dashboard', () => getService().dashboard())
}
