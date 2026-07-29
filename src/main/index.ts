import { app, BrowserWindow, nativeTheme, ipcMain, protocol, net, dialog, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import { execSync } from 'child_process'
import { spawn } from 'child_process'
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

// 选择新的图片存储目录（弹文件夹对话框）
ipcMain.handle('app:pickLibraryRoot', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  const result = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory'],
    title: '选择图片存储目录'
  })
  if (result.canceled || !result.filePaths[0]) return null
  return result.filePaths[0]
})

// 获取应用版本
ipcMain.handle('app:getVersion', () => app.getVersion())

// 读取最新 log 内容（最后 N 行）
ipcMain.handle('app:getLogContent', (_, maxLines: number = 200) => {
  try {
    const logPath = log.transports.file.getFile().path
    if (!fs.existsSync(logPath)) return ''
    const content = fs.readFileSync(logPath, 'utf-8')
    const lines = content.split('\n')
    return lines.slice(-maxLines).join('\n')
  } catch {
    return ''
  }
})

// 获取 log 文件路径
ipcMain.handle('app:getLogPath', () => {
  try {
    return log.transports.file.getFile().path
  } catch {
    return ''
  }
})

// 在文件管理器中打开 log 文件所在目录
ipcMain.handle('app:revealLog', () => {
  try {
    const logPath = log.transports.file.getFile().path
    shell.showItemInFolder(logPath)
  } catch {}
})

// 用系统浏览器打开外部 URL（仅允许 https://github.com 开头）
ipcMain.handle('app:openExternal', (_, url: string) => {
  if (url.startsWith('https://github.com/')) shell.openExternal(url)
})

ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize())
ipcMain.handle('win:maximize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender)
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.handle('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close())

// ─── 用其他应用打开 ─────────────────────────────────────────────────────────────

interface DetectedApp {
  name: string
  exePath: string
}

// 在目录（含第一级子目录）中查找目标 exe 文件
function findExeInDir(dir: string, exeNames: string[]): string | null {
  if (!dir) return null
  try {
    if (!fs.existsSync(dir)) return null
    for (const name of exeNames) {
      const p = path.join(dir, name)
      if (fs.existsSync(p)) return p
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const name of exeNames) {
        const p = path.join(dir, entry.name, name)
        if (fs.existsSync(p)) return p
      }
    }
  } catch {}
  return null
}

// 从 DisplayIcon 注册表值（格式如 "C:\path\app.exe,0"）提取 exe 路径
function exeFromDisplayIcon(icon: string): string | null {
  if (!icon) return null
  const clean = icon.trim().replace(/^"(.+)"$/, '$1').replace(/,\s*-?\d+\s*$/, '').trim()
  if (clean.toLowerCase().endsWith('.exe') && fs.existsSync(clean)) return clean
  return null
}

// Windows 注册表 App Paths 查询（作为补充）
function queryRegistryAppPath(exeName: string): string | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execSync(
      `reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}" /ve`,
      { encoding: 'utf8', timeout: 3000, windowsHide: true }
    )
    const m = out.match(/REG_SZ\s+(.+)/)
    if (m) {
      const p = m[1].trim().replace(/^"|"$/g, '')
      if (fs.existsSync(p)) return p
    }
  } catch {}
  return null
}

