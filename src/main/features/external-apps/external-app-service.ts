/**
 * 外部图像软件联动功能核心服务。
 * 检测本机已安装图像处理软件（Windows 注册表 / macOS /Applications）+ 启动并传入文件。
 * 从 main/index.ts 抽取，隔离平台检测逻辑便于维护与扩展。
 */
import fs from 'fs'
import path from 'path'
import { execSync, spawn } from 'child_process'
import log from 'electron-log'

export interface DetectedApp { name: string; exePath: string }

/** 图像处理应用特征表（按关键字匹配优先级排序） */
const IMAGE_APP_SPECS: Array<{ kw: string; exes: string[] }> = [
  { kw: 'adobe photoshop elements', exes: ['photoshopelementseditor.exe'] },
  { kw: 'adobe photoshop', exes: ['photoshop.exe'] },
  { kw: 'adobe lightroom classic', exes: ['lightroom.exe'] },
  { kw: 'adobe lightroom', exes: ['lightroom.exe'] },
  { kw: 'adobe bridge', exes: ['bridge.exe'] },
  { kw: 'gimp', exes: ['gimp-2.10.exe', 'gimp-3.0.exe', 'gimp-2.99.exe', 'gimp.exe'] },
  { kw: 'capture one', exes: ['captureone.exe'] },
  { kw: 'rawtherapee', exes: ['rawtherapee.exe'] },
  { kw: 'darktable', exes: ['darktable.exe'] },
  { kw: 'irfanview', exes: ['i_view64.exe', 'i_view32.exe', 'i_view.exe'] },
  { kw: 'paint.net', exes: ['paintdotnet.exe'] },
  { kw: 'faststone image viewer', exes: ['fsviewer.exe'] },
  { kw: 'faststone photo resizer', exes: ['fsresizer.exe'] },
  { kw: 'xnviewmp', exes: ['xnviewmp.exe'] },
  { kw: 'xnview', exes: ['xnviewmp.exe', 'xnview.exe'] },
  { kw: 'acdsee ultimate', exes: [] },
  { kw: 'acdsee photo studio', exes: [] },
  { kw: 'acdsee', exes: [] },
  { kw: 'affinity photo', exes: ['photo.exe', 'affinity photo.exe'] },
  { kw: 'polarr photo editor', exes: ['polarr.exe'] },
  { kw: 'polarr', exes: ['polarr.exe'] },
  { kw: '像素蛋糕', exes: [] },
  { kw: 'luminar neo', exes: ['luminar neo.exe'] },
  { kw: 'luminar ai', exes: ['luminar ai.exe'] },
  { kw: 'on1 photo', exes: ['on1photoraw.exe'] },
  { kw: 'dxo photolab', exes: ['dxo.photolab.exe'] },
  { kw: 'paintshop pro', exes: ['corel paintshop pro.exe', 'paintshoppro.exe'] },
  { kw: 'photoscape', exes: ['photoscape.exe', 'photoscapex.exe'] },
  { kw: 'cyberlink photodirector', exes: ['photodirector.exe'] },
  { kw: 'photo director', exes: ['photodirector.exe'] },
  { kw: 'snapseed', exes: ['snapseed.exe'] },
  { kw: 'skylum', exes: [] }
]

function findExeInDir(dir: string, exeNames: string[]): string | null {
  if (!dir) return null
  try {
    if (!fs.existsSync(dir)) return null
    for (const name of exeNames) { const p = path.join(dir, name); if (fs.existsSync(p)) return p }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      for (const name of exeNames) { const p = path.join(dir, entry.name, name); if (fs.existsSync(p)) return p }
    }
  } catch {}
  return null
}

function exeFromDisplayIcon(icon: string): string | null {
  if (!icon) return null
  const clean = icon.trim().replace(/^"(.+)"$/, '$1').replace(/,\s*-?\d+\s*$/, '').trim()
  if (clean.toLowerCase().endsWith('.exe') && fs.existsSync(clean)) return clean
  return null
}

function queryRegistryAppPath(exeName: string): string | null {
  if (process.platform !== 'win32') return null
  try {
    const out = execSync(`reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exeName}" /ve`, { encoding: 'utf8', timeout: 3000, windowsHide: true })
    const m = out.match(/REG_SZ\s+(.+)/)
    if (m) { const p = m[1].trim().replace(/^"|"$/g, ''); if (fs.existsSync(p)) return p }
  } catch {}
  return null
}

