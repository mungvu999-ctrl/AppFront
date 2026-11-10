/**
 * Nẹp + ốp khung cửa đi (M4 làn 2). Khung Pascal chỉ là hai trụ + đố đầu 50×70 mm nằm giữa lòng
 * tường, nên ở cự ly người đứng trong nhà mép ô cửa là vết cắt trần của tường: không nẹp ở mặt
 * tường, lòng tường 100–220 mm lộ ra. Hàm này thêm MỘT lưới gộp cho mỗi cửa (không thêm node vào
 * tài liệu → không ảnh hưởng lưu/diff, dựng lại thì thay hẳn, không nhân đôi):
 * - nẹp hai mặt tường: hai thanh đứng + một thanh đầu, rộng `CASING_W_M`, nhô `CASING_PROUD_M`
 *   (nhô hơn len chân 15 mm nên che đầu len cắt ở mép cửa);
 * - ốp lòng tường: hai má + một đố đầu dày `LINING_M`, sâu đủ bề dày tường.
 * Vật liệu = khe `frame` của cửa (sơn khung thì nẹp đổi theo). Không đổ bóng riêng.
 * Gọi từ vendor `door-system.tsx` (luật `scripts/realism/m4-casing.mjs`). `?disable=casing` tắt.
 * Chỉ cửa chữ nhật trên tường thẳng; ô trống không cánh (`openingKind: 'opening'`) không nẹp.
 */
