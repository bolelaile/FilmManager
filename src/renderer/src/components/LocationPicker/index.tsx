/**
 * LocationPicker — 支持本地检索、在线搜索、经纬度手动录入、地图拖拽选点
 * 地图部分使用 MapLibre GL JS 替代 Leaflet
 */
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Input, Button, Spin, Empty, Divider, Space, Tooltip } from 'antd'
import {
  SearchOutlined, EnvironmentOutlined, PlusOutlined, LoadingOutlined,
  GlobalOutlined, AimOutlined, CloseOutlined, CheckOutlined
} from '@ant-design/icons'
import * as maplibregl from 'maplibre-gl'
import type { Location, LocationSearchResult } from '../../types'

// OSM 栅格瓦片样式
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }
  },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm', minzoom: 0, maxzoom: 19 }]
}

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
  const [allLocations, setAllLocations] = useState<Location[]>([])
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 地图选点模式
  const [showMap, setShowMap] = useState(false)
  const [mapPinLat, setMapPinLat] = useState<number>(35.5)
  const [mapPinLng, setMapPinLng] = useState<number>(105)
  const [mapReverseResult, setMapReverseResult] = useState<{ name: string; address: string } | null>(null)
  const [reverseLoading, setReverseLoading] = useState(false)
  const [editingMapName, setEditingMapName] = useState('')

  const mapContainerRef = useRef<HTMLDivElement>(null)
  const miniMapRef = useRef<maplibregl.Map | null>(null)
  const markerRef = useRef<maplibregl.Marker | null>(null)
  const reverseDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    window.api.locations.list().then((locs) => {
      setAllLocations(locs as Location[])
    })
  }, [])

  // 反向地理编码辅助
  const doReverseGeocode = useCallback(async (lat: number, lng: number) => {
    if (reverseDebounceRef.current) clearTimeout(reverseDebounceRef.current)
    reverseDebounceRef.current = setTimeout(async () => {
      setReverseLoading(true)
      try {
        const res = await window.api.locations.reverseGeocode(lat, lng) as { name: string; address: string } | null
        if (res) {
          setMapReverseResult(res)
          setEditingMapName(res.name)
        }
      } finally {
        setReverseLoading(false)
      }
    }, 300)
  }, [])

  // 挂载/卸载迷你地图
  useEffect(() => {
    if (!showMap) {
      if (miniMapRef.current) {
        miniMapRef.current.remove()
        miniMapRef.current = null
        markerRef.current = null
      }
      return
    }

    if (!mapContainerRef.current) return

    if (miniMapRef.current) {
      miniMapRef.current.remove()
      miniMapRef.current = null
    }

    // 橙色拖拽标记元素
    const markerEl = document.createElement('div')
    markerEl.innerHTML = `<div style="
      width:22px;height:22px;background:#c8832a;
      border-radius:50% 50% 50% 0;border:2px solid #fff;
      transform:rotate(-45deg);
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
    "></div>`

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OSM_STYLE,
      center: [mapPinLng, mapPinLat],   // [lng, lat]
      zoom: mapPinLat === 35.5 && mapPinLng === 105 ? 3 : 10,
      attributionControl: false
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    const marker = new maplibregl.Marker({ element: markerEl, anchor: 'bottom', draggable: true })
      .setLngLat([mapPinLng, mapPinLat])
      .addTo(map)

    marker.on('dragend', () => {
      const pos = marker.getLngLat()
      setMapPinLat(pos.lat)
      setMapPinLng(pos.lng)
      setMapReverseResult(null)
      setEditingMapName('')
      doReverseGeocode(pos.lat, pos.lng)
    })

    map.on('click', (e: maplibregl.MapMouseEvent) => {
      const { lng, lat } = e.lngLat
      marker.setLngLat([lng, lat])
      setMapPinLat(lat)
      setMapPinLng(lng)
      setMapReverseResult(null)
      setEditingMapName('')
      doReverseGeocode(lat, lng)
    })

    markerRef.current = marker
    miniMapRef.current = map

    return () => {
      if (reverseDebounceRef.current) clearTimeout(reverseDebounceRef.current)
    }
  }, [showMap])

  // 清理反向地理编码防抖定时器
  useEffect(() => {
    return () => {
      if (reverseDebounceRef.current) clearTimeout(reverseDebounceRef.current)
    }
  }, [])

  const handleConfirmMapPin = async () => {
    const name = editingMapName.trim()
    if (!name) return
    const address = mapReverseResult?.address ?? `${mapPinLat.toFixed(5)}, ${mapPinLng.toFixed(5)}`
    setSaving(true)
    try {
      const id = await window.api.locations.add(name, address, mapPinLat, mapPinLng) as number
      const loc: Location = { id, name, address, lat: mapPinLat, lng: mapPinLng, created_at: '' }
      setAllLocations((prev) => [...prev, loc])
      onSelect(loc)
      setShowMap(false)
      setMapReverseResult(null)
      setEditingMapName('')
      setMapPinLat(35.5)
      setMapPinLng(105)
    } finally {
      setSaving(false)
    }
  }

  const handleSearch = (q: string) => {
    setQuery(q)
    setRemoteResults(null)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) {
      setLocalResults([])
      return
    }
    const nq = normalize(q)
    const local = allLocations
      .filter((l) => normalize(l.name).includes(nq) || normalize(l.address).includes(nq))
      .slice(0, 10)
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

  // 手动输入坐标视图
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

  // 地图选点视图
  if (showMap) {
    return (
      <div style={{ background: '#111', borderRadius: 8, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        {/* 标题栏 */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #1e1e1e' }}>
          <span style={{ color: '#aaa', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AimOutlined style={{ color: '#c8832a' }} /> 点击或拖拽标记选择地点
          </span>
          <Button
            size="small" type="text"
            icon={<CloseOutlined />}
            onClick={() => { setShowMap(false); setMapReverseResult(null); setEditingMapName('') }}
            style={{ color: '#666' }}
          />
        </div>

        {/* 地图区域 */}
        <div ref={mapContainerRef} style={{ width: '100%', height: 240 }} />

        {/* 坐标 + 地名显示 */}
        <div style={{ padding: '8px 12px', borderTop: '1px solid #1e1e1e', background: '#141414' }}>
          <div style={{ color: '#555', fontSize: 11, marginBottom: 6 }}>
            {mapPinLat.toFixed(5)}, {mapPinLng.toFixed(5)}
          </div>

          {reverseLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#666', fontSize: 12 }}>
              <Spin size="small" /> 正在识别附近地名…
            </div>
          )}

          {!reverseLoading && mapReverseResult && (
            <div>
              <div style={{ color: '#666', fontSize: 11, marginBottom: 4 }}>识别到附近地名，可编辑后保存：</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <Input
                  size="small"
                  value={editingMapName}
                  onChange={(e) => setEditingMapName(e.target.value)}
                  placeholder="地点名称"
                  style={{ background: '#222', borderColor: '#333', color: '#ccc', flex: 1 }}
                  onPressEnter={handleConfirmMapPin}
                />
                <Tooltip title="确认选择此地点">
                  <Button
                    size="small" type="primary"
                    icon={<CheckOutlined />}
                    loading={saving}
                    disabled={!editingMapName.trim()}
                    onClick={handleConfirmMapPin}
                    style={{ background: '#c8832a', borderColor: '#c8832a' }}
                  />
                </Tooltip>
              </div>
              {mapReverseResult.address && (
                <div style={{ color: '#444', fontSize: 10, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mapReverseResult.address}
                </div>
              )}
            </div>
          )}

          {!reverseLoading && !mapReverseResult && (
            <div style={{ color: '#444', fontSize: 11 }}>
              在地图上点击或拖动标记以选择位置
            </div>
          )}
        </div>
      </div>
    )
  }

  const showDropdown = query.trim() && (localResults.length > 0 || remoteResults !== null)

  return (
    <div>
      <div style={{ display: 'flex', gap: 6 }}>
        <Input
          prefix={<SearchOutlined style={{ color: '#555' }} />}
          placeholder={placeholder}
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          allowClear
          onClear={() => { setLocalResults([]); setRemoteResults(null) }}
          style={{ background: '#222', borderColor: '#333', flex: 1 }}
        />
        <Tooltip title="地图选点">
          <Button
            icon={<AimOutlined />}
            onClick={() => { setShowMap(true); setQuery(''); setLocalResults([]); setRemoteResults(null) }}
            style={{ background: '#1a1a1a', borderColor: '#333', color: '#c8832a' }}
          />
        </Tooltip>
      </div>

      {showDropdown && (
        <div style={{
          marginTop: 4, background: '#1a1a1a', border: '1px solid #2a2a2a',
          borderRadius: 6, overflow: 'hidden', maxHeight: 300, overflowY: 'auto'
        }}>
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
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            onClick={() => setShowManual(true)}
            style={{ color: '#555', fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <PlusOutlined style={{ fontSize: 10 }} /> 手动添加地点
          </div>
        </div>
      )}
    </div>
  )
}
