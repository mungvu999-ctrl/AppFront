/**
 * Phép khớp mẫu vào hộp bao của món (tách NGUYÊN VĂN từ `itemNodeOf` của toPascal.ts, vòng 12 làn S): tỉ lệ từng trục
 * `asset.scale`, độ dời, cỡ HIỂN THỊ `shownM` [rộng, cao, sâu] (m). `roomSet` dùng chung để ràng buộc cứng trên cỡ hiển thị
 * — một phép co duy nhất cho cả dựng cảnh lẫn chọn mẫu.
 */

import { millimetres, millimetresToMetres } from '@/domain/units/types';

import { CATALOG_MODELS } from './furnitureCatalog';
import type { PascalVec3 } from './types';

const metresOf = (valueMm: number): number => millimetresToMetres(millimetres(valueMm));

/** Cây mà catalog dựng cao hơn trần (cọ 4,5 m, thông 3 m): trong nhà chặn ở 2,2 m. */
const TALL_PLANT_FOLDERS: ReadonlySet<string> = new Set(['palm', 'fir-tree']);
const TALL_PLANT_MAX_M = 2.2;

/** Thảm: phủ đúng mặt bằng hộp bao; dày theo `heightMm` hoặc nửa catalog (10 mm từng làm `s` chung = 0,25). */
const RUG_FOLDERS: ReadonlySet<string> = new Set(['rectangular-carpet', 'round-carpet']);

const RUG_SCALE_Y = 0.5;
/**
 * Đồ kéo dài được theo từng trục (dãy tủ, kệ, chậu rửa liền tủ, bồn cây…): một tỉ lệ chung
 * thu cả dãy 3 m về một mô-đun. Kéo hết theo trục dài của hộp (không trần — tủ áo 3 m ra 3 m),
 * trục kia trong `[FIT_AXIS_MIN; FIT_AXIS_MAX]` × mẫu nhưng không quá hộp, cao giữ thật.
 */
const STRETCH_FOLDERS: ReadonlySet<string> = new Set([
  'closet',
  'kitchen-cabinet',
  'kitchen-counter',
  'kitchen-shelf',
  'kitchen',
  'bookshelf',
  'shelf',
  'bush',
  'bathroom-sink',
  'dresser',
  'tv-stand',
  // Bàn trà chữ nhật vào ô vuông 0,9 × 0,9 (F1): co đều thì chỉ còn sâu 0,5 m.
  'coffee-table',
]);
/** Biên co giãn một trục mặt bằng quanh tỉ lệ chung (C3, GIAI-PHAP 3.4): lệch hơn thì mẫu méo dáng. */
const FIT_AXIS_MIN = 0.8;
const FIT_AXIS_MAX = 1.25;
/** Biên hệ số cao khi bản vẽ không cho `heightMm`: giữ cao thật của mẫu (bàn ăn không còn 0,30 m). */
const FIT_HEIGHT_MIN = 0.9;
const FIT_HEIGHT_MAX = 1.1;
const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
/** `heightMm` là bề dày tấm trên bản vẽ (mặt bếp 20 mm), không phải cao mẫu: khớp theo mặt bằng, giữ cao thật. */
const OWN_HEIGHT_FOLDERS: ReadonlySet<string> = new Set(['hob-sf']);

export interface ItemFit {
  readonly folder: string;
  /** Cỡ hiển thị [rộng, cao, sâu] (m) theo trục riêng của món. */
  readonly shownM: PascalVec3;
  readonly heightM: number;
  readonly scale: PascalVec3;
  readonly offset: PascalVec3;
  readonly rotation: PascalVec3;
}

/**
 * Khớp mẫu `folder` vào hộp `widthM` × `depthM` (trục riêng của món) với `heightMm` của món (vắng = theo mẫu, chặn trần
 * tầng `levelHeightMm`); `exactFit` = cặp nhận (khớp đúng hộp + `heightMm`). `null` = mẫu chưa có trong catalog.
 */
