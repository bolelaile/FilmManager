import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Layout, message, Modal, Input, Spin } from 'antd'
import { useStore } from '../store'
import type { Photo, AttributeType } from '../types'
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
    setIccProfiles
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
  const [subLibCounts, setSubLibCounts] = useState<Record<string, number>>({})
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
    const libs = await window.api.sublib.list()
    setSubLibraries(libs)
    const counts = await window.api.sublib.counts() as Record<string, number>
    setSubLibCounts(counts)
  }, [setSubLibraries])

  const loadPhotos = useCallback(async (reset = false) => {
    if (loadingRef.current) return
    loadingRef.current = true
    setLoading(true)
    const currentPage = reset ? 1 : page
    try {
      const result = await window.api.photos.list({
        page: currentPage,
        pageSize: PAGE_SIZE,
        filters: filter.filters,
        subLibraryId: filter.subLibraryId,
        search: filter.search,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        sortBy: filter.sortBy,
        sortOrder: filter.sortOrder
      }) as { total: number; rows: Photo[] }
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
  }, [filter, page])

  // 筛选条件变化时重置
  useEffect(() => {
    setPage(1)
    loadPhotos(true)
  }, [filter])

  useEffect(() => {
    loadAttrs()
    loadSubLibs()
    // 加载 ICC 配置文件
    window.api.library.listProfiles().then((p) => setIccProfiles(p as never))
    // 检查主进程初始化错误
    window.api.app.getInitError().then((err) => {
      if (err) message.error(`初始化错误: ${err}`, 10)
    }).catch(() => {})
  }, [])

  const handleOpenViewer = useCallback((photo: Photo, index: number) => {
    setViewerPhotos(photos)
    setViewerIndex(index)
    setViewerPhoto(photo)
  }, [photos, setViewerPhotos, setViewerIndex, setViewerPhoto])

  const handleBatchDelete = async () => {
    Modal.confirm({
      title: `删除 ${selectedIds.size} 张照片`,
      content: '仅从库中移除索引，文件保留在磁盘。如需同时删除文件请在详情面板操作。',
      okText: '移除',
      cancelText: '取消',
      onOk: async () => {
        await window.api.photos.delete([...selectedIds], false)
        message.success(`已移除 ${selectedIds.size} 张照片`)
        clearSelection()
        loadPhotos(true)
        loadAttrs()
      }
    })
  }

  const handleCreateSubLib = async () => {
    if (!newSubLibName.trim()) return
    await window.api.sublib.create(newSubLibName.trim(), filter.subLibraryId)
    setCreateSubLibOpen(false)
    setNewSubLibName('')
    loadSubLibs()
  }

  return (
    <Layout style={{ height: '100vh', background: '#141414', overflow: 'hidden' }}>
      <TopBar
        onImport={() => setImportOpen(true)}
        onBatchDelete={handleBatchDelete}
        onBatchEdit={() => setBatchEditOpen(true)}
        onCreateSubLib={() => setCreateSubLibOpen(true)}
        onOpenMap={() => setMapOpen(true)}
        onOpenFilmLibrary={() => setFilmLibraryOpen(true)}
        onOpenCameraLibrary={() => setCameraLibraryOpen(true)}
        onOpenLensLibrary={() => setLensLibraryOpen(true)}
        totalCount={total}
      />

      <Layout style={{ flex: 1, overflow: 'hidden', flexDirection: 'row' }}>
        <FilterPanel
          attrTypes={attrTypes}
          valueCounts={valueCounts}
          subLibCounts={subLibCounts}
        />

        <Layout.Content style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#141414' }}>
          <PhotoGrid
            photos={photos}
            loading={loading}
            hasMore={hasMore}
            attrTypes={attrTypes}
            onLoadMore={() => loadPhotos(false)}
            onOpenViewer={handleOpenViewer}
            onPhotoDeleted={() => { loadPhotos(true); loadAttrs() }}
          />
        </Layout.Content>
      </Layout>

      {/* 全屏预览 */}
      <PhotoViewer attrTypes={attrTypes} onAttrChanged={() => { loadPhotos(true); loadAttrs() }} />

      {/* 详情抽屉 */}
      <DetailDrawer
        photoId={detailPhotoId}
        attrTypes={attrTypes}
        onClose={() => setDetailPhotoId(null)}
        onDeleted={() => { loadPhotos(true); loadAttrs() }}
      />

      {/* 导入对话框 */}
      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSuccess={() => { loadPhotos(true); loadAttrs() }}
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
          content: { background: '#1a1a1a', border: '1px solid #252525' },
          header: { background: '#1a1a1a', borderBottom: '1px solid #252525' }
        }}
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
        onChanged={() => { loadAttrs(); loadPhotos(true) }}
      />

      {/* 相机库 */}
      <AttrLibraryModal
        open={cameraLibraryOpen}
        attrKey="camera"
        title="相机库"
        attrTypes={attrTypes}
        onClose={() => setCameraLibraryOpen(false)}
        onChanged={() => { loadAttrs(); loadPhotos(true) }}
      />

      {/* 镜头库 */}
      <AttrLibraryModal
        open={lensLibraryOpen}
        attrKey="lens"
        title="镜头库"
        attrTypes={attrTypes}
        onClose={() => setLensLibraryOpen(false)}
        onChanged={() => { loadAttrs(); loadPhotos(true) }}
      />

      {/* 批量编辑属性 */}
      <BatchEditModal
        open={batchEditOpen}
        selectedIds={[...selectedIds]}
        attrTypes={attrTypes}
        onClose={() => setBatchEditOpen(false)}
        onDone={() => { setBatchEditOpen(false); clearSelection(); loadPhotos(true); loadAttrs() }}
      />
    </Layout>
  )
}
