import React, { useEffect, useState, useCallback } from 'react'
import { Layout, message, Modal, Input, Select } from 'antd'
import { useFilterStore, useLibraryStore, useUIStore } from '../store'
import type { SubLibrary } from '../types'
import { usePhotoLoader } from '../hooks/usePhotoLoader'
import { useRollLoader } from '../hooks/useRollLoader'
import { useLibraryData } from '../hooks/useLibraryData'
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

export default function Library() {
  const { filter, selectedIds, clearSelection } = useFilterStore()
  const { setIccProfiles, subLibraries } = useLibraryStore()
  const {
    setViewerPhoto,
    setViewerPhotos,
    setViewerIndex,
    settingsOpen,
    setSettingsOpen,
    detailPhotoId,
    setDetailPhotoId,
    viewMode,
    setViewMode,
    activeRoll,
    setActiveRoll
  } = useUIStore()

  // ── 数据加载 hooks ───────────────────────────────────────────────────────────
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const { photos, total, loading, hasMore, loadPhotos } = usePhotoLoader(filter, activeRoll, unassignedOnly)
  const { rolls, photolessCount, rollsLoading, loadRolls } = useRollLoader(filter)
  const { attrTypes, valueCounts, subLibCounts, filterOptions, loadAttrs, loadSubLibs, loadValueCounts } = useLibraryData()

  // ── 弹窗状态 ─────────────────────────────────────────────────────────────────
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
  const [createRollOpen, setCreateRollOpen] = useState(false)

  // ── 初始化加载（仅首次挂载） ─────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    loadAttrs()
    loadSubLibs()
    window.api.library.listProfiles().then((p) => setIccProfiles(p as never))
    window.api.app.getInitError().then((err) => {
      if (err) message.error(`初始化错误: ${err}`, 10)
    }).catch(() => {})
  }, [])

  // ── 筛选条件变化时重置并更新联动计数 ────────────────────────────────────────
  useEffect(() => {
    if (viewMode === 'rolls' && !activeRoll) {
      loadRolls()
    } else {
      loadPhotos(true)
    }
    loadValueCounts(filter)
  }, [filter, viewMode, activeRoll, unassignedOnly])

  useEffect(() => {
    if (viewMode === 'rolls') setUnassignedOnly(false)
  }, [viewMode])

  // ── 事件处理 ─────────────────────────────────────────────────────────────────
  const handleOpenViewer = useCallback((photo: import('../types').Photo, index: number) => {
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
    ...flattenSubLibs(subLibraries).map((lib) => ({
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

  const handleRollClick = (roll: import('../types').Roll) => {
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

  // ── 渲染 ─────────────────────────────────────────────────────────────────────
  const showRollsView = viewMode === 'rolls' && !activeRoll

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
              onRollLocationChanged={() => loadRolls()}
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

      {/* 批量编辑属性 */}
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
