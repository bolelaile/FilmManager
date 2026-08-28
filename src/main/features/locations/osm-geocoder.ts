/**
 * OSM Nominatim 地理编码子模块（features/locations 内部）。
 * 在线搜索 / 反向地理编码，需联网；失败返回空/null，不阻断流程。
 * 从 ipc/locations.ts 抽取，隔离外部 IO 便于测试与替换。
 */

export interface GeocodeResult {
  name: string
  address: string
  lat: number
  lng: number
}

const USER_AGENT = 'FilmManager/1.0'
const ACCEPT_LANG = 'zh'

/** 地名搜索（limit=8） */
export async function searchLocations(query: string): Promise<GeocodeResult[]> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8&accept-language=${ACCEPT_LANG}`
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!resp.ok) return []
    const data = await resp.json() as Array<{
      place_id: number; display_name: string; lat: string; lon: string
    }>
    return data.map((d) => ({
      name: d.display_name.split(',')[0].trim(),
      address: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon)
    }))
  } catch {
    return []
  }
}

/** 反向地理编码：经纬度 → 附近地名（zoom=14，优先 village/suburb/town/city...） */
export async function reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=${ACCEPT_LANG}&addressdetails=1&zoom=14`
    const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } })
    if (!resp.ok) return null
    const d = await resp.json() as { display_name?: string; address?: Record<string, string> }
    if (!d.display_name) return null
    const name = d.address
      ? (d.address.village || d.address.suburb || d.address.town || d.address.city || d.address.county || d.address.state || d.display_name.split(',')[0]).trim()
      : d.display_name.split(',')[0].trim()
    return { name, address: d.display_name, lat, lng }
  } catch {
    return null
  }
}
