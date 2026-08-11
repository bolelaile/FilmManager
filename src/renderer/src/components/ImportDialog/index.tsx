import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Modal, Button, Progress, Select, Space, Divider, DatePicker, Switch, Tooltip,
  Tag, Input, message, Radio
} from 'antd'
import {
  FolderOpenOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  InboxOutlined,
  PlusOutlined,
  EnvironmentOutlined,
  CloseCircleOutlined,
  CalendarOutlined,
  ApartmentOutlined,
  InfoCircleOutlined,
  BlockOutlined,
  EditOutlined,
  LinkOutlined,
  CopyOutlined
} from '@ant-design/icons'
import type {
  SubLibrary, AttributeValue, Location, AttributeType,
  FolderScanResult, RollImportConfig, FolderAttrMatch, AutoOrganizeMode
} from '../../types'
import type { StorageMode } from '../../../../shared/import-types'
import dayjs from 'dayjs'
import LocationPicker from '../LocationPicker'
import { useStore } from '../../store'
import { FilmIconPicker, FilmTag } from '../FilmIcon'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

// ── Roll-mode: per-row editable config ───────────────────────────────────────

interface RowConfig {
  folder: FolderScanResult
  rollName: string
  attrs: Record<number, number | null> // typeId -> valueId
  matchedAliases: Record<number, string | null> // typeId -> alias that triggered match (null = primary name)
  locationId: number | null
  shotDate: string | null
  createRoll: boolean
}

// ── Main component ───────────────────────────────────────────────────────────

