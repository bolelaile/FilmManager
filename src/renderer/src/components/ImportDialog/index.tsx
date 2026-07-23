import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Modal, Button, Progress, Select, Space, Divider, DatePicker } from 'antd'
import {
  FolderOpenOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  InboxOutlined,
  PlusOutlined,
  EnvironmentOutlined,
  CloseCircleOutlined,
  CalendarOutlined
} from '@ant-design/icons'
import type { SubLibrary, AttributeValue, Location } from '../../types'
import dayjs from 'dayjs'
import LocationPicker from '../LocationPicker'
import { useStore } from '../../store'
import { FilmIconPicker, FilmTag } from '../FilmIcon'

interface ImportDialogProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function ImportDialog({ open, onClose, onSuccess }: ImportDialogProps) {
  const { subLibraries, setImportProgress, attrTypes } = useStore()
  const [step, setStep] = useState<'select' | 'importing' | 'done'>('select')
  const [subLibId, setSubLibId] = useState<number | undefined>(undefined)
  const [progress, setProgress] = useState({ total: 0, imported: 0, skipped: 0 })
  // typeId -> selected valueId (null = not set)
  const [selectedAttrs, setSelectedAttrs] = useState<Record<number, number | null>>({})
  const [filmPickerOpen, setFilmPickerOpen] = useState(false)
  const [filmValues, setFilmValues] = useState<AttributeValue[]>([])
  const [filmTypeId, setFilmTypeId] = useState<number | null>(null)
  // per-type local values loaded from API
  const [typeValues, setTypeValues] = useState<Record<number, AttributeValue[]>>({})
  // per-type current search text (for inline create)
  const [typeSearchTexts, setTypeSearchTexts] = useState<Record<number, string>>({})
  const [isDragging, setIsDragging] = useState(false)
  const [pendingPaths, setPendingPaths] = useState<string[]>([])
  const [importedIds, setImportedIds] = useState<number[]>([])
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null)
  const [shotDate, setShotDate] = useState<string | null>(null)
  const shotDateRef = useRef<string | null>(null)
  useEffect(() => { shotDateRef.current = shotDate }, [shotDate])
  const selectedLocationRef = useRef<Location | null>(null)
  useEffect(() => { selectedLocationRef.current = selectedLocation }, [selectedLocation])
  const cleanupRef = useRef<(() => void)[]>([])
  const dragCounter = useRef(0)
  // keep latest values in refs so drop handler always sees current state
  const subLibIdRef = useRef(subLibId)
  const selectedAttrsRef = useRef(selectedAttrs)
  useEffect(() => { subLibIdRef.current = subLibId }, [subLibId])
  useEffect(() => { selectedAttrsRef.current = selectedAttrs }, [selectedAttrs])

  useEffect(() => {
    if (!open) {
      setStep('select')
      setProgress({ total: 0, imported: 0, skipped: 0 })
      setSelectedAttrs({})
      setImportedIds([])
      setSelectedLocation(null)
      setShotDate(null)
      setTypeSearchTexts({})
      setPendingPaths([])
      cleanupRef.current.forEach((fn) => fn())
      cleanupRef.current = []
    }
  }, [open])

  // load all attribute values when dialog opens
  useEffect(() => {
    if (!open || attrTypes.length === 0) return
    const filmType = attrTypes.find((t) => t.key === 'film')
    if (filmType) setFilmTypeId(filmType.id)

    // load values for each active type
    attrTypes.forEach((t) => {
      window.api.attrs.listValues(t.id).then((vals) => {
        const values = vals as AttributeValue[]
        setTypeValues((prev) => ({ ...prev, [t.id]: values }))
        if (t.key === 'film') setFilmValues(values)
      })
    })
  }, [attrTypes, open])

  const selectedFilmValueId = filmTypeId ? (selectedAttrs[filmTypeId] ?? null) : null
  const selectedFilmValue = filmValues.find((v) => v.id === selectedFilmValueId) ?? null

  const setupListeners = () => {
    const cleanTotal = window.api.import.onTotal((total) => {
      setProgress((p) => ({ ...p, total }))
      setImportProgress({ total, imported: 0, skipped: 0 })
    })
    const cleanProg = window.api.import.onProgress((data) => {
      setProgress({ total: data.total ?? 0, imported: data.imported, skipped: data.skipped })
      setImportProgress({ total: data.total ?? 0, imported: data.imported, skipped: data.skipped })
    })
    cleanupRef.current = [cleanTotal, cleanProg]
  }

  const applyAttributesAndFinish = async (result: { imported: number; skipped: number; importedIds: number[] }) => {
    cleanupRef.current.forEach((fn) => fn())

    const ids = result.importedIds ?? []
    setImportedIds(ids)

    if (ids.length > 0) {
      const attrPairs = Object.entries(selectedAttrsRef.current)
        .filter(([, valueId]) => valueId !== null)
        .map(([typeId, valueId]) => ({ typeId: Number(typeId), valueId: valueId! }))

      if (attrPairs.length > 0) {
        await window.api.photos.batchSetAttributes(ids, attrPairs).catch(() => {})
      }
    }

    // batch-assign selected location (per-roll)
    const loc = selectedLocationRef.current
    if (ids.length > 0 && loc) {
      await window.api.locations.setForPhotos(ids, loc.id).catch(() => {})
    }

    // batch-assign shot date
    const sd = shotDateRef.current
    if (ids.length > 0 && sd) {
      await window.api.photos.batchSetShotDate(ids, sd).catch(() => {})
    }

    if (result.imported > 0 || result.skipped > 0) {
      setStep('done')
      setProgress((p) => ({ ...p, imported: result.imported, skipped: result.skipped }))
    } else {
      setStep('select')
    }
    setImportProgress(null)
  }

  const handleImport = async () => {
    setStep('importing')
    setProgress({ total: 0, imported: 0, skipped: 0 })
    setImportProgress({ total: 0, imported: 0, skipped: 0 })
    setupListeners()
    if (pendingPaths.length > 0) {
      const result = await window.api.import.importPaths(pendingPaths, subLibId)
      await applyAttributesAndFinish(result)
    } else {
      const result = await window.api.import.selectAndImport(subLibId)
      await applyAttributesAndFinish(result)
    }
  }

  const handleDropImport = (paths: string[]) => {
    setPendingPaths(paths)
  }

  // drag-drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    setIsDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault() }
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    const paths: string[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      paths.push((file as any).path)
    }
    if (paths.length > 0) handleDropImport(paths)
  }, [])

  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()

  // 创建新属性值并立即选中
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
    ...flattenSubLibs(subLibraries).map((l) => ({
      value: l.id,
      label: '　'.repeat(l.depth) + l.name
    }))
  ]

  const nonFilmTypes = attrTypes.filter((t) => t.key !== 'film')

  return (
    <>
      <Modal
        title="导入照片"
        open={open}
        onCancel={step !== 'importing' ? onClose : undefined}
        footer={null}
        width={500}
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #252525' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' },
          mask: { background: 'rgba(0,0,0,0.7)' }
        }}
      >
        {step === 'select' && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {/* 拖放区域 */}
            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${isDragging ? '#c8832a' : pendingPaths.length > 0 ? '#5a8a3a' : '#333'}`,
                borderRadius: 8,
                padding: '20px 12px',
                textAlign: 'center',
                background: isDragging
                  ? 'rgba(200,131,42,0.08)'
                  : pendingPaths.length > 0
                  ? 'rgba(90,138,58,0.06)'
                  : '#111',
                transition: 'all 0.2s',
                cursor: 'default'
              }}
            >
              <InboxOutlined
                style={{
                  fontSize: 32,
                  color: isDragging ? '#c8832a' : pendingPaths.length > 0 ? '#6aaa4a' : '#444',
                  marginBottom: 8
                }}
              />
              {pendingPaths.length > 0 ? (
                <>
                  <div style={{ color: '#6aaa4a', fontSize: 13 }}>
                    已拖入 {pendingPaths.length} 个文件 / 文件夹
                  </div>
                  <div
                    style={{ color: '#555', fontSize: 11, marginTop: 4, cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => setPendingPaths([])}
                  >
                    清除，重新拖入
                  </div>
                </>
              ) : (
                <>
                  <div style={{ color: isDragging ? '#c8832a' : '#666', fontSize: 13 }}>
                    将文件夹或图片拖放至此处
                  </div>
                  <div style={{ color: '#444', fontSize: 11, marginTop: 4 }}>
                    支持 JPG、PNG、TIFF、BMP 及主流 RAW 格式
                  </div>
                </>
              )}
            </div>

            {/* 胶片类型选择 */}
            <div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                胶片类型（可选）
              </div>
              <div
                onClick={() => setFilmPickerOpen(true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 12px',
                  background: '#222',
                  border: selectedFilmValue ? '1px solid #c8832a' : '1px solid #333',
                  borderRadius: 6,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s'
                }}
              >
                {selectedFilmValue ? (
                  <>
                    <FilmTag
                      value={selectedFilmValue.value}
                      iconKey={selectedFilmValue.icon_key}
                      iconSize={28}
                      style={{ color: '#e0e0e0', fontSize: 13, flex: 1 }}
                    />
                    <Button
                      size="small"
                      type="text"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (filmTypeId) setSelectedAttrs((prev) => ({ ...prev, [filmTypeId]: null }))
                      }}
                      style={{ color: '#555', padding: 0, minWidth: 'auto' }}
                    >
                      ✕
                    </Button>
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
                  <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                    {type.display_name}（可选）
                  </div>
                  <Select
                    showSearch
                    style={{ width: '100%' }}
                    placeholder={`选择或输入${type.display_name}...`}
                    value={selectedId ?? undefined}
                    onChange={(v) => setSelectedAttrs((prev) => ({ ...prev, [type.id]: v ?? null }))}
                    onSearch={(v) => setTypeSearchTexts((prev) => ({ ...prev, [type.id]: v }))}
                    allowClear
                    onClear={() => setSelectedAttrs((prev) => ({ ...prev, [type.id]: null }))}
                    filterOption={(input, option) =>
                      normalize(String(option?.label ?? '')).includes(normalize(input))
                    }
                    options={values.map((v) => ({ value: v.id, label: v.value }))}
                    dropdownRender={(menu) => (
                      <>
                        {menu}
                        {searchText && !alreadyExists && (
                          <>
                            <Divider style={{ margin: '4px 0', borderColor: '#333' }} />
                            <div
                              style={{ padding: '6px 8px', cursor: 'pointer', color: '#c8832a', fontSize: 12 }}
                              onMouseDown={async (e) => {
                                e.preventDefault()
                                await handleCreateAndSelect(type.id, searchText)
                                setTypeSearchTexts((prev) => ({ ...prev, [type.id]: '' }))
                              }}
                            >
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

            <Divider style={{ borderColor: '#252525', margin: '0' }} />

            {/* 拍摄地点（整卷）*/}
            <div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>拍摄地点（可选，应用于本次导入所有照片）</div>
              {selectedLocation ? (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                  background: '#222', border: '1px solid #c8832a', borderRadius: 6
                }}>
                  <EnvironmentOutlined style={{ color: '#c8832a', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e0e0e0', fontSize: 13 }}>{selectedLocation.name}</div>
                    {selectedLocation.address && (
                      <div style={{ color: '#666', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {selectedLocation.address}
                      </div>
                    )}
                  </div>
                  <Button
                    size="small" type="text"
                    icon={<CloseCircleOutlined />}
                    onClick={() => setSelectedLocation(null)}
                    style={{ color: '#555', padding: 0 }}
                  />
                </div>
              ) : (
                <LocationPicker
                  placeholder="搜索拍摄地点..."
                  onSelect={(loc) => setSelectedLocation(loc)}
                />
              )}
            </div>

            {/* 拍摄日期（整卷）*/}
            <div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>
                <CalendarOutlined style={{ marginRight: 4 }} />拍摄日期（可选，批量应用）
              </div>
              <DatePicker
                style={{ width: '100%', background: '#222', borderColor: '#333' }}
                value={shotDate ? dayjs(shotDate) : null}
                onChange={(d) => setShotDate(d ? d.format('YYYY-MM-DD') : null)}
                allowClear
                placeholder="未设置（默认用入库时间）"
              />
            </div>

            {/* 子库选择 */}
            <div>
              <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>导入到子库（可选）</div>              <Select
                style={{ width: '100%' }}
                value={subLibId}
                onChange={setSubLibId}
                options={subLibOptions as never}
                placeholder="选择子库..."
              />
            </div>

            <Button
              type="primary"
              block
              size="large"
              icon={<FolderOpenOutlined />}
              onClick={handleImport}
              style={{ background: '#c8832a', borderColor: '#c8832a' }}
            >
              {pendingPaths.length > 0 ? `导入已拖入的 ${pendingPaths.length} 个文件` : '选择文件夹并导入'}
            </Button>
          </Space>
        )}

        {step === 'importing' && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <LoadingOutlined style={{ fontSize: 32, color: '#c8832a', marginBottom: 16 }} />
            <div style={{ color: '#ccc', marginBottom: 16 }}>正在导入...</div>
            {progress.total > 0 && (
              <Progress
                percent={Math.round(((progress.imported + progress.skipped) / progress.total) * 100)}
                strokeColor="#c8832a"
                trailColor="#2a2a2a"
              />
            )}
            <div style={{ color: '#666', fontSize: 12, marginTop: 8 }}>
              已导入 {progress.imported} 张 · 跳过 {progress.skipped} 张
              {progress.total > 0 && ` · 共 ${progress.total} 张`}
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <CheckCircleOutlined style={{ fontSize: 40, color: '#52c41a', marginBottom: 16 }} />
            <div style={{ color: '#ccc', fontSize: 16, marginBottom: 8 }}>导入完成</div>
            <div style={{ color: '#888', marginBottom: 20 }}>
              成功导入 {progress.imported} 张 · 跳过 {progress.skipped} 张
            </div>
            <Space>
              <Button onClick={onClose}>关闭</Button>
              <Button
                type="primary"
                onClick={() => { onSuccess(); onClose() }}
                style={{ background: '#c8832a', borderColor: '#c8832a' }}
              >
                查看照片
              </Button>
            </Space>
          </div>
        )}
      </Modal>

      {/* 胶片图标选择器弹窗 */}
      <FilmIconPicker
        open={filmPickerOpen}
        filmValues={filmValues}
        selectedValueId={selectedFilmValueId}
        onSelect={(id) => {
          if (filmTypeId) setSelectedAttrs((prev) => ({ ...prev, [filmTypeId]: id }))
        }}
        onNewValue={(val) => {
          setFilmValues((prev) => [...prev, val])
          if (filmTypeId) {
            setTypeValues((prev) => ({ ...prev, [filmTypeId]: [...(prev[filmTypeId] ?? []), val] }))
            setSelectedAttrs((prev) => ({ ...prev, [filmTypeId]: val.id }))
          }
        }}
        onClose={() => setFilmPickerOpen(false)}
      />
    </>
  )
}
