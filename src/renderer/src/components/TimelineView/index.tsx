import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Spin, Select, DatePicker } from 'antd'
import { DownOutlined, RightOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useFilterStore } from '../../store/filterSlice'
import { useUIStore } from '../../store/uiSlice'
import type { Photo } from '../../types'

interface TimelineThumb {
  id: number
  thumb_path: string
  thumb_ready: number
  file_type: string
  original_name: string
  rotation: number
}

interface TimelineMonth {
  month: string   // 'YYYY-MM'
  count: number
  thumbs: TimelineThumb[]
}

const monthNames = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月']

// ─── 年份标题分隔行 ─────────────────────────────────────────────────────────────
function YearHeader({ year }: { year: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      margin: '8px 0 12px', width: '100%'
    }}>
      <span style={{ color: 'var(--text-primary)', fontSize: 20, fontWeight: 700, letterSpacing: 1, flexShrink: 0 }}>
        {year}
      </span>
      <div style={{ flex: 1, height: 1, background: 'var(--border-strong)' }} />
    </div>
  )
}

// ─── small 模式：封面卡片 ───────────────────────────────────────────────────────
function SmallMonthCard({ item, onClick }: { item: TimelineMonth; onClick: () => void }) {
  const monthIdx = parseInt(item.month.slice(5, 7), 10) - 1
  const cover = item.thumbs[0]
  return (
    <div
      onClick={onClick}
      style={{
        width: 120, cursor: 'pointer', borderRadius: 6,
        border: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        overflow: 'hidden',
        transition: 'border-color 0.15s, background 0.15s'
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'
      }}
    >
      <div style={{ width: '100%', aspectRatio: '1/1', background: 'var(--bg-elevated)', overflow: 'hidden' }}>
        {cover
          ? <ThumbCell thumbPath={cover.thumb_path} size={120} />
          : <div style={{ width: '100%', height: '100%', background: 'var(--bg-elevated)' }} />
        }
      </div>
      <div style={{ padding: '6px 8px' }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 600 }}>{monthNames[monthIdx]}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{item.count} 张</div>
      </div>
    </div>
  )
}

