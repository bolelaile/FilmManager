import { useState, useCallback } from 'react'
import type { AttributeType, FilterState, PhotoFilterOptions } from '../types'
import { useLibraryStore, useFilterStore } from '../store'

export interface LibraryDataResult {
  attrTypes: AttributeType[]
  valueCounts: Record<string, Record<string, number>>
  subLibCounts: Record<string, number>
  filterOptions: PhotoFilterOptions
  loadAttrs: () => Promise<void>
  loadSubLibs: () => Promise<void>
  loadValueCounts: (f: FilterState) => Promise<void>
}

export function useLibraryData(): LibraryDataResult {
  const { setAttrTypes, setSubLibraries } = useLibraryStore()
  const [attrTypes, setLocalAttrTypes] = useState<AttributeType[]>([])
  const [valueCounts, setValueCounts] = useState<Record<string, Record<string, number>>>({})
  const [subLibCounts, setSubLibCounts] = useState<Record<string, number>>({})
  const [filterOptions, setFilterOptions] = useState<PhotoFilterOptions>({
    fileTypes: [],
    statusCounts: { unclassified: 0, missing_date: 0, missing_camera: 0 }
  })

  const loadValueCounts = useCallback(async (f: FilterState) => {
    const counts = await window.api.attrs.valueCounts({
      filters: f.filters,
      subLibraryId: f.subLibraryId,
      search: f.search,
      dateFrom: f.dateFrom,
      dateTo: f.dateTo,
      dateField: f.dateField,
      fileTypes: f.fileTypes,
      organizationStatuses: f.organizationStatuses
    }) as { attribute_type_id: number; attribute_value_id: number; count: number }[]
    const map: Record<string, Record<string, number>> = {}
    counts.forEach(({ attribute_type_id, attribute_value_id, count }) => {
      if (!map[attribute_type_id]) map[attribute_type_id] = {}
      map[attribute_type_id][attribute_value_id] = count
    })
    setValueCounts(map)
  }, [])

  const loadAttrs = useCallback(async () => {
    const all = await window.api.attrs.listAll() as AttributeType[]
    setLocalAttrTypes(all)
    setAttrTypes(all)
    // 属性更新后同步刷新计数，保持和原始行为一致
    await loadValueCounts(useFilterStore.getState().filter)
  }, [setAttrTypes, loadValueCounts])

  const loadSubLibs = useCallback(async () => {
    const [libs, counts, options] = await Promise.all([
      window.api.sublib.list(),
      window.api.sublib.counts(),
      window.api.photos.filterOptions()
    ])
    setSubLibraries(libs)
    setSubLibCounts(counts as Record<string, number>)
    setFilterOptions(options as PhotoFilterOptions)
  }, [setSubLibraries])

  return { attrTypes, valueCounts, subLibCounts, filterOptions, loadAttrs, loadSubLibs, loadValueCounts }
}
