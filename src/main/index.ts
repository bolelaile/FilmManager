import { app, BrowserWindow, nativeTheme, ipcMain, protocol, net, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'
import { initDb } from './db/index'
import { initIpc } from './ipc/index'

// 捕获主进程未处理异常，记录日志并弹窗提示（防止无声崩溃）
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception in main process:', err)
  try {
    dialog.showErrorBox('FilmManager 启动错误', `主进程遇到错误：\n\n${err.message}\n\n详细日志请查看：\n${log.transports.file.getFile().path}`)
  } catch {}
  app.exit(1)
})

function getLibraryRoot(): string {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      if (cfg.libraryRoot) return cfg.libraryRoot
    }
  } catch {}
  // 默认：当前用户的图片目录下的 FilmManager 文件夹
  return path.join(app.getPath('pictures'), 'FilmManager')
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#141414',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  nativeTheme.themeSource = 'dark'

  // 内容加载完成后再显示窗口，避免黑屏闪烁
  win.once('ready-to-show', () => {
    win.show()
  })

  // 兜底：最多等待 5 秒后强制显示窗口（防止 ready-to-show 不触发）
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) {
      log.warn('ready-to-show did not fire within 5s, forcing show')
      win.show()
    }
  }, 5000)

  // 渲染进程崩溃时记录日志
  win.webContents.on('render-process-gone', (_event, details) => {
    log.error('Renderer process gone:', details)
  })

  // 按 F12 开发者工具（生产环境调试用）
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win.webContents.toggleDevTools()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff',
    '.bmp': 'image/bmp'
  }
  return map[ext] ?? 'application/octet-stream'
}

app.whenReady().then(() => {
  // localfile:// 协议用于渲染层直接加载磁盘缩略图（避免大量 IPC 传输）
  protocol.handle('localfile', (request) => {
    const filePath = decodeURIComponent(request.url.slice('localfile://'.length))
    return net.fetch(`file://${filePath}`)
  })
  const libraryRoot = getLibraryRoot()
  log.info('Library root:', libraryRoot)

  let initError: string | null = null
  try {
    initDb(libraryRoot)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('initDb failed:', err)
    initError = msg
  }
  try {
    initIpc(libraryRoot)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('initIpc failed:', err)
    if (!initError) initError = msg
  }

  const win = createWindow()

  // 将初始化错误信息传递给渲染层显示
  if (initError) {
    ipcMain.handle('app:getInitError', () => initError)
  } else {
    ipcMain.handle('app:getInitError', () => null)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// 保存库路径配置
ipcMain.handle('app:setLibraryRoot', (_, newRoot: string) => {
  const configPath = path.join(app.getPath('userData'), 'config.json')
  fs.writeFileSync(configPath, JSON.stringify({ libraryRoot: newRoot }, null, 2))
  return true
})

ipcMain.handle('app:getLibraryRoot', () => getLibraryRoot())

ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.handle('win:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.handle('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())
