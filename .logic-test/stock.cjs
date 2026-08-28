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

// src/main/features/export/stock-presets.ts
var stock_presets_exports = {};
__export(stock_presets_exports, {
  BUILTIN_STOCKS: () => BUILTIN_STOCKS,
  PROCESS_STYLES: () => PROCESS_STYLES,
  resolveStock: () => resolveStock
});
module.exports = __toCommonJS(stock_presets_exports);
var PROCESS_STYLES = {
  "C-41": {
    ink: { color: "rgba(255, 176, 64, 0.92)", glow: "rgba(255, 170, 60, 0.45)" },
    edgePresets: ["135-36", "C-41", "DX 5063", "SAFETY FILM", "135"],
    edgePresets120: ["120", "C-41", "SAFETY FILM"],
    frameNumberStyle: "N/NA"
  },
  BW: {
    ink: { color: "rgba(238, 238, 232, 0.92)", glow: "rgba(240, 240, 235, 0.35)" },
    edgePresets: ["135-36", "SAFETY FILM", "DX 5063", "PANCHROMATIC", "135"],
    edgePresets120: ["120", "SAFETY FILM", "PANCHROMATIC"],
    frameNumberStyle: "N/NA"
  },
  "E-6": {
    ink: { color: "rgba(249, 195, 148, 0.92)", glow: "rgba(249, 195, 148, 0.4)" },
    edgePresets: ["135-36", "E-6", "SAFETY FILM", "135"],
    edgePresets120: ["120", "E-6"],
    frameNumberStyle: "N"
  },
  "ECN-2": {
    ink: { color: "rgba(250, 230, 190, 0.92)", glow: "rgba(250, 230, 190, 0.35)" },
    edgePresets: ["EASTMAN", "KEEP FILM 5219", "ECN-2", "SAFETY FILM"],
    edgePresets120: ["EASTMAN", "ECN-2", "SAFETY FILM"],
    frameNumberStyle: "N"
  }
};
var BUILTIN_STOCKS = [
  // ── Kodak 彩色负片 (C-41) ──
  { id: "kodak-portra-400", name: "Kodak Portra 400", edgeText: "KODAK PORTRA 400", process: "C-41" },
  { id: "kodak-portra-160", name: "Kodak Portra 160", edgeText: "KODAK PORTRA 160", process: "C-41" },
  { id: "kodak-portra-800", name: "Kodak Portra 800", edgeText: "KODAK PORTRA 800", process: "C-41" },
  { id: "kodak-gold-200", name: "Kodak Gold 200", edgeText: "KODAK GOLD 200", process: "C-41" },
  { id: "kodak-gold-100", name: "Kodak Gold 100", edgeText: "KODAK GOLD 100", process: "C-41" },
  { id: "kodak-ultramax-400", name: "Kodak UltraMax 400", edgeText: "KODAK ULTRAMAX 400", process: "C-41" },
  { id: "kodak-colorplus-200", name: "Kodak ColorPlus 200", edgeText: "KODAK COLORPLUS 200", process: "C-41" },
  { id: "kodak-ektar-100", name: "Kodak Ektar 100", edgeText: "KODAK EKTAR 100", process: "C-41" },
  { id: "kodak-proimage-100", name: "Kodak ProImage 100", edgeText: "KODAK PRO IMAGE 100", process: "C-41" },
  // ── Kodak 黑白 (BW) ──
  { id: "kodak-tri-x-400", name: "Kodak Tri-X 400", edgeText: "KODAK TRI-X 400", process: "BW" },
  { id: "kodak-tmax-100", name: "Kodak T-Max 100", edgeText: "KODAK T-MAX 100", process: "BW" },
  { id: "kodak-tmax-400", name: "Kodak T-Max 400", edgeText: "KODAK T-MAX 400", process: "BW" },
  { id: "kodak-tmax-p3200", name: "Kodak P3200", edgeText: "KODAK P3200", process: "BW" },
  // ── Kodak 反转片 (E-6) ──
  { id: "kodak-ektachrome-e100", name: "Kodak Ektachrome E100", edgeText: "KODAK EKTACHROME E100", process: "E-6" },
  // ── Fujifilm 彩色负片 (C-41) ──
  { id: "fujifilm-400", name: "Fujifilm 400", edgeText: "FUJIFILM 400", process: "C-41" },
  { id: "fujifilm-c400", name: "Fujifilm C400", edgeText: "FUJIFILM C400", process: "C-41" },
  { id: "fujicolor-c200", name: "Fujicolor C200", edgeText: "FUJICOLOR C200", process: "C-41" },
  { id: "fujifilm-superia-400", name: "Fujifilm Superia 400", edgeText: "FUJIFILM SUPERIA 400", process: "C-41" },
  // ── Ilford 黑白 (BW) ──
  { id: "ilford-hp5", name: "Ilford HP5 Plus", edgeText: "ILFORD HP5 PLUS", process: "BW" },
  { id: "ilford-fp4", name: "Ilford FP4 Plus", edgeText: "ILFORD FP4 PLUS", process: "BW" },
  { id: "ilford-delta-100", name: "Ilford Delta 100", edgeText: "ILFORD DELTA 100", process: "BW" },
  { id: "ilford-delta-400", name: "Ilford Delta 400", edgeText: "ILFORD DELTA 400", process: "BW" },
  { id: "ilford-xp2", name: "Ilford XP2", edgeText: "ILFORD XP2 SUPER", process: "BW" },
  // ── Kentmere 黑白 (BW) ──
  { id: "kentmere-pan-400", name: "Kentmere Pan 400", edgeText: "KENTMERE 400", process: "BW" },
  // ── Lucky 乐凯 (C-41) ──
  { id: "lucky-c200", name: "Lucky C200", edgeText: "LUCKY C200", process: "C-41" },
  // ── 电影卷 ECN-2 ──
  { id: "kodak-vision3-500", name: "Kodak Vision3 500T", edgeText: "KODAK VISION3 500T", process: "ECN-2" },
  { id: "cinestill-800t", name: "Cinestill 800T", edgeText: "CINESTILL 800T", process: "ECN-2" }
];
function normalize(s) {
  return s.replace(/[\s\-_.\[\]/()]/g, "").toLowerCase();
}
function resolveStock(filmAttrValue) {
  const fallback = {
    edgeText: filmAttrValue?.replace(/\s*\[.*\]\s*/, "").trim().toUpperCase() || "FILM",
    process: "C-41",
    ...PROCESS_STYLES["C-41"],
    matched: false
  };
  if (!filmAttrValue) return fallback;
  const norm = normalize(filmAttrValue);
  let best;
  for (const s of BUILTIN_STOCKS) {
    const ns = normalize(s.name);
    if (norm.includes(ns) || ns.includes(norm)) {
      if (!best || ns.length > normalize(best.name).length) best = s;
    }
  }
  if (best) {
    return { edgeText: best.edgeText, process: best.process, ...PROCESS_STYLES[best.process], matched: true };
  }
  const isBw = /trix|tri-x|t-max|tmax|hp5|fp4|delta|ilford|kentmere|fomapan|neopan|plus-x|ortho|xp2|sfx|rollei|harman|black|黑白|pan/i.test(filmAttrValue);
  const isE6 = /ektachrome|velvia|provia|slide|反转/i.test(filmAttrValue);
  const isEcn = /vision3|cinestill|ecn|电影|eastman/i.test(filmAttrValue);
  const process = isEcn ? "ECN-2" : isE6 ? "E-6" : isBw ? "BW" : "C-41";
  const style = PROCESS_STYLES[process];
  return {
    edgeText: filmAttrValue.replace(/\s*\[.*\]\s*/, "").trim().toUpperCase() || "FILM",
    process,
    ...style,
    matched: false
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  BUILTIN_STOCKS,
  PROCESS_STYLES,
  resolveStock
});
