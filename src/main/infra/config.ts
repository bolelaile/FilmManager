/**
 * 库根目录配置（基础设施层）。
 * 封装 {userData}/config.json 读写，从 main/index.ts 抽取。
 * 注：本文件不直接 import electron（app），由调用方注入 app 路径，便于测试。
 */
import fs from 'fs'
import path from 'path'

export interface LibraryConfig {
  libraryRoot: string
}

/** 读取库根配置；无配置返回默认值（默认由调用方提供） */
export function readLibraryConfig(configPath: string, defaultRoot: string): string {
  try {
    if (fs.existsSync(configPath)) {
      const cfg: LibraryConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (cfg.libraryRoot) return cfg.libraryRoot
    }
  } catch {}
  return defaultRoot
}

/** 写入库根配置 */
export function writeLibraryConfig(configPath: string, libraryRoot: string): void {
  fs.writeFileSync(configPath, JSON.stringify({ libraryRoot }, null, 2))
}

/** 构造 config.json 路径（userData 下） */
export function configPathOf(userDataDir: string): string {
  return path.join(userDataDir, 'config.json')
}
