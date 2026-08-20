import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Modal, Select, InputNumber, Input, ColorPicker, Radio, Switch, Collapse, Button, Slider, Tooltip, message, Tag } from 'antd'
import { DownloadOutlined, FolderOpenOutlined, SaveOutlined, ReloadOutlined } from '@ant-design/icons'
import { useUIStore } from '../../store'
import type {
  ExportConfig,
  ExportPreset,
  FilmFormatId,
  BackgroundType,
  ExportFormat,
  EdgePosition
} from '../../../../shared/export-types'
import { DEFAULT_EXPORT_CONFIG } from '../../../../shared/export-types'

const FORMAT_OPTIONS: { value: FilmFormatId; label: string }[] = [
  { value: '135', label: '135 全画幅' },
  { value: 'half', label: '135 半格（竖）' },
  { value: 'xpan', label: 'XPan 宽幅' },
  { value: '645', label: '120 · 645' },
  { value: '66', label: '120 · 6×6' },
  { value: '67', label: '120 · 6×7' },
  { value: '69', label: '120 · 6×9' },
  { value: '612', label: '120 · 6×12' },
  { value: 'none', label: '无边框' }
]

const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'jpeg', label: 'JPEG' },
  { value: 'png', label: 'PNG' }
]

const TOKEN_HINT = '{film} {camera} {lens} {format} {date} {iso} {aperture} {shutter} {focal} {frame_no} {roll} {location} {original}'

