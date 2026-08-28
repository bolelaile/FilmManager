/**
 * 地点功能核心服务。
 * 封装地点 CRUD、照片-地点关联、地图数据、在线搜索/反向地理编码。
 * 依赖 LocationRepository（数据）+ osm-geocoder（外部 IO），不直接 getDb()/electron。
 */
import type { LocationRepository, LocationRow } from '../../data/repositories/location-repository'
import { searchLocations, reverseGeocode, type GeocodeResult } from './osm-geocoder'

export class LocationService {
  constructor(private repo: LocationRepository) {}

  list(): LocationRow[] { return this.repo.list() }

  add(name: string, address: string, lat: number, lng: number): number {
    return this.repo.add(name, address, lat, lng)
  }

  delete(id: number): void { this.repo.delete(id) }

  update(id: number, name: string, address: string): void { this.repo.update(id, name, address) }

  photosOf(locationId: number): number[] { return this.repo.photosOf(locationId) }

  forPhoto(photoId: number): LocationRow[] { return this.repo.forPhoto(photoId) }

  /** 批量设置地点（null 仅清除） */
  setForPhotos(photoIds: number[], locationId: number | null): boolean {
    this.repo.setForPhotos(photoIds, locationId)
    return true
  }

  clearForPhotos(photoIds: number[]): boolean {
    this.repo.clearForPhotos(photoIds)
    return true
  }

  addToPhoto(photoId: number, locationId: number): void { this.repo.addToPhoto(photoId, locationId) }

  removeFromPhoto(photoId: number, locationId: number): void { this.repo.removeFromPhoto(photoId, locationId) }

  /** 地图视图数据 */
  mapData(): { locations: LocationRow[]; photosByLoc: Record<number, number[]> } {
    return this.repo.mapData()
  }

  /** OSM 在线搜索 */
  async search(query: string): Promise<GeocodeResult[]> {
    return searchLocations(query)
  }

  /** OSM 反向地理编码 */
  async reverseGeocode(lat: number, lng: number): Promise<GeocodeResult | null> {
    return reverseGeocode(lat, lng)
  }

  /** 全部地点坐标（features/import 的 GPS 关联用） */
  allCoords(): { id: number; lat: number; lng: number }[] {
    return this.repo.allCoords()
  }

  /** 按名称查（features/import 的文件夹地点匹配用） */
  findByName(name: string): LocationRow | null {
    return this.repo.findByName(name)
  }
}
