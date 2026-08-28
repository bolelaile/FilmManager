/**
 * L2 逻辑单测基线（重构前/后回归对照）。
 * 用 esbuild 把被测 TS 模块 bundle 成 CJS，node 断言验证纯逻辑。
 * 用法：node scripts/logic-test.cjs
 */
const { buildSync } = require('esbuild')
const path = require('path')
const fs = require('fs')
const assert = require('assert')

const root = path.resolve(__dirname, '..')
const tmpDir = path.join(root, '.logic-test')
fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

function bundle(entry, outfile) {
  buildSync({
    entryPoints: [path.join(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: path.join(tmpDir, outfile),
    external: ['@napi-rs/canvas', 'sharp', 'electron', 'better-sqlite3', 'electron-log'],
    logLevel: 'silent'
  })
  return require(path.join(tmpDir, outfile))
}

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`) }
  catch (e) { fail++; console.log(`  ✗ ${name}: ${e.message}`) }
}

console.log('=== L2 逻辑单测 ===\n')

// ── 1. stock 品牌匹配 ──
console.log('[stock-presets: resolveStock]')
bundle('src/main/services/export/stock-presets.ts', 'stock.cjs')
const { resolveStock } = require(path.join(tmpDir, 'stock.cjs'))
test('Kodak Portra 400 → C-41 橙', () => {
  const s = resolveStock('Kodak Portra 400 [135 / 35mm]')
  assert.strictEqual(s.edgeText, 'KODAK PORTRA 400')
  assert.strictEqual(s.process, 'C-41')
  assert.ok(s.ink.color.includes('255, 176, 64'), `ink=${s.ink.color}`)
})
test('Ilford HP5 → BW 白', () => {
  const s = resolveStock('Ilford HP5 Plus')
  assert.strictEqual(s.process, 'BW')
  assert.ok(s.ink.color.includes('238, 238, 232'), `ink=${s.ink.color}`)
})
test('Cinestill 800T → ECN-2 米黄', () => {
  const s = resolveStock('Cinestill 800T')
  assert.strictEqual(s.process, 'ECN-2')
  assert.ok(s.ink.color.includes('250, 230, 190'), `ink=${s.ink.color}`)
})
test('Fuji Superia → C-41（彩色负片）', () => {
  const s = resolveStock('Fujifilm Superia 400')
  assert.strictEqual(s.process, 'C-41')
})
test('未知胶卷 → 回退 C-41', () => {
  const s = resolveStock('某未知胶卷')
  assert.strictEqual(s.process, 'C-41')
})
test('null → 回退 C-41 + 默认 edgeText', () => {
  const s = resolveStock(null)
  assert.strictEqual(s.process, 'C-41')
  assert.ok(s.edgeText.length > 0)
})

// ── 2. 内容哈希（computeContentHash 逻辑复刻，避免 bundle 引入 electron） ──
console.log('\n[thumbnail: computeContentHash]')
const { createHash } = require('crypto')
// 复刻 src/main/services/thumbnail.ts 的 computeContentHash 纯逻辑（重构后将抽到 infra）
function computeContentHash(filePath) {
  let fd = null
  try {
    const stat = fs.statSync(filePath)
    const sampleSize = Math.min(65536, stat.size)
    const buffer = Buffer.alloc(sampleSize)
    fd = fs.openSync(filePath, 'r')
    fs.readSync(fd, buffer, 0, sampleSize, 0)
    return createHash('md5').update(String(stat.size)).update(buffer).digest('hex')
  } catch { return null }
  finally { if (fd !== null) try { fs.closeSync(fd) } catch {} }
}
test('同内容同哈希', () => {
  const f1 = path.join(tmpDir, 'a.bin'); const f2 = path.join(tmpDir, 'b.bin')
  fs.writeFileSync(f1, Buffer.alloc(70000, 0x41))
  fs.writeFileSync(f2, Buffer.alloc(70000, 0x41))
  assert.strictEqual(computeContentHash(f1), computeContentHash(f2))
})
test('不同内容不同哈希', () => {
  const f1 = path.join(tmpDir, 'c.bin'); const f2 = path.join(tmpDir, 'd.bin')
  fs.writeFileSync(f1, Buffer.alloc(70000, 0x41))
  fs.writeFileSync(f2, Buffer.alloc(70000, 0x42))
  assert.notStrictEqual(computeContentHash(f1), computeContentHash(f2))
})
test('读取失败返回 null', () => {
  assert.strictEqual(computeContentHash('/nonexistent/path.bin'), null)
})

// ── 3. ensureUniqueFilePath + claimed 竞态 ──
console.log('\n[library-layout: ensureUniqueFilePath]')
bundle('src/main/services/library-layout.ts', 'layout.cjs')
const { ensureUniqueFilePath, pathKey } = require(path.join(tmpDir, 'layout.cjs'))
test('路径不存在时返回原路径', () => {
  const p = path.join(tmpDir, 'nonexistent-' + Date.now() + '.jpg')
  assert.strictEqual(ensureUniqueFilePath(p), p)
})
test('磁盘已存在时追加后缀', () => {
  const base = path.join(tmpDir, 'exists.jpg')
  fs.writeFileSync(base, 'x')
  const r = ensureUniqueFilePath(base)
  assert.ok(r.endsWith('_1.jpg'), `r=${r}`)
})
test('claimed 集合消除并行竞态', () => {
  const dir = path.join(tmpDir, 'race'); fs.mkdirSync(dir, { recursive: true })
  const base = path.join(dir, 'same.jpg')
  const claimed = new Set()
  // 模拟两 worker 同时认领同一路径（磁盘尚不存在）
  const r1 = ensureUniqueFilePath(base, undefined, claimed)
  claimed.add(pathKey(r1))
  const r2 = ensureUniqueFilePath(base, undefined, claimed)
  claimed.add(pathKey(r2))
  // 核心不变量：两个 worker 拿到不同路径，且认领集合无重复
  assert.notStrictEqual(r1, r2, '两个 worker 不应拿到相同路径')
  assert.strictEqual(pathKey(r1) === pathKey(r2), false, '认领路径不重复')
  // 第二个应因 claimed 命中而追加后缀
  assert.ok(r2.endsWith('_1.jpg'), `r2 应追加后缀: ${r2}`)
})

// ── 4. 导出类型映射 ──
console.log('\n[export-types: filmFormatToId]')
bundle('src/shared/export-types.ts', 'etypes.cjs')
const { filmFormatToId, DEFAULT_EXPORT_CONFIG } = require(path.join(tmpDir, 'etypes.cjs'))
test('film_format → formatId 映射', () => {
  assert.strictEqual(filmFormatToId('135 / 35mm'), '135')
  assert.strictEqual(filmFormatToId('半格 / 17.5mm'), 'half')
  assert.strictEqual(filmFormatToId('135 宽幅 / Xpan'), 'xpan')
  assert.strictEqual(filmFormatToId('645 中画幅'), '645')
  assert.strictEqual(filmFormatToId('6x6 中画幅'), '66')
  assert.strictEqual(filmFormatToId('6x7 中画幅'), '67')
  assert.strictEqual(filmFormatToId('6x9 中画幅'), '69')
  assert.strictEqual(filmFormatToId('6x12 中画幅'), '612')
  assert.strictEqual(filmFormatToId('4x5 大画幅'), 'none')
  assert.strictEqual(filmFormatToId(null), '135')
})
test('DEFAULT_EXPORT_CONFIG 字段完整', () => {
  assert.ok(DEFAULT_EXPORT_CONFIG.border.formatId)
  assert.ok(DEFAULT_EXPORT_CONFIG.image.crop === null)
  assert.ok(['jpeg', 'png'].includes(DEFAULT_EXPORT_CONFIG.image.format))
})

console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
process.exit(fail > 0 ? 1 : 0)
