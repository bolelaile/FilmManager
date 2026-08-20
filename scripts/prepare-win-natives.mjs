#!/usr/bin/env node
/**
 * 为 Windows x64 跨平台编译准备原生模块预构建二进制文件
 *
 * 在 Linux/macOS 上为 Windows 目标下载以下预构建二进制：
 *   - better-sqlite3 (Electron 29 / module ABI v121)
 *   - @img/sharp-win32-x64
 *   - @img/sharp-libvips-win32-x64
 *
 * 用法:
 *   node scripts/prepare-win-natives.mjs
 *   npm run dist:cross   # 自动调用本脚本后执行打包
 */

import { execSync } from 'child_process'
import {
  existsSync, readFileSync, mkdirSync, rmSync,
  openSync, readSync, closeSync, createWriteStream
} from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import { createGunzip } from 'zlib'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Electron 29.x 对应的 better-sqlite3 预构建 ABI 版本号
const ELECTRON_ABI = '121'

// ── 工具 ──────────────────────────────────────────────────────

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })
}

/** 跟随重定向的 https GET，返回响应流 */
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        resolve(httpsGet(res.headers.location))
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}: ${url}`))
        return
      }
      resolve(res)
    }).on('error', reject)
  })
}

/** 下载文件到本地临时路径 */
async function downloadToFile(url, destPath) {
  const dir = dirname(destPath)
  mkdirSync(dir, { recursive: true })
  const res = await httpsGet(url)
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(destPath)
    res.pipe(ws)
    ws.on('finish', resolve)
    ws.on('error', reject)
  })
}

/** 下载并解压 .tar.gz 到目标目录（使用系统 tar 命令） */
async function downloadAndExtract(url, destDir) {
  mkdirSync(destDir, { recursive: true })
  const tmpFile = join(ROOT, '_tmp_native.tar.gz')
  try {
    console.log(`  下载: ${url}`)
    await downloadToFile(url, tmpFile)
    console.log('  解压...')
    execSync(`tar xzf "${tmpFile}" -C "${destDir}"`, { stdio: 'pipe' })
  } finally {
    try { rmSync(tmpFile) } catch {}
  }
}

/** 检查文件是否为 Windows PE 格式（MZ header） */
function isWindowsBinary(filePath) {
  if (!existsSync(filePath)) return false
  try {
    const fd = openSync(filePath, 'r')
    const buf = Buffer.alloc(2)
    readSync(fd, buf, 0, 2, 0)
    closeSync(fd)
    return buf[0] === 0x4d && buf[1] === 0x5a // "MZ"
  } catch {
    return false
  }
}

// ── Step 1: better-sqlite3 Windows 预构建二进制 ──────────────

async function prepareBetterSqlite3() {
  console.log('\n[1/3] 准备 better-sqlite3 Windows 二进制...')

  const pkgJsonPath = join(ROOT, 'node_modules', 'better-sqlite3', 'package.json')
  if (!existsSync(pkgJsonPath)) {
    console.error('  错误: 未找到 better-sqlite3，请先运行 npm install')
    process.exit(1)
  }

  const version = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')).version
  console.log(`  版本: better-sqlite3@${version}`)

  const destDir = join(ROOT, 'node_modules', 'better-sqlite3')
  const buildRelease = join(destDir, 'build', 'Release')
  const nodeFile = join(buildRelease, 'better_sqlite3.node')

  // 已有 Windows 二进制则跳过
  if (isWindowsBinary(nodeFile)) {
    console.log('  ✓ 已有 Windows 二进制，跳过下载')
    return
  }

  // 清理旧 Linux 构建产物
  const buildDir = join(destDir, 'build')
  if (existsSync(buildDir)) {
    rmSync(buildDir, { recursive: true, force: true })
  }
  mkdirSync(buildRelease, { recursive: true })

  const releaseUrl =
    `https://github.com/WiseLibs/better-sqlite3/releases/download/` +
    `v${version}/better-sqlite3-v${version}-electron-v${ELECTRON_ABI}-win32-x64.tar.gz`

  try {
    await downloadAndExtract(releaseUrl, destDir)
  } catch (err) {
    console.error(`\n  下载失败: ${err.message}`)
    console.error(`  手动下载地址:\n  ${releaseUrl}`)
    console.error(`  将压缩包解压到:\n  ${destDir}`)
    process.exit(1)
  }

  if (existsSync(nodeFile)) {
    console.log('  ✓ better-sqlite3 Windows 二进制已就绪')
  } else {
    console.error(`  错误: 解压后未找到 ${nodeFile}`)
    process.exit(1)
  }
}

