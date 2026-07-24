import React, { useState } from 'react'
import { Tree, Collapse, Checkbox, DatePicker, Select, Button, Tag, Tooltip, Input, Segmented, Modal, message } from 'antd'
import {
  FolderOutlined,
  FolderOpenOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SearchOutlined,
  InboxOutlined,
  CalendarOutlined,
  CameraOutlined,
  FileImageOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import dayjs from 'dayjs'
import { useStore } from '../../store'
import type { AttributeType, SubLibrary, PhotoFilterOptions, OrganizationStatus } from '../../types'
import { FilmIconImg } from '../FilmIcon'

const { RangePicker } = DatePicker
const { Panel } = Collapse

interface FilterPanelProps {
  attrTypes: AttributeType[]
  valueCounts: Record<string, Record<string, number>>
  subLibCounts: Record<string, number>
  filterOptions: PhotoFilterOptions
  onSubLibraryDeleted: () => void
}

const organizationStatusItems: { value: OrganizationStatus; label: string; icon: React.ReactNode }[] = [
  { value: 'unclassified', label: '未分类', icon: <InboxOutlined /> },
  { value: 'missing_date', label: '缺少拍摄日期', icon: <CalendarOutlined /> },
  { value: 'missing_camera', label: '缺少相机信息', icon: <CameraOutlined /> }
]

export default function FilterPanel({ attrTypes, valueCounts, subLibCounts, filterOptions, onSubLibraryDeleted }: FilterPanelProps) {
  const { filter, setFilter, subLibraries } = useStore()
  // per-type search query for attribute value filtering
  const [attrSearch, setAttrSearch] = useState<Record<number, string>>({})
  const [contextMenu, setContextMenu] = useState<{ id: number; name: string; x: number; y: number } | null>(null)

  React.useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => {
      window.removeEventListener('click', close)
    }
  }, [contextMenu])

  const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase()

  const handleDateChange = (dates: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) => {
    if (!dates) {
      setFilter({ dateFrom: undefined, dateTo: undefined })
    } else {
      setFilter({
        dateFrom: dates[0]?.format('YYYY-MM-DD'),
        dateTo: dates[1]?.format('YYYY-MM-DD')
      })
    }
  }

  const buildTree = (nodes: SubLibrary[]): DataNode[] =>
    nodes.map<DataNode>((n) => {
      const count = subLibCounts[String(n.id)] ?? 0
      return {
        key: n.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span>{n.name}</span>
            {count > 0 && <span style={{ color: '#555', fontSize: 11, marginLeft: 6 }}>{count}</span>}
          </span>
        ),
        icon: ({ expanded }: { expanded?: boolean }) =>
          expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: n.children.length ? buildTree(n.children) : undefined
      }
    })

  const flattenSubLibraries = (nodes: SubLibrary[], depth = 0): { id: number; name: string; depth: number }[] =>
    nodes.flatMap((node) => [{ id: node.id, name: node.name, depth }, ...flattenSubLibraries(node.children, depth + 1)])

  const selectedStatuses = filter.organizationStatuses ?? []
  const selectedFileTypes = filter.fileTypes ?? []
  const totalPhotoCount = subLibCounts.__total ?? 0
  const attributeFilterCount = Object.values(filter.filters).reduce((s, v) => s + v.length, 0)
  const activeFilterCount = attributeFilterCount
    + selectedStatuses.length
    + selectedFileTypes.length
    + (filter.dateFrom || filter.dateTo ? 1 : 0)
    + (filter.subLibraryId != null ? 1 : 0)

  const toggleOrganizationStatus = (status: OrganizationStatus) => {
    const next = selectedStatuses.includes(status)
      ? selectedStatuses.filter((value) => value !== status)
      : [...selectedStatuses, status]
    setFilter({ organizationStatuses: next })
  }

  return (
    <div
      style={{
        width: 240,
        minWidth: 240,
        background: '#181818',
        borderRight: '1px solid #252525',
        height: '100%',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* 子库树 */}
      <div style={{ padding: '12px 12px 4px', borderBottom: '1px solid #252525' }}>
        <div style={{ color: '#888', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          子库
        </div>
        <Tree
          showIcon
          treeData={[
            {
              key: -1,
              title: (
                <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span>全部照片</span>
                  {totalPhotoCount > 0 && (
                    <span style={{ color: '#555', fontSize: 11, marginLeft: 6 }}>{totalPhotoCount}</span>
                  )}
                </span>
              ),
              icon: <FolderOutlined />
            },
            ...buildTree(subLibraries)
          ]}
          selectedKeys={[filter.subLibraryId ?? -1]}
          onSelect={(keys) => {
            const key = keys[0] as number
            setFilter({ subLibraryId: key === -1 ? undefined : key })
          }}
          onRightClick={({ event, node }) => {
            event.preventDefault()
            const id = Number(node.key)
            if (id <= 0) return
            const name = flattenSubLibraries(subLibraries).find((library) => library.id === id)?.name ?? '子库'
            setContextMenu({
              id,
              name,
              x: Math.min(event.clientX, window.innerWidth - 220),
              y: Math.min(event.clientY, window.innerHeight - 90)
            })
          }}
          style={{ background: 'transparent', color: '#ccc' }}
        />
      </div>

      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            zIndex: 3000,
            minWidth: 190,
            padding: '4px 0',
            background: '#1e1e1e',
            border: '1px solid #333',
            borderRadius: 6,
            boxShadow: '0 6px 24px rgba(0,0,0,0.55)'
          }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}
        >
          <div style={{ padding: '6px 14px', color: '#777', fontSize: 11, borderBottom: '1px solid #2a2a2a' }}>
            {contextMenu.name}
          </div>
          <button
            type="button"
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              border: 0,
              background: 'transparent',
              color: '#ff7875',
              textAlign: 'left',
              cursor: 'pointer'
            }}
            onClick={() => {
              const target = contextMenu
              setContextMenu(null)
              Modal.confirm({
                title: `删除子库“${target.name}”？`,
                content: '直属照片和本地文件会移入图库根目录，子子库及其本地目录会提升为顶层；照片文件不会被删除。',
                okText: '删除子库',
                cancelText: '取消',
                okButtonProps: { danger: true },
                onOk: async () => {
                  try {
                    await window.api.sublib.delete(target.id)
                    if (filter.subLibraryId === target.id) setFilter({ subLibraryId: undefined })
                    onSubLibraryDeleted()
                    message.success(`已删除子库“${target.name}”`)
                  } catch (error) {
                    console.error('delete sub-library failed:', error)
                    message.error('删除子库失败，请检查日志')
                    throw error
                  }
                }
              })
            }}
          >
            <DeleteOutlined />
            删除子库
          </button>
        </div>
      )}

      {/* 时间范围 */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #252525' }}>
        <div style={{ color: '#888', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          时间范围
        </div>
        <Segmented
          block
          size="small"
          value={filter.dateField}
          onChange={(value) => setFilter({ dateField: value as 'imported_at' | 'shot_date' })}
          options={[
            { value: 'imported_at', label: '入库日期' },
            { value: 'shot_date', label: '拍摄日期' }
          ]}
          style={{ marginBottom: 8 }}
        />
        <RangePicker
          size="small"
          style={{ width: '100%', background: '#222', borderColor: '#333' }}
          onChange={handleDateChange as never}
          value={
            filter.dateFrom && filter.dateTo
              ? [dayjs(filter.dateFrom), dayjs(filter.dateTo)]
              : undefined
          }
        />
      </div>

      {/* 整理状态 */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #252525' }}>
        <div style={{ color: '#888', fontSize: 11, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 1 }}>
          整理状态
        </div>
        {organizationStatusItems.map((item) => {
          const count = filterOptions.statusCounts[item.value] ?? 0
          return (
            <div
              key={item.value}
              onClick={() => toggleOrganizationStatus(item.value)}
              style={{
                minHeight: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#bbb', fontSize: 12 }}>
                <Checkbox checked={selectedStatuses.includes(item.value)} style={{ pointerEvents: 'none' }} />
                <span style={{ color: '#666', width: 14 }}>{item.icon}</span>
                {item.label}
              </span>
              <span style={{ color: '#555', fontSize: 11 }}>{count}</span>
            </div>
          )
        })}
      </div>

      {/* 文件格式 */}
      {filterOptions.fileTypes.length > 0 && (
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #252525' }}>
          <div style={{ color: '#888', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
            <FileImageOutlined style={{ marginRight: 5 }} />文件格式
          </div>
          <Select
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            size="small"
            value={selectedFileTypes}
            onChange={(values) => setFilter({ fileTypes: values })}
            placeholder="全部格式"
            style={{ width: '100%' }}
            options={filterOptions.fileTypes.map((item) => ({
              value: item.value,
              label: `${item.value.toUpperCase()} (${item.count})`
            }))}
          />
        </div>
      )}

      {/* 属性筛选 */}
      <Collapse
        ghost
        defaultActiveKey={attrTypes.filter((t) => t.is_system && t.key !== 'imported_at').map((t) => t.id)}
        style={{ flex: 1 }}
      >
        {attrTypes.filter((type) => type.key !== 'imported_at').map((type) => {
          const selectedForType = filter.filters[type.id] ?? []
          const searchQuery = attrSearch[type.id] ?? ''
          const nq = normalize(searchQuery)
          const allValues = (type.values ?? [])
            .filter((v) =>
              v.is_preset === 0 ||
              (valueCounts[type.id]?.[v.id] ?? 0) > 0 ||
              selectedForType.includes(v.id)
            )
          const visibleValues = nq
            ? allValues.filter((v) => normalize(v.value).includes(nq))
            : allValues
          return (
            <Panel
              key={type.id}
              header={
                <span style={{ color: '#ccc', fontSize: 13 }}>
                  {type.display_name}
                  {selectedForType.length > 0 && (
                    <Tag color="#c8832a" style={{ marginLeft: 6, fontSize: 10, lineHeight: '16px', padding: '0 4px' }}>
                      {selectedForType.length}
                    </Tag>
                  )}
                </span>
              }
            >
              {/* 值超过 6 个时显示搜索框 */}
              {allValues.length > 6 && (
                <Input
                  size="small"
                  prefix={<SearchOutlined style={{ color: '#444', fontSize: 10 }} />}
                  placeholder="搜索..."
                  value={searchQuery}
                  onChange={(e) => setAttrSearch((prev) => ({ ...prev, [type.id]: e.target.value }))}
                  allowClear
                  style={{ marginBottom: 6, background: '#1a1a1a', borderColor: '#2a2a2a', fontSize: 11 }}
                />
              )}
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {visibleValues
                  .map((v) => {
                  const count = valueCounts[type.id]?.[v.id] ?? 0
                  const isFilm = type.key === 'film'
                  return (
                    <div
                      key={v.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: isFilm ? '4px 0' : '3px 0',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        const cur = filter.filters[type.id] ?? []
                        const next = cur.includes(v.id) ? cur.filter((x) => x !== v.id) : [...cur, v.id]
                        setFilter({ filters: { ...filter.filters, [type.id]: next } })
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Checkbox
                          checked={selectedForType.includes(v.id)}
                          style={{ pointerEvents: 'none' }}
                        />
                        {isFilm && (v as any).icon_key && (
                          <FilmIconImg iconKey={(v as any).icon_key} size={20} />
                        )}
                        <span style={{ color: '#bbb', fontSize: 12 }}>{v.value}</span>
                      </div>
                      {count > 0 && (
                        <span style={{ color: '#555', fontSize: 11 }}>{count}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </Panel>
          )
        })}
      </Collapse>

      {/* 排序 */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #252525', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Select
          size="small"
          value={filter.sortBy}
          onChange={(v) => setFilter({ sortBy: v })}
          style={{ flex: 1 }}
          options={[
            { value: 'imported_at', label: '入库时间' },
            { value: 'shot_date', label: '拍摄日期' },
            { value: 'file_name', label: '文件名' }
          ]}
        />
        <Tooltip title={filter.sortOrder === 'desc' ? '降序' : '升序'}>
          <Button
            size="small"
            icon={filter.sortOrder === 'desc' ? <SortDescendingOutlined /> : <SortAscendingOutlined />}
            onClick={() => setFilter({ sortOrder: filter.sortOrder === 'desc' ? 'asc' : 'desc' })}
            style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
          />
        </Tooltip>
      </div>

      {/* 清除筛选 */}
      {activeFilterCount > 0 && (
        <Button
          size="small"
          type="link"
          onClick={() => setFilter({
            filters: {},
            dateFrom: undefined,
            dateTo: undefined,
            dateField: 'imported_at',
            fileTypes: [],
            organizationStatuses: [],
            subLibraryId: undefined
          })}
          style={{ margin: '0 12px 8px', color: '#c8832a' }}
        >
          清除所有筛选 ({activeFilterCount})
        </Button>
      )}
    </div>
  )
}
