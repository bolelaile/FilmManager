import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Layout, message, Modal, Input, Select } from 'antd'
import { useFilterStore, useLibraryStore, useUIStore, useShortcutsStore } from '../store'
import type { SubLibrary } from '../types'
import { usePhotoLoader } from '../hooks/usePhotoLoader'
import { useRollLoader } from '../hooks/useRollLoader'
import { useLibraryData } from '../hooks/useLibraryData'
import { useShortcutListener } from '../hooks/useShortcutListener'
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
import ImportProgressBar from '../components/ImportProgressBar'
import TimelineView from '../components/TimelineView'
import ExportModal from '../components/ExportModal'
import ExportProgressBar from '../components/ExportProgressBar'
import TrashModal from '../components/TrashModal'
import StatsModal from '../components/StatsModal'
import DuplicatesModal from '../components/DuplicatesModal'
import ShortcutsHelp from '../components/ShortcutsHelp'

const SIZES = ['small', 'medium', 'large'] as const

export default function Library() {
  const { filter, selectedIds, selectAll, clearSelection, setFilter } = useFilterStore()
  const { setIccProfiles, subLibraries, importProgress } = useLibraryStore()
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
    setActiveRoll,
    thumbnailSize,
    setThumbnailSize,
    viewerPhoto,
    openExport,
    setShortcutsHelpOpen,
    triggerFocusSearch,
    copiedAttrs,
    setCopiedAttrs,
    trashOpen,
    setTrashOpen,
    statsOpen,
    setStatsOpen,
    duplicatesOpen,
    setDuplicatesOpen
  } = useUIStore()
  const { loadBindings } = useShortcutsStore()

  // ── 数据加载 hooks ───────────────────────────────────────────────────────────
  const [unassignedOnly, setUnassignedOnly] = useState(false)
  const { photos, total, loading, hasMore, loadPhotos } = usePhotoLoader(filter, activeRoll, unassignedOnly)
  const { rolls, photolessCount, rollsLoading, loadRolls } = useRollLoader(filter)
  const { attrTypes, valueCounts, subLibCounts, filterOptions, loadAttrs, loadSubLibs, loadValueCounts } = useLibraryData()

  // ── 弹窗状态 ─────────────────────────────────────────────────────────────────
  const [importOpen, setImportOpen] = useState(false)
  const [importInitialPaths, setImportInitialPaths] = useState<string[]>([])
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
    loadBindings()
    window.api.library.listProfiles().then((p) => setIccProfiles(p as never))
    window.api.app.getInitError().then((err) => {
      if (err) message.error(`初始化错误: ${err}`, 10)
    }).catch(() => {})
  }, [])

  // ── 筛选条件变化时重置并更新联动计数 ────────────────────────────────────────
  useEffect(() => {
    if (viewMode === 'rolls' && !activeRoll) {
      loadRolls()
    } else if (viewMode !== 'timeline') {
      loadPhotos(true)
    }
    loadValueCounts(filter)
  }, [filter, viewMode, activeRoll, unassignedOnly])

  useEffect(() => {
    if (viewMode === 'rolls' || viewMode === 'timeline') setUnassignedOnly(false)
  }, [viewMode])

  // ── 后台导入进行中：每 3 秒刷新一次图库（将 indexing 占位卡片替换为完成卡片）─────
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (importProgress && !importPollRef.current) {
      importPollRef.current = setInterval(() => {
        loadPhotos(true)
        loadSubLibs()
      }, 3000)
    }
    if (!importProgress && importPollRef.current) {
      clearInterval(importPollRef.current)
      importPollRef.current = null
      // 最终刷新一次确保完成态
      loadPhotos(true)
      loadAttrs()
      loadSubLibs()
    }
    return () => {
      if (importPollRef.current) {
        clearInterval(importPollRef.current)
        importPollRef.current = null
      }
    }
  }, [!!importProgress])

  // ── 全局拖拽导入 ─────────────────────────────────────────────────────────────
  const [globalDragOver, setGlobalDragOver] = useState(false)
  const globalDragCounter = useRef(0)

  const handleGlobalDragEnter = useCallback((e: React.DragEvent) => {
    // 仅处理外部文件拖入，忽略应用内照片拖拽（自定义 MIME）
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    globalDragCounter.current++
    setGlobalDragOver(true)
  }, [])

  const handleGlobalDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    globalDragCounter.current--
    if (globalDragCounter.current <= 0) {
      globalDragCounter.current = 0
      setGlobalDragOver(false)
    }
  }, [])

  const handleGlobalDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
  }, [])

  const handleGlobalDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    globalDragCounter.current = 0
    setGlobalDragOver(false)
    const paths: string[] = []
    for (const file of Array.from(e.dataTransfer.files)) {
      paths.push((file as unknown as { path: string }).path)
    }
    if (paths.length > 0) {
      setImportInitialPaths(paths)
      setImportOpen(true)
    }
  }, [])

  // ── 事件处理 ─────────────────────────────────────────────────────────────────
  const handleOpenViewer = useCallback((photo: import('../types').Photo, index: number) => {
    setViewerPhotos(photos)
    setViewerIndex(index)
    setViewerPhoto(photo)
  }, [photos, setViewerPhotos, setViewerIndex, setViewerPhoto])

  // ── 属性复制/粘贴（作用于当前选中集；单选时取该张） ─────────────────────────
  const handleCopyAttrs = useCallback(async () => {
    const ids = [...selectedIds]
    if (ids.length === 0) return
    const photo = await window.api.photos.get(ids[0]) as { attributes?: { attribute_type_id: number; value_id: number }[] } | null
    if (photo?.attributes && photo.attributes.length > 0) {
      setCopiedAttrs(photo.attributes.map((a) => ({ typeId: a.attribute_type_id, valueId: a.value_id })))
      message.success(`已复制 ${ids[0]} 号照片的 ${photo.attributes.length} 项属性`)
    } else {
      setCopiedAttrs([])
      message.info('该照片无属性可复制')
    }
  }, [selectedIds, setCopiedAttrs])

  const handlePasteAttrs = useCallback(async () => {
    if (!copiedAttrs || copiedAttrs.length === 0) {
      message.info('剪贴板无属性')
      return
    }
    const ids = [...selectedIds]
    if (ids.length === 0) return
    await window.api.photos.batchSetAttributes(ids, copiedAttrs)
    message.success(`已粘贴属性到 ${ids.length} 张照片`)
    loadAttrs()
    loadPhotos(true)
  }, [copiedAttrs, selectedIds, loadAttrs, loadPhotos])

  // ── 缩略图尺寸循环 ──────────────────────────────────────────────────────────
  const cycleThumbSize = useCallback((dir: 1 | -1) => {
    const idx = SIZES.indexOf(thumbnailSize)
    const next = SIZES[(idx + dir + SIZES.length) % SIZES.length]
    setThumbnailSize(next)
  }, [thumbnailSize, setThumbnailSize])

  // ── 全局快捷键（无全屏预览时激活；网格/预览动作由各自组件监听） ───────────────
  const globalActive = !viewerPhoto
  useShortcutListener(
    ['search.focus', 'view.rolls', 'view.photos', 'view.timeline', 'thumb.smaller', 'thumb.larger',
     'import.open', 'export.selected', 'selectAll', 'deselectAll', 'attrs.copy', 'attrs.paste',
     'shortcuts.help', 'trash.open'],
    {
      'search.focus': () => triggerFocusSearch(),
      'view.rolls': () => { setActiveRoll(null); setViewMode('rolls') },
      'view.photos': () => { if (viewMode !== 'photos') { setActiveRoll(null); setViewMode('photos') } },
      'view.timeline': () => { setActiveRoll(null); setViewMode('timeline') },
      'thumb.smaller': () => cycleThumbSize(-1),
      'thumb.larger': () => cycleThumbSize(1),
      'import.open': () => setImportOpen(true),
      'export.selected': () => { if (selectedIds.size > 0) openExport([...selectedIds], `选中 ${selectedIds.size} 张`) },
      'selectAll': () => { if (viewMode === 'photos') selectAll(photos.map((p) => p.id)) },
      'deselectAll': () => clearSelection(),
      'attrs.copy': handleCopyAttrs,
      'attrs.paste': handlePasteAttrs,
      'shortcuts.help': () => setShortcutsHelpOpen(true),
      'trash.open': () => setTrashOpen(true),
    },
    globalActive,
    true
  )

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
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      color: 'var(--text-secondary)',
      flexShrink: 0
    }}>
      <span
        style={{ color: 'var(--accent)', cursor: 'pointer' }}
        onClick={() => { setActiveRoll(null); setUnassignedOnly(false); setViewMode('rolls') }}
      >
        卷视图
      </span>
      <span>/</span>
      <span style={{ color: 'var(--text-primary)' }}>{activeRoll?.name ?? '其他图片'}</span>
      <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: 11 }}>{total} 张</span>
    </div>
  ) : null

  return (
    <Layout style={{ height: '100vh', background: 'var(--bg-base)', overflow: 'hidden' }}>
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

        <Layout.Content
          style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#141414', position: 'relative' }}
          onDragEnter={handleGlobalDragEnter}
          onDragLeave={handleGlobalDragLeave}
          onDragOver={handleGlobalDragOver}
          onDrop={handleGlobalDrop}
        >
          {/* 全局拖拽蒙层 */}
          {globalDragOver && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 200,
              background: 'rgba(0,0,0,0.6)',
              border: '2px dashed var(--accent)',
              borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              pointerEvents: 'none'
            }}>
              <div style={{ textAlign: 'center', color: 'var(--accent)' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>📥</div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>释放以导入照片</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>支持文件和文件夹</div>
              </div>
            </div>
          )}
          {rollBreadcrumb}

          {viewMode === 'timeline' ? (
            <TimelineView
              onMonthClick={(year, month) => {
                const from = `${year}-${month}-01`
                const lastDay = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate()
                const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`
                setFilter({ dateFrom: from, dateTo: to, dateField: 'shot_date' })
                setViewMode('photos')
              }}
            />
          ) : showRollsView ? (
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

          <ImportProgressBar />
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
        onClose={() => { setImportOpen(false); setImportInitialPaths([]) }}
        initialPaths={importInitialPaths}
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
      <ExportModal />
      <ExportProgressBar />

      {/* 回收站 / 统计 / 重复 / 快捷键帮助 */}
      <TrashModal open={trashOpen} onClose={() => setTrashOpen(false)} />
      <StatsModal open={statsOpen} onClose={() => setStatsOpen(false)} />
      <DuplicatesModal open={duplicatesOpen} onClose={() => setDuplicatesOpen(false)} onChanged={() => { loadPhotos(true); loadAttrs() }} />
      <ShortcutsHelp />
    </Layout>
  )
}
