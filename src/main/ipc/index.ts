import { registerPhotosIpc } from './photos'
import { registerImportIpc } from './import'
import { registerAttributesIpc } from './attributes'
import { registerSubLibrariesIpc } from './sublibraries'
import { registerLibraryIpc } from './library'
import { registerLocationsIpc } from './locations'
import { registerRollsIpc } from './rolls'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import log from 'electron-log'
import { getDb } from '../db/index'
import { synchronizeLibraryLayout } from '../services/library-layout'

let libraryRoot: string
let thumbDir: string
let profilesDir: string

export function getLibraryRoot(): string { return libraryRoot }
export function getThumbDir(): string { return thumbDir }
export function getProfilesDir(): string { return profilesDir }

export function initIpc(libRoot: string): void {
  libraryRoot = libRoot
  thumbDir = path.join(libRoot, 'thumbs')
  profilesDir = path.join(app.getAppPath(), 'resources', 'profiles')

  const filesRoot = path.join(libRoot, 'files')
  fs.mkdirSync(filesRoot, { recursive: true })
  fs.mkdirSync(thumbDir, { recursive: true })

  const syncResult = synchronizeLibraryLayout(getDb(), filesRoot)
  log.info('Physical library layout synchronized', {
    directories: syncResult.directories,
    moved: syncResult.moved,
    unchanged: syncResult.unchanged,
    failed: syncResult.failed.length
  })
  if (syncResult.failed.length > 0) {
    log.warn('Some photos could not be moved into the physical sub-library tree', syncResult.failed)
  }

  registerPhotosIpc()
  registerImportIpc()
  registerAttributesIpc()
  registerSubLibrariesIpc()
  registerLibraryIpc()
  registerLocationsIpc()
  registerRollsIpc()
}
