/**
 * 导入目标子库解析子模块（features/import 内部）。
 * 按自动整理模式（年/年月/相机/胶片/来源文件夹）解析目标子库。
 */
import path from 'path'
import { getDb } from '../../db/index'
import { getOrCreateSubLibrary as getOrCreatePhysicalSubLibrary } from '../../features/library-layout/library-layout'
import type { ImportOptions } from '../../../shared/import-types'

export function resolveTargetSubLibrary(
  options: ImportOptions, sourcePath: string, shotDate: string | null,
  cameraModel: string | null, filesRoot: string
): number | undefined {
  const mode = options.organizeBy ?? 'none'
  if (mode === 'none') return options.subLibraryId
  let pathNames: string[]
  switch (mode) {
    case 'year': pathNames = [shotDate?.slice(0, 4) || '日期未知']; break
    case 'year-month': pathNames = shotDate ? [shotDate.slice(0, 4), shotDate.slice(0, 7)] : ['日期未知']; break
    case 'camera': pathNames = [options.cameraName || cameraModel || '相机未知']; break
    case 'film': pathNames = [options.filmName || '胶片未指定']; break
    case 'source-folder': pathNames = [path.basename(path.dirname(sourcePath)) || '来源未知']; break
  }
  let parentId = options.subLibraryId
  for (const rawName of pathNames) {
    parentId = getOrCreatePhysicalSubLibrary(getDb(), filesRoot, sanitizeSubLibraryName(rawName), parentId)
  }
  return parentId
}

export function sanitizeSubLibraryName(name: string): string {
  // 去除控制字符（0x00-0x1f），截断 100 字符
  return name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 100) || "未命名"
}
