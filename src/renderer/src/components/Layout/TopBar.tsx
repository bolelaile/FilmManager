import React, { useCallback } from 'react'
import { Layout, Button, Input, Segmented, Tooltip, Space, Badge } from 'antd'
import {
  ImportOutlined,
  SettingOutlined,
  SearchOutlined,
  DeleteOutlined,
  FolderAddOutlined,
  EnvironmentOutlined,
  VideoCameraOutlined,
  CameraOutlined,
  AimOutlined,
  EditOutlined,
  MinusOutlined,
  BorderOutlined,
  CloseOutlined,
  RotateRightOutlined,
  FolderOutlined
} from '@ant-design/icons'
import { useStore } from '../../store'

const { Header } = Layout

interface TopBarProps {
  onImport: () => void
  onBatchDelete: () => void
  onBatchEdit: () => void
  onBatchRotate: () => void
  onMoveToSubLibrary: () => void
  onCreateSubLib: () => void
  onOpenMap: () => void
  onOpenFilmLibrary: () => void
  onOpenCameraLibrary: () => void
  onOpenLensLibrary: () => void
  totalCount: number
}

export default function TopBar({
  onImport, onBatchDelete, onBatchEdit, onBatchRotate, onMoveToSubLibrary, onCreateSubLib,
  onOpenMap, onOpenFilmLibrary, onOpenCameraLibrary, onOpenLensLibrary, totalCount
}: TopBarProps) {
  const { filter, setFilter, thumbnailSize, setThumbnailSize, selectedIds, setSettingsOpen } = useStore()

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFilter({ search: e.target.value || undefined })
    },
    [setFilter]
  )

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
    WebkitAppRegion: 'no-drag' as never, transition: 'background 0.12s, color 0.12s',
    padding: 0
  }

  return (
    <Header
      style={{
        background: '#1a1a1a',
        borderBottom: '1px solid #2a2a2a',
        padding: 0,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        WebkitAppRegion: 'drag' as never
      }}
    >
      {/* 标题 */}
      <div style={{ fontWeight: 700, fontSize: 15, color: '#c8832a', letterSpacing: 1, padding: '0 14px 0 16px', flexShrink: 0, WebkitAppRegion: 'drag' as never }}>
        FilmManager
      </div>

      {/* 拖拽占位 */}
      <div style={{ flex: 1, WebkitAppRegion: 'drag' as never }} />

      {/* 操作区 */}
      <Space size={6} style={{ WebkitAppRegion: 'no-drag' as never, padding: '0 6px' }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#666' }} />}
          placeholder="搜索文件名..."
          value={filter.search ?? ''}
          onChange={handleSearchChange}
          allowClear
          style={{ width: 190, background: '#262626', borderColor: '#333', color: '#fff' }}
        />

        {selectedIds.size > 0 && (
          <>
            <Badge count={selectedIds.size} size="small">
              <Tooltip title="删除所选">
                <Button
                  icon={<DeleteOutlined />}
                  danger
                  onClick={onBatchDelete}
                  style={{ background: '#2a1515', borderColor: '#5c2020' }}
                />
              </Tooltip>
            </Badge>
            <Tooltip title="批量编辑属性">
              <Button
                icon={<EditOutlined />}
                onClick={onBatchEdit}
                style={{ background: '#1f1f1f', borderColor: '#333', color: '#c8832a' }}
              />
            </Tooltip>
            <Tooltip title="顺时针旋转 90°">
              <Button
                icon={<RotateRightOutlined />}
                onClick={onBatchRotate}
                style={{ background: '#1f1f1f', borderColor: '#333', color: '#c8832a' }}
              />
            </Tooltip>
            <Tooltip title="移动到子库">
              <Button
                icon={<FolderOutlined />}
                onClick={onMoveToSubLibrary}
                style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }}
              />
            </Tooltip>
          </>
        )}

        <Tooltip title="新建子库">
          <Button icon={<FolderAddOutlined />} onClick={onCreateSubLib} style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }} />
        </Tooltip>
        <Tooltip title="地点地图">
          <Button icon={<EnvironmentOutlined />} onClick={onOpenMap} style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }} />
        </Tooltip>
        <Tooltip title="胶卷库">
          <Button icon={<VideoCameraOutlined />} onClick={onOpenFilmLibrary} style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }} />
        </Tooltip>
        <Tooltip title="相机库">
          <Button icon={<CameraOutlined />} onClick={onOpenCameraLibrary} style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }} />
        </Tooltip>
        <Tooltip title="镜头库">
          <Button icon={<AimOutlined />} onClick={onOpenLensLibrary} style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }} />
        </Tooltip>

        <Button
          type="primary"
          icon={<ImportOutlined />}
          onClick={onImport}
          style={{ background: '#c8832a', borderColor: '#c8832a' }}
        >
          导入
        </Button>

        <Segmented
          options={sizeOptions}
          value={thumbnailSize}
          onChange={(v) => setThumbnailSize(v as 'small' | 'medium' | 'large')}
          style={{ background: '#262626' }}
        />

        <Tooltip title="设置">
          <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} style={{ background: '#1f1f1f', borderColor: '#333', color: '#ccc' }} />
        </Tooltip>

        <span style={{ color: '#555', fontSize: 11, minWidth: 44, textAlign: 'center', WebkitAppRegion: 'drag' as never }}>
          {totalCount} 张
        </span>
      </Space>

      {/* 分隔线 */}
      <div style={{ width: 1, height: 22, background: '#2a2a2a', flexShrink: 0 }} />

      {/* 窗口控制 */}
      <button
        style={winBtnBase}
        onClick={() => window.api.win.minimize()}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.color = '#ccc' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#777' }}
        title="最小化"
      >
        <MinusOutlined />
      </button>
      <button
        style={winBtnBase}
        onClick={() => window.api.win.maximize()}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#2a2a2a'; e.currentTarget.style.color = '#ccc' }}
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