export default function ImportDialog({ open, onClose, onSuccess }: ImportDialogProps) {
  const { subLibraries, setImportProgress, attrTypes } = useStore()

  // ── shared state ──
  const [step, setStep] = useState<'select' | 'scan' | 'confirm' | 'importing' | 'done'>('select')
  const [subLibId, setSubLibId] = useState<number | undefined>(undefined)
  const [autoOrganize, setAutoOrganize] = useState(false)
  const [organizeBy, setOrganizeBy] = useState<AutoOrganizeMode>('year-month')
  const [autoCreateEquipment, setAutoCreateEquipment] = useState(true)
  const [storageMode, setStorageMode] = useState<StorageMode>('managed')
  const [progress, setProgress] = useState({ total: 0, imported: 0, skipped: 0 })
  const [rollModeEnabled, setRollModeEnabled] = useState(false)

  // ── single-batch mode state ──
  const [selectedAttrs, setSelectedAttrs] = useState<Record<number, number | null>>({})
  const [filmPickerOpen, setFilmPickerOpen] = useState(false)
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [filmTypeId, setFilmTypeId] = useState<number | null>(null)
  const [typeValues, setTypeValues] = useState<Record<number, AttributeValue[]>>({})
  const [typeSearchTexts, setTypeSearchTexts] = useState<Record<number, string>>({})
  const [isDragging, setIsDragging] = useState(false)
  const [pendingPaths, setPendingPaths] = useState<string[]>([])
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null)
  const [shotDate, setShotDate] = useState<string | null>(null)
  const [createRollEnabled, setCreateRollEnabled] = useState(false)
  const [singleRollName, setSingleRollName] = useState('')

  // ── roll mode state ──
  const [scannedFolders, setScannedFolders] = useState<FolderScanResult[]>([])
  const [rootFileCount, setRootFileCount] = useState(0)
  const [rowConfigs, setRowConfigs] = useState<RowConfig[]>([])
  const [scanning, setScanning] = useState(false)
  // per-row film picker
  const [filmPickerRowIdx, setFilmPickerRowIdx] = useState<number | null>(null)
  // all locations for picker (loaded once)
  const [allLocations, setAllLocations] = useState<Location[]>([])
  const [doneResults, setDoneResults] = useState<{ rollName: string; imported: number; skipped: number }[]>([])

  // refs for progress callbacks
  const shotDateRef = useRef<string | null>(null)
  useEffect(() => { shotDateRef.current = shotDate }, [shotDate])
  const selectedLocationRef = useRef<Location | null>(null)
  useEffect(() => { selectedLocationRef.current = selectedLocation }, [selectedLocation])
  const cleanupRef = useRef<(() => void)[]>([])
  const dragCounter = useRef(0)
  const selectedAttrsRef = useRef(selectedAttrs)
  const createRollEnabledRef = useRef(createRollEnabled)
  const singleRollNameRef = useRef(singleRollName)
  const subLibIdRef = useRef(subLibId)
  useEffect(() => { subLibIdRef.current = subLibId }, [subLibId])
  useEffect(() => { selectedAttrsRef.current = selectedAttrs }, [selectedAttrs])
  useEffect(() => { createRollEnabledRef.current = createRollEnabled }, [createRollEnabled])
  useEffect(() => { singleRollNameRef.current = singleRollName }, [singleRollName])

  // Reset on close
  useEffect(() => {
    if (!open) {
      setStep('select')
      setProgress({ total: 0, imported: 0, skipped: 0 })
      setSelectedAttrs({})
      setAutoOrganize(false)
      setOrganizeBy('year-month')
      setAutoCreateEquipment(true)
      setSelectedLocation(null)
      setShotDate(null)
      setTypeSearchTexts({})
      setPendingPaths([])
      setScannedFolders([])
      setRowConfigs([])
      setDoneResults([])
      setCreateRollEnabled(false)
      setSingleRollName('')
      cleanupRef.current.forEach((fn) => fn())
      cleanupRef.current = []
    }
  }, [open])

  // Load attribute values when dialog opens
  useEffect(() => {
    if (!open || attrTypes.length === 0) return
    const filmType = attrTypes.find((t) => t.key === 'film')
    if (filmType) setFilmTypeId(filmType.id)
    attrTypes.forEach((t) => {
      window.api.attrs.listValues(t.id).then((vals) => {
        const values = vals as AttributeValue[]
        setTypeValues((prev) => ({ ...prev, [t.id]: values }))
        if (t.key === 'film') setFilmValues(values)
      })
    })
    window.api.locations.list().then((locs) => setAllLocations(locs as Location[]))
  }, [attrTypes, open])

  const selectedFilmValueId = filmTypeId ? (selectedAttrs[filmTypeId] ?? null) : null
  const selectedFilmValue = filmValues.find((v) => v.id === selectedFilmValueId) ?? null

  const normalize = (s: string) => s.replace(/[\s\-_.]/g, '').toLowerCase()

  const setupListeners = () => {
    const cleanTotal = window.api.import.onTotal((total) => {
      setProgress((p) => ({ ...p, total }))
      setImportProgress({ total, imported: 0, skipped: 0 })
    })
    const cleanProg = window.api.import.onProgress((data) => {
      setProgress({ total: data.total ?? 0, imported: data.imported, skipped: data.skipped })
      setImportProgress({ total: data.total ?? 0, imported: data.imported, skipped: data.skipped })
    })
    // 阶段一完成后立即通知父级刷新图库（占位卡片出现）
    const cleanReg = window.api.import.onRegistered(() => {
      onSuccess()
    })
    cleanupRef.current = [cleanTotal, cleanProg, cleanReg]
  }

  // ── single-batch import finish ────────────────────────────────────────────
  const applyAttributesAndFinish = async (result: { imported: number; skipped: number; importedIds: number[] }) => {
    cleanupRef.current.forEach((fn) => fn())
    cleanupRef.current = []
    const ids = result.importedIds ?? []

    if (ids.length > 0) {
      const attrPairs = Object.entries(selectedAttrsRef.current)
        .filter(([, valueId]) => valueId !== null)
        .map(([typeId, valueId]) => ({ typeId: Number(typeId), valueId: valueId! }))
      if (attrPairs.length > 0) {
        await window.api.photos.batchSetAttributes(ids, attrPairs).catch(() => {})
      }
    }
    const loc = selectedLocationRef.current
    if (ids.length > 0 && loc) {
      await window.api.locations.setForPhotos(ids, loc.id).catch(() => {})
    }
    const sd = shotDateRef.current
    if (ids.length > 0 && sd) {
      await window.api.photos.batchSetShotDate(ids, sd).catch(() => {})
    }

    // 创建卷（单批次模式）
    let rollResult: { rollName: string; imported: number; skipped: number } | null = null
    if (ids.length > 0 && createRollEnabledRef.current) {
      // 属性一致性检查（警告，不阻断）
      const check = await window.api.rolls.checkAttrConsistency(ids).catch(() => ({ ok: true, warnings: [] })) as { ok: boolean; warnings: string[] }
      if (!check.ok) {
        check.warnings.forEach((w) => message.warning(`建卷提示：${w}`, 6))
      }
      const rollName = singleRollNameRef.current.trim() || undefined
      await window.api.rolls.create({ photoIds: ids, name: rollName, subLibraryId: subLibIdRef.current ?? null }).catch(() => {})
      rollResult = { rollName: rollName || '本次导入', imported: result.imported, skipped: result.skipped }
    }

    if (result.imported > 0 || result.skipped > 0) {
      onSuccess()
      setStep('done')
      setProgress((p) => ({ ...p, imported: result.imported, skipped: result.skipped }))
      if (rollResult) setDoneResults([rollResult])
    } else {
      setStep('select')
    }
    // importProgress 由后台进度条自行清除，不在这里重置
  }

  const handleImport = async () => {
    setStep('importing')
    setProgress({ total: 0, imported: 0, skipped: 0 })
    setImportProgress({ total: 0, imported: 0, skipped: 0 })
    setupListeners()
    const cameraType = attrTypes.find((type) => type.key === 'camera')
    const lensType = attrTypes.find((type) => type.key === 'lens')
    const selectedCameraValue = cameraType
      ? (typeValues[cameraType.id] ?? []).find((value) => value.id === selectedAttrsRef.current[cameraType.id])
      : undefined
    const selectedLensValue = lensType
      ? (typeValues[lensType.id] ?? []).find((value) => value.id === selectedAttrsRef.current[lensType.id])
      : undefined
    const options = {
      subLibraryId: subLibId,
      organizeBy: (autoOrganize ? organizeBy : 'none') as AutoOrganizeMode,
      shotDate: shotDateRef.current,
      filmName: selectedFilmValue?.value ?? null,
      cameraName: selectedCameraValue?.value ?? null,
      lensName: selectedLensValue?.value ?? null,
      autoCreateEquipment,
      storageMode
    }
    if (pendingPaths.length > 0) {
      const result = await window.api.import.importPaths(pendingPaths, options)
      await applyAttributesAndFinish(result)
    } else {
      const result = await window.api.import.selectAndImport(options)
      await applyAttributesAndFinish(result)
    }
  }

  // ── roll-mode: scan ───────────────────────────────────────────────────────
  const handleScanFolders = async () => {
    setScanning(true)
    try {
      const result = await window.api.import.scanFolders() as {
        rootPath: string
        folders: FolderScanResult[]
        rootFileCount: number
        rootMatches: FolderAttrMatch[]
      } | null
      if (!result) { setScanning(false); return }

      setScannedFolders(result.folders)
      setRootFileCount(result.rootFileCount ?? 0)

      // Build initial row configs using merged matches (child + parent) + parsed date
      const configs: RowConfig[] = result.folders.map((folder) => {
        // Merge: child matches take priority, parent fills in gaps for unmatched types
        const seenTypes = new Set(folder.matches.map((m) => m.typeId))
        const merged = [
          ...folder.matches,
          ...folder.parentMatches.filter((m) => !seenTypes.has(m.typeId))
        ]

        const attrMap: Record<number, number | null> = {}
        const aliasMap: Record<number, string | null> = {}
        for (const m of merged) {
          attrMap[m.typeId] = m.valueId
          aliasMap[m.typeId] = m.matchedAlias ?? null
        }

        return {
          folder,
          rollName: folder.inferredRollName || folder.name,
          attrs: attrMap,
          matchedAliases: aliasMap,
          locationId: null,
          shotDate: folder.parsedDate,
          createRoll: true
        }
      })
      setRowConfigs(configs)
      setStep('confirm')
    } finally {
      setScanning(false)
    }
  }

  // ── roll-mode: import ─────────────────────────────────────────────────────
  const handleImportRolls = async () => {
    setStep('importing')
    setProgress({ total: 0, imported: 0, skipped: 0 })
    setImportProgress({ total: 0, imported: 0, skipped: 0 })
    setupListeners()

    const configs: RollImportConfig[] = rowConfigs.map((rc) => ({
      folderPath: rc.folder.folderPath,
      rollName: rc.rollName,
      attrs: Object.entries(rc.attrs)
        .filter(([, vid]) => vid !== null)
        .map(([tid, vid]) => ({ typeId: Number(tid), valueId: vid! })),
      locationId: rc.locationId,
      shotDate: rc.shotDate,
      subLibraryId: subLibId ?? null,
      createRoll: rc.createRoll
    }))

    try {
      const result = await window.api.import.importRolls(configs) as {
        results: { rollName: string; imported: number; skipped: number }[]
        totalImported: number
        totalSkipped: number
      }
      cleanupRef.current.forEach((fn) => fn())
      setDoneResults(result.results)
      setProgress({ total: result.totalImported + result.totalSkipped, imported: result.totalImported, skipped: result.totalSkipped })
      setStep('done')
      onSuccess()
    } catch (err) {
      message.error('导入失败，请重试')
      setStep('confirm')
    }
    setImportProgress(null)
  }

  // ── drag-drop ────────────────────────────────────────────────────────────
  const handleDragEnter = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current++; setIsDragging(true) }
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false) }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); dragCounter.current = 0; setIsDragging(false)
    const paths: string[] = []
    for (const file of Array.from(e.dataTransfer.files)) paths.push((file as any).path)
    if (paths.length > 0) setPendingPaths(paths)
  }, [])

  // ── inline create ─────────────────────────────────────────────────────────
  const handleCreateAndSelect = async (typeId: number, name: string) => {
    if (!name.trim()) return
    const newId = await window.api.attrs.addValue(typeId, name.trim()) as number
    const newVal: AttributeValue = { id: newId, attribute_type_id: typeId, value: name.trim(), is_preset: 0 }
    setTypeValues((prev) => ({ ...prev, [typeId]: [...(prev[typeId] ?? []), newVal] }))
    if (typeId === filmTypeId) setFilmValues((prev) => [...prev, newVal])
    setSelectedAttrs((prev) => ({ ...prev, [typeId]: newId }))
  }

  const flattenSubLibs = (libs: SubLibrary[], depth = 0): { id: number; name: string; depth: number }[] =>
    libs.flatMap((l) => [{ id: l.id, name: l.name, depth }, ...flattenSubLibs(l.children, depth + 1)])

  const subLibOptions = [
    { value: undefined, label: '未分类（根目录）' },
    ...flattenSubLibs(subLibraries).map((l) => ({ value: l.id, label: '　'.repeat(l.depth) + l.name }))
  ]

  const nonFilmTypes = attrTypes.filter((t) => t.key !== 'film')
  const organizeHint: Record<Exclude<AutoOrganizeMode, 'none'>, string> = {
    'year-month': '根据手动日期或 EXIF 拍摄日期创建“年份 / 年月”两级子库。',
    year: '根据手动日期或 EXIF 拍摄日期创建年份子库。',
    camera: '根据 EXIF 相机型号创建子库，无法识别时归入“相机未知”。',
    film: '根据本次选择的胶片创建子库，未选择时归入“胶片未指定”。',
    'source-folder': '根据每张照片原始所在文件夹创建子库。'
  }

  // ── row updaters ──────────────────────────────────────────────────────────
  const updateRow = (idx: number, patch: Partial<RowConfig>) =>
    setRowConfigs((prev) => prev.map((r, i) => i === idx ? { ...r, ...patch } : r))

  // ── render ────────────────────────────────────────────────────────────────

  const modalWidth = step === 'confirm' ? 780 : 500

  return (
    <>
      <Modal
        title={step === 'confirm' ? '确认卷信息' : '导入照片'}
        open={open}
        onCancel={step !== 'importing' ? onClose : undefined}
        footer={null}
        width={modalWidth}
        mask={false}
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
        }}
      >
        {/* ── SELECT step ── */}
        {step === 'select' && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>

            {/* Roll-mode toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 12px', background: rollModeEnabled ? 'rgba(200,131,42,0.08)' : '#111',
              borderRadius: 8, border: `1px solid ${rollModeEnabled ? '#c8832a' : '#222'}`,
              transition: 'all 0.2s'
            }}>
              <div>
                <div style={{ color: rollModeEnabled ? '#c8832a' : '#888', fontSize: 13, fontWeight: 500 }}>
                  <BlockOutlined style={{ marginRight: 6 }} />按子文件夹自动识别为卷
                </div>
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>
                  每个子文件夹识别为一卷，自动匹配胶片/相机/镜头型号，导入前可逐卷确认
                </div>
              </div>
              <Switch
                checked={rollModeEnabled}
                onChange={setRollModeEnabled}
                style={{ marginLeft: 12, flexShrink: 0 }}
              />
            </div>

            {rollModeEnabled ? (
              /* ── roll mode: just a scan button ── */
              <>
                <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>
                  选择一个包含子文件夹的根目录，每个子文件夹将被识别为一卷
                </div>
                <Button
                  type="primary"
                  block
                  size="large"
                  icon={scanning ? <LoadingOutlined /> : <FolderOpenOutlined />}
                  onClick={handleScanFolders}
                  loading={scanning}
                  style={{ background: '#c8832a', borderColor: '#c8832a' }}
                >
                  选择根目录并扫描
                </Button>
                <Divider style={{ borderColor: '#252525', margin: '0' }} />
                <div style={{ color: '#888', fontSize: 12, marginBottom: 4 }}>导入到子库（可选）</div>
                <Select
                  style={{ width: '100%' }}
                  value={subLibId}
                  onChange={setSubLibId}
                  options={subLibOptions as never}
                  placeholder="选择子库..."
                />
              </>
            ) : (
              /* ── single-batch mode ── */
              <>
                {/* 拖放区域 */}
                <div
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${isDragging ? '#c8832a' : pendingPaths.length > 0 ? '#5a8a3a' : '#333'}`,
                    borderRadius: 8, padding: '20px 12px', textAlign: 'center',
                    background: isDragging ? 'rgba(200,131,42,0.08)' : pendingPaths.length > 0 ? 'rgba(90,138,58,0.06)' : '#111',
                    transition: 'all 0.2s', cursor: 'default'
                  }}
                >
                  <InboxOutlined style={{ fontSize: 32, color: isDragging ? '#c8832a' : pendingPaths.length > 0 ? '#6aaa4a' : '#444', marginBottom: 8 }} />
                  {pendingPaths.length > 0 ? (
                    <>
                      <div style={{ color: '#6aaa4a', fontSize: 13 }}>已拖入 {pendingPaths.length} 个文件 / 文件夹</div>
                      <div style={{ color: '#555', fontSize: 11, marginTop: 4, cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setPendingPaths([])}>清除，重新拖入</div>
                    </>
                  ) : (
                    <>
                      <div style={{ color: isDragging ? '#c8832a' : '#666', fontSize: 13 }}>将文件夹或图片拖放至此处</div>
                      <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>支持 JPG、PNG、TIFF、BMP 及主流 RAW 格式</div>
                    </>
                  )}
                </div>

                {/* 胶片类型 */}
                <div>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>胶片类型（可选）</div>
                  <div
                    onClick={() => setFilmPickerOpen(true)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: '#222', border: selectedFilmValue ? '1px solid #c8832a' : '1px solid #333', borderRadius: 6, cursor: 'pointer', transition: 'border-color 0.15s' }}
                  >
                    {selectedFilmValue ? (
                      <>
                        <FilmTag value={selectedFilmValue.value} iconKey={selectedFilmValue.icon_key} iconSize={28} style={{ color: '#e0e0e0', fontSize: 13, flex: 1 }} />
                        <Button size="small" type="text" onClick={(e) => { e.stopPropagation(); if (filmTypeId) setSelectedAttrs((prev) => ({ ...prev, [filmTypeId]: null })) }} style={{ color: '#555', padding: 0, minWidth: 'auto' }}>✕</Button>
                      </>
                    ) : (
                      <span style={{ color: '#555', fontSize: 13 }}>点击选择胶片类型...</span>
                    )}
                  </div>
                </div>

                {/* 其他属性 */}
                {nonFilmTypes.map((type) => {
                  const values = typeValues[type.id] ?? []
                  const selectedId = selectedAttrs[type.id] ?? null
                  const searchText = (typeSearchTexts[type.id] ?? '').trim()
                  const alreadyExists = values.some((v) => normalize(v.value) === normalize(searchText))
                  return (
                    <div key={type.id}>
                      <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>{type.display_name}（可选）</div>
                      <Select
                        showSearch style={{ width: '100%' }}
                        placeholder={`选择或输入${type.display_name}...`}
                        value={selectedId ?? undefined}
                        onChange={(v) => setSelectedAttrs((prev) => ({ ...prev, [type.id]: v ?? null }))}
                        onSearch={(v) => setTypeSearchTexts((prev) => ({ ...prev, [type.id]: v }))}
                        allowClear onClear={() => setSelectedAttrs((prev) => ({ ...prev, [type.id]: null }))}
                        filterOption={(input, option) => normalize(String(option?.label ?? '')).includes(normalize(input))}
                        options={values.map((v) => ({ value: v.id, label: v.value }))}
                        dropdownRender={(menu) => (
                          <>
                            {menu}
                            {searchText && !alreadyExists && (
                              <>
                                <Divider style={{ margin: '4px 0', borderColor: '#333' }} />
                                <div style={{ padding: '6px 8px', cursor: 'pointer', color: '#c8832a', fontSize: 12 }}
                                  onMouseDown={async (e) => { e.preventDefault(); await handleCreateAndSelect(type.id, searchText); setTypeSearchTexts((prev) => ({ ...prev, [type.id]: '' })) }}>
                                  <PlusOutlined /> 新增 "{searchText}"
                                </div>
                              </>
                            )}
                          </>
                        )}
                        styles={{ popup: { root: { background: '#1a1a1a' } } }}
                      />
                    </div>
                  )
                })}

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 }}>
                  <span style={{ color: '#aaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                    自动收录新器材
                    <Tooltip title="EXIF 中识别到的相机或镜头不在器材库时，自动创建对应型号">
                      <InfoCircleOutlined style={{ color: '#666' }} />
                    </Tooltip>
                  </span>
                  <Switch size="small" checked={autoCreateEquipment} onChange={setAutoCreateEquipment} />
                </div>

                <Divider style={{ borderColor: '#252525', margin: '0' }} />

                {/* 拍摄地点 */}
                <div>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>拍摄地点（可选，应用于本次导入所有照片）</div>
                  {selectedLocation ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: '#222', border: '1px solid #c8832a', borderRadius: 6 }}>
                      <EnvironmentOutlined style={{ color: '#c8832a', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#e0e0e0', fontSize: 13 }}>{selectedLocation.name}</div>
                        {selectedLocation.address && <div style={{ color: '#666', fontSize: 11 }}>{selectedLocation.address}</div>}
                      </div>
                      <Button size="small" type="text" icon={<CloseCircleOutlined />} onClick={() => setSelectedLocation(null)} style={{ color: '#555', padding: 0 }} />
                    </div>
                  ) : (
                    <LocationPicker placeholder="搜索拍摄地点..." onSelect={(loc) => setSelectedLocation(loc)} />
                  )}
                </div>

                {/* 拍摄日期 */}
                <div>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                    <CalendarOutlined style={{ marginRight: 4 }} />拍摄日期（可选，批量应用）
                  </div>
                  <DatePicker
                    style={{ width: '100%', background: '#222', borderColor: '#333' }}
                    value={shotDate ? dayjs(shotDate) : null}
                    onChange={(d) => setShotDate(d ? d.format('YYYY-MM-DD') : null)}
                    allowClear
                    placeholder="未设置（优先读取 EXIF）"
                  />
                </div>

                {/* 存储模式 */}
                <div>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>存储方式</div>
                  <Radio.Group
                    value={storageMode}
                    onChange={(e) => setStorageMode(e.target.value)}
                    style={{ width: '100%' }}
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size={6}>
                      <Radio value="managed" style={{ color: '#ccc', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ fontSize: 13 }}><CopyOutlined style={{ marginRight: 5, color: '#c8832a' }} />复制到图库</span>
                          <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>将文件复制到 FilmManager 管理目录，移动原文件不受影响</div>
                        </div>
                      </Radio>
                      <Radio value="linked" style={{ color: '#ccc', alignItems: 'flex-start' }}>
                        <div>
                          <span style={{ fontSize: 13 }}><LinkOutlined style={{ marginRight: 5, color: '#c8832a' }} />建立索引</span>
                          <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>只记录原始路径，不复制文件；移动或删除原文件将导致无法访问</div>
                        </div>
                      </Radio>
                    </Space>
                  </Radio.Group>
                </div>

                {/* 整理位置 */}
                <div>
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                    {storageMode === 'linked' ? '归档到子库（逻辑分组）' : autoOrganize ? '整理到根目录（可选）' : '导入到子库（可选）'}
                  </div>
                  <Select style={{ width: '100%' }} value={subLibId} onChange={setSubLibId} options={subLibOptions as never} placeholder="选择子库..." />
                </div>

                {/* 自动整理 */}
                <div style={{ opacity: storageMode === 'linked' ? 0.4 : 1, pointerEvents: storageMode === 'linked' ? 'none' : 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: '#aaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ApartmentOutlined style={{ color: '#c8832a' }} />
                      自动整理
                    </span>
                    <Switch size="small" checked={autoOrganize} onChange={setAutoOrganize} />
                  </div>
                  {autoOrganize && (
                    <>
                      <Select
                        style={{ width: '100%' }}
                        value={organizeBy}
                        onChange={setOrganizeBy}
                        options={[
                          { value: 'year-month', label: '按拍摄月份' },
                          { value: 'year', label: '按拍摄年份' },
                          { value: 'camera', label: '按相机型号' },
                          { value: 'film', label: '按胶片类型' },
                          { value: 'source-folder', label: '按来源文件夹' }
                        ]}
                      />
                      <div style={{ color: '#666', fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                        {organizeHint[organizeBy as Exclude<AutoOrganizeMode, 'none'>]}
                      </div>
                    </>
                  )}
                </div>

                {/* 建卷开关 */}
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '8px 12px', background: createRollEnabled ? 'rgba(200,131,42,0.08)' : '#111',
                  borderRadius: 8, border: `1px solid ${createRollEnabled ? '#c8832a' : '#222'}`,
                  transition: 'all 0.2s'
                }}>
                  <div>
                    <div style={{ color: createRollEnabled ? '#c8832a' : '#888', fontSize: 13, fontWeight: 500 }}>
                      <BlockOutlined style={{ marginRight: 6 }} />将本次导入组成一个卷
                    </div>
                    <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>
                      导入完成后自动将所有文件归入同一个卷
                    </div>
                  </div>
                  <Switch
                    checked={createRollEnabled}
                    onChange={setCreateRollEnabled}
                    style={{ marginLeft: 12, flexShrink: 0 }}
                  />
                </div>

                {/* 卷名输入（仅在建卷开关打开时显示） */}
                {createRollEnabled && (
                  <div>
                    <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>卷名（可选，留空则自动生成）</div>
                    <Input
                      placeholder="如：2024年夏 · Kodak Portra 400"
                      value={singleRollName}
                      onChange={(e) => setSingleRollName(e.target.value)}
                      style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
                    />
                  </div>
                )}


                <Button type="primary" block size="large" icon={<FolderOpenOutlined />} onClick={handleImport} style={{ background: '#c8832a', borderColor: '#c8832a' }}>
                  {pendingPaths.length > 0 ? `导入已拖入的 ${pendingPaths.length} 个文件` : '选择文件夹并导入'}
                </Button>
              </>
            )}
          </Space>
        )}

        {/* ── CONFIRM step (roll mode) ── */}
        {step === 'confirm' && (
          <div>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 12 }}>
              共扫描到 <span style={{ color: '#c8832a' }}>{scannedFolders.length}</span> 个子文件夹。请确认每卷的信息，可修改卷名、属性等。
              {rootFileCount > 0 && <span style={{ color: '#666', marginLeft: 8 }}>（根目录另有 {rootFileCount} 个散图，不会自动归卷）</span>}
            </div>

            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {rowConfigs.map((rc, idx) => (
                <RollConfirmRow
                  key={rc.folder.folderPath}
                  idx={idx}
                  rc={rc}
                  attrTypes={attrTypes}
                  typeValues={typeValues}
                  filmTypeId={filmTypeId}
                  filmValues={filmValues}
                  allLocations={allLocations}
                  onUpdate={(patch) => updateRow(idx, patch)}
                  onOpenFilmPicker={() => setFilmPickerRowIdx(idx)}
                  onAddValue={async (typeId, name) => {
                    const newId = await window.api.attrs.addValue(typeId, name) as number
                    const newVal: AttributeValue = { id: newId, attribute_type_id: typeId, value: name, is_preset: 0 }
                    setTypeValues((prev) => ({ ...prev, [typeId]: [...(prev[typeId] ?? []), newVal] }))
                    if (typeId === filmTypeId) setFilmValues((prev) => [...prev, newVal])
                    return newId
                  }}
                />
              ))}
            </div>

            <Divider style={{ borderColor: '#252525', margin: '12px 0' }} />

            <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>导入到子库（可选，应用于所有卷）</div>
            <Select style={{ width: '100%', marginBottom: 12 }} value={subLibId} onChange={setSubLibId} options={subLibOptions as never} placeholder="选择子库..." />

            <Space>
              <Button onClick={() => setStep('select')} style={{ background: '#1a1a1a', borderColor: '#333', color: '#888' }}>返回</Button>
              <Button type="primary" icon={<FolderOpenOutlined />} onClick={handleImportRolls} style={{ background: '#c8832a', borderColor: '#c8832a' }}>
                开始导入 ({rowConfigs.reduce((n, r) => n + r.folder.fileCount, 0)} 张照片，{rowConfigs.filter((r) => r.createRoll).length} 卷)
              </Button>
            </Space>
          </div>
        )}

        {/* ── IMPORTING step ── */}
        {step === 'importing' && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <LoadingOutlined style={{ fontSize: 32, color: '#c8832a', marginBottom: 16 }} />
            <div style={{ color: '#ccc', marginBottom: 16 }}>正在导入...</div>
            {progress.total > 0 && (
              <Progress percent={Math.round(((progress.imported + progress.skipped) / progress.total) * 100)} strokeColor="#c8832a" trailColor="#2a2a2a" />
            )}
            <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
              已导入 {progress.imported} 张 · 跳过 {progress.skipped} 张{progress.total > 0 && ` · 共 ${progress.total} 张`}
            </div>
          </div>
        )}

        {/* ── DONE step ── */}
        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 40, color: '#52c41a', marginBottom: 16 }} />
            <div style={{ color: '#ccc', fontSize: 16, marginBottom: 8 }}>导入完成</div>
            <div style={{ color: '#888', marginBottom: doneResults.length > 0 ? 12 : 20 }}>
              成功导入 {progress.imported} 张 · 跳过 {progress.skipped} 张
            </div>
            {doneResults.length > 0 && (
              <div style={{ maxHeight: 160, overflowY: 'auto', textAlign: 'left', marginBottom: 16, background: '#111', borderRadius: 6, padding: '6px 0' }}>
                {doneResults.map((r, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 12px', fontSize: 12, color: '#888' }}>
                    <span style={{ color: '#bbb' }}>{r.rollName}</span>
                    <span>{r.imported} 张</span>
                  </div>
                ))}
              </div>
            )}
            <Space>
              <Button onClick={onClose}>关闭</Button>
              <Button type="primary" onClick={onClose} style={{ background: '#c8832a', borderColor: '#c8832a' }}>查看照片</Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* film picker for single-batch mode */}
      <FilmIconPicker
        open={filmPickerOpen && filmPickerRowIdx === null}
        filmValues={filmValues}
        selectedValueId={selectedFilmValueId}
        onSelect={(id) => { if (filmTypeId) setSelectedAttrs((prev) => ({ ...prev, [filmTypeId]: id })) }}
        onNewValue={(val) => {
          setFilmValues((prev) => [...prev, val])
          if (filmTypeId) {
            setTypeValues((prev) => ({ ...prev, [filmTypeId]: [...(prev[filmTypeId] ?? []), val] }))
            setSelectedAttrs((prev) => ({ ...prev, [filmTypeId]: val.id }))
          }
        }}
        onClose={() => setFilmPickerOpen(false)}
      />

      {/* film picker for roll-confirm mode */}
      {filmPickerRowIdx !== null && (
        <FilmIconPicker
          open
          filmValues={filmValues}
          selectedValueId={filmTypeId ? (rowConfigs[filmPickerRowIdx]?.attrs[filmTypeId] ?? null) : null}
          onSelect={(id) => {
            if (filmTypeId) {
              updateRow(filmPickerRowIdx, {
                attrs: { ...rowConfigs[filmPickerRowIdx].attrs, [filmTypeId]: id },
                matchedAliases: { ...rowConfigs[filmPickerRowIdx].matchedAliases, [filmTypeId]: null }
              })
            }
            setFilmPickerRowIdx(null)
          }}
          onNewValue={(val) => {
            setFilmValues((prev) => [...prev, val])
            if (filmTypeId) {
              setTypeValues((prev) => ({ ...prev, [filmTypeId]: [...(prev[filmTypeId] ?? []), val] }))
              updateRow(filmPickerRowIdx, {
                attrs: { ...rowConfigs[filmPickerRowIdx].attrs, [filmTypeId]: val.id },
                matchedAliases: { ...rowConfigs[filmPickerRowIdx].matchedAliases, [filmTypeId]: null }
              })
            }
            setFilmPickerRowIdx(null)
          }}
          onClose={() => setFilmPickerRowIdx(null)}
        />
      )}
    </>
  )
}

// ── RollConfirmRow ────────────────────────────────────────────────────────────

interface RollConfirmRowProps {
  idx: number
  rc: RowConfig
  attrTypes: AttributeType[]
  typeValues: Record<number, AttributeValue[]>
  filmTypeId: number | null
  filmValues: AttributeValue[]
  allLocations: Location[]
  onUpdate: (patch: Partial<RowConfig>) => void
  onOpenFilmPicker: () => void
  onAddValue: (typeId: number, name: string) => Promise<number>
}

function RollConfirmRow({
  idx, rc, attrTypes, typeValues, filmTypeId, filmValues, allLocations,
  onUpdate, onOpenFilmPicker, onAddValue
}: RollConfirmRowProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(rc.rollName)
  const [locSearch, setLocSearch] = useState('')

  const filmAttrId = filmTypeId
  const selectedFilm = filmAttrId ? filmValues.find((v) => v.id === rc.attrs[filmAttrId]) : null
  const nonFilmTypes = attrTypes.filter((t) => t.key !== 'film' && t.key !== 'imported_at')
  const normalize = (s: string) => s.replace(/[\s\-_.]/g, '').toLowerCase()

  const filteredLocs = allLocations.filter((l) =>
    !locSearch.trim() || normalize(l.name).includes(normalize(locSearch)) || normalize(l.address).includes(normalize(locSearch))
  ).slice(0, 6)

  const selectedLoc = allLocations.find((l) => l.id === rc.locationId)

  // Track which typeIds were inferred from parent vs child folder
  const childTypeIds = new Set(rc.folder.matches.map((m) => m.typeId))
  const parentTypeIds = new Set(rc.folder.parentMatches.map((m) => m.typeId))

  const matchSource = (typeId: number): 'child' | 'parent' | 'none' => {
    if (rc.attrs[typeId] == null) return 'none'
    if (childTypeIds.has(typeId)) return 'child'
    if (parentTypeIds.has(typeId)) return 'parent'
    return 'none'
  }

  const aliasLabel = (typeId: number) => {
    const alias = rc.matchedAliases?.[typeId]
    if (!alias) return null
    return (
      <Tooltip title={`匹配别名："${alias}"`}>
        <span style={{ fontSize: 9, color: '#c8832a', background: 'rgba(200,131,42,0.15)', border: '1px solid rgba(200,131,42,0.4)', borderRadius: 3, padding: '1px 4px', marginLeft: 3, cursor: 'default' }}>~别名</span>
      </Tooltip>
    )
  }

  const sourceLabel = (typeId: number) => {
    const src = matchSource(typeId)
    if (src === 'parent') return <span style={{ fontSize: 9, color: '#6a9a4a', marginLeft: 3 }} title="来自父文件夹名称">↑父</span>
    if (src === 'child') return <span style={{ fontSize: 9, color: '#4a7acc', marginLeft: 3 }} title="来自子文件夹名称">↓子</span>
    return null
  }

  return (
    <div style={{ padding: '10px 12px', marginBottom: 8, background: '#111', borderRadius: 8, border: `1px solid ${rc.createRoll ? '#2a2a2a' : '#1a1a1a'}` }}>
      {/* Row header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Switch
          size="small"
          checked={rc.createRoll}
          onChange={(v) => onUpdate({ createRoll: v })}
        />
        <span style={{ color: '#666', fontSize: 11 }}>建卷</span>
        <span style={{ color: '#555', fontSize: 11, marginLeft: 4 }}>
          📁 {rc.folder.name}
          <span style={{ color: '#444', marginLeft: 6 }}>({rc.folder.fileCount} 张)</span>
        </span>
        {/* Parsed date hint badge */}
        {rc.folder.parsedDate && (
          <span style={{ fontSize: 10, color: '#888', background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 3, padding: '1px 5px' }}>
            📅 {rc.folder.parsedDate}
          </span>
        )}
        <div style={{ flex: 1 }} />
      </div>

      {/* Roll name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <span style={{ color: '#666', fontSize: 11, flexShrink: 0 }}>卷名</span>
        {editingName ? (
          <Input
            size="small"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { onUpdate({ rollName: nameDraft }); setEditingName(false) }}
            onPressEnter={() => { onUpdate({ rollName: nameDraft }); setEditingName(false) }}
            style={{ flex: 1, background: '#222', borderColor: '#c8832a', color: '#ccc', fontSize: 12 }}
          />
        ) : (
          <span
            style={{ color: '#ccc', fontSize: 12, flex: 1, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            onClick={() => { setNameDraft(rc.rollName); setEditingName(true) }}
          >
            {rc.rollName}
            <EditOutlined style={{ marginLeft: 6, color: '#444', fontSize: 10 }} />
          </span>
        )}
      </div>

      {/* Attributes row */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {/* Film picker */}
        <Tooltip title={selectedFilm ? '更换胶片类型' : '选择胶片类型'}>
          <div
            onClick={onOpenFilmPicker}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px',
              background: '#1e1e1e', border: `1px solid ${selectedFilm ? '#c8832a' : '#2a2a2a'}`,
              borderRadius: 4, cursor: 'pointer', fontSize: 11
            }}
          >
            {selectedFilm ? (
              <>
                <FilmTag value={selectedFilm.value} iconKey={selectedFilm.icon_key} iconSize={16} style={{ color: '#ccc', fontSize: 11 }} />
                {filmTypeId && aliasLabel(filmTypeId)}
                {filmTypeId && sourceLabel(filmTypeId)}
              </>
            ) : (
              <span style={{ color: '#555' }}>+ 胶片</span>
            )}
          </div>
        </Tooltip>

        {/* Other attr selects (compact) */}
        {nonFilmTypes.map((type) => {
          const vals = typeValues[type.id] ?? []
          const selectedId = rc.attrs[type.id] ?? null
          return (
            <div key={type.id} style={{ display: 'flex', alignItems: 'center' }}>
              <Select
                size="small"
                showSearch
                style={{ minWidth: 100 }}
                placeholder={type.display_name}
                value={selectedId ?? undefined}
                onChange={(v) => onUpdate({
                  attrs: { ...rc.attrs, [type.id]: v ?? null },
                  matchedAliases: { ...rc.matchedAliases, [type.id]: null }
                })}
                allowClear
                onClear={() => onUpdate({
                  attrs: { ...rc.attrs, [type.id]: null },
                  matchedAliases: { ...rc.matchedAliases, [type.id]: null }
                })}
                filterOption={(input, option) => normalize(String(option?.label ?? '')).includes(normalize(input))}
                options={vals.map((v) => ({ value: v.id, label: v.value }))}
                styles={{ popup: { root: { background: '#1a1a1a' } } }}
                popupMatchSelectWidth={false}
              />
              {aliasLabel(type.id)}
              {sourceLabel(type.id)}
            </div>
          )
        })}

        {/* Location */}
        {selectedLoc ? (
          <Tag
            closable
            onClose={() => onUpdate({ locationId: null })}
            style={{ background: '#1e1e1e', borderColor: '#c8832a', color: '#c8832a', fontSize: 11 }}
          >
            📍{selectedLoc.name}
          </Tag>
        ) : (
          <Select
            size="small"
            showSearch
            style={{ minWidth: 90 }}
            placeholder="📍地点"
            value={undefined}
            onSearch={setLocSearch}
            filterOption={false}
            onChange={(v) => onUpdate({ locationId: v ?? null })}
            options={filteredLocs.map((l) => ({ value: l.id, label: l.name }))}
            styles={{ popup: { root: { background: '#1a1a1a' } } }}
            popupMatchSelectWidth={false}
          />
        )}

        {/* Shot date */}
        <DatePicker
          size="small"
          placeholder="拍摄日期"
          value={rc.shotDate ? dayjs(rc.shotDate) : null}
          onChange={(d) => onUpdate({ shotDate: d ? d.format('YYYY-MM-DD') : null })}
          allowClear
          style={{ background: '#1e1e1e', borderColor: '#2a2a2a', width: 120 }}
        />
      </div>
    </div>
  )
}
