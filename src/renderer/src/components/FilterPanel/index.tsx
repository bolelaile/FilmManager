import React, { useState } from 'react'
import { Tree, Collapse, Checkbox, DatePicker, Select, Button, Tag, Tooltip, Input } from 'antd'
import {
  FolderOutlined,
  FolderOpenOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import dayjs from 'dayjs'
import { useStore } from '../../store'
import type { AttributeType, SubLibrary } from '../../types'
import { FilmIconImg } from '../FilmIcon'

const { RangePicker } = DatePicker
const { Panel } = Collapse

interface FilterPanelProps {
  attrTypes: AttributeType[]
  valueCounts: Record<string, Record<string, number>>
  subLibCounts: Record<string, number>
}

export default function FilterPanel({ attrTypes, valueCounts, subLibCounts }: FilterPanelProps) {
  const { filter, setFilter, subLibraries } = useStore()
  // per-type search query for attribute value filtering
  const [attrSearch, setAttrSearch] = useState<Record<number, string>>({})

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
    nodes.map((n) => {
      const count = subLibCounts[String(n.id)] ?? 0
      return {
        key: n.id,
        title: (
          <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
            <span>{n.name}</span>
            {count > 0 && <span style={{ color: '#555', fontSize: 11, marginLeft: 6 }}>{count}</span>}
          </span>
        ),
        icon: ({ expanded }: { expanded: boolean }) =>
          expanded ? <FolderOpenOutlined /> : <FolderOutlined />,
        children: n.children.length ? buildTree(n.children) : undefined
      }
    })

  const activeFilterCount = Object.values(filter.filters).reduce((s, v) => s + v.length, 0)

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
                  {subLibCounts['null'] !== undefined && subLibCounts['null'] > 0 && (
                    <span style={{ color: '#555', fontSize: 11, marginLeft: 6 }}>{subLibCounts['null']}</span>
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
          style={{ background: 'transparent', color: '#ccc' }}
        />
      </div>

      {/* 入库时间 */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #252525' }}>
        <div style={{ color: '#888', fontSize: 11, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>
          入库时间
        </div>
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

      {/* 属性筛选 */}
      <Collapse
        ghost
        defaultActiveKey={attrTypes.filter((t) => t.is_system).map((t) => t.id)}
        style={{ flex: 1 }}
      >
        {attrTypes.map((type) => {
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
          onClick={() => setFilter({ filters: {}, dateFrom: undefined, dateTo: undefined, subLibraryId: undefined })}
          style={{ margin: '0 12px 8px', color: '#c8832a' }}
        >
          清除所有筛选 ({activeFilterCount})
        </Button>
      )}
    </div>
  )
}
