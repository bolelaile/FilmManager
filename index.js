"use strict";
const electron = require("electron");
const path = require("path");
const fs = require("fs");
const log = require("electron-log");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const sharp = require("sharp");
let db;
function getDb() {
  return db;
}
function initDb(libraryRoot2) {
  const dbPath = path.join(libraryRoot2, "film.db");
  fs.mkdirSync(libraryRoot2, { recursive: true });
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations();
  log.info("Database initialized at", dbPath);
}
function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sub_libraries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      description TEXT DEFAULT '',
      parent_id   INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
      sort_order  INTEGER DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS photos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path     TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      file_type     TEXT NOT NULL,
      thumb_path    TEXT,
      thumb_ready   INTEGER DEFAULT 0,
      width         INTEGER,
      height        INTEGER,
      file_size     INTEGER,
      sub_library_id INTEGER REFERENCES sub_libraries(id) ON DELETE SET NULL,
      imported_at   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      notes         TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS attribute_types (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      key          TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      is_system    INTEGER DEFAULT 0,
      is_active    INTEGER DEFAULT 1,
      sort_order   INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS attribute_values (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      attribute_type_id INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
      value             TEXT NOT NULL,
      icon_key          TEXT,
      is_preset         INTEGER DEFAULT 0,
      UNIQUE(attribute_type_id, value)
    );

    CREATE TABLE IF NOT EXISTS photo_attributes (
      photo_id           INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      attribute_type_id  INTEGER NOT NULL REFERENCES attribute_types(id) ON DELETE CASCADE,
      attribute_value_id INTEGER NOT NULL REFERENCES attribute_values(id) ON DELETE CASCADE,
      PRIMARY KEY (photo_id, attribute_type_id, attribute_value_id)
    );

    CREATE TABLE IF NOT EXISTS color_profiles (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      name      TEXT NOT NULL UNIQUE,
      file_path TEXT NOT NULL,
      is_preset INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_photos_sub_library ON photos(sub_library_id);
    CREATE INDEX IF NOT EXISTS idx_photos_imported_at ON photos(imported_at);
    CREATE INDEX IF NOT EXISTS idx_photo_attrs_photo ON photo_attributes(photo_id);
    CREATE INDEX IF NOT EXISTS idx_photo_attrs_type_val ON photo_attributes(attribute_type_id, attribute_value_id);
  `);
  try {
    db.exec(`ALTER TABLE attribute_values ADD COLUMN icon_key TEXT`);
  } catch {
  }
  seedDefaultData();
}
function buildIconIndex() {
  try {
    const manifestPath = path.join(electron.app.getAppPath(), "resources", "film-icons", "manifest.json");
    if (!fs.existsSync(manifestPath)) return /* @__PURE__ */ new Map();
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    const index = /* @__PURE__ */ new Map();
    for (const [key, name] of Object.entries(manifest)) {
      index.set(normalizeName(name), key);
    }
    return index;
  } catch {
    return /* @__PURE__ */ new Map();
  }
}
function normalizeName(name) {
  return name.toLowerCase().replace(/\s+/g, "").replace(/[^a-z0-9一-鿿]/g, "");
}
function seedDefaultData() {
  const typeCount = db.prepare("SELECT COUNT(*) as c FROM attribute_types").get();
  if (typeCount.c > 0) return;
  const iconIndex = buildIconIndex();
  const insertType = db.prepare(
    "INSERT OR IGNORE INTO attribute_types (key, display_name, is_system, is_active, sort_order) VALUES (?, ?, ?, 1, ?)"
  );
  insertType.run("camera", "相机", 1, 0);
  insertType.run("film", "胶片", 1, 1);
  insertType.run("imported_at", "入库时间", 1, 2);
  insertType.run("lens", "镜头型号", 0, 3);
  insertType.run("dev_method", "冲扫方式", 0, 4);
  insertType.run("dev_lab", "冲扫商家", 0, 5);
  insertType.run("film_format", "胶片格式", 0, 6);
  const cameraType = db.prepare("SELECT id FROM attribute_types WHERE key='camera'").get();
  const filmType = db.prepare("SELECT id FROM attribute_types WHERE key='film'").get();
  const lensType = db.prepare("SELECT id FROM attribute_types WHERE key='lens'").get();
  const devMethodType = db.prepare("SELECT id FROM attribute_types WHERE key='dev_method'").get();
  const filmFormatType = db.prepare("SELECT id FROM attribute_types WHERE key='film_format'").get();
  const insertVal = db.prepare(
    "INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset) VALUES (?, ?, ?, 1)"
  );
  const cameras = [
    "Nikon F3",
    "Nikon FM2",
    "Nikon F100",
    "Nikon FE2",
    "Canon AE-1",
    "Canon F-1",
    "Canon EOS-1V",
    "Leica M6",
    "Leica M7",
    "Leica M3",
    "Leica M2",
    "Pentax 67",
    "Pentax 6x7",
    "Pentax K1000",
    "Mamiya RZ67",
    "Mamiya RB67",
    "Mamiya 7II",
    "Hasselblad 500C/M",
    "Hasselblad 503CW",
    "Contax G2",
    "Contax T2",
    "Contax RX",
    "Olympus OM-1",
    "Olympus OM-4T",
    "Minolta X-700",
    "Minolta CLE",
    "Rollei 35",
    "Rolleiflex 2.8F",
    "Yashica Mat-124G",
    "Bronica SQ-A"
  ];
  cameras.forEach((v) => insertVal.run(cameraType.id, v, null));
  const manifestPath = path.join(electron.app.getAppPath(), "resources", "film-icons", "manifest.json");
  let filmNames = [];
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    filmNames = Object.entries(manifest).map(([key, name]) => ({ name, iconKey: key }));
  } else {
    const fallback = [
      "Kodak Portra 400",
      "Kodak Portra 160",
      "Kodak Portra 800",
      "Kodak Gold 200",
      "Kodak UltraMax 400",
      "Kodak Ektar 100",
      "Kodak Tri-X 400",
      "Kodak T-MAX 100",
      "Kodak T-MAX 400",
      "Fujifilm Superia 400",
      "Fujifilm Velvia 50",
      "Fujifilm Provia 100F",
      "Ilford HP5 Plus",
      "Ilford FP4 Plus",
      "Ilford Delta 100",
      "Cinestill 800T",
      "Cinestill 400D"
    ];
    filmNames = fallback.map((name) => ({ name, iconKey: iconIndex.get(normalizeName(name)) ?? "" }));
  }
  filmNames.forEach(({ name, iconKey }) => insertVal.run(filmType.id, name, iconKey || null));
  const lenses = [
    "Nikkor 50mm f/1.4",
    "Nikkor 50mm f/1.8",
    "Nikkor 35mm f/2",
    "Canon 50mm f/1.4",
    "Canon 28mm f/2.8",
    "Leica Summicron 50mm f/2",
    "Leica Summilux 35mm f/1.4",
    "Leica Elmarit 28mm f/2.8",
    "Zeiss Planar 50mm f/0.7",
    "Zeiss Distagon 35mm f/1.4",
    "Voigtlander Nokton 40mm f/1.4",
    "Voigtlander Color-Skopar 35mm f/2.5"
  ];
  lenses.forEach((v) => insertVal.run(lensType.id, v, null));
  ["自冲自扫", "送冲送扫", "自冲送扫", "送冲自扫"].forEach(
    (v) => insertVal.run(devMethodType.id, v, null)
  );
  ["135 / 35mm", "120 中画幅", "4x5 大画幅", "8x10 大画幅"].forEach(
    (v) => insertVal.run(filmFormatType.id, v, null)
  );
  log.info("Default data seeded with", filmNames.length, "film presets");
}
const THUMB_SIZE = 400;
const SUPPORTED_EXTENSIONS = /* @__PURE__ */ new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tiff",
  ".tif",
  ".bmp",
  ".webp",
  ".cr2",
  ".cr3",
  ".nef",
  ".nrw",
  ".arw",
  ".srf",
  ".sr2",
  ".orf",
  ".rw2",
  ".pef",
  ".raf",
  ".dng",
  ".raw",
  ".rwl",
  ".mrw",
  ".x3f",
  ".3fr",
  ".fff",
  ".iiq",
  ".mef"
]);
function isRawFormat(ext) {
  return ![".jpg", ".jpeg", ".png", ".tiff", ".tif", ".bmp", ".webp"].includes(ext.toLowerCase());
}
function getFileType(filePath) {
  return path.extname(filePath).toLowerCase().replace(".", "");
}
function extractEmbeddedJpeg(rawBuffer) {
  let bestStart = -1;
  let bestEnd = -1;
  let bestSize = 0;
  let searchPos = rawBuffer.length - 2;
  while (searchPos > 100) {
    if (rawBuffer[searchPos] === 255 && rawBuffer[searchPos + 1] === 217) {
      const jpegEnd = searchPos + 2;
      for (let i = searchPos - 2; i >= 0; i--) {
        if (rawBuffer[i] === 255 && rawBuffer[i + 1] === 216 && rawBuffer[i + 2] === 255) {
          const size = jpegEnd - i;
          if (size > bestSize && size > 5e4) {
            bestStart = i;
            bestEnd = jpegEnd;
            bestSize = size;
          }
          break;
        }
      }
    }
    searchPos--;
  }
  if (bestStart !== -1) {
    return rawBuffer.slice(bestStart, bestEnd);
  }
  return null;
}
async function generateThumbnail(sourcePath, thumbDir2) {
  try {
    fs.mkdirSync(thumbDir2, { recursive: true });
    const hash = crypto.createHash("md5").update(sourcePath).digest("hex");
    const thumbPath = path.join(thumbDir2, `${hash}.webp`);
    if (fs.existsSync(thumbPath)) return thumbPath;
    const ext = path.extname(sourcePath).toLowerCase();
    if (isRawFormat(ext)) {
      let imgBuffer = null;
      try {
        imgBuffer = await sharp(sourcePath).resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside" }).webp({ quality: 80 }).toBuffer();
      } catch {
        const rawBuf = fs.readFileSync(sourcePath);
        const embedded = extractEmbeddedJpeg(rawBuf);
        if (embedded) {
          imgBuffer = await sharp(embedded).resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside" }).webp({ quality: 80 }).toBuffer();
        }
      }
      if (imgBuffer) {
        fs.writeFileSync(thumbPath, imgBuffer);
        return thumbPath;
      }
      return null;
    } else {
      await sharp(sourcePath).resize(THUMB_SIZE, THUMB_SIZE, { fit: "inside" }).webp({ quality: 80 }).toFile(thumbPath);
      return thumbPath;
    }
  } catch (err) {
    log.warn("Thumbnail generation failed for", sourcePath, err);
    return null;
  }
}
async function getImageMeta(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (isRawFormat(ext)) {
      const rawBuf = fs.readFileSync(filePath);
      const embedded = extractEmbeddedJpeg(rawBuf);
      if (embedded) {
        const meta2 = await sharp(embedded).metadata();
        return { width: meta2.width ?? 0, height: meta2.height ?? 0 };
      }
      return null;
    }
    const meta = await sharp(filePath).metadata();
    return { width: meta.width ?? 0, height: meta.height ?? 0 };
  } catch {
    return null;
  }
}
async function renderFullPreview(filePath, iccProfilePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    let pipeline;
    if (isRawFormat(ext)) {
      try {
        pipeline = sharp(filePath);
        await pipeline.metadata();
      } catch {
        const rawBuf = fs.readFileSync(filePath);
        const embedded = extractEmbeddedJpeg(rawBuf);
        if (!embedded) return null;
        pipeline = sharp(embedded);
      }
    } else {
      pipeline = sharp(filePath);
    }
    if (iccProfilePath && fs.existsSync(iccProfilePath)) {
      const iccBuffer = fs.readFileSync(iccProfilePath);
      pipeline = pipeline.withMetadata({ icc: iccBuffer.toString("base64") });
    }
    pipeline = pipeline.resize(4096, 4096, { fit: "inside", withoutEnlargement: true });
    pipeline = pipeline.jpeg({ quality: 95 });
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height };
  } catch (err) {
    log.error("Full preview render failed", filePath, err);
    return null;
  }
}
function registerPhotosIpc() {
  electron.ipcMain.handle(
    "photos:list",
    (_, params) => {
      const db2 = getDb();
      const { page, pageSize, filters, subLibraryId, search, dateFrom, dateTo, sortBy = "imported_at", sortOrder = "desc" } = params;
      const offset = (page - 1) * pageSize;
      let sql = `SELECT DISTINCT p.* FROM photos p`;
      const args = [];
      let joinIdx = 0;
      for (const [typeId, valueIds] of Object.entries(filters)) {
        if (!valueIds || valueIds.length === 0) continue;
        const alias = `pa${joinIdx++}`;
        sql += ` JOIN photo_attributes ${alias} ON ${alias}.photo_id = p.id AND ${alias}.attribute_type_id = ${typeId} AND ${alias}.attribute_value_id IN (${valueIds.map(() => "?").join(",")})`;
        args.push(...valueIds);
      }
      const wheres = [];
      if (subLibraryId != null) {
        wheres.push("p.sub_library_id = ?");
        args.push(subLibraryId);
      }
      if (search) {
        wheres.push("p.original_name LIKE ?");
        args.push(`%${search}%`);
      }
      if (dateFrom) {
        wheres.push("p.imported_at >= ?");
        args.push(dateFrom);
      }
      if (dateTo) {
        wheres.push("p.imported_at <= ?");
        args.push(dateTo + " 23:59:59");
      }
      if (wheres.length) sql += " WHERE " + wheres.join(" AND ");
      sql += ` ORDER BY p.${sortBy} ${sortOrder}`;
      const countSql = `SELECT COUNT(*) as total FROM (${sql}) t`;
      const total = db2.prepare(countSql).get(...args).total;
      sql += " LIMIT ? OFFSET ?";
      const rows = db2.prepare(sql).all(...args, pageSize, offset);
      const ids = rows.map((r) => r.id);
      const attrs = ids.length ? db2.prepare(
        `SELECT pa.photo_id, at.key, at.display_name, av.value, av.id as value_id, pa.attribute_type_id
               FROM photo_attributes pa
               JOIN attribute_types at ON at.id = pa.attribute_type_id
               JOIN attribute_values av ON av.id = pa.attribute_value_id
               WHERE pa.photo_id IN (${ids.map(() => "?").join(",")})
               ORDER BY at.sort_order`
      ).all(...ids) : [];
      const attrMap = /* @__PURE__ */ new Map();
      for (const a of attrs) {
        if (!attrMap.has(a.photo_id)) attrMap.set(a.photo_id, []);
        attrMap.get(a.photo_id).push(a);
      }
      return { total, rows: rows.map((r) => ({ ...r, attributes: attrMap.get(r.id) ?? [] })) };
    }
  );
  electron.ipcMain.handle("photos:get", (_, id) => {
    const db2 = getDb();
    const photo = db2.prepare("SELECT * FROM photos WHERE id = ?").get(id);
    if (!photo) return null;
    const attrs = db2.prepare(
      `SELECT pa.attribute_type_id, at.key, at.display_name, av.value, av.id as value_id
         FROM photo_attributes pa
         JOIN attribute_types at ON at.id = pa.attribute_type_id
         JOIN attribute_values av ON av.id = pa.attribute_value_id
         WHERE pa.photo_id = ?
         ORDER BY at.sort_order`
    ).all(id);
    return { ...photo, attributes: attrs };
  });
  electron.ipcMain.handle(
    "photos:setAttributes",
    (_, photoId, attrAssignments) => {
      const db2 = getDb();
      db2.prepare("DELETE FROM photo_attributes WHERE photo_id = ?").run(photoId);
      const ins = db2.prepare(
        "INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)"
      );
      for (const { typeId, valueId } of attrAssignments) {
        ins.run(photoId, typeId, valueId);
      }
      return true;
    }
  );
  electron.ipcMain.handle(
    "photos:batchSetAttributes",
    (_, photoIds, attrAssignments) => {
      const db2 = getDb();
      const deleteStmt = db2.prepare("DELETE FROM photo_attributes WHERE photo_id = ? AND attribute_type_id = ?");
      const ins = db2.prepare(
        "INSERT OR IGNORE INTO photo_attributes (photo_id, attribute_type_id, attribute_value_id) VALUES (?, ?, ?)"
      );
      const tx = db2.transaction(() => {
        for (const photoId of photoIds) {
          for (const { typeId, valueId } of attrAssignments) {
            deleteStmt.run(photoId, typeId);
            ins.run(photoId, typeId, valueId);
          }
        }
      });
      tx();
      return true;
    }
  );
  electron.ipcMain.handle("photos:updateNotes", (_, id, notes) => {
    getDb().prepare("UPDATE photos SET notes = ? WHERE id = ?").run(notes, id);
    return true;
  });
  electron.ipcMain.handle("photos:delete", (_, ids, deleteFile) => {
    const db2 = getDb();
    for (const id of ids) {
      if (deleteFile) {
        const row = db2.prepare("SELECT file_path, thumb_path FROM photos WHERE id = ?").get(id);
        if (row) {
          try {
            fs.unlinkSync(row.file_path);
          } catch {
          }
          if (row.thumb_path) try {
            fs.unlinkSync(row.thumb_path);
          } catch {
          }
        }
      }
      db2.prepare("DELETE FROM photos WHERE id = ?").run(id);
    }
    return true;
  });
  electron.ipcMain.handle("photos:fullPreview", async (_, filePath, iccPath) => {
    const result = await renderFullPreview(filePath, iccPath);
    if (!result) return null;
    return {
      dataUrl: `data:image/jpeg;base64,${result.buffer.toString("base64")}`,
      width: result.width,
      height: result.height
    };
  });
  electron.ipcMain.handle("photos:thumbDataUrl", (_, thumbPath) => {
    try {
      const buf = fs.readFileSync(thumbPath);
      return `data:image/webp;base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle("photos:moveToSubLibrary", (_, photoIds, subLibraryId) => {
    const db2 = getDb();
    const stmt = db2.prepare("UPDATE photos SET sub_library_id = ? WHERE id = ?");
    const tx = db2.transaction(() => {
      photoIds.forEach((id) => stmt.run(subLibraryId, id));
    });
    tx();
    return true;
  });
}
function registerImportIpc() {
  electron.ipcMain.handle("import:selectAndImport", async (event, subLibraryId) => {
    const win = electron.BrowserWindow.fromWebContents(event.sender);
    const result = await electron.dialog.showOpenDialog(win, {
      properties: ["openDirectory"],
      title: "选择要导入的文件夹"
    });
    if (result.canceled || !result.filePaths[0]) return { imported: 0, skipped: 0 };
    const folderPath = result.filePaths[0];
    return importFolder(folderPath, subLibraryId, event);
  });
  electron.ipcMain.handle("import:importPaths", async (event, filePaths, subLibraryId) => {
    let imported = 0;
    let skipped = 0;
    for (const p of filePaths) {
      const stat = fs.statSync(p);
      if (stat.isDirectory()) {
        const r = await importFolder(p, subLibraryId, event);
        imported += r.imported;
        skipped += r.skipped;
      } else {
        const ext = path.extname(p).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          const ok = await importFile(p, subLibraryId);
          ok ? imported++ : skipped++;
          event.sender.send("import:progress", { imported, skipped });
        }
      }
    }
    return { imported, skipped };
  });
}
async function importFolder(folderPath, subLibraryId, event) {
  let imported = 0;
  let skipped = 0;
  function walk(dir) {
    const files = [];
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) files.push(...walk(full));
        else {
          const ext = path.extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) files.push(full);
        }
      }
    } catch {
    }
    return files;
  }
  const allFiles = walk(folderPath);
  event.sender.send("import:total", allFiles.length);
  for (const filePath of allFiles) {
    const ok = await importFile(filePath, subLibraryId);
    ok ? imported++ : skipped++;
    event.sender.send("import:progress", { imported, skipped, total: allFiles.length });
  }
  return { imported, skipped };
}
async function importFile(sourcePath, subLibraryId) {
  const db2 = getDb();
  const libraryRoot2 = getLibraryRoot$1();
  const thumbDir2 = getThumbDir();
  const destPath = path.join(libraryRoot2, "files", path.basename(sourcePath));
  const finalDest = ensureUniquePath(destPath);
  try {
    const existing = db2.prepare("SELECT id FROM photos WHERE file_path = ?").get(finalDest);
    if (existing) return false;
    fs.mkdirSync(path.dirname(finalDest), { recursive: true });
    fs.copyFileSync(sourcePath, finalDest);
    const stat = fs.statSync(finalDest);
    const meta = await getImageMeta(finalDest);
    const info = db2.prepare(
      `INSERT INTO photos (file_path, original_name, file_type, width, height, file_size, sub_library_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      finalDest,
      path.basename(sourcePath),
      getFileType(sourcePath),
      meta?.width ?? null,
      meta?.height ?? null,
      stat.size,
      subLibraryId ?? null
    );
    generateThumbnail(finalDest, thumbDir2).then((thumbPath) => {
      if (thumbPath) {
        db2.prepare("UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?").run(
          thumbPath,
          info.lastInsertRowid
        );
      }
    });
    return true;
  } catch (err) {
    log.error("Import file failed", sourcePath, err);
    return false;
  }
}
function ensureUniquePath(dest) {
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(dest);
  const base = dest.slice(0, -ext.length);
  let i = 1;
  while (fs.existsSync(`${base}_${i}${ext}`)) i++;
  return `${base}_${i}${ext}`;
}
function registerAttributesIpc() {
  electron.ipcMain.handle("attrs:listTypes", () => {
    return getDb().prepare("SELECT * FROM attribute_types ORDER BY sort_order, id").all();
  });
  electron.ipcMain.handle("attrs:listValues", (_, typeId) => {
    return getDb().prepare("SELECT * FROM attribute_values WHERE attribute_type_id = ? ORDER BY is_preset DESC, value ASC").all(typeId);
  });
  electron.ipcMain.handle("attrs:listAll", () => {
    const db2 = getDb();
    const types = db2.prepare("SELECT * FROM attribute_types WHERE is_active = 1 ORDER BY sort_order, id").all();
    const values = db2.prepare("SELECT * FROM attribute_values ORDER BY is_preset DESC, value ASC").all();
    const valuesByType = /* @__PURE__ */ new Map();
    for (const v of values) {
      if (!valuesByType.has(v.attribute_type_id)) valuesByType.set(v.attribute_type_id, []);
      valuesByType.get(v.attribute_type_id).push(v);
    }
    return types.map((t) => ({ ...t, values: valuesByType.get(t.id) ?? [] }));
  });
  electron.ipcMain.handle("attrs:valueCounts", () => {
    const rows = getDb().prepare(
      `SELECT attribute_type_id, attribute_value_id, COUNT(DISTINCT photo_id) as count
         FROM photo_attributes GROUP BY attribute_type_id, attribute_value_id`
    ).all();
    return rows;
  });
  electron.ipcMain.handle("attrs:filmIconManifest", () => {
    try {
      const iconsDir = path.join(electron.app.getAppPath(), "resources", "film-icons");
      const manifestPath = path.join(iconsDir, "manifest.json");
      if (!fs.existsSync(manifestPath)) return {};
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      return manifest;
    } catch {
      return {};
    }
  });
  electron.ipcMain.handle("attrs:filmIconDataUrl", (_, iconKey, size = 64) => {
    try {
      const iconsDir = path.join(electron.app.getAppPath(), "resources", "film-icons");
      const suffix = size === 128 ? "@2x" : "";
      const iconPath = path.join(iconsDir, `${iconKey}${suffix}.webp`);
      if (!fs.existsSync(iconPath)) return null;
      const buf = fs.readFileSync(iconPath);
      return `data:image/webp;base64,${buf.toString("base64")}`;
    } catch {
      return null;
    }
  });
  electron.ipcMain.handle("attrs:filmIconsBatch", (_, iconKeys, size = 64) => {
    const iconsDir = path.join(electron.app.getAppPath(), "resources", "film-icons");
    const result = {};
    const suffix = size === 128 ? "@2x" : "";
    for (const key of iconKeys) {
      try {
        const iconPath = path.join(iconsDir, `${key}${suffix}.webp`);
        if (fs.existsSync(iconPath)) {
          const buf = fs.readFileSync(iconPath);
          result[key] = `data:image/webp;base64,${buf.toString("base64")}`;
        }
      } catch {
      }
    }
    return result;
  });
  electron.ipcMain.handle("attrs:addType", (_, displayName, key) => {
    const db2 = getDb();
    const k = key || displayName.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_一-鿿]/g, "");
    const maxOrder = db2.prepare("SELECT MAX(sort_order) as m FROM attribute_types").get().m ?? 0;
    const r = db2.prepare("INSERT INTO attribute_types (key, display_name, is_system, is_active, sort_order) VALUES (?, ?, 0, 1, ?)").run(k + "_" + Date.now(), displayName, maxOrder + 1);
    return r.lastInsertRowid;
  });
  electron.ipcMain.handle("attrs:updateType", (_, id, displayName) => {
    getDb().prepare("UPDATE attribute_types SET display_name = ? WHERE id = ?").run(displayName, id);
    return true;
  });
  electron.ipcMain.handle("attrs:toggleType", (_, id, active) => {
    getDb().prepare("UPDATE attribute_types SET is_active = ? WHERE id = ? AND is_system = 0").run(active ? 1 : 0, id);
    return true;
  });
  electron.ipcMain.handle("attrs:deleteType", (_, id) => {
    getDb().prepare("DELETE FROM attribute_types WHERE id = ? AND is_system = 0").run(id);
    return true;
  });
  electron.ipcMain.handle("attrs:addValue", (_, typeId, value, iconKey) => {
    const r = getDb().prepare("INSERT OR IGNORE INTO attribute_values (attribute_type_id, value, icon_key, is_preset) VALUES (?, ?, ?, 0)").run(typeId, value.trim(), iconKey ?? null);
    return r.lastInsertRowid;
  });
  electron.ipcMain.handle("attrs:updateValue", (_, id, value, iconKey) => {
    if (iconKey !== void 0) {
      getDb().prepare("UPDATE attribute_values SET value = ?, icon_key = ? WHERE id = ?").run(value.trim(), iconKey || null, id);
    } else {
      getDb().prepare("UPDATE attribute_values SET value = ? WHERE id = ?").run(value.trim(), id);
    }
    return true;
  });
  electron.ipcMain.handle("attrs:deleteValue", (_, id) => {
    getDb().prepare("DELETE FROM attribute_values WHERE id = ?").run(id);
    return true;
  });
  electron.ipcMain.handle("attrs:reorder", (_, orderedIds) => {
    const db2 = getDb();
    const tx = db2.transaction(() => {
      orderedIds.forEach((id, idx) => {
        db2.prepare("UPDATE attribute_types SET sort_order = ? WHERE id = ?").run(idx, id);
      });
    });
    tx();
    return true;
  });
}
function registerSubLibrariesIpc() {
  electron.ipcMain.handle("sublib:list", () => {
    const rows = getDb().prepare("SELECT * FROM sub_libraries ORDER BY parent_id ASC, sort_order ASC, name ASC").all();
    return buildTree(rows);
  });
  electron.ipcMain.handle("sublib:create", (_, name, parentId) => {
    const db2 = getDb();
    const maxOrder = db2.prepare("SELECT MAX(sort_order) as m FROM sub_libraries WHERE parent_id IS ?").get(parentId ?? null).m ?? 0;
    const r = db2.prepare("INSERT INTO sub_libraries (name, parent_id, sort_order) VALUES (?, ?, ?)").run(name.trim(), parentId ?? null, maxOrder + 1);
    return r.lastInsertRowid;
  });
  electron.ipcMain.handle("sublib:rename", (_, id, name) => {
    getDb().prepare("UPDATE sub_libraries SET name = ? WHERE id = ?").run(name.trim(), id);
    return true;
  });
  electron.ipcMain.handle("sublib:setDescription", (_, id, description) => {
    getDb().prepare("UPDATE sub_libraries SET description = ? WHERE id = ?").run(description, id);
    return true;
  });
  electron.ipcMain.handle("sublib:delete", (_, id) => {
    const db2 = getDb();
    db2.prepare("UPDATE photos SET sub_library_id = NULL WHERE sub_library_id = ?").run(id);
    db2.prepare("UPDATE sub_libraries SET parent_id = NULL WHERE parent_id = ?").run(id);
    db2.prepare("DELETE FROM sub_libraries WHERE id = ?").run(id);
    return true;
  });
  electron.ipcMain.handle("sublib:counts", () => {
    const rows = getDb().prepare("SELECT sub_library_id, COUNT(*) as count FROM photos GROUP BY sub_library_id").all();
    const map = { null: 0 };
    rows.forEach((r) => {
      map[String(r.sub_library_id)] = r.count;
    });
    return map;
  });
}
function buildTree(rows) {
  const map = /* @__PURE__ */ new Map();
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }));
  const roots = [];
  rows.forEach((r) => {
    if (r.parent_id == null) roots.push(map.get(r.id));
    else map.get(r.parent_id)?.children.push(map.get(r.id));
  });
  return roots;
}
function registerLibraryIpc() {
  electron.ipcMain.handle("library:info", () => {
    return {
      root: getLibraryRoot$1(),
      thumbDir: getThumbDir(),
      profilesDir: getProfilesDir()
    };
  });
  electron.ipcMain.handle("library:revealFile", (_, filePath) => {
    electron.shell.showItemInFolder(filePath);
  });
  electron.ipcMain.handle("library:regenThumb", async (_, photoId) => {
    const db2 = getDb();
    const row = db2.prepare("SELECT file_path FROM photos WHERE id = ?").get(photoId);
    if (!row) return false;
    const thumbPath = await generateThumbnail(row.file_path, getThumbDir());
    if (thumbPath) {
      db2.prepare("UPDATE photos SET thumb_path = ?, thumb_ready = 1 WHERE id = ?").run(thumbPath, photoId);
    }
    return !!thumbPath;
  });
  electron.ipcMain.handle("library:listProfiles", () => {
    const profilesDir2 = getProfilesDir();
    const customDir = path.join(getLibraryRoot$1(), "profiles");
    const collect = (dir, isPreset) => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => /\.(icc|icm)$/i.test(f)).map((f) => ({
        name: path.basename(f, path.extname(f)),
        path: path.join(dir, f),
        isPreset
      }));
    };
    return [...collect(profilesDir2, true), ...collect(customDir, false)];
  });
  electron.ipcMain.handle("library:importProfile", async (event) => {
    const win = require("electron").BrowserWindow.fromWebContents(event.sender);
    const result = await electron.dialog.showOpenDialog(win, {
      filters: [{ name: "ICC Profile", extensions: ["icc", "icm"] }],
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled) return [];
    const customDir = path.join(getLibraryRoot$1(), "profiles");
    fs.mkdirSync(customDir, { recursive: true });
    const imported = [];
    for (const src of result.filePaths) {
      const dest = path.join(customDir, path.basename(src));
      fs.copyFileSync(src, dest);
      imported.push(path.basename(src, path.extname(src)));
    }
    return imported;
  });
  electron.ipcMain.handle("library:stats", () => {
    const db2 = getDb();
    const total = db2.prepare("SELECT COUNT(*) as c FROM photos").get().c;
    const byType = db2.prepare("SELECT file_type, COUNT(*) as count FROM photos GROUP BY file_type").all();
    const librarySize = getFolderSize(path.join(getLibraryRoot$1(), "files"));
    return { total, byType, librarySize };
  });
}
function getFolderSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) size += getFolderSize(full);
    else size += fs.statSync(full).size;
  }
  return size;
}
let libraryRoot;
let thumbDir;
let profilesDir;
function getLibraryRoot$1() {
  return libraryRoot;
}
function getThumbDir() {
  return thumbDir;
}
function getProfilesDir() {
  return profilesDir;
}
function initIpc(libRoot) {
  libraryRoot = libRoot;
  thumbDir = path.join(libRoot, "thumbs");
  profilesDir = path.join(electron.app.getAppPath(), "resources", "profiles");
  fs.mkdirSync(path.join(libRoot, "files"), { recursive: true });
  fs.mkdirSync(thumbDir, { recursive: true });
  registerPhotosIpc();
  registerImportIpc();
  registerAttributesIpc();
  registerSubLibrariesIpc();
  registerLibraryIpc();
}
const DEFAULT_LIBRARY_ROOT = "E:\\FilmManager";
function getLibraryRoot() {
  const configPath = path.join(electron.app.getPath("userData"), "config.json");
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (cfg.libraryRoot) return cfg.libraryRoot;
    }
  } catch {
  }
  return DEFAULT_LIBRARY_ROOT;
}
function createWindow() {
  const win = new electron.BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#141414",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#1a1a1a",
      symbolColor: "#ffffff",
      height: 40
    },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true
    }
  });
  electron.nativeTheme.themeSource = "dark";
  if (process.env["ELECTRON_RENDERER_URL"]) {
    win.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  return win;
}
electron.app.whenReady().then(() => {
  electron.protocol.handle("localfile", (request) => {
    const filePath = decodeURIComponent(request.url.slice("localfile://".length));
    return electron.net.fetch(`file://${filePath}`);
  });
  const libraryRoot2 = getLibraryRoot();
  log.info("Library root:", libraryRoot2);
  try {
    initDb(libraryRoot2);
    initIpc(libraryRoot2);
  } catch (err) {
    log.error("Init failed:", err);
  }
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.ipcMain.handle("app:setLibraryRoot", (_, newRoot) => {
  const configPath = path.join(electron.app.getPath("userData"), "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ libraryRoot: newRoot }, null, 2));
  return true;
});
electron.ipcMain.handle("app:getLibraryRoot", () => getLibraryRoot());
