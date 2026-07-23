/**
 * FilmIconImg — 显示单个胶片图标（带缓存）
 * FilmTag — 显示"[图标] 胶片名称"格式的标签
 * FilmIconPicker — 胶片选择弹窗（图标网格 + 新增）
 */
import React, { useEffect, useState, useMemo, useCallback, memo } from 'react'
import { Modal, Input, Tooltip, Empty, Spin, Button, Space, Divider } from 'antd'
import { SearchOutlined, PlusOutlined, PictureOutlined } from '@ant-design/icons'
import { useStore } from '../../store'
import type { AttributeValue } from '../../types'

// ── FilmIconImg ───────────────────────────────────────────────────────────────

interface FilmIconImgProps {
  iconKey?: string | null
  size?: number
  className?: string
  style?: React.CSSProperties
}

export const FilmIconImg = memo(function FilmIconImg({
  iconKey,
  size = 24,
  style
}: FilmIconImgProps) {
  const { filmIconCache, mergeFilmIconCache } = useStore()

  useEffect(() => {
    if (!iconKey || filmIconCache[iconKey]) return
    window.api.attrs.filmIconDataUrl(iconKey, 64).then((url) => {
      if (url) mergeFilmIconCache({ [iconKey]: url })
    })
  }, [iconKey])

  if (!iconKey) return null
  const url = filmIconCache[iconKey]
  if (!url) return <span style={{ display: 'inline-block', width: size, height: size, ...style }} />

  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0, ...style }}
    />
  )
})

// ── FilmTag ───────────────────────────────────────────────────────────────────

interface FilmTagProps {
  value: string
  iconKey?: string | null
  iconSize?: number
  style?: React.CSSProperties
}

export const FilmTag = memo(function FilmTag({ value, iconKey, iconSize = 20, style }: FilmTagProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, ...style }}>
      {iconKey && <FilmIconImg iconKey={iconKey} size={iconSize} />}
      <span>{value}</span>
    </span>
  )
})

// ── FilmIconPicker ────────────────────────────────────────────────────────────

interface FilmIconPickerProps {
  open: boolean
  filmValues: AttributeValue[]
  selectedValueId?: number | null
  onSelect: (valueId: number) => void
  onNewValue?: (value: AttributeValue) => void
  onClose: () => void
}