export class ExternalAppService {
  /** 检测本机已安装图像处理软件 */
  detect(tempDir: string): DetectedApp[] {
    const found: DetectedApp[] = []
    const seenExe = new Set<string>()
    const addApp = (name: string, exePath: string | null) => {
      if (!exePath) return
      const key = exePath.toLowerCase()
      if (seenExe.has(key) || !fs.existsSync(exePath)) return
      seenExe.add(key); found.push({ name, exePath })
    }

    if (process.platform === 'win32') {
      let uninstallEntries: Array<{ DisplayName?: string; InstallLocation?: string; DisplayIcon?: string }> = []
      try {
        const tmpPs1 = path.join(tempDir, '_fm_detect.ps1')
        const psScript = [
          '$keys = @(',
          "  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
          "  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
          "  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
          ')',
          '[array]($keys | ForEach-Object { try { Get-ItemProperty $_ -ErrorAction SilentlyContinue } catch {} } | Where-Object { $_.DisplayName -ne $null -and $_.DisplayName -ne \'\' } | Select-Object DisplayName,InstallLocation,DisplayIcon) | ConvertTo-Json -Compress -Depth 1'
        ].join('\r\n')
        fs.writeFileSync(tmpPs1, psScript, 'utf8')
        const raw = execSync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${tmpPs1}"`, { encoding: 'utf8', timeout: 20000, windowsHide: true }).trim()
        try { fs.unlinkSync(tmpPs1) } catch {}
        if (raw && raw !== 'null') { const parsed = JSON.parse(raw); uninstallEntries = Array.isArray(parsed) ? parsed : [parsed] }
      } catch (err) { log.warn('detectImageApps: PowerShell registry scan failed:', (err as Error).message) }

      for (const entry of uninstallEntries) {
        if (!entry.DisplayName) continue
        const nameLow = entry.DisplayName.toLowerCase()
        for (const spec of IMAGE_APP_SPECS) {
          if (!nameLow.includes(spec.kw)) continue
          let exePath: string | null = null
          if (entry.DisplayIcon) exePath = exeFromDisplayIcon(entry.DisplayIcon)
          if (!exePath && entry.InstallLocation && spec.exes.length > 0) exePath = findExeInDir(entry.InstallLocation, spec.exes)
          if (!exePath && entry.InstallLocation) {
            try {
              const dir = entry.InstallLocation
              if (fs.existsSync(dir)) {
                const exeFiles = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.exe')).map((f) => ({ f, size: fs.statSync(path.join(dir, f)).size })).sort((a, b) => b.size - a.size)
                if (exeFiles.length > 0) exePath = path.join(dir, exeFiles[0].f)
              }
            } catch {}
          }
          if (exePath) { addApp(entry.DisplayName, exePath); break }
        }
      }
      const appPathFallbacks: Array<[string, string]> = [
        ['Photoshop.exe', 'Adobe Photoshop'], ['lightroom.exe', 'Adobe Lightroom Classic'],
        ['rawtherapee.exe', 'RawTherapee'], ['darktable.exe', 'darktable'],
        ['i_view64.exe', 'IrfanView'], ['FSViewer.exe', 'FastStone Image Viewer'],
        ['gimp.exe', 'GIMP'], ['xnviewmp.exe', 'XnViewMP']
      ]
      for (const [exe, label] of appPathFallbacks) addApp(label, queryRegistryAppPath(exe))
    } else if (process.platform === 'darwin') {
      const appDirs = ['/Applications', path.join(process.env['HOME'] ?? '', 'Applications')]
      const macSpecs: Array<[string, string]> = [
        ['Adobe Photoshop 2025/Adobe Photoshop 2025.app', 'Adobe Photoshop 2025'],
        ['Adobe Photoshop 2024/Adobe Photoshop 2024.app', 'Adobe Photoshop 2024'],
        ['Adobe Lightroom Classic/Adobe Lightroom Classic.app', 'Adobe Lightroom Classic'],
        ['GIMP-2.10.app', 'GIMP'], ['GIMP.app', 'GIMP'],
        ['Capture One 23.app', 'Capture One'],
        ['Affinity Photo 2.app', 'Affinity Photo 2'], ['Affinity Photo.app', 'Affinity Photo'],
        ['Pixelmator Pro.app', 'Pixelmator Pro'],
        ['RawTherapee.app', 'RawTherapee'], ['darktable.app', 'darktable']
      ]
      for (const baseDir of appDirs) for (const [rel, label] of macSpecs) { const p = path.join(baseDir, rel); if (fs.existsSync(p)) addApp(label, p) }
    }
    return found
  }

  /** 用指定应用打开多个文件 */
  openWithApp(exePath: string, filePaths: string[]): boolean {
    try {
      if (!exePath || !fs.existsSync(exePath)) return false
      if (process.platform === 'darwin' && exePath.endsWith('.app')) {
        spawn('open', ['-a', exePath, ...filePaths], { detached: true, stdio: 'ignore' }).unref()
      } else {
        spawn(exePath, filePaths, { detached: true, stdio: 'ignore' }).unref()
      }
      return true
    } catch (err) { log.error('openWithApp error:', err); return false }
  }
}