// 图像处理应用特征表（按关键字匹配优先级排序，越具体越靠前）
const IMAGE_APP_SPECS: Array<{ kw: string; exes: string[] }> = [
  { kw: 'adobe photoshop elements',  exes: ['photoshopelementseditor.exe'] },
  { kw: 'adobe photoshop',           exes: ['photoshop.exe'] },
  { kw: 'adobe lightroom classic',   exes: ['lightroom.exe'] },
  { kw: 'adobe lightroom',           exes: ['lightroom.exe'] },
  { kw: 'adobe bridge',              exes: ['bridge.exe'] },
  { kw: 'gimp',                      exes: ['gimp-2.10.exe','gimp-3.0.exe','gimp-2.99.exe','gimp.exe'] },
  { kw: 'capture one',               exes: ['captureone.exe'] },
  { kw: 'rawtherapee',               exes: ['rawtherapee.exe'] },
  { kw: 'darktable',                 exes: ['darktable.exe'] },
  { kw: 'irfanview',                 exes: ['i_view64.exe','i_view32.exe','i_view.exe'] },
  { kw: 'paint.net',                 exes: ['paintdotnet.exe'] },
  { kw: 'faststone image viewer',    exes: ['fsviewer.exe'] },
  { kw: 'faststone photo resizer',   exes: ['fsresizer.exe'] },
  { kw: 'xnviewmp',                  exes: ['xnviewmp.exe'] },
  { kw: 'xnview',                    exes: ['xnviewmp.exe','xnview.exe'] },
  { kw: 'acdsee ultimate',           exes: [] },
  { kw: 'acdsee photo studio',       exes: [] },
  { kw: 'acdsee',                    exes: [] },
  { kw: 'affinity photo',            exes: ['photo.exe','affinity photo.exe'] },
  { kw: 'polarr photo editor',       exes: ['polarr.exe'] },
  { kw: 'polarr',                    exes: ['polarr.exe'] },
  { kw: '像素蛋糕',                   exes: [] },
  { kw: 'luminar neo',               exes: ['luminar neo.exe'] },
  { kw: 'luminar ai',                exes: ['luminar ai.exe'] },
  { kw: 'on1 photo',                 exes: ['on1photoraw.exe'] },
  { kw: 'dxo photolab',              exes: ['dxo.photolab.exe'] },
  { kw: 'paintshop pro',             exes: ['corel paintshop pro.exe','paintshoppro.exe'] },
  { kw: 'photoscape',                exes: ['photoscape.exe','photoscapex.exe'] },
  { kw: 'cyberlink photodirector',   exes: ['photodirector.exe'] },
  { kw: 'photo director',            exes: ['photodirector.exe'] },
  { kw: 'snapseed',                  exes: ['snapseed.exe'] },
  { kw: 'skylum',                    exes: [] },
]

