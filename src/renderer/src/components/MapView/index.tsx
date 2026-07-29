/**
 * MapView — 显示所有有照片标记的地点，点击地标查看该地点照片
 * 使用 MapLibre GL JS（WebGL canvas 渲染，不依赖 CSS 层叠，兼容 Electron Modal）
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Modal, Button, Spin, Empty } from 'antd'
import { CloseOutlined, EnvironmentOutlined, LeftOutlined } from '@ant-design/icons'
import * as maplibregl from 'maplibre-gl'
import type { Location, Photo } from '../../types'

// OSM 栅格瓦片样式（自包含，无需外部 style.json URL）
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

interface MapLocation extends Location {
  photo_count: number
}

interface MapData {
  locations: MapLocation[]
  photosByLoc: Record<number, number[]>
}

interface MapViewProps {
  open: boolean
  onClose: () => void
}

export default function MapView({ open, onClose }: MapViewProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedLoc, setSelectedLoc] = useState<MapLocation | null>(null)
  const [locPhotos, setLocPhotos] = useState<Photo[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.api.locations.mapData() as MapData
      setMapData(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      loadData()
    } else {
      setSelectedLoc(null)
      setLocPhotos([])
    }
  }, [open])

  const handleMarkerClick = useCallback(async (loc: MapLocation) => {
    setSelectedLoc(loc)
    setLoadingPhotos(true)
    try {
      const photoIds = new Set(await window.api.locations.photos(loc.id) as number[])
      if (photoIds.size === 0) { setLocPhotos([]); return }
      const result = await window.api.photos.list({
        page: 1, pageSize: 200, filters: {},
        sortBy: 'shot_date', sortOrder: 'desc'
      }) as { total: number; rows: Photo[] }
      setLocPhotos(result.rows.filter(p => photoIds.has(p.id)))
    } finally {
      setLoadingPhotos(false)
    }
  }, [])

  // 初始化地图（数据加载完成后）
  useEffect(() => {
    if (!open || !mapData || !mapContainerRef.current) return

    // 销毁旧实例
    if (mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
    }
    markersRef.current = []

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: OSM_STYLE,
      center: [105, 35.5],   // [lng, lat] — MapLibre 使用经度优先
      zoom: 3,
      attributionControl: false
    })

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    mapRef.current = map

    map.on('load', () => {
      if (!mapData.locations.length) return

      const bounds = new maplibregl.LngLatBounds()

      for (const loc of mapData.locations) {
        const count = loc.photo_count

        // 自定义标记 DOM 元素
        const el = document.createElement('div')
        el.style.cursor = 'pointer'
        el.innerHTML = `
          <div style="
            display:flex;flex-direction:column;align-items:center;
          ">
            <div style="
              background:#c8832a;color:#fff;border-radius:50%;
              width:32px;height:32px;
              display:flex;align-items:center;justify-content:center;
              font-size:13px;font-weight:600;
              box-shadow:0 2px 8px rgba(0,0,0,0.5);border:2px solid #fff;
            ">${count}</div>
            <div style="
              width:0;height:0;
              border-left:6px solid transparent;
              border-right:6px solid transparent;
              border-top:8px solid #c8832a;
              margin-top:-1px;
            "></div>
          </div>
        `
        el.addEventListener('click', () => handleMarkerClick(loc))

        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([loc.lng, loc.lat])
          .addTo(map)

        markersRef.current.push(marker)
        bounds.extend([loc.lng, loc.lat])
      }

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 500 })
      }
    })
  }, [open, mapData])

  // Modal 关闭时销毁地图
  useEffect(() => {
    if (!open && mapRef.current) {
      mapRef.current.remove()
      mapRef.current = null
      markersRef.current = []
    }
  }, [open])

  // Modal 动画结束后调用 resize()，确保 WebGL canvas 取到正确尺寸
  const handleAfterOpenChange = useCallback((visible: boolean) => {
    if (visible && mapRef.current) {
      mapRef.current.resize()
    }
  }, [])

  const handleBack = () => {
    setSelectedLoc(null)
    setLocPhotos([])
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="90vw"
      style={{ top: 20, maxWidth: 1200 }}
      mask={false}
      afterOpenChange={handleAfterOpenChange}
      styles={{
        content: { background: '#141414', border: '1px solid #353535', boxShadow: '0 8px 40px rgba(0,0,0,0.85)', padding: 0 },
        body: { padding: 0 }
      }}
      closeIcon={<CloseOutlined style={{ color: '#888' }} />}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ccc', padding: '0 4px' }}>
          <EnvironmentOutlined style={{ color: '#c8832a' }} />
          <span>地点地图</span>
          {mapData && <span style={{ color: '#555', fontSize: 12 }}>· {mapData.locations.length} 个地点</span>}
        </div>
      }
    >
      <div style={{ display: 'flex', height: '75vh' }}>
        {/* 地图区域 */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, zIndex: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: '#141414'
            }}>
              <Spin size="large" />
            </div>
          )}
          {!loading && mapData?.locations.length === 0 && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
              zIndex: 10, background: 'rgba(20,20,20,0.85)', borderRadius: 8,
              padding: '8px 16px', color: '#666', fontSize: 12,
              pointerEvents: 'none', whiteSpace: 'nowrap'
            }}>
              暂无地点数据 — 在照片详情中为照片添加拍摄地点
            </div>
          )}
          <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* 右侧面板：选中地点后展示 */}
        {selectedLoc && (
          <div style={{
            width: 320,
            borderLeft: '1px solid #252525',
            background: '#181818',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #252525', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button size="small" type="text" icon={<LeftOutlined />} onClick={handleBack} style={{ color: '#888', padding: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#ccc', fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedLoc.name}
                </div>
                <div style={{ color: '#555', fontSize: 11, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {selectedLoc.address || `${selectedLoc.lat.toFixed(4)}, ${selectedLoc.lng.toFixed(4)}`}
                </div>
              </div>
              <span style={{ color: '#c8832a', fontSize: 12, flexShrink: 0 }}>{selectedLoc.photo_count} 张</span>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {loadingPhotos ? (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
                  <Spin size="small" />
                </div>
              ) : locPhotos.length === 0 ? (
                <Empty description={<span style={{ color: '#555' }}>暂无照片</span>} />
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {locPhotos.map(photo => {
                    const dateStr = photo.shot_date ?? photo.imported_at?.substring(0, 10) ?? ''
                    return (
                      <div key={photo.id} style={{ display: 'flex', flexDirection: 'column' }}>
                        <div style={{ aspectRatio: '1', background: '#111', borderRadius: 4, overflow: 'hidden' }}>
                          {photo.thumb_ready && photo.thumb_path ? (
                            <img
                              src={`localfile://${encodeURIComponent(photo.thumb_path)}`}
                              alt={photo.original_name}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 10 }}>
                              {photo.file_type.toUpperCase()}
                            </div>
                          )}
                        </div>
                        {dateStr && (
                          <div style={{ color: '#555', fontSize: 9, marginTop: 2, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {dateStr}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
