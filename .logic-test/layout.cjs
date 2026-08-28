"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/features/library-layout/library-layout.ts
var library_layout_exports = {};
__export(library_layout_exports, {
  createSubLibrary: () => createSubLibrary,
  deleteSubLibrary: () => deleteSubLibrary,
  ensureSubLibraryDirectory: () => ensureSubLibraryDirectory,
  ensureUniqueFilePath: () => ensureUniqueFilePath,
  getOrCreateSubLibrary: () => getOrCreateSubLibrary,
  getSubLibraryDirectory: () => getSubLibraryDirectory,
  movePhotosToSubLibrary: () => movePhotosToSubLibrary,
  pathKey: () => pathKey,
  renameSubLibrary: () => renameSubLibrary,
  sanitizeFolderName: () => sanitizeFolderName,
  synchronizeLibraryLayout: () => synchronizeLibraryLayout
});
module.exports = __toCommonJS(library_layout_exports);
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var import_electron_log = __toESM(require("electron-log"));
function synchronizeLibraryLayout(db, filesRoot) {
  import_fs.default.mkdirSync(filesRoot, { recursive: true });
  assignFolderNames(db, filesRoot);
  const subLibraries = listSubLibraries(db);
  let directories = 0;
  for (const subLibrary of sortByDepth(subLibraries)) {
    const directory = getSubLibraryDirectory(db, filesRoot, subLibrary.id);
    if (!import_fs.default.existsSync(directory)) {
      import_fs.default.mkdirSync(directory, { recursive: true });
      directories++;
    }
  }
  const result = { moved: 0, unchanged: 0, failed: [], directories };
  const photos = db.prepare("SELECT id, file_path, original_name, sub_library_id FROM photos ORDER BY id").all();
  for (const photo of photos) {
    const moveResult = relocatePhoto(db, filesRoot, photo, photo.sub_library_id);
    mergeMoveResult(result, moveResult);
  }
  return result;
}
function getSubLibraryDirectory(db, filesRoot, subLibraryId) {
  const root = import_path.default.resolve(filesRoot);
  if (subLibraryId == null) return root;
  const rows = listSubLibraries(db);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const segments = [];
  const visited = /* @__PURE__ */ new Set();
  let currentId = subLibraryId;
  while (currentId != null) {
    if (visited.has(currentId)) throw new Error(`\u5B50\u5E93\u5C42\u7EA7\u5B58\u5728\u5FAA\u73AF\u5F15\u7528\uFF1A${currentId}`);
    visited.add(currentId);
    const row = byId.get(currentId);
    if (!row) throw new Error(`\u5B50\u5E93\u4E0D\u5B58\u5728\uFF1A${currentId}`);
    segments.unshift(row.folder_name || sanitizeFolderName(row.name));
    currentId = row.parent_id;
  }
  const directory = import_path.default.resolve(root, ...segments);
  assertInsideRoot(root, directory);
  return directory;
}
function ensureSubLibraryDirectory(db, filesRoot, subLibraryId) {
  const directory = getSubLibraryDirectory(db, filesRoot, subLibraryId);
  import_fs.default.mkdirSync(directory, { recursive: true });
  return directory;
}
function createSubLibrary(db, filesRoot, name, parentId) {
  const normalizedName = normalizeDisplayName(name);
  if (parentId != null) getSubLibraryDirectory(db, filesRoot, parentId);
  const maxOrder = db.prepare("SELECT MAX(sort_order) AS value FROM sub_libraries WHERE parent_id IS ?").get(parentId ?? null).value ?? 0;
  const folderName = allocateFolderName(db, filesRoot, normalizedName, parentId ?? null);
  const result = db.prepare(`
    INSERT INTO sub_libraries (name, parent_id, folder_name, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(normalizedName, parentId ?? null, folderName, maxOrder + 1);
  const id = Number(result.lastInsertRowid);
  try {
    ensureSubLibraryDirectory(db, filesRoot, id);
  } catch (error) {
    db.prepare("DELETE FROM sub_libraries WHERE id = ?").run(id);
    throw error;
  }
  return id;
}
function getOrCreateSubLibrary(db, filesRoot, name, parentId) {
  const normalizedName = normalizeDisplayName(name);
  const existing = db.prepare(`
    SELECT id FROM sub_libraries
    WHERE parent_id IS ? AND name = ? COLLATE NOCASE
    LIMIT 1
  `).get(parentId ?? null, normalizedName);
  if (existing) {
    ensureSubLibraryDirectory(db, filesRoot, existing.id);
    return existing.id;
  }
  return createSubLibrary(db, filesRoot, normalizedName, parentId);
}
function renameSubLibrary(db, filesRoot, id, name) {
  const row = getSubLibrary(db, id);
  relocateSubLibrary(db, filesRoot, row, row.parent_id, normalizeDisplayName(name));
}
function deleteSubLibrary(db, filesRoot, id) {
  const row = getSubLibrary(db, id);
  const directory = getSubLibraryDirectory(db, filesRoot, id);
  const photoIds = db.prepare("SELECT id FROM photos WHERE sub_library_id = ? ORDER BY id").all(id);
  const photoResult = movePhotosToSubLibrary(db, filesRoot, photoIds.map((photo) => photo.id), null);
  if (photoResult.failed.length > 0) {
    throw new Error(`\u6709 ${photoResult.failed.length} \u5F20\u7167\u7247\u65E0\u6CD5\u79FB\u51FA\u5B50\u5E93\u201C${row.name}\u201D`);
  }
  const children = db.prepare(`
    SELECT id, name, parent_id, folder_name
    FROM sub_libraries
    WHERE parent_id = ?
    ORDER BY sort_order, id
  `).all(id);
  for (const child of children) {
    relocateSubLibrary(db, filesRoot, child, null, child.name);
  }
  db.prepare("DELETE FROM sub_libraries WHERE id = ?").run(id);
  tryRemoveEmptyDirectory(directory);
}
function movePhotosToSubLibrary(db, filesRoot, photoIds, subLibraryId) {
  ensureSubLibraryDirectory(db, filesRoot, subLibraryId);
  const result = { moved: 0, unchanged: 0, failed: [] };
  for (const id of new Set(photoIds)) {
    const photo = db.prepare(`
      SELECT id, file_path, original_name, sub_library_id, storage_mode
      FROM photos WHERE id = ?
    `).get(id);
    if (!photo) {
      result.failed.push({ id, filePath: "", reason: "\u7167\u7247\u8BB0\u5F55\u4E0D\u5B58\u5728" });
      continue;
    }
    if (photo.storage_mode === "linked") {
      db.prepare("UPDATE photos SET sub_library_id = ? WHERE id = ?").run(subLibraryId, id);
      result.unchanged++;
      continue;
    }
    mergeMoveResult(result, relocatePhoto(db, filesRoot, photo, subLibraryId));
  }
  return result;
}
function ensureUniqueFilePath(destination, sourcePath, claimed) {
  const isTaken = (p) => {
    if (sourcePath && pathsReferToSameLocation(p, sourcePath)) return false;
    if (import_fs.default.existsSync(p)) return true;
    return claimed?.has(pathKey(p)) ?? false;
  };
  if (!isTaken(destination)) {
    return destination;
  }
  const extension = import_path.default.extname(destination);
  const base = destination.slice(0, destination.length - extension.length);
  let index = 1;
  let candidate = `${base}_${index}${extension}`;
  while (isTaken(candidate)) {
    index++;
    candidate = `${base}_${index}${extension}`;
  }
  return candidate;
}
function sanitizeFolderName(name) {
  let value = name.normalize("NFKC").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim();
  if (!value || value === "." || value === "..") value = "\u672A\u547D\u540D";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) value = `_${value}`;
  return value.slice(0, 100).replace(/[. ]+$/g, "") || "\u672A\u547D\u540D";
}
function assignFolderNames(db, filesRoot) {
  const rows = sortByDepth(listSubLibraries(db));
  const usedByParent = /* @__PURE__ */ new Map();
  const update = db.prepare("UPDATE sub_libraries SET folder_name = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    for (const row of rows) {
      const parentKey = String(row.parent_id ?? "root");
      const used = usedByParent.get(parentKey) ?? /* @__PURE__ */ new Set();
      usedByParent.set(parentKey, used);
      const base = sanitizeFolderName(row.folder_name || row.name);
      const parentDirectory = getSubLibraryDirectory(db, filesRoot, row.parent_id);
      let folderName = base;
      let index = 1;
      while (used.has(pathKey(folderName)) || import_fs.default.existsSync(import_path.default.join(parentDirectory, folderName)) && !import_fs.default.statSync(import_path.default.join(parentDirectory, folderName)).isDirectory()) {
        index++;
        folderName = withFolderSuffix(base, index);
      }
      used.add(pathKey(folderName));
      if (row.folder_name !== folderName) {
        update.run(folderName, row.id);
        row.folder_name = folderName;
      }
    }
  });
  transaction();
}
function allocateFolderName(db, filesRoot, name, parentId, excludeId) {
  const siblings = db.prepare(`
    SELECT id, folder_name FROM sub_libraries
    WHERE parent_id IS ? AND (? IS NULL OR id != ?)
  `).all(parentId, excludeId ?? null, excludeId ?? null);
  const used = new Set(siblings.map((row) => pathKey(row.folder_name || "")));
  const parentDirectory = getSubLibraryDirectory(db, filesRoot, parentId);
  const currentDirectory = excludeId == null ? null : getSubLibraryDirectory(db, filesRoot, excludeId);
  const base = sanitizeFolderName(name);
  let index = 1;
  let candidate = base;
  while (used.has(pathKey(candidate)) || import_fs.default.existsSync(import_path.default.join(parentDirectory, candidate)) && !(currentDirectory && pathsReferToSameLocation(import_path.default.join(parentDirectory, candidate), currentDirectory))) {
    index++;
    candidate = withFolderSuffix(base, index);
  }
  return candidate;
}
function relocatePhoto(db, filesRoot, photo, targetSubLibraryId) {
  const result = { moved: 0, unchanged: 0, failed: [] };
  const targetDirectory = ensureSubLibraryDirectory(db, filesRoot, targetSubLibraryId);
  const fileName = import_path.default.basename(photo.file_path || photo.original_name);
  const desiredPath = import_path.default.join(targetDirectory, fileName);
  const targetPath = ensureUniqueFilePath(desiredPath, photo.file_path);
  if (pathsReferToSameLocation(photo.file_path, targetPath)) {
    db.prepare("UPDATE photos SET sub_library_id = ? WHERE id = ?").run(targetSubLibraryId, photo.id);
    result.unchanged++;
    return result;
  }
  if (!import_fs.default.existsSync(photo.file_path)) {
    result.failed.push({ id: photo.id, filePath: photo.file_path, reason: "\u6E90\u6587\u4EF6\u4E0D\u5B58\u5728" });
    return result;
  }
  try {
    moveFile(photo.file_path, targetPath);
    try {
      db.prepare("UPDATE photos SET file_path = ?, sub_library_id = ? WHERE id = ?").run(targetPath, targetSubLibraryId, photo.id);
    } catch (error) {
      try {
        moveFile(targetPath, photo.file_path);
      } catch (rollbackError) {
        import_electron_log.default.error("Failed to roll back photo move", rollbackError);
      }
      throw error;
    }
    result.moved++;
  } catch (error) {
    result.failed.push({
      id: photo.id,
      filePath: photo.file_path,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
  return result;
}
function relocateSubLibrary(db, filesRoot, row, targetParentId, targetName) {
  const oldDirectory = getSubLibraryDirectory(db, filesRoot, row.id);
  const folderName = allocateFolderName(db, filesRoot, targetName, targetParentId, row.id);
  const targetParentDirectory = ensureSubLibraryDirectory(db, filesRoot, targetParentId);
  const newDirectory = import_path.default.join(targetParentDirectory, folderName);
  assertInsideRoot(import_path.default.resolve(filesRoot), import_path.default.resolve(newDirectory));
  const affectedPhotos = db.prepare("SELECT id, file_path FROM photos").all().filter((photo) => isInsideDirectory(oldDirectory, photo.file_path)).map((photo) => ({
    id: photo.id,
    oldPath: photo.file_path,
    newPath: import_path.default.join(newDirectory, import_path.default.relative(oldDirectory, photo.file_path))
  }));
  const directoryMove = moveDirectory(oldDirectory, newDirectory);
  try {
    const updatePhoto = db.prepare("UPDATE photos SET file_path = ? WHERE id = ?");
    const transaction = db.transaction(() => {
      db.prepare("UPDATE sub_libraries SET name = ?, parent_id = ?, folder_name = ? WHERE id = ?").run(targetName, targetParentId, folderName, row.id);
      for (const photo of affectedPhotos) updatePhoto.run(photo.newPath, photo.id);
    });
    transaction();
  } catch (error) {
    rollbackDirectoryMove(directoryMove);
    throw error;
  }
}
function moveDirectory(source, destination) {
  if (pathsExactlyEqual(source, destination)) {
    import_fs.default.mkdirSync(destination, { recursive: true });
    return { source, destination, moved: false, created: false };
  }
  import_fs.default.mkdirSync(import_path.default.dirname(destination), { recursive: true });
  if (!import_fs.default.existsSync(source)) {
    import_fs.default.mkdirSync(destination, { recursive: true });
    return { source, destination, moved: false, created: true };
  }
  if (pathsReferToSameLocation(source, destination)) {
    const temporary = `${source}.__filmmanager_${Date.now()}`;
    import_fs.default.renameSync(source, temporary);
    try {
      import_fs.default.renameSync(temporary, destination);
    } catch (error) {
      import_fs.default.renameSync(temporary, source);
      throw error;
    }
  } else {
    if (import_fs.default.existsSync(destination)) throw new Error(`\u76EE\u6807\u76EE\u5F55\u5DF2\u5B58\u5728\uFF1A${destination}`);
    import_fs.default.renameSync(source, destination);
  }
  return { source, destination, moved: true, created: false };
}
function rollbackDirectoryMove(move) {
  try {
    if (move.moved && import_fs.default.existsSync(move.destination)) {
      import_fs.default.renameSync(move.destination, move.source);
    } else if (move.created) {
      tryRemoveEmptyDirectory(move.destination);
    }
  } catch (error) {
    import_electron_log.default.error("Failed to roll back sub-library directory move", error);
  }
}
function moveFile(source, destination) {
  if (pathsReferToSameLocation(source, destination)) return;
  import_fs.default.mkdirSync(import_path.default.dirname(destination), { recursive: true });
  try {
    import_fs.default.renameSync(source, destination);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    import_fs.default.copyFileSync(source, destination, import_fs.default.constants.COPYFILE_EXCL);
    try {
      import_fs.default.unlinkSync(source);
    } catch (unlinkError) {
      try {
        import_fs.default.unlinkSync(destination);
      } catch {
      }
      throw unlinkError;
    }
  }
}
function listSubLibraries(db) {
  return db.prepare(`
    SELECT id, name, parent_id, folder_name
    FROM sub_libraries
    ORDER BY id
  `).all();
}
function getSubLibrary(db, id) {
  const row = db.prepare(`
    SELECT id, name, parent_id, folder_name
    FROM sub_libraries WHERE id = ?
  `).get(id);
  if (!row) throw new Error(`\u5B50\u5E93\u4E0D\u5B58\u5728\uFF1A${id}`);
  return row;
}
function sortByDepth(rows) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const depths = /* @__PURE__ */ new Map();
  const depthOf = (id, visiting = /* @__PURE__ */ new Set()) => {
    const known = depths.get(id);
    if (known != null) return known;
    if (visiting.has(id)) throw new Error(`\u5B50\u5E93\u5C42\u7EA7\u5B58\u5728\u5FAA\u73AF\u5F15\u7528\uFF1A${id}`);
    visiting.add(id);
    const row = byId.get(id);
    const depth = row?.parent_id == null ? 0 : depthOf(row.parent_id, visiting) + 1;
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  return [...rows].sort((a, b) => depthOf(a.id) - depthOf(b.id) || a.id - b.id);
}
function normalizeDisplayName(name) {
  const value = name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 100);
  if (!value) throw new Error("\u5B50\u5E93\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
  return value;
}
function withFolderSuffix(base, index) {
  const suffix = ` (${index})`;
  const maxBaseLength = Math.max(1, 100 - suffix.length);
  return `${base.slice(0, maxBaseLength).replace(/[. ]+$/g, "")}${suffix}`;
}
function mergeMoveResult(target, source) {
  target.moved += source.moved;
  target.unchanged += source.unchanged;
  target.failed.push(...source.failed);
}
function pathKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}
function pathsExactlyEqual(a, b) {
  return import_path.default.resolve(a) === import_path.default.resolve(b);
}
function pathsReferToSameLocation(a, b) {
  return pathKey(import_path.default.resolve(a)) === pathKey(import_path.default.resolve(b));
}
function isInsideDirectory(directory, candidate) {
  const relative = import_path.default.relative(import_path.default.resolve(directory), import_path.default.resolve(candidate));
  return relative !== "" && !relative.startsWith(`..${import_path.default.sep}`) && relative !== ".." && !import_path.default.isAbsolute(relative);
}
function assertInsideRoot(root, candidate) {
  if (pathsReferToSameLocation(root, candidate)) return;
  if (!isInsideDirectory(root, candidate)) throw new Error(`\u76EE\u5F55\u8D85\u51FA\u56FE\u5E93\u8303\u56F4\uFF1A${candidate}`);
}
function tryRemoveEmptyDirectory(directory) {
  try {
    import_fs.default.rmdirSync(directory);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error.code ?? "")) {
      import_electron_log.default.warn("Failed to remove empty sub-library directory", directory, error);
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createSubLibrary,
  deleteSubLibrary,
  ensureSubLibraryDirectory,
  ensureUniqueFilePath,
  getOrCreateSubLibrary,
  getSubLibraryDirectory,
  movePhotosToSubLibrary,
  pathKey,
  renameSubLibrary,
  sanitizeFolderName,
  synchronizeLibraryLayout
});