export default function ExportModal() {
  const { exportOpen, exportPhotoIds, exportLabel, closeExport, setExportProgress } = useUIStore()
  const [config, setConfig] = useState<ExportConfig>(DEFAULT_EXPORT_CONFIG)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [matchInfo, setMatchInfo] = useState<{
    source: string; filmFormat: string | null
    photoWidth: number | null; photoHeight: number | null
    stockLabel: string; stockEdgeText: string
  } | null>(null)
  const [presets, setPresets] = useState<ExportPreset[]>([])
  const [exporting, setExporting] = useState(false)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const configRef = useRef(config)
  configRef.current = config

  const photoId = exportPhotoIds[0]

  useEffect(() => {
    if (!exportOpen) return
    window.api.export.defaultConfig().then((c) => setConfig(c as ExportConfig))
    window.api.export.presets.list().then((p) => setPresets(p as ExportPreset[]))
  }, [exportOpen])

  // 自动匹配画幅 + stock（仅单张首图）
  useEffect(() => {
    if (!exportOpen || !photoId) return
    setMatchInfo(null)
    setPreviewUrl(null)
    window.api.export.matchBorder(photoId).then((r) => {
      const res = r as { formatId: FilmFormatId; filmFormat: string | null; source: string; photoWidth: number | null; photoHeight: number | null; stockLabel: string; stockEdgeText: string }
      setMatchInfo({ source: res.source, filmFormat: res.filmFormat, photoWidth: res.photoWidth, photoHeight: res.photoHeight, stockLabel: res.stockLabel, stockEdgeText: res.stockEdgeText })
      setConfig((c) => ({ ...c, border: { ...c.border, formatId: res.formatId, filmFormatOverride: null } }))
    })
  }, [exportOpen, photoId])

  // 预览防抖 + stale 丢弃
  const previewSeqRef = useRef(0)
  const refreshPreview = useCallback(() => {
    if (!photoId) return
    const seq = ++previewSeqRef.current
    setPreviewLoading(true)
    window.api.export
      .preview(photoId, configRef.current)
      .then((url) => { if (seq === previewSeqRef.current) setPreviewUrl(url as string) })
      .catch(() => { if (seq === previewSeqRef.current) setPreviewUrl(null) })
      .finally(() => { if (seq === previewSeqRef.current) setPreviewLoading(false) })
  }, [photoId])

  useEffect(() => {
    if (!exportOpen || !photoId) return
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(refreshPreview, 280)
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current) }
  }, [config, exportOpen, photoId, refreshPreview])

  const update = (patch: Partial<ExportConfig>) => setConfig((c) => ({ ...c, ...patch }))
  const updateBorder = (patch: Partial<ExportConfig['border']>) => setConfig((c) => ({ ...c, border: { ...c.border, ...patch } }))
  const updateImage = (patch: Partial<ExportConfig['image']>) => setConfig((c) => ({ ...c, image: { ...c.image, ...patch } }))
  const updateBg = (patch: Partial<ExportConfig['background']>) => setConfig((c) => ({ ...c, background: { ...c.background, ...patch } }))
  const updateOut = (patch: Partial<ExportConfig['output']>) => setConfig((c) => ({ ...c, output: { ...c.output, ...patch } }))
  const updateEdge = (patch: Partial<ExportConfig['edgeText']>) => setConfig((c) => ({ ...c, edgeText: { ...c.edgeText, ...patch } }))

  // pan/zoom 裁切（始终 cover 填满）
  const crop = config.image.crop ?? { zoom: 1, offsetX: 0.5, offsetY: 0.5 }
  const setCrop = (patch: Partial<typeof crop>) => setConfig((c) => ({
    ...c, image: { ...c.image, crop: { ...(c.image.crop ?? { zoom: 1, offsetX: 0.5, offsetY: 0.5 }), ...patch } }
  }))
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; imgW: number; imgH: number } | null>(null)
  const onPreviewMouseDown = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    dragRef.current = { startX: e.clientX, startY: e.clientY, baseX: crop.offsetX, baseY: crop.offsetY, imgW: img.clientWidth, imgH: img.clientHeight }
  }
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.startX) / Math.max(1, d.imgW)
      const dy = (e.clientY - d.startY) / Math.max(1, d.imgH)
      setCrop({ offsetX: Math.max(0, Math.min(1, d.baseX - dx)), offsetY: Math.max(0, Math.min(1, d.baseY - dy)) })
    }
    const onUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const noAlpha = config.image.format === 'jpeg'
  const transparentWithNoAlpha = config.background.type === 'transparent' && noAlpha
  const photoAspect = matchInfo?.photoWidth && matchInfo?.photoHeight ? matchInfo.photoWidth / matchInfo.photoHeight : null
  const aspectMismatch = photoAspect != null && matchInfo!.filmFormat != null

  const handleExport = async () => {
    if (transparentWithNoAlpha) {
      message.warning('JPEG 不支持透明背景，请切换为 PNG 或改用纯色/模糊背景')
      return
    }
    if (!config.output.dir) { message.warning('请先选择导出目录'); return }
    if (exportPhotoIds.length === 0) { message.warning('没有可导出的照片'); return }
    if (exportPhotoIds.length === 1) {
      setExporting(true)
      try {
        await window.api.export.render(photoId, config)
        message.success('导出完成')
        closeExport()
      } catch (err) {
        message.error('导出失败：' + (err instanceof Error ? err.message : String(err)))
      } finally { setExporting(false) }
      return
    }
    setExporting(true)
    setExportProgress({ done: 0, total: exportPhotoIds.length, success: 0, failed: 0 })
    const offProg = window.api.export.onProgress((d) => setExportProgress(d))
    const offDone = window.api.export.onDone((d) => {
      offProg(); offDone(); setExporting(false)
      const result = d as { total: number; success: number; failed: number; cancelled: boolean }
      if (result.cancelled) message.info(`已取消：成功 ${result.success} / ${result.total}，失败 ${result.failed}`)
      else if (result.failed === 0) message.success(`导出完成：${result.success} 张`)
      else message.warning(`导出完成：成功 ${result.success}，失败 ${result.failed}`)
      setExportProgress(null)
      if (!result.cancelled) closeExport()
    })
    try { await window.api.export.batch(exportPhotoIds, config) }
    catch (err) {
      offProg(); offDone(); setExporting(false); setExportProgress(null)
      message.error('导出失败：' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const handlePickDir = async () => {
    const dir = await window.api.export.pickDir()
    if (dir) updateOut({ dir: dir as string })
  }
  const handleSavePreset = () => {
    const name = window.prompt('预设名称')
    if (!name) return
    window.api.export.presets.save(name.trim(), config).then(() => {
      message.success('预设已保存')
      window.api.export.presets.list().then((p) => setPresets(p as ExportPreset[]))
    })
  }
  const handleDeletePreset = (id: number, isBuiltin: number) => {
    if (isBuiltin) { message.warning('内置预设不可删除'); return }
    window.api.export.presets.delete(id).then((ok) => {
      if (ok) { message.success('已删除'); window.api.export.presets.list().then((p) => setPresets(p as ExportPreset[])) }
    })
  }

  const matchSourceText = matchInfo
    ? matchInfo.source === 'attr' ? '由「胶片格式属性」自动匹配'
      : matchInfo.source === 'detect' ? '由像素检测自动匹配'
      : '未识别画幅，使用默认 135'
    : '匹配中…'

  const sectionStyle: React.CSSProperties = { marginBottom: 4 }

  return (
    <Modal
      open={exportOpen}
      onCancel={closeExport}
      title={<span><DownloadOutlined /> 导出</span>}
      width={980}
      footer={null}
      styles={{
        content: { background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: 0 },
        header: { background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '0 20px', margin: 0, height: 52, display: 'flex', alignItems: 'center' },
        body: { padding: 0, height: 'calc(100vh - 200px)', minHeight: 560, display: 'flex', overflow: 'hidden' }
      }}
    >
      <div style={{ width: 460, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '14px 18px 20px' }}>
        <div style={{ marginBottom: 10, color: 'var(--text-dim)', fontSize: 12 }}>
          范围：<Tag color="blue" style={{ marginRight: 6 }}>{exportLabel}</Tag>
          共 <b style={{ color: 'var(--text-primary)' }}>{exportPhotoIds.length}</b> 张
        </div>

        <Collapse
          defaultActiveKey={['border', 'image', 'output']}
          ghost
          size="small"
          items={[
            {
              key: 'border',
              label: <SectionLabel>边框</SectionLabel>,
              children: (
                <div style={sectionStyle}>
                  <Row label="匹配">
                    <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{matchSourceText}</span>
                    <Tooltip title="重新自动匹配">
                      <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => {
                        if (photoId) window.api.export.matchBorder(photoId).then((r) => {
                          const res = r as { formatId: FilmFormatId; filmFormat: string | null; source: string; photoWidth: number | null; photoHeight: number | null; stockLabel: string; stockEdgeText: string }
                          setMatchInfo({ source: res.source, filmFormat: res.filmFormat, photoWidth: res.photoWidth, photoHeight: res.photoHeight, stockLabel: res.stockLabel, stockEdgeText: res.stockEdgeText })
                          setConfig((c) => ({ ...c, border: { ...c.border, formatId: res.formatId, filmFormatOverride: null } }))
                        })
                      }} />
                    </Tooltip>
                  </Row>
                  {matchInfo?.stockLabel && (
                    <Row label="胶卷">
                      <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{matchInfo.stockLabel}</span>
                    </Row>
                  )}
                  <Row label="画幅">
                    <Select size="small" style={{ width: '100%' }} value={config.border.formatId}
                      onChange={(v) => updateBorder({ formatId: v })}
                      options={FORMAT_OPTIONS} />
                  </Row>

                  <div style={{ marginTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>边字</span>
                      <Switch size="small" checked={config.edgeText.enabled} onChange={(v) => updateEdge({ enabled: v })} />
                    </div>
                    {config.edgeText.enabled && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-dim)' }}>默认按胶卷品牌自动生成边字内容/墨色（Courier 等宽 + 发光 + 条码）。</div>
                        <Collapse ghost size="small" style={{ marginTop: 4 }}
                          items={[{
                            key: 'adv',
                            label: <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>高级（自定义内容/样式）</span>,
                            children: (
                              <>
                                <Row label="位置">
                                  <Select mode="multiple" size="small" style={{ width: '100%' }}
                                    value={config.edgeText.positions}
                                    onChange={(v) => updateEdge({ positions: v as EdgePosition[] })}
                                    options={[{ value: 'top', label: '顶部' }, { value: 'bottom', label: '底部' }, { value: 'left', label: '左侧' }, { value: 'right', label: '右侧' }]} />
                                </Row>
                                {config.edgeText.positions.includes('top') && (
                                  <Row label="顶内容"><Input size="small" value={config.edgeText.content.top ?? ''} onChange={(e) => updateEdge({ content: { ...config.edgeText.content, top: e.target.value } })} placeholder="留空=自动 brand" /></Row>
                                )}
                                {config.edgeText.positions.includes('bottom') && (
                                  <Row label="底内容"><Input size="small" value={config.edgeText.content.bottom ?? ''} onChange={(e) => updateEdge({ content: { ...config.edgeText.content, bottom: e.target.value } })} placeholder="留空=自动 帧号+条码" /></Row>
                                )}
                                <Row label="字号比"><Slider min={0.4} max={1.2} step={0.02} style={{ flex: 1 }} value={config.edgeText.fontSizeRatio} onChange={(v) => updateEdge({ fontSizeRatio: v })} /></Row>
                                <Row label="不透明度"><Slider min={0.2} max={1} step={0.05} style={{ flex: 1 }} value={config.edgeText.opacity} onChange={(v) => updateEdge({ opacity: v })} /></Row>
                                <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.4 }}>可用 token：{TOKEN_HINT}</div>
                              </>
                            )
                          }]} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: '24px' }}>帧号</span>
                          <InputNumber size="small" min={0} max={99} value={config.frameNo.digits} onChange={(v) => setConfig((c) => ({ ...c, frameNo: { ...c.frameNo, digits: v ?? 2 } }))} addonBefore="位数" style={{ width: 110 }} />
                          <Input size="small" style={{ width: 80 }} value={config.frameNo.prefix} onChange={(e) => setConfig((c) => ({ ...c, frameNo: { ...c.frameNo, prefix: e.target.value } }))} addonBefore="前缀" />
                          <InputNumber size="small" min={1} value={config.frameNo.start} onChange={(v) => setConfig((c) => ({ ...c, frameNo: { ...c.frameNo, start: v ?? 1 } }))} addonBefore="起始" style={{ width: 110 }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            },
            {
              key: 'image',
              label: <SectionLabel>图像</SectionLabel>,
              children: (
                <div style={sectionStyle}>
                  <Row label="格式">
                    <Select size="small" style={{ width: 120 }} value={config.image.format}
                      onChange={(v) => updateImage({ format: v })} options={EXPORT_FORMATS} />
                  </Row>
                  {config.image.format === 'jpeg' && (
                    <Row label="画质"><Slider min={50} max={100} value={config.image.quality} onChange={(v) => updateImage({ quality: v })} style={{ flex: 1 }} /></Row>
                  )}
                  <Row label="长边 px">
                    <InputNumber size="small" min={256} max={16384} style={{ width: 120 }} value={config.image.longEdge ?? undefined}
                      placeholder="原尺寸" onChange={(v) => updateImage({ longEdge: v ?? null, scale: null })} />
                  </Row>
                </div>
              )
            },
            {
              key: 'bg',
              label: <SectionLabel>背景</SectionLabel>,
              children: (
                <div style={sectionStyle}>
                  <Row label="类型">
                    <Radio.Group size="small" value={config.background.type} onChange={(e) => updateBg({ type: e.target.value as BackgroundType })}>
                      <Radio.Button value="transparent" disabled={noAlpha}>透明</Radio.Button>
                      <Radio.Button value="blur">高斯模糊</Radio.Button>
                      <Radio.Button value="solid">纯色</Radio.Button>
                    </Radio.Group>
                  </Row>
                  {transparentWithNoAlpha && (
                    <div style={{ fontSize: 10, color: '#faad14', marginTop: 4 }}>JPEG 不支持透明背景，将自动降级</div>
                  )}
                  {config.background.type === 'solid' && (
                    <Row label="颜色"><ColorPicker size="small" value={config.background.color} onChange={(_, hex) => updateBg({ color: hex })} /></Row>
                  )}
                  {config.background.type === 'blur' && (
                    <>
                      <Row label="模糊强度"><Slider min={2} max={40} style={{ flex: 1 }} value={config.background.blurSigma} onChange={(v) => updateBg({ blurSigma: v })} /></Row>
                      <Row label="填充色"><ColorPicker size="small" value={config.background.color} onChange={(_, hex) => updateBg({ color: hex })} /></Row>
                    </>
                  )}
                  <Row label="留白比"><Slider min={0} max={0.2} step={0.01} style={{ flex: 1 }} value={config.background.paddingRatio} onChange={(v) => updateBg({ paddingRatio: v })} /></Row>
                </div>
              )
            },
            {
              key: 'output',
              label: <SectionLabel>输出</SectionLabel>,
              children: (
                <div style={sectionStyle}>
                  <Row label="预设">
                    <Select size="small" style={{ flex: 1 }} placeholder="选择预设加载"
                      onChange={(id) => {
                        const p = presets.find((x) => x.id === id)
                        if (p) { setConfig(p.config); message.info(`已加载预设：${p.name}`) }
                      }}
                      options={presets.map((p) => ({ value: p.id, label: `${p.name}${p.is_builtin ? ' (内置)' : ''}` }))} />
                    <Button size="small" icon={<SaveOutlined />} onClick={handleSavePreset} />
                  </Row>
                  {presets.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {presets.map((p) => (
                        <Tag key={p.id} closable={!p.is_builtin} onClose={() => handleDeletePreset(p.id, p.is_builtin)}
                          style={{ cursor: 'pointer', fontSize: 11 }} onClick={() => { setConfig(p.config); message.info(`已加载：${p.name}`) }}>
                          {p.name}{p.is_builtin ? '★' : ''}
                        </Tag>
                      ))}
                    </div>
                  )}
                  <Row label="目录">
                    <Input size="small" style={{ flex: 1 }} value={config.output.dir} readOnly placeholder="选择导出目录" />
                    <Button size="small" icon={<FolderOpenOutlined />} onClick={handlePickDir} />
                  </Row>
                  <Row label="命名">
                    <Input size="small" value={config.output.filenameTemplate} onChange={(e) => updateOut({ filenameTemplate: e.target.value })} />
                  </Row>
                  <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>{TOKEN_HINT} {'{index}'} {'{frame_no_padded}'}</div>
                  <Row label="同名">
                    <Radio.Group size="small" value={config.output.overwrite} onChange={(e) => updateOut({ overwrite: e.target.value })}>
                      <Radio.Button value="rename">重命名</Radio.Button>
                      <Radio.Button value="skip">跳过</Radio.Button>
                      <Radio.Button value="overwrite">覆盖</Radio.Button>
                    </Radio.Group>
                  </Row>
                </div>
              )
            }
          ]}
        />
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-base)', padding: 16 }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderRadius: 6,
          background: config.background.type === 'transparent' ? 'repeating-conic-gradient(#2a2a2a 0% 25%, #1f1f1f 0% 50%) 50% / 24px 24px' : 'var(--bg-base)' }}>
          {previewLoading ? (
            <span style={{ color: 'var(--text-dim)' }}>渲染预览中…</span>
          ) : previewUrl ? (
            <img src={previewUrl} alt="预览" draggable={false} onMouseDown={onPreviewMouseDown}
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 4, boxShadow: '0 0 30px rgba(0,0,0,0.6)', cursor: crop.zoom > 1 ? 'grab' : 'default', userSelect: 'none' }} />
          ) : (
            <span style={{ color: 'var(--text-dim)' }}>无预览</span>
          )}
        </div>
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>缩放</span>
          <Slider min={1} max={4} step={0.05} style={{ flex: 1 }} value={crop.zoom} onChange={(v) => setCrop({ zoom: v })} />
          <span style={{ fontSize: 11, color: 'var(--text-dim)', width: 36, textAlign: 'right' }}>{crop.zoom.toFixed(2)}×</span>
          <Button size="small" type="text" onClick={() => setConfig((c) => ({ ...c, image: { ...c.image, crop: null } }))}>重置</Button>
        </div>
        {aspectMismatch && (
          <div style={{ fontSize: 10, color: '#faad14', marginTop: 2 }}>
            照片比例与画幅不符，已裁切填满；可拖动预览图或调缩放调整位置（中央区始终被填满）。
          </div>
        )}
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            {config.image.format.toUpperCase()} · q{config.image.quality}
            {config.image.longEdge ? ` · 长边 ${config.image.longEdge}px` : ' · 原尺寸'}
          </span>
        </div>
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={closeExport}>取消</Button>
          <Button type="primary" icon={<DownloadOutlined />} loading={exporting} onClick={handleExport}>
            导出 {exportPhotoIds.length} 张
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{children}</span>
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 11, width: 64, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  )
}
