import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Layout, message, Modal, Input, Spin, Select } from 'antd'
import { useStore } from '../store'
import type { Photo, AttributeType, PhotoFilterOptions, SubLibrary, Roll } from '../types'
import TopBar from '../components/Layout/TopBar'
import FilterPanel from '../components/FilterPanel'
import PhotoGrid from '../components/PhotoGrid'
import PhotoViewer from '../components/PhotoViewer'
import DetailDrawer from '../components/DetailDrawer'
import ImportDialog from '../components/ImportDialog'
import SettingsModal from '../components/SettingsModal'
import MapView from '../components/MapView'
import FilmLibraryModal from '../components/FilmLibraryModal'
import AttrLibraryModal from '../components/AttrLibraryModal'
import BatchEditModal from '../components/BatchEditModal'
import RollsView from '../components/RollsView'
import CreateRollModal from '../components/CreateRollModal'

const PAGE_SIZE = 80

export default function Library() {
  const {
    filter,
    setAttrTypes,
    setSubLibraries,
    selectedIds,
    clearSelection,
    setViewerPhoto,
    setViewerPhotos,
    setViewerIndex,
    settingsOpen,
    setSettingsOpen,
    detailPhotoId,
    setDetailPhotoId,
    setIccProfiles,
    viewMode,
    setViewMode,
    activeRoll,
    setActiveRoll
  } = useStore()

  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [attrTypes, setLocalAttrTypes] = useState<AttributeType[]>([])
  const [valueCounts, setValueCounts] = useState<Record<string, Record<string, number>>>({})
  const [importOpen, setImportOpen] = useState(false)
  const [createSubLibOpen, setCreateSubLibOpen] = useState(false)
  const [newSubLibName, setNewSubLibName] = useState('')
  const [mapOpen, setMapOpen] = useState(false)
  const [filmLibraryOpen, setFilmLibraryOpen] = useState(false)
  const [cameraLibraryOpen, setCameraLibraryOpen] = useState(false)
  const [lensLibraryOpen, setLensLibraryOpen] = useState(false)
  const [batchEditOpen, setBatchEditOpen] = useState(false)
  const [moveSubLibOpen, setMoveSubLibOpen] = useState(false)
  const [moveTargetSubLibId, setMoveTargetSubLibId] = useState<number | null>(null)
  const [subLibCounts, setSubLibCounts] = useState<Record<string, number>>({})
  const [filterOptions, setFilterOptions] = useState<PhotoFilterOptions>({
    fileTypes: [],
    statusCounts: { unclassified: 0, missing_date: 0, missing_camera: 0 }
  })
  const [createRollOpen, setCreateRollOpen] = useState(false)

  // Rolls state
  const [rolls, setRolls] = useState<Roll[]>([])
  const [photolessCount, setPhotolessCount] = useState(0)
  const [rollsLoading, setRollsLoading] = useState(false)
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const loadingRef = useRef(false)

  const loadAttrs = useCallback(async () => {
    const all = await window.api.attrs.listAll() as AttributeType[]
    setLocalAttrTypes(all)
    setAttrTypes(all)

    const counts = await window.api.attrs.valueCounts({}) as { attribute_type_id: number; attribute_value_id: number; count: number }[]
    const map: Record<string, Record<string, number>> = {}
    counts.forEach(({ attribute_type_id, attribute_value_id, count }) => {
      if (!map[attribute_type_id]) map[attribute_type_id] = {}
      map[attribute_type_id][attribute_value_id] = count
    })
    setValueCounts(map)
  }, [setAttrTypes])

  const loadSubLibs = useCallback(async () => {
    const [libs, counts, options] = await Promise.all([
      window.api.sublib.list(),
      window.api.sublib.counts(),
      window.api.photos.filterOptions()
    ])
    setSubLibraries(libs)
    setSubLibCounts(counts as Record<string, number>)
    setFilterOptions(options as PhotoFilterOptions)
  }, [setSubLibraries])

  const loadPhotos = useCallback(async (reset = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const currentPage = reset ? 1 : page
    try {
      // When in roll drill-down: load only that roll's photos
      let result: { total: number; rows: Photo[] }
      if (activeRoll || unassignedOnly) {
        result = await window.api.rolls.photos(activeRoll?.id ?? null, {
          page: currentPage,
          pageSize: PAGE_SIZE,
          filters: filter.filters,
          subLibraryId: filter.subLibraryId,
          search: filter.search,
          dateFrom: filter.dateFrom,
          dateTo: filter.dateTo,
          dateField: filter.dateField,
          fileTypes: filter.fileTypes,
          organizationStatuses: filter.organizationStatuses,
          sortBy: filter.sortBy,
          sortOrder: filter.sortOrder
        }) as { total: number; rows: Photo[] }
      } else {
        result = await window.api.photos.list({
          page: currentPage,
          pageSize: PAGE_SIZE,
          filters: filter.filters,
          subLibraryId: filter.subLibraryId,
          search: filter.search,
          dateFrom: filter.dateFrom,
          dateTo: filter.dateTo,
          dateField: filter.dateField,
          fileTypes: filter.fileTypes,
          organizationStatuses: filter.organizationStatuses,
          sortBy: filter.sortBy,
          sortOrder: filter.sortOrder
        }) as { total: number; rows: Photo[] }
      }
      if (reset) {
        setPhotos(result.rows)
        setPage(2)
      } else {
        setPhotos((prev) => [...prev, ...result.rows])
        setPage(currentPage + 1)
      }
      setTotal(result.total)
      setHasMore(currentPage * PAGE_SIZE < result.total)
    } catch (err) {
      console.error('loadPhotos failed:', err)
      message.error('加载照片失败，请检查日志')
    } finally {
      setLoading(false)
      loadingRef.current = false
    }
  }, [filter, page, activeRoll, unassignedOnly])

  const loadRolls = useCallback(async () => {
    setRollsLoading(true)
    try {
      const result = await window.api.rolls.list({
        filters: filter.filters,
        subLibraryId: filter.subLibraryId,
        search: filter.search,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        dateField: filter.dateField,
        fileTypes: filter.fileTypes,
        organizationStatuses: filter.organizationStatuses
      }) as { rolls: Roll[]; photolessCount: number }
      setRolls(result.rolls)
      setPhotolessCount(result.photolessCount)
    } catch (err) {
      console.error('loadRolls failed:', err)
    } finally {
      setRollsLoading(false)
    }
  }, [filter])

  // 筛选条件变化时重置
  useEffect(() => {
    setPage(1)
    if (viewMode === 'rolls' && !activeRoll) {
      loadRolls()
    } else {
      loadPhotos(true)
    }
  }, [filter, viewMode, activeRoll, unassignedOnly])

  useEffect(() => {
    if (viewMode === 'rolls') setUnassignedOnly(false)
  }, [viewMode])

  useEffect(() => {
    loadAttrs()
    loadSubLibs()
    window.api.library.listProfiles().then((p) => setIccProfiles(p as never))
    window.api.app.getInitError().then((err) => {
      if (err) message.error(`初始化错误: ${err}`, 10)
    }).catch(() => {})
  }, [])

  const handleOpenViewer = useCallback((photo: Photo, index: number) => {
    setViewerPhotos(photos)
    setViewerIndex(index)
    setViewerPhoto(photo)
  }, [photos, setViewerPhotos, setViewerIndex, setViewerPhoto])

  const handleCreateSubLib = async () => {
    if (!newSubLibName.trim()) return
    await window.api.sublib.create(newSubLibName.trim(), filter.subLibraryId)
    setCreateSubLibOpen(false)
    setNewSubLibName('')
    loadSubLibs()
  }

  const flattenSubLibs = (libs: SubLibrary[], depth = 0): { id: number; name: string; depth: number }[] =>
    libs.flatMap((lib) => [{ id: lib.id, name: lib.name, depth }, ...flattenSubLibs(lib.children, depth + 1)])

  const subLibMoveOptions = [
    { value: null, label: '未分类（根目录）' },
    ...flattenSubLibs(useStore.getState().subLibraries).map((lib) => ({
      value: lib.id,
      label: '　'.repeat(lib.depth) + lib.name
    }))
  ]

  const handleBatchRotate = async () => {
    if (selectedIds.size === 0) return
    const result = await window.api.photos.batchRotate([...selectedIds], 90) as { updated: number }
    message.success(`已旋转 ${result.updated} 张照片`)
    clearSelection()
    loadPhotos(true)
  }

  const handleBatchMove = async () => {
    if (selectedIds.size === 0) return
    const result = await window.api.photos.moveToSubLibrary([...selectedIds], moveTargetSubLibId) as {
      moved: number
      unchanged: number
      failed: { reason: string }[]
    }
    if (result.failed.length > 0) {
      message.warning(`已移动 ${result.moved} 张，${result.failed.length} 张本地文件移动失败`)
    } else {
      message.success(`已整理 ${result.moved + result.unchanged} 张照片`)
    }
    clearSelection()
    setMoveSubLibOpen(false)
    loadPhotos(true)
    loadSubLibs()
  }

  const handleRollClick = (roll: Roll) => {
    setUnassignedOnly(false)
    setActiveRoll(roll)
    setViewMode('photos')
    clearSelection()
  }

  const handleOtherPhotosClick = () => {
    setUnassignedOnly(true)
    setActiveRoll(null)
    setViewMode('photos')
    clearSelection()
  }

  // Determine what to show in main content area
  const showRollsView = viewMode === 'rolls' && !activeRoll

  // Title for breadcrumb when inside a roll
  const rollBreadcrumb = activeRoll || unassignedOnly ? (
    <div style={{
      padding: '6px 16px',
      background: '#1a1a1a',
      borderBottom: '1px solid #252525',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      color: '#888',
      flexShrink: 0
    }}>
      <span
        style={{ color: '#c8832a', cursor: 'pointer' }}
        onClick={() => { setActiveRoll(null); setUnassignedOnly(false); setViewMode('rolls') }}
      >
        卷视图
      </span>
      <span>/</span>
      <span style={{ color: '#ccc' }}>{activeRoll?.name ?? '其他图片'}</span>
      <span style={{ marginLeft: 'auto', color: '#555', fontSize: 11 }}>{total} 张</span>
    </div>
  ) : null
  return (
    <Layout style={{ height: '100vh', background: '#141414', overflow: 'hidden' }}>
      <TopBar
        onImport={() => setImportOpen(true)}
        onCreateSubLib={() => setCreateSubLibOpen(true)}
        onOpenMap={() => setMapOpen(true)}
        onOpenFilmLibrary={() => setFilmLibraryOpen(true)}
        onOpenCameraLibrary={() => setCameraLibraryOpen(true)}
        onOpenLensLibrary={() => setLensLibraryOpen(true)}
        onCreateRoll={() => setCreateRollOpen(true)}
        totalCount={total}
      />

      <Layout style={{ flex: 1, overflow: 'hidden', flexDirection: 'row' }}>
        <FilterPanel
          attrTypes={attrTypes}
          valueCounts={valueCounts}
          subLibCounts={subLibCounts}
          filterOptions={filterOptions}
          onSubLibraryDeleted={() => { loadPhotos(true); loadSubLibs() }}
        />

        <Layout.Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#141414' }}>
          {/* Breadcrumb when inside a roll */}
          {rollBreadcrumb}

          {showRollsView ? (
            <RollsView
              rolls={rolls}
              photolessCount={photolessCount}
              loading={rollsLoading}
              attrTypes={attrTypes}
              onRollClick={handleRollClick}
              onOtherPhotosClick={handleOtherPhotosClick}
              onRollDeleted={() => loadRolls()}
              onRollRenamed={() => loadRolls()}
            />
          ) : (
            <PhotoGrid
              photos={photos}
              loading={loading}
              hasMore={hasMore}
              attrTypes={attrTypes}
              onLoadMore={() => loadPhotos(false)}
              onOpenViewer={handleOpenViewer}
              onBatchEdit={() => setBatchEditOpen(true)}
              onBatchRotate={handleBatchRotate}
              onMoveToSubLibrary={() => { setMoveTargetSubLibId(null); setMoveSubLibOpen(true) }}
              onPhotoDeleted={() => { loadPhotos(true); loadAttrs(); loadSubLibs(); loadRolls() }}
            />
          )}
        </Layout.Content>
      </Layout>

      {/* 全屏预览 */}
      <PhotoViewer attrTypes={attrTypes} onAttrChanged={() => { loadPhotos(true); loadAttrs(); loadSubLibs() }} />

      {/* 详情抽屉 */}
      <DetailDrawer
        photoId={detailPhotoId}
        attrTypes={attrTypes}
        onClose={() => setDetailPhotoId(null)}
        onMoved={() => { loadPhotos(true); loadSubLibs() }}
        onDeleted={() => { loadPhotos(true); loadAttrs(); loadSubLibs() }}
      />

      {/* 导入对话框 */}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { loadPhotos(true); loadAttrs(); loadSubLibs(); loadRolls() }}
      />

      {/* 建卷对话框 */}
      <CreateRollModal
        open={createRollOpen}
        selectedIds={[...selectedIds]}
        onClose={() => setCreateRollOpen(false)}
        onCreated={() => {
          setCreateRollOpen(false)
          clearSelection()
          loadRolls()
          loadAttrs()
        }}
      />

      {/* 新建子库 */}
      <Modal
        title="新建子库"
        open={createSubLibOpen}
        onOk={handleCreateSubLib}
        onCancel={() => { setCreateSubLibOpen(false); setNewSubLibName('') }}
        okText="创建"
        cancelText="取消"
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' }
        }}
        mask={false}
      >
        <Input
          placeholder="子库名称"
          value={newSubLibName}
          onChange={(e) => setNewSubLibName(e.target.value)}
          onPressEnter={handleCreateSubLib}
          autoFocus
          style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
        />
      </Modal>

      {/* 批量移动到子库 */}
      <Modal
        title={`移动 ${selectedIds.size} 张照片`}
        open={moveSubLibOpen}
        onOk={handleBatchMove}
        onCancel={() => setMoveSubLibOpen(false)}
        okText="移动"
        cancelText="取消"
        styles={{
          content: { background: '#1a1a1a', border: '1px solid #252525' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' }
        }}
      >
        <Select
          style={{ width: '100%' }}
          value={moveTargetSubLibId}
          onChange={setMoveTargetSubLibId}
          options={subLibMoveOptions as never}
          placeholder="选择目标子库"
        />
      </Modal>

      {/* 设置 */}
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onAttrChange={() => { loadAttrs(); loadSubLibs() }}
      />

      {/* 地点地图 */}
      <MapView open={mapOpen} onClose={() => setMapOpen(false)} />

      {/* 胶卷库 */}
      <FilmLibraryModal
        open={filmLibraryOpen}
        attrTypes={attrTypes}
        onClose={() => setFilmLibraryOpen(false)}
        onChanged={() => { loadAttrs(); loadPhotos(true); loadSubLibs() }}
      />

      {/* 相机库 */}
      <AttrLibraryModal
        open={cameraLibraryOpen}
        attrKey="camera"
        title="相机库"
        attrTypes={attrTypes}
        onClose={() => setCameraLibraryOpen(false)}
        onChanged={() => { loadAttrs(); loadPhotos(true); loadSubLibs() }}
      />

      {/* 镜头库 */}
      <AttrLibraryModal
        open={lensLibraryOpen}
        attrKey="lens"
        title="镜头库"
        attrTypes={attrTypes}
        onClose={() => setLensLibraryOpen(false)}
        onChanged={() => { loadAttrs(); loadPhotos(true); loadSubLibs() }}
      />

      {/* 批量编辑属性和拍摄地点 */}
      <BatchEditModal
        open={batchEditOpen}
        selectedIds={[...selectedIds]}
        attrTypes={attrTypes}
        onClose={() => setBatchEditOpen(false)}
        onDone={() => { setBatchEditOpen(false); clearSelection(); loadPhotos(true); loadAttrs(); loadSubLibs() }}
      />
    </Layout>
  )
}
