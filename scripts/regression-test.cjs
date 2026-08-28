/**
 * L2 扩展：导出渲染器回归（填满不变量 + 居中）。
 * 重构后验证 film-frame-renderer 仍正确。
 */
const { createRequire } = require('module')
const pr = createRequire('/root/film-manager/')
const sharp = pr('sharp')
const fs = require('fs')
const { execSync } = require('child_process')

// esbuild bundle renderer
const out = '/tmp/ff-regression.cjs'
execSync('node_modules/.bin/esbuild src/main/features/export/film-frame-renderer.ts --bundle --platform=node --format=cjs --outfile=' + out + ' --external:@napi-rs/canvas --external:sharp --external:electron', { stdio: 'pipe' })
const { renderFilmFrame } = require(out)

const stock = {
  edgeText: 'KODAK PORTRA 400', process: 'C-41',
  ink: { color: 'rgba(255,176,64,0.92)', glow: 'rgba(255,170,60,0.45)' },
  edgePresets: ['135-36', 'C-41', 'DX 5063', 'SAFETY FILM', '135'],
  edgePresets120: ['120', 'C-41', 'SAFETY FILM'],
  frameNumberStyle: 'N/NA', matched: true
}

async function makePhoto(w, h) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 60, g: 110, b: 180 } } }).png().toBuffer()
}

let pass = 0, fail = 0
function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name) }
  catch (e) { fail++; console.log('  ✗ ' + name + ': ' + e.message) }
}

async function checkFill(fmt, crop, label) {
  const photo = await makePhoto(1600, 1067)
  const out = await renderFilmFrame({
    photoBuffer: photo, photoW: 1600, photoH: 1067, formatId: fmt, stock, frameNo: 1,
    crop, background: { type: 'solid', color: '#000' }, longEdge: 1600, outputFormat: 'png'
  })
  fs.writeFileSync('/tmp/reg.png', out)
  const { data, info } = await sharp(out).raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, ch = info.channels
  // 居中检查：垂直中线左右 padding 对称
  const row = Math.floor(H / 2)
  let firstNonBlack = -1, lastNonBlack = -1
  for (let x = 0; x < W; x++) {
    const i = (row * W + x) * ch
    if (!(data[i] < 12 && data[i + 1] < 12 && data[i + 2] < 12)) {
      if (firstNonBlack < 0) firstNonBlack = x
      lastNonBlack = x
    }
  }
  const leftPad = firstNonBlack
  const rightPad = W - 1 - lastNonBlack
  const centered = Math.abs(leftPad - rightPad) <= 2
  // 填满检查：采样区背景黑=0
  let black = 0
  for (let y = Math.floor(H * 0.2); y < H * 0.8; y += 7)
    for (let x = Math.floor(W * 0.2); x < W * 0.8; x += 7) {
      const i = (y * W + x) * ch
      if (data[i] < 10 && data[i + 1] < 10 && data[i + 2] < 10) black++
    }
  console.log(`  ${label}: 左${leftPad} 右${rightPad} 差${leftPad - rightPad} ${centered ? '居中✓' : '偏移✗'} 黑${black} ${black > 3 ? '有残留✗' : '填满✓'}`)
  if (centered) pass++; else fail++
  if (black <= 3) pass++; else fail++
}

;(async () => {
  console.log('=== L2 扩展：导出渲染器回归 ===\n')
  await checkFill('135', null, '135-cover')
  await checkFill('135', { zoom: 2, offsetX: 0, offsetY: 0 }, '135-zoom2-tl')
  await checkFill('135', { zoom: 3, offsetX: 1, offsetY: 1 }, '135-zoom3-br')
  await checkFill('66', { zoom: 2, offsetX: 1, offsetY: 0 }, '66-zoom2')
  await checkFill('half', null, 'half-cover')
  await checkFill('none', null, 'none-cover')
  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`)
  fs.unlinkSync('/tmp/reg.png')
  try { fs.unlinkSync(out) } catch {}
  process.exit(fail > 0 ? 1 : 0)
})().catch(e => { console.log('✗', e.message); process.exit(1) })