export const itemFitOf = (
  folder: string,
  widthM: number,
  depthM: number,
  heightMm: number | undefined,
  levelHeightMm: number,
  exactFit = false,
): ItemFit | null => {
  const catalog = CATALOG_MODELS[folder];
  if (catalog === undefined) {
    return null;
  }

  const [cw, ch, cd] = catalog.dimensions;
  const fixedH = heightMm === undefined || OWN_HEIGHT_FOLDERS.has(folder) ? undefined : metresOf(heightMm);
  // Không có `heightMm` (bản quét AI) thì chỉ hộp bao quyết định `s` — món đồ có thể
  // phình cao vô lý. Chặn: ≤ 1,25× cỡ catalog, cây cao ≤ 2,2 m, và không quá trần tầng.
  const maxH = fixedH ?? Math.min(metresOf(levelHeightMm), TALL_PLANT_FOLDERS.has(folder) ? TALL_PLANT_MAX_M : ch * 1.25);
  // Tỉ lệ từng trục [sx, sy, sz] theo nhóm: thảm phủ mặt bằng, đồ kéo dài kéo theo chiều dài,
  // đồ cứng co giãn từng trục có chặn lệch. Chỉ `asset.scale` lệch trục — lượt về
  // chỉ đọc `node.scale` nên không đổi gì.
  // Hộp bao là khung riêng của món (K1: `orientDetected` đã đổi cạnh khi quay 90/270), node
  // quay theo `rotationDeg` — nên `rx`/`rz` so trục riêng với trục mẫu, không đụng `asset.rotation`.
  const rx = widthM / cw;
  const rz = depthM / cd;
  const heightOf = (ref: number): number =>
    fixedH === undefined ? Math.min(clampTo(ref, FIT_HEIGHT_MIN, FIT_HEIGHT_MAX), maxH / ch) : fixedH / ch;
  // Không trục mặt bằng nào vượt hộp bao (FE-H): biên [0,8; 1,25] chỉ chống co thiếu — mẫu khác dáng
  // hộp (chậu, tủ đầu giường, kệ nông) từng phình gấp đôi hộp ở trục bị chặn.
  const [ax, sy, az] = ((): PascalVec3 => {
    if (exactFit) return [rx, heightMm === undefined ? heightOf(Math.sqrt(rx * rz)) : metresOf(heightMm) / ch, rz];
    if (RUG_FOLDERS.has(folder)) return [rx, fixedH === undefined ? RUG_SCALE_Y : fixedH / ch, rz];
    if (STRETCH_FOLDERS.has(folder)) {
      // Kéo hết theo trục dài của hộp (so với mẫu), trục kia giữ gần chiều sâu mẫu.
      const alongX = rx >= rz;
      const deep = clampTo(alongX ? rz : rx, FIT_AXIS_MIN, FIT_AXIS_MAX);
      return alongX ? [rx, heightOf(deep), deep] : [deep, heightOf(deep), rz];
    }
    // Đồ cứng: mỗi trục co giãn riêng trong [0,8; 1,25] × trung bình nhân hai trục.
    const g = Math.sqrt(rx * rz);
    return [clampTo(rx, g * FIT_AXIS_MIN, g * FIT_AXIS_MAX), heightOf(g), clampTo(rz, g * FIT_AXIS_MIN, g * FIT_AXIS_MAX)];
  })();
  const sx = Math.min(ax, rx);
  const sz = Math.min(az, rz);
  // `asset.scale` nhân thẳng vào GLB gốc; catalog nào có scale riêng thì `dimensions`
  // là cỡ sau scale đó (cọ: GLB cao 11,9 m × 0,37) — phải nhân lại, không thì cao gấp đôi tường.
  const [kx, ky, kz] = catalog.scale ?? [1, 1, 1];
  // Đồ treo tường: mô hình mỏng hơn hộp bao thì áp lưng nó vào mép sau (−z cục
  // bộ, phía tường) thay vì treo lơ lửng giữa hộp. Dời bằng `asset.offset` chứ
  // không dời `position`: tâm món đồ phải giữ đúng `centre` để lượt về không trôi.
  // `attachTo` không ghi ra — Pascal sẽ đòi một bức tường cha mà node này không có.
  const backShift = catalog.attachTo === 'wall-side' ? -(depthM - cd * sz) / 2 : 0;
  const [ox, oy, oz] = catalog.offset;

  return {
    folder,
    shownM: [cw * sx, fixedH ?? ch * sy, cd * sz] as PascalVec3,
    heightM: fixedH ?? ch * sy,
    scale: [sx * kx, sy * ky, sz * kz] as PascalVec3,
    offset: [ox * sx, oy * sy, oz * sz + backShift] as PascalVec3,
    rotation: [...catalog.rotation] as PascalVec3,
  };
};
