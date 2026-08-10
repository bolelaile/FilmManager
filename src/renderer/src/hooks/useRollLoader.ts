import { useState, useCallback } from 'react'
import type { FilterState, Roll } from '../types'

export interface RollLoaderResult {
  rolls: Roll[]
  photolessCount: number
  rollsLoading: boolean
  loadRolls: () => Promise<void>
}

export function useRollLoader(filter: FilterState): RollLoaderResult {
  const [rolls, setRolls] = useState<Roll[]>([])
  const [photolessCount, setPhotolessCount] = useState(0)
  const [rollsLoading, setRollsLoading] = useState(false)

  const loadRolls = useCallback(async () => {
    setRollsLoading(true)
    try {
      const result = await window.api.rolls.list({
        filters: filter.filters,
        subLibraryId: filter.subLibraryId,
        search: filter.search,
        dateFrom: filter.dateFrom,
        dateTo: filter.dateTo,
        dateField: filter.dateField,
        fileTypes: filter.fileTypes,
        organizationStatuses: filter.organizationStatuses
      }) as { rolls: Roll[]; photolessCount: number }
      setRolls(result.rolls)
      setPhotolessCount(result.photolessCount)
    } catch (err) {
      console.error('loadRolls failed:', err)
    } finally {
      setRollsLoading(false)
    }
  }, [filter])

  return { rolls, photolessCount, rollsLoading, loadRolls }
}
