/**
 * 依赖注入装配（应用协调层）。
 * 统一构造 Repository + Service 单例，供 ipc-adapters 获取，替代各 adapter 内的懒构造。
 * 价值：① 装配集中可见；② Service 依赖关系显式；③ 便于测试时替换实现。
 *
 * 现阶段 ipc-adapters 仍保留各自的懒 getService()（渐进兼容）；
 * 本模块提供 getServices() 供后续批次统一切换，并为测试提供装配入口。
 */
import path from 'path'
import { app } from 'electron'
import { getDb } from '../db/index'
import { createRepositories, type Repositories } from '../data'
import { PhotoService } from '../features/photos'
import { ImportService } from '../features/import'
import { RollService } from '../features/rolls'
import { AttributeService } from '../features/attributes'
import { SubLibraryService } from '../features/sublibrary'
import { LocationService } from '../features/locations'
import { LibraryService } from '../features/library'
import { ExportService } from '../features/export'
import { ExternalAppService } from '../features/external-apps'

export interface Services {
  photos: PhotoService
  import: ImportService
  rolls: RollService
  attributes: AttributeService
  sublibrary: SubLibraryService
  locations: LocationService
  library: LibraryService
  export: ExportService
  externalApps: ExternalAppService
  repos: Repositories
}

let services: Services | null = null

/** 装配全部 Service 单例（需在 initDb 之后调用） */
export function getServices(libraryRoot: string, thumbDir: string, profilesDir: string): Services {
  if (services) return services
  const db = getDb()
  const repos = createRepositories(db)
  const filesRoot = path.join(libraryRoot, 'files')

  services = {
    photos: new PhotoService(db, repos.photos, repos.attributes, thumbDir, libraryRoot, profilesDir),
    import: new ImportService(),
    rolls: new RollService(repos.rolls, repos.attributes, repos.photos),
    attributes: new AttributeService(
      repos.attributes,
      path.join(app.getAppPath(), 'resources', 'film-icons'),
      path.join(app.getPath('userData'), 'film-icons')
    ),
    sublibrary: new SubLibraryService(db, repos.subLibraries, filesRoot),
    locations: new LocationService(repos.locations),
    library: new LibraryService(repos.photos, libraryRoot, thumbDir, profilesDir),
    export: new ExportService(repos.exportPresets),
    externalApps: new ExternalAppService(),
    repos
  }
  return services
}

/** 重置（测试用） */
export function resetServices(): void {
  services = null
}