// ── Step 2: @img/sharp-win32-x64 ────────────────────────────

/** 从 npm registry 获取包的 tarball URL（使用 npm 配置的 registry） */
async function getNpmTarballUrl(pkg, version) {
  // 通过 npm 命令查询，天然支持镜像/代理配置
  try {
    const result = execSync(
      `npm view "${pkg}@${version}" dist.tarball --json 2>/dev/null`,
      { encoding: 'utf-8', cwd: ROOT }
    ).trim()
    return result.replace(/^"|"$/g, '')
  } catch {
    // 回退：手动构造 registry URL
    const registry = execSync('npm config get registry', { encoding: 'utf-8' }).trim()
      .replace(/\/$/, '')
    const encodedPkg = pkg.replace('/', '%2F')
    const metaUrl = `${registry}/${encodedPkg}/${version}`
    const metaRes = await httpsGet(metaUrl)
    const metaData = await new Promise((resolve, reject) => {
      const chunks = []
      metaRes.on('data', (d) => chunks.push(d))
      metaRes.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))) }
        catch (e) { reject(e) }
      })
      metaRes.on('error', reject)
    })
    return metaData?.dist?.tarball
  }
}

/**
 * 直接从 npm registry 下载 tarball 并解压到 node_modules，
 * 绕过 npm 的平台兼容性检查（用于跨平台安装 win32 包）
 */
async function installNpmPkg(pkg, version) {
  const tarballUrl = await getNpmTarballUrl(pkg, version)
  if (!tarballUrl) throw new Error(`未找到 ${pkg}@${version} 的 tarball 地址`)

  // 包名最后一段作为目录名，如 @img/sharp-win32-x64 → node_modules/@img/sharp-win32-x64
  const pkgDir = join(ROOT, 'node_modules', ...pkg.split('/'))
  mkdirSync(pkgDir, { recursive: true })

  const tmpFile = join(ROOT, `_tmp_${pkg.replace(/[@/]/g, '_')}.tgz`)
  try {
    console.log(`  下载: ${tarballUrl}`)
    await downloadToFile(tarballUrl, tmpFile)
    // npm tarball 内文件路径都在 "package/" 前缀下，--strip-components=1 去掉它
    execSync(`tar xzf "${tmpFile}" -C "${pkgDir}" --strip-components=1`, { stdio: 'pipe' })
    console.log(`  ✓ 解压完成: ${pkgDir}`)
  } finally {
    try { rmSync(tmpFile) } catch {}
  }
}