ipcMain.handle('app:detectImageApps', (): DetectedApp[] => {
  const found: DetectedApp[] = []
  const seenExe = new Set<string>()

  const addApp = (name: string, exePath: string | null) => {
    if (!exePath) return
    const key = exePath.toLowerCase()
    if (seenExe.has(key) || !fs.existsSync(exePath)) return
    seenExe.add(key)
    found.push({ name, exePath })
  }

  if (process.platform === 'win32') {
    // ── 主要策略：PowerShell 读取系统卸载注册表，覆盖所有安装位置 ──────────────────
    let uninstallEntries: Array<{
      DisplayName?: string
      InstallLocation?: string
      DisplayIcon?: string
    }> = []

    try {
      // 写 PS1 脚本到临时文件，避免命令行转义问题
      const tmpPs1 = path.join(app.getPath('temp'), '_fm_detect.ps1')
      const psScript = [
        '$keys = @(',
        "  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
        "  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
        ')',
        '[array]($keys | ForEach-Object {',
        '  try { Get-ItemProperty $_ -ErrorAction SilentlyContinue } catch {}',
        "} | Where-Object { $_.DisplayName -ne $null -and $_.DisplayName -ne '' } |",
        '  Select-Object DisplayName,InstallLocation,DisplayIcon) | ConvertTo-Json -Compress -Depth 1'
      ].join('\r\n')
      fs.writeFileSync(tmpPs1, psScript, 'utf8')

      const raw = execSync(
        `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpPs1}"`,
        { encoding: 'utf8', timeout: 20000, windowsHide: true }
      ).trim()

      try { fs.unlinkSync(tmpPs1) } catch {}

      if (raw && raw !== 'null') {
        const parsed = JSON.parse(raw)
        uninstallEntries = Array.isArray(parsed) ? parsed : [parsed]
      }
    } catch (err) {
      log.warn('detectImageApps: PowerShell registry scan failed:', (err as Error).message)
    }

    // ── 逐条匹配已知图像应用 ────────────────────────────────────────────────────
    for (const entry of uninstallEntries) {
      if (!entry.DisplayName) continue
      const nameLow = entry.DisplayName.toLowerCase()

      for (const spec of IMAGE_APP_SPECS) {
        if (!nameLow.includes(spec.kw)) continue

        let exePath: string | null = null

        // 1. DisplayIcon 中直接含 exe 路径（最可靠）
        if (entry.DisplayIcon) {
          exePath = exeFromDisplayIcon(entry.DisplayIcon)
        }

        // 2. 在 InstallLocation 中按已知 exe 名查找
        if (!exePath && entry.InstallLocation && spec.exes.length > 0) {
          exePath = findExeInDir(entry.InstallLocation, spec.exes)
        }

        // 3. 对没有 exe 名列表的条目，在 InstallLocation 中查找最大 exe
        if (!exePath && entry.InstallLocation) {
          try {
            const dir = entry.InstallLocation
            if (fs.existsSync(dir)) {
              const exeFiles = fs.readdirSync(dir)
                .filter((f) => f.toLowerCase().endsWith('.exe'))
                .map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size }))
                .sort((a, b) => b.size - a.size)
              if (exeFiles.length > 0) exePath = path.join(dir, exeFiles[0].f)
            }
          } catch {}
        }

        if (exePath) {
          addApp(entry.DisplayName, exePath)
          break // 一条注册表条目只加一次
        }
      }
    }

    // ── 补充策略：Windows App Paths 注册表（捕漏网之鱼）──────────────────────────
    const appPathFallbacks: Array<[string, string]> = [
      ['Photoshop.exe',     'Adobe Photoshop'],
      ['lightroom.exe',     'Adobe Lightroom Classic'],
      ['rawtherapee.exe',   'RawTherapee'],
      ['darktable.exe',     'darktable'],
      ['i_view64.exe',      'IrfanView'],
      ['FSViewer.exe',      'FastStone Image Viewer'],
      ['gimp.exe',          'GIMP'],
      ['xnviewmp.exe',      'XnViewMP'],
    ]
    for (const [exe, label] of appPathFallbacks) {
      addApp(label, queryRegistryAppPath(exe))
    }

  } else if (process.platform === 'darwin') {
    // macOS：扫描 /Applications 及用户 Applications
    const appDirs = ['/Applications', path.join(process.env['HOME'] ?? '', 'Applications')]
    const macSpecs: Array<[string, string]> = [
      ['Adobe Photoshop 2025/Adobe Photoshop 2025.app',     'Adobe Photoshop 2025'],
      ['Adobe Photoshop 2024/Adobe Photoshop 2024.app',     'Adobe Photoshop 2024'],
      ['Adobe Lightroom Classic/Adobe Lightroom Classic.app','Adobe Lightroom Classic'],
      ['GIMP-2.10.app',                                     'GIMP'],
      ['GIMP.app',                                          'GIMP'],
      ['Capture One 23.app',                                'Capture One'],
      ['Affinity Photo 2.app',                              'Affinity Photo 2'],
      ['Affinity Photo.app',                                'Affinity Photo'],
      ['Pixelmator Pro.app',                                'Pixelmator Pro'],
      ['RawTherapee.app',                                   'RawTherapee'],
      ['darktable.app',                                     'darktable'],
    ]
    for (const baseDir of appDirs) {
      for (const [rel, label] of macSpecs) {
        const p = path.join(baseDir, rel)
        if (fs.existsSync(p)) addApp(label, p)
      }
    }
  }

  return found
})

// 用指定应用打开多个文件
ipcMain.handle('app:openWithApp', (_, exePath: string, filePaths: string[]) => {
  try {
    if (!exePath || !fs.existsSync(exePath)) return false
    // macOS .app bundle: use 'open -a'
    if (process.platform === 'darwin' && exePath.endsWith('.app')) {
      spawn('open', ['-a', exePath, ...filePaths], { detached: true, stdio: 'ignore' }).unref()
    } else {
      spawn(exePath, filePaths, { detached: true, stdio: 'ignore' }).unref()
    }
    return true
  } catch (err) {
    log.error('openWithApp error:', err)
    return false
  }
})
