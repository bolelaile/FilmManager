/**
 * MapView — 显示所有有照片标记的地点，点击地标查看该地点照片
 */
import React, { useEffect, useState, useRef, useCallback } from 'react'
import { Modal, Button, Spin, Empty, message } from 'antd'
import { CloseOutlined, EnvironmentOutlined, LeftOutlined, ReloadOutlined } from '@ant-design/icons'
import type { Location, Photo } from '../../types'

// Leaflet must be imported dynamically to avoid SSR issues
let L: typeof import('leaflet') | null = null

const TILE_STALL_TIMEOUT = 25000
const TILE_SOURCES = [
  {
    name: 'OpenStreetMap.de',
    url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18
  },
  {
    name: 'Esri World Street Map',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles © Esri',
    maxZoom: 19
  },
  {
    name: 'OpenStreetMap',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  }
] as const

interface TileLoadState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  sourceIndex: number
  sourceName: string
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
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletMap = useRef<import('leaflet').Map | null>(null)
  const tileLayerRef = useRef<import('leaflet').TileLayer | null>(null)
  const retryTilesRef = useRef<(() => void) | null>(null)
  const markersRef = useRef<import('leaflet').Marker[]>([])
  const [mapData, setMapData] = useState<MapData | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedLoc, setSelectedLoc] = useState<MapLocation | null>(null)
  const [locPhotos, setLocPhotos] = useState<Photo[]>([])
  const [loadingPhotos, setLoadingPhotos] = useState(false)
  const [tileLoad, setTileLoad] = useState<TileLoadState>({
    status: 'idle',
    sourceIndex: 0,
    sourceName: TILE_SOURCES[0].name
  })

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
      setTileLoad({ status: 'idle', sourceIndex: 0, sourceName: TILE_SOURCES[0].name })
    }
  }, [open])

  // Init map when container is ready and data loaded
  useEffect(() => {
    if (!open || !mapData || !mapRef.current) return

    let disposed = false
    let sourceAttempt = 0
    let fallbackTimer: number | null = null

    const clearFallbackTimer = () => {
      if (fallbackTimer != null) {
        window.clearTimeout(fallbackTimer)
        fallbackTimer = null
      }
    }

    initLeaflet().then(() => {
      if (disposed || !L || !mapRef.current) return

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

      const activateTileSource = (sourceIndex: number) => {
        if (disposed || !L) return
        const source = TILE_SOURCES[sourceIndex]
        const attempt = ++sourceAttempt
        let tileErrors = 0
        clearFallbackTimer()
        tileLayerRef.current?.remove()
        setTileLoad({ status: 'loading', sourceIndex, sourceName: source.name })

        const useNextSource = () => {
          if (disposed || attempt !== sourceAttempt) return
          clearFallbackTimer()
          if (sourceIndex + 1 < TILE_SOURCES.length) {
            const nextSource = TILE_SOURCES[sourceIndex + 1]
            message.warning(`${source.name} 加载失败，正在切换到 ${nextSource.name}`)
            activateTileSource(sourceIndex + 1)
          } else {
            setTileLoad({ status: 'error', sourceIndex, sourceName: source.name })
            message.error('所有地图瓦片源均加载失败')
          }
        }

        const layer = L.tileLayer(source.url, {
          attribution: source.attribution,
          maxZoom: source.maxZoom
        })
        const scheduleStallFallback = () => {
          clearFallbackTimer()
          fallbackTimer = window.setTimeout(useNextSource, TILE_STALL_TIMEOUT)
        }
        layer.on('tileload', () => {
          if (disposed || attempt !== sourceAttempt) return
          scheduleStallFallback()
        })
        layer.on('load', () => {
          if (disposed || attempt !== sourceAttempt) return
          clearFallbackTimer()
          setTileLoad({ status: 'ready', sourceIndex, sourceName: source.name })
        })
        layer.on('tileerror', () => {
          if (disposed || attempt !== sourceAttempt) return
          tileErrors++
          if (tileErrors >= 2) useNextSource()
        })
        layer.addTo(map)
        tileLayerRef.current = layer
        scheduleStallFallback()
      }

      retryTilesRef.current = () => activateTileSource(0)
      activateTileSource(0)

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
      disposed = true
      sourceAttempt++
      clearFallbackTimer()
      retryTilesRef.current = null
    }
  }, [open, mapData])

  // cleanup map on close
  useEffect(() => {
    if (!open && leafletMap.current) {
      leafletMap.current.remove()
      leafletMap.current = null
      tileLayerRef.current = null
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
          {tileLoad.status === 'loading' && (
            <div data-map-tile-status="loading" data-map-tile-source={tileLoad.sourceName} style={{
              position: 'absolute', top: 10, right: 10, zIndex: 1000,
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '6px 10px', background: 'rgba(20,20,20,0.88)',
              border: '1px solid #333', borderRadius: 4, color: '#aaa', fontSize: 12
            }}>
              <Spin size="small" />
              正在加载 {tileLoad.sourceName}
            </div>
          )}
          {tileLoad.status === 'ready' && tileLoad.sourceIndex > 0 && (
            <div data-map-tile-status="ready" data-map-tile-source={tileLoad.sourceName} style={{
              position: 'absolute', top: 10, right: 10, zIndex: 1000,
              padding: '6px 10px', background: 'rgba(20,20,20,0.82)',
              border: '1px solid #333', borderRadius: 4, color: '#888', fontSize: 12
            }}>
              备用地图：{tileLoad.sourceName}
            </div>
          )}
          {tileLoad.status === 'error' && (
            <div data-map-tile-status="error" data-map-tile-source={tileLoad.sourceName} style={{
              position: 'absolute', top: 10, right: 10, zIndex: 1000,
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', background: 'rgba(40,18,18,0.9)',
              border: '1px solid #5c2020', borderRadius: 4, color: '#ff7875', fontSize: 12
            }}>
              <span>地图底图加载失败</span>
              <Button
                size="small"
                type="text"
                icon={<ReloadOutlined />}
                onClick={() => retryTilesRef.current?.()}
                style={{ color: '#ff9c99', padding: '0 4px', height: 22 }}
              />
            </div>
          )}
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
