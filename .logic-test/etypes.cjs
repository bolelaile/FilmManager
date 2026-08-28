"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/shared/export-types.ts
var export_types_exports = {};
__export(export_types_exports, {
  DEFAULT_EXPORT_CONFIG: () => DEFAULT_EXPORT_CONFIG,
  filmFormatToId: () => filmFormatToId
});
module.exports = __toCommonJS(export_types_exports);
var DEFAULT_EXPORT_CONFIG = {
  border: {
    formatId: "135",
    filmFormatOverride: null
  },
  edgeText: {
    enabled: true,
    stockId: "auto",
    positions: ["top", "bottom"],
    content: {},
    font: '"Courier New", monospace',
    fontSizeRatio: 0.86,
    opacity: 0.92,
    align: "center",
    letterSpacing: 0
  },
  frameNo: { start: 1, step: 1, digits: 2, prefix: "" },
  image: {
    format: "jpeg",
    quality: 92,
    longEdge: 2048,
    scale: null,
    crop: null
  },
  background: {
    type: "solid",
    color: "#0a0a0a",
    blurSigma: 12,
    paddingRatio: 0.05
  },
  output: {
    dir: "",
    filenameTemplate: "{original}_{frame_no}",
    overwrite: "rename"
  }
};
function filmFormatToId(filmFormat) {
  if (!filmFormat) return "135";
  const s = filmFormat;
  if (s.includes("\u534A\u683C")) return "half";
  if (s.includes("Xpan") || s.includes("\u5BBD\u5E45")) return "xpan";
  if (s.includes("645")) return "645";
  if (s.includes("6x6") || s.includes("6\xD76")) return "66";
  if (s.includes("6x7") || s.includes("6\xD77")) return "67";
  if (s.includes("6x9") || s.includes("6\xD79")) return "69";
  if (s.includes("6x12") || s.includes("6\xD712")) return "612";
  if (s.includes("4x5") || s.includes("8x10") || s.includes("\u5927\u753B\u5E45")) return "none";
  return "135";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_EXPORT_CONFIG,
  filmFormatToId
});
