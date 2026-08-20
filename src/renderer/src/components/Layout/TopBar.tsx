import React, { useCallback, useRef, useState } from 'react'
import { Layout, Button, Input, Segmented, Tooltip, Space, Badge } from 'antd'
import {
  ImportOutlined,
  SettingOutlined,
  SearchOutlined,
  FolderAddOutlined,
  EnvironmentOutlined,
  VideoCameraOutlined,
  CameraOutlined,
  AimOutlined,
  MinusOutlined,
  BorderOutlined,
  CloseOutlined,
  BlockOutlined,
  AppstoreOutlined,
  RollbackOutlined,
  CalendarOutlined
} from '@ant-design/icons'
import { useStore } from '../../store'

const { Header } = Layout

interface TopBarProps {
  onImport: () => void
  onCreateSubLib: () => void
  onOpenMap: () => void
  onOpenFilmLibrary: () => void
  onOpenCameraLibrary: () => void
  onOpenLensLibrary: () => void
  onCreateRoll: () => void
  totalCount: number
}

export default function TopBar({
  onImport, onCreateSubLib,
  onOpenMap, onOpenFilmLibrary, onOpenCameraLibrary, onOpenLensLibrary,
  onCreateRoll, totalCount
}: TopBarProps) {
  const { filter, setFilter, thumbnailSize, setThumbnailSize, rollThumbnailSize, setRollThumbnailSize, selectedIds, setSettingsOpen, viewMode, setViewMode, activeRoll, setActiveRoll } = useStore()

  // 搜索框本地受控值（立即响应输入），防抖后再同步到 filter store
  const [searchInput, setSearchInput] = useState(filter.search ?? '')
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 当外部重置 filter.search（如切换视图、清除筛选）时，同步本地值
  React.useEffect(() => {
    if ((filter.search ?? '') !== searchInput) {
      setSearchInput(filter.search ?? '')
    }
  }, [filter.search])

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setSearchInput(val)
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
      searchDebounceRef.current = setTimeout(() => {
        setFilter({ search: val || undefined })
      }, 300)
    },
    [setFilter]
  )

  // 清空搜索时立即同步
  const handleSearchClear = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current)
    setSearchInput('')
    setFilter({ search: undefined })
  }, [setFilter])

  // 卷视图（含卷内单独照片页）时用 rollThumbnailSize，其余用 thumbnailSize
  const isRollView = viewMode === 'rolls' || (viewMode === 'photos' && !!activeRoll)
  const activeSize = isRollView ? rollThumbnailSize : thumbnailSize
  const setActiveSize = isRollView ? setRollThumbnailSize : setThumbnailSize

  const sizeOptions = [
    {
      value: 'small',
      label: (
        <Tooltip title="小缩略图">
          <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
            {[0, 1, 2, 3].map((i) => (
              <span key={i} style={{ width: 4, height: 4, background: 'currentColor', borderRadius: 1, display: 'inline-block' }} />
            ))}
          </span>
        </Tooltip>
      )
    },
    {
      value: 'medium',
      label: (
        <Tooltip title="中缩略图">
          <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{ width: 6, height: 6, background: 'currentColor', borderRadius: 1, display: 'inline-block' }} />
            ))}
          </span>
        </Tooltip>
      )
    },
    {
      value: 'large',
      label: (
        <Tooltip title="大缩略图">
          <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
            {[0, 1].map((i) => (
              <span key={i} style={{ width: 9, height: 9, background: 'currentColor', borderRadius: 1, display: 'inline-block' }} />
            ))}
          </span>
        </Tooltip>
      )
    }
  ]

  const winBtnBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 40, height: 48, border: 'none', background: 'transparent',
    cursor: 'pointer', color: '#777', fontSize: 12, flexShrink: 0,
    WebkitAppRegion: 'no-drag', transition: 'background 0.12s, color 0.12s',
    padding: 0
  }

  return (
    <Header
      style={{
        background: 'var(--bg-header)',
        borderBottom: '1px solid var(--border)',
        padding: 0,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        WebkitAppRegion: 'drag'
      }}
    >
      {/* 标题 */}
      <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)', letterSpacing: 1, padding: '0 14px 0 16px', flexShrink: 0, WebkitAppRegion: 'drag' }}>
        FilmManager
      </div>

      {/* 拖拽占位 */}
      <div style={{ flex: 1, WebkitAppRegion: 'drag' }} />

      {/* 操作区 */}
      <Space size={4} style={{ WebkitAppRegion: 'no-drag', padding: '0 6px' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#666' }} />}
          placeholder="搜索文件名..."
          value={searchInput}
          onChange={handleSearchChange}
          onClear={handleSearchClear}
          allowClear
          style={{ width: 190, background: 'var(--bg-elevated)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
        />

        {/* 视图模式切换：卷 / 单张 / 时间线 */}
        <Segmented
          options={[
            { value: 'rolls', label: <Tooltip title="卷视图"><BlockOutlined /></Tooltip> },
            { value: 'photos', label: <Tooltip title="照片视图"><AppstoreOutlined /></Tooltip> },
            { value: 'timeline', label: <Tooltip title="时间线视图"><CalendarOutlined /></Tooltip> }
          ]}
          value={viewMode}
          onChange={(v) => {
            setViewMode(v as 'rolls' | 'photos' | 'timeline')
            if (v === 'rolls' || v === 'timeline') setActiveRoll(null)
          }}
          style={{ background: 'var(--bg-elevated)' }}
        />

        {/* 卷内视图返回按钮 */}
        {viewMode === 'photos' && activeRoll && (
          <Tooltip title="返回卷视图">
            <Button
              icon={<RollbackOutlined />}
              onClick={() => { setActiveRoll(null); setViewMode('rolls') }}
              style={{ background: 'var(--bg-elevated)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
            />
          </Tooltip>
        )}

        {/* 分组分隔线 */}
        <div style={{ width: 1, height: 20, background: '#2a2a2a', flexShrink: 0, margin: '0 2px' }} />

        {/* 库管理工具组 */}
        <Tooltip title="新建子库">
          <Button icon={<FolderAddOutlined />} onClick={onCreateSubLib} style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </Tooltip>
        <Tooltip title="地点地图">
          <Button icon={<EnvironmentOutlined />} onClick={onOpenMap} style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </Tooltip>
        <Tooltip title="胶卷库">
          <Button icon={<VideoCameraOutlined />} onClick={onOpenFilmLibrary} style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </Tooltip>
        <Tooltip title="相机库">
          <Button icon={<CameraOutlined />} onClick={onOpenCameraLibrary} style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </Tooltip>
        <Tooltip title="镜头库">
          <Button icon={<AimOutlined />} onClick={onOpenLensLibrary} style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </Tooltip>

        {/* 分组分隔线 */}
        <div style={{ width: 1, height: 20, background: '#2a2a2a', flexShrink: 0, margin: '0 2px' }} />

        {selectedIds.size > 0 && viewMode !== 'rolls' && (
          <Badge count={selectedIds.size} size="small">
            <Tooltip title="将所选照片建立为胶卷卷">
              <Button
                icon={<BlockOutlined />}
                onClick={onCreateRoll}
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--accent)', color: 'var(--accent)' }}
              />
            </Tooltip>
          </Badge>
        )}

        <Button
          type="primary"
          icon={<ImportOutlined />}
          onClick={onImport}
          style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
        >
          导入
        </Button>

        {/* 分组分隔线 */}
        <div style={{ width: 1, height: 20, background: '#2a2a2a', flexShrink: 0, margin: '0 2px' }} />

        <Segmented
          options={sizeOptions}
          value={activeSize}
          onChange={(v) => setActiveSize(v as 'small' | 'medium' | 'large')}
          style={{ background: 'var(--bg-elevated)' }}
        />

        <Tooltip title="设置">
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--text-primary)' }} />
        </Tooltip>

        <span style={{ color: 'var(--text-dim)', fontSize: 11, minWidth: 44, textAlign: 'center', WebkitAppRegion: 'drag' }}>
          {totalCount} 张
        </span>
      </Space>

      {/* 分隔线 */}
      <div style={{ width: 1, height: 22, background: 'var(--border)', flexShrink: 0 }} />

      {/* 窗口控制 */}
      <button
        style={winBtnBase}
        onClick={() => window.api.win.minimize()}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#777' }}
        title="最小化"
      >
        <MinusOutlined />
      </button>
      <button
        style={winBtnBase}
        onClick={() => window.api.win.maximize()}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-elevated)'; e.currentTarget.style.color = 'var(--text-primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#777' }}
        title="最大化 / 还原"
      >
        <BorderOutlined />
      </button>
      <button
        style={winBtnBase}
        onClick={() => window.api.win.close()}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#c0392b'; e.currentTarget.style.color = '#fff' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#777' }}
        title="关闭"
      >
        <CloseOutlined />
      </button>
    </Header>
  )
}