export function FilmIconPicker({
  open,
  filmValues,
  selectedValueId,
  onSelect,
  onNewValue,
  onClose
}: FilmIconPickerProps) {
  const { filmIconCache, mergeFilmIconCache, attrTypes } = useStore()
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  // inline add-new state
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIconKey, setNewIconKey] = useState<string | null>(null)
  const [newIconUrl, setNewIconUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // reset add form when dialog closes
  useEffect(() => {
    if (!open) {
      setAdding(false)
      setNewName('')
      setNewIconKey(null)
      setNewIconUrl(null)
      setSearch('')
    }
  }, [open])

  // preload icons in batches
  useEffect(() => {
    if (!open) return
    const needed = filmValues
      .filter((v) => v.icon_key && !filmIconCache[v.icon_key])
      .map((v) => v.icon_key!)
    if (needed.length === 0) return

    setLoading(true)
    const batches: string[][] = []
    for (let i = 0; i < needed.length; i += 20) batches.push(needed.slice(i, i + 20))
    Promise.all(batches.map((b) => window.api.attrs.filmIconsBatch(b, 64))).then((results) => {
      const merged: Record<string, string> = {}
      results.forEach((r) => Object.assign(merged, r))
      mergeFilmIconCache(merged)
      setLoading(false)
    })
  }, [open, filmValues.length])

  const filtered = useMemo(() => {
    const q = search.replace(/\s+/g, '').toLowerCase()
    return q ? filmValues.filter((v) => v.value.replace(/\s+/g, '').toLowerCase().includes(q)) : filmValues
  }, [filmValues, search])

  const withIcon = filtered.filter((v) => v.icon_key)
  const withoutIcon = filtered.filter((v) => !v.icon_key)

  const handlePickIcon = async () => {
    const key = await window.api.attrs.importCustomIcon() as string | null
    if (!key) return
    // load the freshly saved icon
    const url = await window.api.attrs.filmIconDataUrl(key, 64) as string | null
    if (url) {
      mergeFilmIconCache({ [key]: url })
      setNewIconUrl(url)
    }
    setNewIconKey(key)
  }

  const handleSaveNew = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    try {
      const filmType = attrTypes.find((t) => t.key === 'film')
      if (!filmType) return
      const newId = await window.api.attrs.addValue(filmType.id, name, newIconKey ?? undefined) as number
      const newVal: AttributeValue = {
        id: newId,
        attribute_type_id: filmType.id,
        value: name,
        icon_key: newIconKey ?? undefined,
        is_preset: 0
      }
      onNewValue?.(newVal)
      onSelect(newId)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="选择胶片类型"
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      mask={false}
      draggable
      styles={{
        content: { background: '#1a1a1a', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)', padding: 0 },
        header: { background: '#1a1a1a', borderBottom: '1px solid #252525', padding: '14px 20px' },
        body: { padding: '12px 16px 16px' }
      }}
    >
      {/* 新增胶片表单 */}
      {adding ? (
        <div style={{ marginBottom: 12, padding: 12, background: '#111', borderRadius: 8, border: '1px solid #2a2a2a' }}>
          <div style={{ color: '#888', fontSize: 12, marginBottom: 10 }}>新增胶片类型</div>
          <Input
            autoFocus
            placeholder="胶片名称（如 Kodak Ultramax 400）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onPressEnter={handleSaveNew}
            style={{ background: '#222', borderColor: '#333', color: '#ccc', marginBottom: 10 }}
          />
          {/* 图标选择 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div
              onClick={handlePickIcon}
              style={{
                width: 56,
                height: 56,
                background: '#1e1e1e',
                border: '1px dashed #444',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                flexShrink: 0,
                overflow: 'hidden'
              }}
            >
              {newIconUrl ? (
                <img src={newIconUrl} alt="" width={56} height={56} style={{ objectFit: 'cover' }} />
              ) : (
                <PictureOutlined style={{ fontSize: 20, color: '#444' }} />
              )}
            </div>
            <div>
              <Button
                size="small"
                onClick={handlePickIcon}
                style={{ background: '#222', borderColor: '#333', color: '#aaa', marginBottom: 4, display: 'block' }}
              >
                {newIconKey ? '更换图标' : '选择图标（可选）'}
              </Button>
              {newIconKey && (
                <Button
                  size="small"
                  type="text"
                  onClick={() => { setNewIconKey(null); setNewIconUrl(null) }}
                  style={{ color: '#666', padding: 0, fontSize: 11 }}
                >
                  移除图标
                </Button>
              )}
              <div style={{ color: '#555', fontSize: 11 }}>支持 JPG、PNG、WebP</div>
            </div>
          </div>
          <Space>
            <Button
              type="primary"
              size="small"
              loading={saving}
              onClick={handleSaveNew}
              disabled={!newName.trim()}
              style={{ background: '#c8832a', borderColor: '#c8832a' }}
            >
              保存
            </Button>
            <Button
              size="small"
              onClick={() => { setAdding(false); setNewName(''); setNewIconKey(null); setNewIconUrl(null) }}
              style={{ background: '#222', borderColor: '#333', color: '#888' }}
            >
              取消
            </Button>
          </Space>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Input
            prefix={<SearchOutlined style={{ color: '#555' }} />}
            placeholder="搜索胶片名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
            style={{ flex: 1, background: '#222', borderColor: '#333' }}
            autoFocus
          />
          <Button
            icon={<PlusOutlined />}
            onClick={() => setAdding(true)}
            style={{ background: '#222', borderColor: '#333', color: '#c8832a' }}
          >
            新增
          </Button>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin size="small" />
          <span style={{ marginLeft: 8, color: '#666', fontSize: 12 }}>加载图标中...</span>
        </div>
      )}

      {!loading && !adding && filtered.length === 0 && (
        <Empty description={<span style={{ color: '#555' }}>没有匹配的胶片</span>} />
      )}

      {!loading && !adding && withIcon.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: 8,
              maxHeight: 380,
              overflowY: 'auto'
            }}
          >
            {withIcon.map((v) => {
              const isSelected = v.id === selectedValueId
              const iconUrl = v.icon_key ? filmIconCache[v.icon_key] : null
              return (
                <Tooltip title={v.value} key={v.id} placement="top">
                  <div
                    onClick={() => { onSelect(v.id); onClose() }}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 5,
                      padding: '8px 4px',
                      borderRadius: 6,
                      cursor: 'pointer',
                      border: isSelected ? '2px solid #c8832a' : '2px solid transparent',
                      background: isSelected ? 'rgba(200,131,42,0.12)' : 'transparent',
                      transition: 'all 0.15s'
                    }}
                    className="film-icon-item"
                  >
                    {iconUrl ? (
                      <img
                        src={iconUrl}
                        alt={v.value}
                        width={64}
                        height={64}
                        style={{ borderRadius: 6, objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 64,
                          height: 64,
                          background: '#222',
                          borderRadius: 6,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#555',
                          fontSize: 10
                        }}
                      >
                        ...
                      </div>
                    )}
                    <span
                      style={{
                        fontSize: 10,
                        color: isSelected ? '#c8832a' : '#aaa',
                        textAlign: 'center',
                        lineHeight: '14px',
                        maxWidth: 96,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        width: '100%'
                      }}
                    >
                      {v.value}
                    </span>
                  </div>
                </Tooltip>
              )
            })}
          </div>
        </div>
      )}

      {!loading && !adding && withoutIcon.length > 0 && (
        <div>
          {withIcon.length > 0 && (
            <div style={{ color: '#555', fontSize: 11, marginBottom: 6, paddingTop: 8, borderTop: '1px solid #252525' }}>
              其他胶片
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {withoutIcon.map((v) => (
              <div
                key={v.id}
                onClick={() => { onSelect(v.id); onClose() }}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: v.id === selectedValueId ? '1px solid #c8832a' : '1px solid #333',
                  background: v.id === selectedValueId ? 'rgba(200,131,42,0.12)' : '#1e1e1e',
                  color: v.id === selectedValueId ? '#c8832a' : '#bbb',
                  fontSize: 12,
                  cursor: 'pointer'
                }}
              >
                {v.value}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}
