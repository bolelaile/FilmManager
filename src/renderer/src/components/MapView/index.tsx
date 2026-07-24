/**
 * MapView — 显示所有有照片标记的地点，点击地标查看该地点照片
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Modal, Button, Spin, Empty } from 'antd'
import { CloseOutlined, EnvironmentOutlined, LeftOutlined } from '@ant-design/icons'
import type { Location, Photo } from '../../types'

// Leaflet must be imported dynamically to avoid SSR issues
let L: typeof import('leaflet') | null = null

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
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMap = useRef<import('leaflet').Map | null>(null)
  const markersRef = useRef<import('leaflet').Marker[]>([])
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedLoc, setSelectedLoc] = useState<MapLocation | null>(null)
  const [locPhotos, setLocPhotos] = useState<Photo[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)

  // lazy load leaflet (renderer only)
  const initLeaflet = useCallback(async () => {
    if (L) return
    L = (await import('leaflet')).default
    // fix default icon paths broken by bundlers
    delete (L.Icon.Default.prototype as any)._getIconUrl
    L.Icon.Default.mergeOptions({
      iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
      iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
      shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
    })
  }, [])

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

  // Init map when container is ready and data loaded
  useEffect(() => {
    if (!open || !mapData || !mapRef.current) return

    initLeaflet().then(() => {
      if (!L || !mapRef.current) return

      // destroy old map
      if (leafletMap.current) {
        leafletMap.current.remove()
        leafletMap.current = null
      }

      const map = L.map(mapRef.current, {
        center: [20, 0],
        zoom: 2,
        zoomControl: true
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 18
      }).addTo(map)

      leafletMap.current = map
      markersRef.current = []

      // add markers
      if (mapData.locations.length > 0) {
        const bounds: [number, number][] = []
        for (const loc of mapData.locations) {
          const count = loc.photo_count

          // custom icon with count badge
          const iconHtml = `
            <div style="
              position:relative;
              display:flex;
              flex-direction:column;
              align-items:center;
            ">
              <div style="
                background:#c8832a;
                color:#fff;
                border-radius:50%;
                width:32px;
                height:32px;
                display:flex;
                align-items:center;
                justify-content:center;
                font-size:13px;
                font-weight:600;
                box-shadow:0 2px 8px rgba(0,0,0,0.5);
                border:2px solid #fff;
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

          const icon = L!.divIcon({
            html: iconHtml,
            className: '',
            iconSize: [32, 44],
            iconAnchor: [16, 44],
            popupAnchor: [0, -44]
          })

          const marker = L!.marker([loc.lat, loc.lng], { icon })
            .bindTooltip(loc.name, { permanent: false, direction: 'top', offset: [0, -44] })
            .addTo(map)

          marker.on('click', () => {
            handleMarkerClick(loc)
          })

          markersRef.current.push(marker)
          bounds.push([loc.lat, loc.lng])
        }

        if (bounds.length > 0) {
          map.fitBounds(bounds as any, { padding: [40, 40], maxZoom: 10 })
        }
      }
    })

    return () => {
      // don't destroy on data change, only on close
    }
  }, [open, mapData])

  // cleanup map on close
  useEffect(() => {
    if (!open && leafletMap.current) {
      leafletMap.current.remove()
      leafletMap.current = null
    }
  }, [open])

  const handleMarkerClick = useCallback(async (loc: MapLocation) => {
    setSelectedLoc(loc)
    setLoadingPhotos(true)
    try {
      // fetch photos for this location
      const result = await window.api.photos.list({
        page: 1,
        pageSize: 200,
        filters: {},
        sortBy: 'imported_at',
        sortOrder: 'desc'
      }) as { total: number; rows: Photo[] }

      // filter to only photos at this location
      const photoIds = new Set(await window.api.locations.photos(loc.id) as number[])
      setLocPhotos(result.rows.filter((p) => photoIds.has(p.id)))
    } finally {
      setLoadingPhotos(false)
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
        <div style={{ flex: 1, position: 'relative' }}>
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
              position: 'absolute', inset: 0, zIndex: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              background: '#141414', gap: 12
            }}>
              <EnvironmentOutlined style={{ fontSize: 40, color: '#333' }} />
              <div style={{ color: '#555' }}>暂无地点数据</div>
              <div style={{ color: '#444', fontSize: 12 }}>在照片详情面板中为照片添加拍摄地点</div>
            </div>
          )}
          <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
        </div>

        {/* 右侧面板 */}
        {selectedLoc && (
          <div style={{
            width: 320,
            borderLeft: '1px solid #252525',
            background: '#181818',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* 标题 */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #252525', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Button
                size="small"
                type="text"
                icon={<LeftOutlined />}
                onClick={handleBack}
                style={{ color: '#888', padding: 0 }}
              />
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

            {/* 照片网格 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
              {loadingPhotos ? (
                <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
                  <Spin size="small" />
                </div>
              ) : locPhotos.length === 0 ? (
                <Empty description={<span style={{ color: '#555' }}>暂无照片</span>} />
              ) : (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 4
                }}>
                  {locPhotos.map((photo) => (
                    <div
                      key={photo.id}
                      style={{
                        aspectRatio: '1',
                        background: '#111',
                        borderRadius: 4,
                        overflow: 'hidden'
                      }}
                    >
                      {photo.thumb_ready && photo.thumb_path ? (
                        <img
                          src={`localfile://${encodeURIComponent(photo.thumb_path)}`}
                          alt={photo.original_name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 10 }}>
                          {photo.original_name.substring(0, 6)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
