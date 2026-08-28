/**
 * 数据访问层入口。
 * 提供 Repository 工厂：传入 db 实例，返回各领域 Repository。
 * 功能核心层与 IPC 适配层经此获取 Repository，不直接 getDb()。
 *
 * 注：批次 1 仅建 Repository 实现，暂不切换现有 ipc 调用（渐进式）。
 * 批次 2 抽取功能核心时，bootstrap 装配 Repository 注入各 Service。
 */
import type Database from 'better-sqlite3'
import { PhotoRepository } from './repositories/photo-repository'
import { SubLibraryRepository } from './repositories/sublibrary-repository'
import { AttributeRepository } from './repositories/attribute-repository'
import { RollRepository } from './repositories/roll-repository'
import { LocationRepository } from './repositories/location-repository'
import { ExportPresetRepository } from './repositories/export-preset-repository'
import { ImportQueueRepository } from './repositories/import-queue-repository'

export interface Repositories {
  photos: PhotoRepository
  subLibraries: SubLibraryRepository
  attributes: AttributeRepository
  rolls: RollRepository
  locations: LocationRepository
  exportPresets: ExportPresetRepository
  importQueue: ImportQueueRepository
}

/** 创建全部 Repository（注入同一 db 实例） */
export function createRepositories(db: Database.Database): Repositories {
  return {
    photos: new PhotoRepository(db),
    subLibraries: new SubLibraryRepository(db),
    attributes: new AttributeRepository(db),
    rolls: new RollRepository(db),
    locations: new LocationRepository(db),
    exportPresets: new ExportPresetRepository(db),
    importQueue: new ImportQueueRepository(db)
  }
}

export * from './types'
export * from './repositories'