// ─── medium 模式：6 格缩略图卡片 ───────────────────────────────────────────────
function MediumMonthCard({ item, onClick }: { item: TimelineMonth; onClick: () => void }) {
  const monthIdx = parseInt(item.month.slice(5, 7), 10) - 1
  return (
    <div
      onClick={onClick}
      style={{
        width: 200, background: 'var(--bg-surface)',
        border: '1px solid var(--border)', borderRadius: 6,
        padding: '10px 12px', cursor: 'pointer',
        transition: 'border-color 0.15s, background 0.15s'
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)'
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)'
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-surface)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <span style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600 }}>{monthNames[monthIdx]}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{item.count} 张</span>
      </div>
      {item.thumbs.length > 0 && (
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
          {item.thumbs.slice(0, 6).map((t) => (
            <ThumbCell key={t.id} thumbPath={t.thumb_path} size={52} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── large 模式：可折叠行（缩略图 140px，可点击打开预览） ───────────────────────
const LARGE_THUMB = 140

function LargeMonthRow({
  item, onClick, onThumbClick
}: {
  item: TimelineMonth
  onClick: () => void
  onThumbClick: (id: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const monthIdx = parseInt(item.month.slice(5, 7), 10) - 1
  const previewRow = item.thumbs.slice(0, 5)
  const restRows = item.thumbs.slice(5)

  return (
    <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 14 }}>
      {/* 月份标题行 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 10, cursor: 'pointer', userSelect: 'none'
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ color: 'var(--text-dim)', fontSize: 13, width: 16 }}>
          {expanded ? <DownOutlined /> : <RightOutlined />}
        </span>
        <span
          style={{ color: 'var(--accent)', fontSize: 15, fontWeight: 600, minWidth: 48 }}
          onClick={(e) => { e.stopPropagation(); onClick() }}
        >
          {monthNames[monthIdx]}
        </span>
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{item.count} 张</span>
      </div>
      {/* 默认一行 5 张 */}
      {previewRow.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {previewRow.map((t) => (
            <ThumbCell key={t.id} thumbPath={t.thumb_path} size={LARGE_THUMB} onClick={() => onThumbClick(t.id)} />
          ))}
          {/* 折叠时若有更多，显示占位 +N */}
          {!expanded && item.count > 5 && (
            <div
              onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
              style={{
                width: LARGE_THUMB, height: LARGE_THUMB, borderRadius: 4, flexShrink: 0,
                background: 'var(--bg-elevated)', border: '1px dashed var(--border-strong)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 14, fontWeight: 500
              }}
            >
              +{item.count - 5}
            </div>
          )}
        </div>
      )}
      {/* 展开后其余图片 */}
      {expanded && restRows.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
          {restRows.map((t) => (
            <ThumbCell key={t.id} thumbPath={t.thumb_path} size={LARGE_THUMB} onClick={() => onThumbClick(t.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 懒加载缩略图格子 ──────────────────────────────────────────────────────────
function ThumbCell({ thumbPath, size, onClick }: { thumbPath: string; size: number; onClick?: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.api.photos.thumbDataUrl(thumbPath).then((url) => {
      if (!cancelled && url) setDataUrl(url as string)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [thumbPath])

  return (
    <div
      onClick={onClick}
      style={{
        width: size, height: size, borderRadius: 3, overflow: 'hidden',
        background: 'var(--bg-surface)', flexShrink: 0,
        cursor: onClick ? 'pointer' : undefined,
        transition: onClick ? 'opacity 0.1s' : undefined
      }}
      onMouseEnter={(e) => { if (onClick) (e.currentTarget as HTMLElement).style.opacity = '0.82' }}
      onMouseLeave={(e) => { if (onClick) (e.currentTarget as HTMLElement).style.opacity = '1' }}
    >
      {dataUrl ? (
        <img src={dataUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', height: '100%', background: 'var(--bg-elevated)' }} />
      )}
    </div>
  )
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────
interface TimelineViewProps {
  onMonthClick: (year: string, month: string) => void
}

export default function TimelineView({ onMonthClick }: TimelineViewProps) {
  const { filter, setFilter } = useFilterStore()
  const { thumbnailSize, setViewMode, setViewerPhoto, setViewerPhotos, setViewerIndex } = useUIStore()

  const [data, setData] = useState<TimelineMonth[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedYears, setSelectedYears] = useState<string[]>([])
  const [dateField, setDateField] = useState<'shot_date' | 'imported_at'>('shot_date')

  const loadCounterRef = useRef(0)

  const thumbsPerMonth = thumbnailSize === 'small' ? 1 : thumbnailSize === 'large' ? 30 : 6

  const load = useCallback(async () => {
    const counter = ++loadCounterRef.current
    setLoading(true)
    try {
      const result = await window.api.photos.timeline({
        dateField,
        filters: filter.filters,
        subLibraryId: filter.subLibraryId ?? undefined,
        search: filter.search ?? undefined,
        fileTypes: filter.fileTypes,
        organizationStatuses: filter.organizationStatuses as string[],
        starredOnly: filter.starredOnly,
        thumbsPerMonth
      })
      if (counter !== loadCounterRef.current) return
      setData(result as TimelineMonth[])
    } catch {
      if (counter === loadCounterRef.current) setData([])
    } finally {
      if (counter === loadCounterRef.current) setLoading(false)
    }
  }, [filter, dateField, thumbsPerMonth])

  useEffect(() => { load() }, [load])

  // 点击缩略图打开全屏预览
  const handleThumbClick = useCallback(async (id: number) => {
    const photo = await window.api.photos.get(id).catch(() => null) as Photo | null
    if (!photo) return
    setViewerPhotos([photo])
    setViewerIndex(0)
    setViewerPhoto(photo)
  }, [setViewerPhoto, setViewerPhotos, setViewerIndex])

  // 年份多选（仅视图过滤，不写入全局 filter）
  const allYears = Array.from(new Set(data.map((d) => d.month.slice(0, 4)))).sort((a, b) => b.localeCompare(a))
  const activeData = selectedYears.length > 0
    ? data.filter((d) => selectedYears.includes(d.month.slice(0, 4)))
    : data

  // 按年份分组
  const byYear = new Map<string, TimelineMonth[]>()
  for (const item of activeData) {
    const y = item.month.slice(0, 4)
    if (!byYear.has(y)) byYear.set(y, [])
    byYear.get(y)!.push(item)
  }
  const sortedYears = Array.from(byYear.keys()).sort((a, b) => b.localeCompare(a))

  // 月份范围选择：写入 filter 并跳转照片视图
  const handleMonthRangeChange = (dates: [dayjs.Dayjs | null, dayjs.Dayjs | null] | null) => {
    if (!dates || !dates[0] || !dates[1]) {
      setFilter({ dateFrom: undefined, dateTo: undefined })
      return
    }
    setFilter({
      dateFrom: dates[0].format('YYYY-MM-01'),
      dateTo: dates[1].endOf('month').format('YYYY-MM-DD'),
      dateField
    })
    setViewMode('photos')
  }

  const currentRange: [dayjs.Dayjs, dayjs.Dayjs] | null =
    filter.dateFrom && filter.dateTo
      ? [dayjs(filter.dateFrom), dayjs(filter.dateTo)]
      : null

  return (
    <div style={{ padding: '16px 20px', overflowY: 'auto', height: '100%' }}>
      {/* 工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select
          size="small"
          value={dateField}
          onChange={setDateField}
          style={{ width: 110 }}
          options={[
            { label: '拍摄日期', value: 'shot_date' },
            { label: '入库日期', value: 'imported_at' }
          ]}
        />
        {allYears.length > 0 && (
          <Select
            mode="multiple"
            size="small"
            placeholder="筛选年份"
            value={selectedYears}
            onChange={setSelectedYears}
            style={{ minWidth: 120, maxWidth: 280 }}
            options={allYears.map((y) => ({ label: y, value: y }))}
            maxTagCount={3}
          />
        )}
        <DatePicker.RangePicker
          picker="month"
          size="small"
          value={currentRange}
          onChange={handleMonthRangeChange as (dates: unknown, dateStrings: [string, string]) => void}
          placeholder={['开始月份', '结束月份']}
        />
      </div>

      {/* 内容区 */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <Spin />
        </div>
      ) : activeData.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', paddingTop: 60 }}>暂无数据</div>
      ) : thumbnailSize === 'small' ? (
        <div>
          {sortedYears.map((year) => (
            <div key={year}>
              <YearHeader year={year} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
                {byYear.get(year)!.map((item) => (
                  <SmallMonthCard
                    key={item.month}
                    item={item}
                    onClick={() => onMonthClick(item.month.slice(0, 4), item.month.slice(5, 7))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : thumbnailSize === 'large' ? (
        <div>
          {sortedYears.map((year) => (
            <div key={year}>
              <YearHeader year={year} />
              {byYear.get(year)!.map((item) => (
                <LargeMonthRow
                  key={item.month}
                  item={item}
                  onClick={() => onMonthClick(item.month.slice(0, 4), item.month.slice(5, 7))}
                  onThumbClick={handleThumbClick}
                />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div>
          {sortedYears.map((year) => (
            <div key={year}>
              <YearHeader year={year} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
                {byYear.get(year)!.map((item) => (
                  <MediumMonthCard
                    key={item.month}
                    item={item}
                    onClick={() => onMonthClick(item.month.slice(0, 4), item.month.slice(5, 7))}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
