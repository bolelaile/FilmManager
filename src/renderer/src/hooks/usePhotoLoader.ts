import { useState, useCallback, useRef } from 'react'
import { message } from 'antd'
import type { Photo, FilterState, Roll } from '../types'

const PAGE_SIZE = 80

export interface PhotoLoaderResult {
  photos: Photo[]
  total: number
  loading: boolean
  hasMore: boolean
  loadPhotos: (reset?: boolean) => Promise<void>
}

export function usePhotoLoader(
  filter: FilterState,
  activeRoll: Roll | null,
  unassignedOnly: boolean
): PhotoLoaderResult {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const loadingRef = useRef(false)
  const loadCounterRef = useRef(0)

  const loadPhotos = useCallback(async (reset = false) => {
    if (!reset && loadingRef.current) return
    const myCount = ++loadCounterRef.current
    loadingRef.current = true
    setLoading(true)
    const currentPage = reset ? 1 : page
    try {
      let result: { total: number; rows: Photo[] }
      if (activeRoll || unassignedOnly) {
        result = await window.api.rolls.photos(activeRoll?.id ?? null, {
          page: currentPage,
          pageSize: PAGE_SIZE,
          filters: filter.filters,
          subLibraryId: filter.subLibraryId,
          search: filter.search,
          dateFrom: filter.dateFrom,
          dateTo: filter.dateTo,
          dateField: filter.dateField,
          fileTypes: filter.fileTypes,
          organizationStatuses: filter.organizationStatuses,
          sortBy: filter.sortBy,
          sortOrder: filter.sortOrder
        }) as { total: number; rows: Photo[] }
      } else {
        result = await window.api.photos.list({
          page: currentPage,
          pageSize: PAGE_SIZE,
          filters: filter.filters,
          subLibraryId: filter.subLibraryId,
          search: filter.search,
          dateFrom: filter.dateFrom,
          dateTo: filter.dateTo,
          dateField: filter.dateField,
          fileTypes: filter.fileTypes,
          organizationStatuses: filter.organizationStatuses,
          sortBy: filter.sortBy,
          sortOrder: filter.sortOrder
        }) as { total: number; rows: Photo[] }
      }
      if (myCount !== loadCounterRef.current) return
      if (reset) {
        setPhotos(result.rows)
        setPage(2)
      } else {
        setPhotos((prev) => [...prev, ...result.rows])
        setPage(currentPage + 1)
      }
      setTotal(result.total)
      setHasMore(currentPage * PAGE_SIZE < result.total)
    } catch (err) {
      if (myCount !== loadCounterRef.current) return
      console.error('loadPhotos failed:', err)
      message.error('加载照片失败，请检查日志')
    } finally {
      if (myCount === loadCounterRef.current) {
        setLoading(false)
        loadingRef.current = false
      }
    }
  }, [filter, page, activeRoll, unassignedOnly])

  return { photos, total, loading, hasMore, loadPhotos }
}
