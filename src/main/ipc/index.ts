import { registerPhotosIpc } from './photos'
import { registerImportIpc } from './import'
import { registerAttributesIpc } from './attributes'
import { registerSubLibrariesIpc } from './sublibraries'
import { registerLibraryIpc } from './library'
import { registerLocationsIpc } from './locations'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'

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

  fs.mkdirSync(path.join(libRoot, 'files'), { recursive: true })
  fs.mkdirSync(thumbDir, { recursive: true })

  registerPhotosIpc()
  registerImportIpc()
  registerAttributesIpc()
  registerSubLibrariesIpc()
  registerLibraryIpc()
  registerLocationsIpc()
}
