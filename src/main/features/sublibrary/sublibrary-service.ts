/**
 * 子库功能核心服务。
 * 封装子库树、计数、CRUD。磁盘目录树同步委托 library-layout（features/library-layout）。
 * 依赖 SubLibraryRepository + db（library-layout 函数需 db），不直接 electron。
 */
import type Database from 'better-sqlite3'
import type { SubLibraryRepository, SubLibNode } from '../../data/repositories/sublibrary-repository'
import { createSubLibrary, renameSubLibrary, deleteSubLibrary } from '../../services/library-layout'

export class SubLibraryService {
  constructor(
    private db: Database.Database,
    private repo: SubLibraryRepository,
    private filesRoot: string
  ) {}

  tree(): SubLibNode[] { return this.repo.tree() }

  counts(): Record<string, number> { return this.repo.counts() }

  /** 新建子库（委托 library-layout 同步磁盘目录，失败回滚） */
  create(name: string, parentId?: number): number {
    return createSubLibrary(this.db, this.filesRoot, name, parentId)
  }

  /** 重命名（委托 library-layout 移动目录树） */
  rename(id: number, name: string): void {
    renameSubLibrary(this.db, this.filesRoot, id, name)
  }

  setDescription(id: number, description: string): void {
    this.repo.setDescription(id, description)
  }

  /** 删除（委托 library-layout：照片移根、子库提升） */
  delete(id: number): void {
    deleteSubLibrary(this.db, this.filesRoot, id)
  }
}
