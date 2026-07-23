/**
 * LocationPicker — 先本地检索（大小写/空格不敏感），无结果时可调 OSM Nominatim
 */
import React, { useState, useRef, useEffect } from 'react'
import { Input, Button, Spin, Empty, Divider, Space } from 'antd'
import { SearchOutlined, EnvironmentOutlined, PlusOutlined, LoadingOutlined, GlobalOutlined } from '@ant-design/icons'
import type { Location, LocationSearchResult } from '../../types'

// 规范化：去除空格、转小写，用于模糊匹配
function normalize(s: string): string {
  return s.replace(/\s+/g, '').toLowerCase()
}

interface LocationPickerProps {
  onSelect: (loc: Location) => void
  placeholder?: string
}

export default function LocationPicker({ onSelect, placeholder = '搜索或新增地点...' }: LocationPickerProps) {
  const [query, setQuery] = useState('')
  const [localResults, setLocalResults] = useState<Location[]>([])
  const [remoteResults, setRemoteResults] = useState<LocationSearchResult[] | null>(null)
  const [searchingRemote, setSearchingRemote] = useState(false)
  const [showManual, setShowManual] = useState(false)
  const [manualName, setManualName] = useState('')
  const [manualAddr, setManualAddr] = useState('')
  const [manualLat, setManualLat] = useState('')
  const [manualLng, setManualLng] = useState('')
  const [saving, setSaving] = useState(false)
  // all locations cached for local search
  const [allLocations, setAllLocations] = useState<Location[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // load all locations once for local search
  useEffect(() => {
    window.api.locations.list().then((locs) => {
      setAllLocations(locs as Location[])
    })
  }, [])

  const handleSearch = (q: string) => {
    setQuery(q)
    setRemoteResults(null)

    if (debounceRef.current) clearTimeout(debounceRef.current)

    if (!q.trim()) {
      setLocalResults([])
      return
    }

    const nq = normalize(q)
    // local search: match name or address, case+space insensitive
    const local = allLocations.filter(
      (l) => normalize(l.name).includes(nq) || normalize(l.address).includes(nq)
    ).slice(0, 10)
    setLocalResults(local)
  }

  const handleSearchRemote = async () => {
    if (!query.trim()) return
    setSearchingRemote(true)
    try {
      const res = await window.api.locations.search(query) as LocationSearchResult[]
      setRemoteResults(res)
    } finally {
      setSearchingRemote(false)
    }
  }

  const handleSelectLocal = (loc: Location) => {
    onSelect(loc)
    setQuery('')
    setLocalResults([])
    setRemoteResults(null)
  }

  const handleSelectRemote = async (r: LocationSearchResult) => {
    setSaving(true)
    try {
      const id = await window.api.locations.add(r.name, r.address, r.lat, r.lng) as number
      const loc: Location = { id, name: r.name, address: r.address, lat: r.lat, lng: r.lng, created_at: '' }
      // update local cache
      setAllLocations((prev) => [...prev, loc])
      onSelect(loc)
      setQuery('')
      setLocalResults([])
      setRemoteResults(null)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveManual = async () => {
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    if (!manualName.trim() || isNaN(lat) || isNaN(lng)) return
    setSaving(true)
    try {
      const id = await window.api.locations.add(manualName.trim(), manualAddr.trim(), lat, lng) as number
      const loc: Location = { id, name: manualName.trim(), address: manualAddr.trim(), lat, lng, created_at: '' }
      setAllLocations((prev) => [...prev, loc])
      onSelect(loc)
      setShowManual(false)
      setManualName(''); setManualAddr(''); setManualLat(''); setManualLng('')
    } finally {
      setSaving(false)
    }
  }

  if (showManual) {
    return (
      <div style={{ background: '#111', borderRadius: 8, padding: 12, border: '1px solid #2a2a2a' }}>
        <div style={{ color: '#888', fontSize: 12, marginBottom: 8 }}>手动添加地点</div>
        <Space direction="vertical" style={{ width: '100%' }} size={6}>
          <Input
            autoFocus
            placeholder="地点名称（如：京都御所）"
            value={manualName}
            onChange={(e) => setManualName(e.target.value)}
            style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
          />
          <Input
            placeholder="详细地址（可选）"
            value={manualAddr}
            onChange={(e) => setManualAddr(e.target.value)}
            style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <Input
              placeholder="纬度（如：35.026）"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
            />
            <Input
              placeholder="经度（如：135.762）"
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              style={{ background: '#222', borderColor: '#333', color: '#ccc' }}
            />
          </div>
          <Space>
            <Button
              type="primary" size="small" loading={saving}
              disabled={!manualName.trim() || !manualLat || !manualLng}
              onClick={handleSaveManual}
              style={{ background: '#c8832a', borderColor: '#c8832a' }}
            >
              保存
            </Button>
            <Button size="small" onClick={() => setShowManual(false)} style={{ background: '#222', borderColor: '#333', color: '#888' }}>
              取消
            </Button>
          </Space>
        </Space>
      </div>
    )
  }

  const showDropdown = query.trim() && (localResults.length > 0 || remoteResults !== null)

  return (
    <div>
      <Input
        prefix={<SearchOutlined style={{ color: '#555' }} />}
        placeholder={placeholder}
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        allowClear
        onClear={() => { setLocalResults([]); setRemoteResults(null) }}
        style={{ background: '#222', borderColor: '#333' }}
      />

      {showDropdown && (
        <div style={{
          marginTop: 4, background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 6, overflow: 'hidden', maxHeight: 300, overflowY: 'auto'
        }}>
          {/* 本地结果 */}
          {localResults.map((loc) => (
            <div
              key={loc.id}
              onClick={() => handleSelectLocal(loc)}
              className="location-result-item"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #222'
              }}
            >
              <EnvironmentOutlined style={{ color: '#c8832a', marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ color: '#ccc', fontSize: 13 }}>{loc.name}</div>
                {loc.address && (
                  <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{loc.address}</div>
                )}
              </div>
            </div>
          ))}

          {/* 在线搜索结果 */}
          {remoteResults !== null && remoteResults.map((r, i) => (
            <div
              key={`r${i}`}
              onClick={() => !saving && handleSelectRemote(r)}
              className="location-result-item"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 12px', cursor: saving ? 'wait' : 'pointer', borderBottom: '1px solid #222'
              }}
            >
              <GlobalOutlined style={{ color: '#5a8a5a', marginTop: 2, flexShrink: 0 }} />
              <div>
                <div style={{ color: '#ccc', fontSize: 13 }}>{r.name}</div>
                <div style={{ color: '#555', fontSize: 11, marginTop: 2 }}>{r.address}</div>
              </div>
            </div>
          ))}

          {remoteResults !== null && remoteResults.length === 0 && (
            <div style={{ padding: '8px 12px' }}>
              <Empty description={<span style={{ color: '#555', fontSize: 12 }}>未找到在线结果</span>} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            </div>
          )}

          <Divider style={{ margin: '4px 0', borderColor: '#2a2a2a' }} />

          {/* 在线搜索按钮 */}
          <div
            onClick={handleSearchRemote}
            style={{ padding: '7px 12px', cursor: searchingRemote ? 'wait' : 'pointer', color: '#5a8a5a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            className="location-result-item"
          >
            {searchingRemote ? <LoadingOutlined /> : <GlobalOutlined />} 在 OpenStreetMap 中搜索"{query}"
          </div>

          <div
            onClick={() => { setShowManual(true); setQuery(''); setLocalResults([]); setRemoteResults(null) }}
            style={{ padding: '7px 12px', cursor: 'pointer', color: '#c8832a', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
            className="location-result-item"
          >
            <PlusOutlined /> 手动输入坐标
          </div>
        </div>
      )}

      {!query.trim() && (
        <div
          onClick={() => setShowManual(true)}
          style={{ marginTop: 6, color: '#555', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
        >
          <PlusOutlined style={{ fontSize: 10 }} /> 手动添加地点
        </div>
      )}
    </div>
  )
}
