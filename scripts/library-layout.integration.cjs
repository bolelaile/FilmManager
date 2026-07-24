const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')

const bundlePath = process.env.FILM_MANAGER_LAYOUT_BUNDLE
if (!bundlePath) throw new Error('FILM_MANAGER_LAYOUT_BUNDLE is required')
const layout = require(bundlePath)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'filmmanager-layout-'))
const filesRoot = path.join(root, 'files')
fs.mkdirSync(filesRoot, { recursive: true })
const db = new Database(path.join(root, 'test.db'))
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE sub_libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    parent_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
    folder_name TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    original_name TEXT NOT NULL,
    file_type TEXT NOT NULL,
    sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL
  );
`)

try {
  const yearId = layout.createSubLibrary(db, filesRoot, '2024')
  const monthId = layout.createSubLibrary(db, filesRoot, '2024-07', yearId)
  const flatPhoto = path.join(filesRoot, 'photo.jpg')
  fs.writeFileSync(flatPhoto, 'flat-photo')
  const photoId = Number(db.prepare(`
    INSERT INTO photos (file_path, original_name, file_type, sub_library_id)
    VALUES (?, 'photo.jpg', 'jpg', ?)
  `).run(flatPhoto, monthId).lastInsertRowid)

  const sync = layout.synchronizeLibraryLayout(db, filesRoot)
  assert.equal(sync.moved, 1)
  let photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId)
  assert.equal(photo.file_path, path.join(filesRoot, '2024', '2024-07', 'photo.jpg'))
  assert.equal(fs.readFileSync(photo.file_path, 'utf8'), 'flat-photo')

  layout.renameSubLibrary(db, filesRoot, yearId, '归档')
  photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId)
  assert.equal(photo.file_path, path.join(filesRoot, '归档', '2024-07', 'photo.jpg'))
  assert.ok(fs.existsSync(photo.file_path))

  const selectedId = layout.createSubLibrary(db, filesRoot, '精选')
  const existingPhoto = path.join(filesRoot, '精选', 'photo.jpg')
  fs.writeFileSync(existingPhoto, 'existing-photo')
  db.prepare(`
    INSERT INTO photos (file_path, original_name, file_type, sub_library_id)
    VALUES (?, 'photo.jpg', 'jpg', ?)
  `).run(existingPhoto, selectedId)

  const moved = layout.movePhotosToSubLibrary(db, filesRoot, [photoId], selectedId)
  assert.equal(moved.moved, 1)
  assert.equal(moved.failed.length, 0)
  photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(photoId)
  assert.equal(photo.file_path, path.join(filesRoot, '精选', 'photo_1.jpg'))
  assert.equal(fs.readFileSync(photo.file_path, 'utf8'), 'flat-photo')

  const directPath = path.join(filesRoot, '归档', 'direct.jpg')
  const childPath = path.join(filesRoot, '归档', '2024-07', 'child.jpg')
  fs.writeFileSync(directPath, 'direct-photo')
  fs.writeFileSync(childPath, 'child-photo')
  const directId = Number(db.prepare(`
    INSERT INTO photos (file_path, original_name, file_type, sub_library_id)
    VALUES (?, 'direct.jpg', 'jpg', ?)
  `).run(directPath, yearId).lastInsertRowid)
  const childId = Number(db.prepare(`
    INSERT INTO photos (file_path, original_name, file_type, sub_library_id)
    VALUES (?, 'child.jpg', 'jpg', ?)
  `).run(childPath, monthId).lastInsertRowid)

  layout.deleteSubLibrary(db, filesRoot, yearId)
  const direct = db.prepare('SELECT * FROM photos WHERE id = ?').get(directId)
  const child = db.prepare('SELECT * FROM photos WHERE id = ?').get(childId)
  const promoted = db.prepare('SELECT * FROM sub_libraries WHERE id = ?').get(monthId)
  assert.equal(direct.sub_library_id, null)
  assert.equal(direct.file_path, path.join(filesRoot, 'direct.jpg'))
  assert.equal(promoted.parent_id, null)
  assert.equal(child.file_path, path.join(filesRoot, '2024-07', 'child.jpg'))
  assert.ok(fs.existsSync(direct.file_path))
  assert.ok(fs.existsSync(child.file_path))

  const invalidId = layout.createSubLibrary(db, filesRoot, 'A:B')
  const invalidDirectory = layout.getSubLibraryDirectory(db, filesRoot, invalidId)
  assert.equal(path.basename(invalidDirectory), 'A_B')
  assert.ok(fs.existsSync(invalidDirectory))
  assert.equal(layout.getOrCreateSubLibrary(db, filesRoot, 'A:B'), invalidId)

  const collisionFile = path.join(filesRoot, 'folder.jpg')
  fs.writeFileSync(collisionFile, 'folder-name-collision')
  const collisionId = Number(db.prepare(`
    INSERT INTO sub_libraries (name, parent_id, folder_name, sort_order)
    VALUES ('folder.jpg', NULL, NULL, 999)
  `).run().lastInsertRowid)
  const collisionPhotoId = Number(db.prepare(`
    INSERT INTO photos (file_path, original_name, file_type, sub_library_id)
    VALUES (?, 'folder.jpg', 'jpg', ?)
  `).run(collisionFile, collisionId).lastInsertRowid)
  const collisionSync = layout.synchronizeLibraryLayout(db, filesRoot)
  const collisionPhoto = db.prepare('SELECT * FROM photos WHERE id = ?').get(collisionPhotoId)
  assert.equal(collisionSync.failed.length, 0)
  assert.notEqual(path.dirname(collisionPhoto.file_path), filesRoot)
  assert.ok(fs.existsSync(collisionPhoto.file_path))

  for (const row of db.prepare('SELECT file_path FROM photos').all()) {
    assert.ok(fs.existsSync(row.file_path), `Missing file after layout operations: ${row.file_path}`)
  }

  process.stdout.write(`${JSON.stringify({
    sync,
    moved,
    collisionSync,
    photos: db.prepare('SELECT COUNT(*) AS count FROM photos').get().count
  })}\n`)
} finally {
  db.close()
  fs.rmSync(root, { recursive: true, force: true })
}