async function prepareSharpWin32() {
  console.log('\n[2/3] 准备 @img/sharp-win32-x64 (sharp Windows 二进制)...')

  const sharpPkgPath = join(ROOT, 'node_modules', 'sharp', 'package.json')
  if (!existsSync(sharpPkgPath)) {
    console.error('  错误: 未找到 sharp，请先运行 npm install')
    process.exit(1)
  }

  const sharpPkg = JSON.parse(readFileSync(sharpPkgPath, 'utf-8'))
  const sharpVersion = sharpPkg.version
  const optDeps = sharpPkg.optionalDependencies || {}

  // 使用 sharp 声明的 libvips Windows 版本，或回退到 Linux 版本号
  const libvipsVersion =
    optDeps['@img/sharp-libvips-win32-x64'] ||
    optDeps['@img/sharp-libvips-linux-x64'] ||
    '1.0.4'

  console.log(`  sharp@${sharpVersion}, sharp-libvips-win32-x64@${libvipsVersion}`)

  const sharpWinNode = join(ROOT, 'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node')
  const libvipsWinPkg = join(ROOT, 'node_modules/@img/sharp-libvips-win32-x64/package.json')

  if (!existsSync(sharpWinNode)) {
    console.log(`  下载 @img/sharp-win32-x64@${sharpVersion} (绕过平台限制)...`)
    await installNpmPkg(`@img/sharp-win32-x64`, sharpVersion)
  }

  if (!existsSync(libvipsWinPkg)) {
    console.log(`  下载 @img/sharp-libvips-win32-x64@${libvipsVersion}...`)
    await installNpmPkg(`@img/sharp-libvips-win32-x64`, libvipsVersion)
  }

  if (existsSync(sharpWinNode)) {
    console.log('  ✓ @img/sharp-win32-x64 已就绪')
  } else {
    console.error('  错误: @img/sharp-win32-x64 安装失败')
    process.exit(1)
  }
}

// ── Step 3: @napi-rs/canvas-win32-x64-msvc ────────────────────

async function prepareNapiCanvasWin32() {
  console.log('\n[3/4] 准备 @napi-rs/canvas-win32-x64-msvc (Canvas Windows 二进制)...')

  const canvasPkgPath = join(ROOT, 'node_modules', '@napi-rs', 'canvas', 'package.json')
  if (!existsSync(canvasPkgPath)) {
    console.error('  错误: 未找到 @napi-rs/canvas，请先运行 npm install')
    process.exit(1)
  }

  const canvasVersion = JSON.parse(readFileSync(canvasPkgPath, 'utf-8')).version
  console.log(`  @napi-rs/canvas@${canvasVersion}`)

  // win32-x64 平台包的 .node 文件
  const winNode = join(ROOT, 'node_modules/@napi-rs/canvas-win32-x64-msvc/napi-v3.win32-x64-msvc.node')
  const winPkgJson = join(ROOT, 'node_modules/@napi-rs/canvas-win32-x64-msvc/package.json')

  if (!existsSync(winPkgJson)) {
    console.log(`  下载 @napi-rs/canvas-win32-x64-msvc@${canvasVersion} (绕过平台限制)...`)
    await installNpmPkg(`@napi-rs/canvas-win32-x64-msvc`, canvasVersion)
  }

  if (existsSync(winPkgJson)) {
    console.log('  ✓ @napi-rs/canvas-win32-x64-msvc 已就绪')
  } else {
    console.error('  错误: @napi-rs/canvas-win32-x64-msvc 安装失败')
    process.exit(1)
  }
}

// ── Step 4: 验证 ─────────────────────────────────────────────

function verify() {
  console.log('\n[4/4] 验证原生模块...')

  const checks = [
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node',
    'node_modules/@img/sharp-libvips-win32-x64/package.json',
    'node_modules/@napi-rs/canvas-win32-x64-msvc/package.json'
  ]

  let allOk = true
  for (const rel of checks) {
    const full = join(ROOT, rel)
    if (existsSync(full)) {
      console.log(`  ✓ ${rel}`)
    } else {
      console.error(`  ✗ 缺失: ${rel}`)
      allOk = false
    }
  }

  if (!allOk) process.exit(1)
  console.log('\n  ✓ 所有 Windows 原生模块已就绪，可执行 electron-builder\n')
}

// ── 入口 ─────────────────────────────────────────────────────

console.log('==================================================')
console.log('  FilmManager - 准备 Windows 跨平台原生模块')
console.log(`  Electron ABI: v${ELECTRON_ABI} (Electron 29.x)`)
console.log('==================================================')

await prepareBetterSqlite3()
await prepareSharpWin32()
await prepareNapiCanvasWin32()
verify()