import { BoxGeometry, type BufferGeometry, type Material, Mesh, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const CASING_W_M = 0.07;
export const CASING_PROUD_M = 0.018;
export const LINING_M = 0.012;
/** Nẹp đè vào mép ô cửa một chút để che khe giữa tường và khung. */
const CASING_OVERLAP_M = 0.01;
/** Tường mỏng hơn mức này là vách kính/lan can: không nẹp. */
export const CASING_MIN_WALL_M = 0.06;
export const CASING_MESH_NAME = 'appfront-casing';

export const casingDisabled = (search: string): boolean =>
  (new URLSearchParams(search).get('disable') ?? '').split(',').includes('casing');

const disabled = typeof location !== 'undefined' && casingDisabled(location.search);

/** Hộp [rộng, cao, sâu, x, y, z] trong hệ toạ độ cửa (tâm ô cửa, z = pháp tuyến tường). */
export type CasingBox = readonly [number, number, number, number, number, number];

/** Các hộp nẹp + ốp cho ô cửa `width × height` trên tường dày `wallT` (thuần, để kiểm). */
export function casingBoxes(width: number, height: number, wallT: number): CasingBox[] {
  if (!(width > 0 && height > 0 && wallT >= CASING_MIN_WALL_M)) return [];
  const reach = CASING_W_M - CASING_OVERLAP_M; // phần nẹp ra ngoài mép ô
  const postH = height + reach;
  const postY = -height / 2 + postH / 2;
  const headW = width + 2 * reach;
  const headY = height / 2 + reach - CASING_W_M / 2;
  const postX = width / 2 + reach - CASING_W_M / 2;
  const boxes: CasingBox[] = [];
  for (const side of [1, -1]) {
    const z = side * (wallT / 2 + CASING_PROUD_M / 2);
    boxes.push([CASING_W_M, postH, CASING_PROUD_M, -postX, postY, z]);
    boxes.push([CASING_W_M, postH, CASING_PROUD_M, postX, postY, z]);
    boxes.push([headW, CASING_W_M, CASING_PROUD_M, 0, headY, z]);
  }
  boxes.push([LINING_M, height, wallT, -(width / 2 - LINING_M / 2), 0, 0]);
  boxes.push([LINING_M, height, wallT, width / 2 - LINING_M / 2, 0, 0]);
  boxes.push([width, LINING_M, wallT, 0, height / 2 - LINING_M / 2, 0]);
  return boxes;
}

type BoxUv = (geometry: BoxGeometry, w: number, h: number, d: number) => void;

/** Một geometry gộp cho mọi hộp (một draw call mỗi cửa). */
export function casingGeometry(boxes: readonly CasingBox[], boxUv?: BoxUv): BufferGeometry | null {
  if (boxes.length === 0) return null;
  const parts = boxes.map(([w, h, d, x, y, z]) => {
    const g = new BoxGeometry(w, h, d);
    boxUv?.(g, w, h, d);
    return g.translate(x, y, z);
  });
  const merged = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  return merged;
}

interface DoorLike {
  readonly width: number;
  readonly height: number;
  readonly openingShape?: string;
}

/** Thêm lưới nẹp vào lưới cửa (vendor đã xoá con cũ trước khi dựng lại). */
export function addDoorCasing(
  parent: Object3D,
  material: Material,
  node: DoorLike,
  wallT: number,
  boxUv?: BoxUv,
): void {
  if (disabled) return;
  if (node.openingShape && node.openingShape !== 'rectangle') return;
  const geometry = casingGeometry(casingBoxes(node.width, node.height, wallT), boxUv);
  if (!geometry) return;
  const mesh = new Mesh(geometry, material);
  mesh.name = CASING_MESH_NAME;
  mesh.userData.slotId = 'frame';
  parent.add(mesh);
}

/** Bậu cửa sổ (đá/sơn trắng theo khe `frame`): tấm dày `SILL_T_M`, mặt trên cao hơn đáy ô `SILL_RISE_M`. */
export const SILL_T_M = 0.03;
const SILL_RISE_M = 0.012;
/** Mũi bậu nhô khỏi mặt tường và tai bậu chìa hai bên ô. */
export const SILL_NOSE_M = 0.03;
const SILL_EAR_M = 0.04;
/** Cửa sổ có đáy sát sàn hơn mức này (cửa kính sát đất) không có bậu. */
const SILL_MIN_HEIGHT_M = 0.15;

/**
 * Bậu hai mặt cho ô cửa sổ: từ mặt khung (`frameDepth/2`) ra quá mặt tường `SILL_NOSE_M`. Bậu
 * Pascal sẵn có chỉ một mặt (+Z) và chỉ nhô ~15 mm khỏi tường 200 mm → gần như không thấy.
 */
export function windowSillBoxes(width: number, height: number, wallT: number, frameDepth: number): CasingBox[] {
  if (!(width > 0 && height > 0 && wallT >= CASING_MIN_WALL_M)) return [];
  const z0 = frameDepth / 2;
  const z1 = wallT / 2 + SILL_NOSE_M;
  if (!(z1 > z0)) return [];
  const y = -height / 2 + SILL_RISE_M - SILL_T_M / 2;
  const w = width + 2 * SILL_EAR_M;
  return [1, -1].map((side) => [w, SILL_T_M, z1 - z0, 0, y, (side * (z0 + z1)) / 2] as const);
}

interface WindowLike {
  readonly width: number;
  readonly height: number;
  readonly frameDepth?: number;
  readonly openingKind?: string;
  readonly openingShape?: string;
  readonly position: readonly number[];
}

/** Thêm lưới bậu vào lưới cửa sổ; `sillY` = độ cao đáy ô so với chân tường. */
export function addWindowSill(
  parent: Object3D,
  material: Material,
  node: WindowLike,
  wallT: number,
  boxUv?: BoxUv,
): void {
  if (disabledSill) return;
  if (node.openingKind === 'opening' || (node.openingShape && node.openingShape !== 'rectangle')) return;
  if ((node.position[1] ?? 0) - node.height / 2 < SILL_MIN_HEIGHT_M) return;
  const geometry = casingGeometry(windowSillBoxes(node.width, node.height, wallT, node.frameDepth ?? 0.07), boxUv);
  if (!geometry) return;
  const mesh = new Mesh(geometry, material);
  mesh.name = SILL_MESH_NAME;
  mesh.userData.slotId = 'frame';
  parent.add(mesh);
}

export const SILL_MESH_NAME = 'appfront-sill';
export const sillDisabled = (search: string): boolean =>
  (new URLSearchParams(search).get('disable') ?? '').split(',').includes('sill');
const disabledSill = typeof location !== 'undefined' && sillDisabled(location.search);
