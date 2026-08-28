/**
 * IPC 总线封装（基础设施层）。
 * 隔离 electron 的 ipcMain.handle/ipcMain.on，使功能核心层不直接依赖 electron。
 * 重构批次 2+ 中 ipc-adapters 将使用本封装注册 handler 与推送事件。
 *
 * 注：本模块仍 import electron（IPC 是 Electron 能力），但提供统一边界，
 * 使功能核心层经此调用而非直接 ipcMain。
 */
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

export type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown | Promise<unknown>

/** 注册 invoke handler */
export function handle(channel: string, handler: IpcHandler): void {
  ipcMain.handle(channel, handler as never)
}

/** 向渲染层推送事件 */
export function send(sender: WebContents, channel: string, data: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, data)
}

/** 注册一次性 handler（覆盖同 channel 旧 handler，用于初始化错误等） */
export function handleOnce(channel: string, handler: IpcHandler): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, handler as never)
}
