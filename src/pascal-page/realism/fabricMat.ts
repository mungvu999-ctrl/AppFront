/**
 * Vòng 11 b3 — nguyên nhân #3 (`F:/runs/m11/b0/BAO-CAO.txt`): ga/chăn/rèm/sofa vải là vật liệu trơn (ga giường thư viện
 * fbfbfb, nhám 0,9, không ảnh). Cờ `?enable=fabricmat` (TẮT mặc định, hằng `FABRIC_MAT_DEFAULT`; `?disable=fabricmat` luôn tắt).
 *
 * Một vật liệu vải DÙNG CHUNG lúc chạy, thủ tục TSL, KHÔNG ảnh (0 byte tải thêm):
 * - Nhiễu 3D theo toạ độ thế giới (vải "đặc", không cần UV): rèm/gối/chăn Pascal không có UV, giường Pascal UV nhỏ
 *   (normal ảnh lặp thành hạt giấy nhám — itemLook) → ảnh không dùng được cho cả hai; ảnh KTX2 lại không đọc được màu
 *   trung bình (upholstery `textureMean` trả 1) → đó là lý do rèm vòng 10 vẫn nâu sẫm.
 * - Hai quãng: nếp chùng ~0,25 m (cao 2,5 mm) + hạt sợi ~6 mm (0,12 mm) → pháp tuyến bump tự tính bằng đạo hàm màn hình
 *   (Mikkelsen; `bumpMap` của three chỉ nhận ảnh). Màu ± theo hạt/nếp (có sắc độ), nhám 0,82–0,98, sheen theo màu vải.
 * - Màu = màu vật liệu đang có (concept/bảng màu, nhuộm upholstery chạy SAU trên vật liệu này) — không đổi họ màu;
 *   trắng tuyệt đối kẹp ≤ `ALBEDO_MAX` (vải trắng thật ~0,8) để có bóng đổ trên mặt giường.
 * - Một đồ thị node chung cho mọi vật liệu vải (màu là uniform) → khoá shader = 1 × số `side` khác nhau (≤ 2).
 * Chỉ đổi cách hiển thị (vật liệu), không đổi mẫu/vị trí/kích thước; áp mọi giường/sofa/rèm/gối/chăn (cả món dò).
 * Khe người dùng gán vật liệu (món không sinh) giữ nguyên.
 */
import { DoubleSide, type Material, type Mesh } from 'three';
import { abs, clamp, smoothstep, uniform, cross, dFdx, dFdy, dot, faceDirection, materialColor, mix, mx_noise_float, normalize, normalView, positionView, positionWorld, sign, vec3, vec4 } from 'three/tsl';
import { MeshPhysicalNodeMaterial, type Node } from 'three/webgpu';
import LIBRARY_ROLES_JSON from '@/lib/pascal/libraryRoles.json' with { type: 'json' };
import { namedFolderOf, serverKindOf, VARIANT_MODEL } from '@/lib/pascal/furnitureCatalog';
import { fabricRoleOf, fabricSurfaceOf, type FabricMatch, type FabricRole } from './fabricRules';
import type { UpholsteryTag } from './upholstery';

/** Hằng lật mặc định (điều phối viên đổi sau QA ảnh). */
export const FABRIC_MAT_DEFAULT = false;

export function fabricMatFlag(search: string, def = FABRIC_MAT_DEFAULT): boolean {
  const q = new URLSearchParams(search);
  if ((q.get('disable') ?? '').split(',').includes('fabricmat')) return false;
  return def || (q.get('enable') ?? '').split(',').includes('fabricmat');
}
let on = fabricMatFlag(typeof location === 'undefined' ? '' : location.search);
export const fabricMatOn = (): boolean => on;
/** Chỉ cho bài kiểm. */
export const setFabricMat = (v: boolean): void => {
  on = v;
};

/**
 * BẢNG CƯỜNG ĐỘ DUY NHẤT (lát 2). Mức chọn bằng `?fabric=<0..3>` (mặc định `FABRIC_LEVEL_DEFAULT`); mọi mức cùng MỘT đồ thị
 * node (giá trị là uniform) → không thêm khoá shader. 0 = lát 1. Hạt sợi mờ dần theo khoảng cách camera: đủ dưới
 * `grainNearM`, mất ở `grainFarM` (mức 0: không mờ). `tone` nhân màu (giữ sắc độ, trắng → trắng ngà/xám ấm).
 * Căn cứ: nếp lát 1 dốc tối đa ≈ 2π·2,5 mm/0,25 m ≈ 0,06 rad (≈ 3,6°) → bóng đổ chỉ ±3–5 %, bị vai tone map nén trên nền
 * gần trắng (ảnh cn03: gối đã áp vẫn y như cũ). Mức 2: 2π·12 mm/0,45 m ≈ 0,17 rad (≈ 10°) → ±10–15 %.
 */
export const FABRIC_LEVELS = [
  { foldPeriodM: 0.25, foldHeightM: 0.0025, grainHeightM: 0.00012, grainAlbedo: 0.07, foldAlbedo: 0.06, tone: 1, grainNearM: 1e3, grainFarM: 2e3 },
  { foldPeriodM: 0.35, foldHeightM: 0.006, grainHeightM: 0.00015, grainAlbedo: 0.08, foldAlbedo: 0.08, tone: 0.95, grainNearM: 1.2, grainFarM: 3 },
  { foldPeriodM: 0.45, foldHeightM: 0.012, grainHeightM: 0.00018, grainAlbedo: 0.09, foldAlbedo: 0.1, tone: 0.9, grainNearM: 1.2, grainFarM: 3 },
  { foldPeriodM: 0.55, foldHeightM: 0.02, grainHeightM: 0.0002, grainAlbedo: 0.1, foldAlbedo: 0.13, tone: 0.85, grainNearM: 1.2, grainFarM: 3 },
] as const;
/** Hằng lật mặc định của mức (điều phối viên đổi sau QA ảnh). */
export const FABRIC_LEVEL_DEFAULT = 0;
export function fabricLevelOf(search: string, def = FABRIC_LEVEL_DEFAULT): number {
  const raw = new URLSearchParams(search).get('fabric');
  const n = raw == null || raw === '' ? def : Math.round(Number(raw));
  return Number.isFinite(n) ? Math.min(FABRIC_LEVELS.length - 1, Math.max(0, n)) : def;
}
let level = fabricLevelOf(typeof location === 'undefined' ? '' : location.search);
const LV = FABRIC_LEVELS[level]!;
const U = {
  foldFreq: uniform(1 / LV.foldPeriodM),
  foldHeight: uniform(LV.foldHeightM),
  grainHeight: uniform(LV.grainHeightM),
  grainAlbedo: uniform(LV.grainAlbedo),
  foldAlbedo: uniform(LV.foldAlbedo),
  tone: uniform(LV.tone),
  grainNear: uniform(LV.grainNearM),
  grainFar: uniform(LV.grainFarM),
};
/** Đổi mức lúc chạy (probe/A-B không nạp lại trang): chỉ đổi uniform. */
export function setFabricLevel(next: number): number {
  level = Math.min(FABRIC_LEVELS.length - 1, Math.max(0, Math.round(next)));
  const v = FABRIC_LEVELS[level]!;
  U.foldFreq.value = 1 / v.foldPeriodM;
  U.foldHeight.value = v.foldHeightM;
  U.grainHeight.value = v.grainHeightM;
  U.grainAlbedo.value = v.grainAlbedo;
  U.foldAlbedo.value = v.foldAlbedo;
  U.tone.value = v.tone;
  U.grainNear.value = v.grainNearM;
  U.grainFar.value = v.grainFarM;
  return level;
}

export const FABRIC_LOOK = {
  grainPeriodM: 0.006,
  roughness: 0.9,
  roughnessAmp: 0.08,
  sheen: 0.7,
  sheenRoughness: 0.6,
  sheenWhite: 0.35,
  specularIntensity: 0.3,
} as const;
/** Kênh màu tuyến tính tối đa (vải trắng thật ~0,8; fbfbfb = 0,96 ra khối trắng cháy). */
export const ALBEDO_MAX = 0.82;

// ---- Vai món: dữ liệu catalog chung ----
const ROLE_OF_KEY = new Map<string, string>();
for (const [role, ids] of Object.entries((LIBRARY_ROLES_JSON as { roles: Record<string, string[]> }).roles)) for (const id of ids) ROLE_OF_KEY.set(id, role);
for (const [variant, model] of Object.entries(VARIANT_MODEL)) if (model && !ROLE_OF_KEY.has(model.folder)) ROLE_OF_KEY.set(model.folder, variant);

export function roleOfKey(key: string): string | undefined {
  return ROLE_OF_KEY.get(key) ?? ROLE_OF_KEY.get(namedFolderOf(key)) ?? (serverKindOf(key) === 'bed' ? 'bed' : undefined);
}

// ---- Vật liệu ----
interface Nodes {
  color: Node<'vec4'>;
  rough: Node<'float'>;
  normal: Node<'vec3'>;
  sheen: Node<'vec3'>;
}
let nodes: Nodes | undefined;

/** Đồ thị node dựng một lần, gán chung cho mọi vật liệu vải → cùng khoá shader. */
function fabricNodes(): Nodes {
  if (nodes) return nodes;
  const L = FABRIC_LOOK;
  const fold = mx_noise_float(positionWorld.mul(U.foldFreq));
  // Hạt sợi chỉ hiện khi nhìn gần (xa: dưới một điểm ảnh → nhấp nháy, và mắt không thấy).
  const near = smoothstep(U.grainNear, U.grainFar, positionView.z.negate()).oneMinus();
  const grain = mx_noise_float(positionWorld.div(L.grainPeriodM).add(31.7)).mul(near);
  // mx_noise_float / faceDirection khai kiểu Node chung → ép về float.
  const height = fold.mul(U.foldHeight).add(grain.mul(U.grainHeight)) as unknown as Node<'float'>;
  const face = faceDirection as unknown as Node<'float'>;
  // Mikkelsen "bump mapping unparametrized surfaces": đạo hàm màn hình của độ cao (mét) + của vị trí view (không chuẩn hoá
  // → biên độ đúng theo mét).
  const sx = dFdx(positionView);
  const sy = dFdy(positionView);
  const r1 = cross(sy, normalView);
  const r2 = cross(normalView, sx);
  const det = dot(sx, r1).mul(face);
  // Kiểu của three chỉ khai dFdx/dFdy cho vec2/vec3; lúc chạy nhận cả float.
  const dhx = dFdx(height as unknown as Node<'vec3'>) as unknown as Node<'float'>;
  const dhy = dFdy(height as unknown as Node<'vec3'>) as unknown as Node<'float'>;
  const grad = r1.mul(dhx).add(r2.mul(dhy)).mul(sign(det));
  const normal = normalize(normalView.mul(abs(det)).sub(grad)) as unknown as Node<'vec3'>;
  const base = (materialColor as unknown as Node<'vec4'>).rgb;
  const shade = grain.mul(U.grainAlbedo).add(fold.mul(U.foldAlbedo)).add(1).mul(U.tone);
  nodes = {
    color: vec4(base.mul(shade), 1) as unknown as Node<'vec4'>,
    rough: clamp(grain.mul(L.roughnessAmp).add(L.roughness), 0, 1) as unknown as Node<'float'>,
    normal,
    sheen: mix(base, vec3(1), L.sheenWhite).mul(L.sheen) as unknown as Node<'vec3'>,
  };
  return nodes;
}

type Src = Material & { color?: { r: number; g: number; b: number }; map?: unknown; roughness?: number; metalness?: number; emissiveIntensity?: number; emissive?: { r: number; g: number; b: number } };

const cache = new Map<string, Material>();
const sides = new Set<number>();

function fabricMaterialFor(src: Src, bedding: boolean): Material {
  const key = `${src.uuid}|${bedding ? 'b' : ''}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const L = FABRIC_LOOK;
  const m = new MeshPhysicalNodeMaterial();
  m.name = `${src.name}|fabricmat`;
  const c = src.color ?? { r: 1, g: 1, b: 1 };
  m.color.setRGB(Math.min(ALBEDO_MAX, c.r), Math.min(ALBEDO_MAX, c.g), Math.min(ALBEDO_MAX, c.b));
  m.side = src.side;
  m.roughness = L.roughness;
  m.metalness = 0;
  m.sheen = L.sheen;
  m.sheenRoughness = L.sheenRoughness;
  m.specularIntensity = L.specularIntensity;
  const n = fabricNodes();
  m.colorNode = n.color;
  m.roughnessNode = n.rough;
  m.normalNode = n.normal;
  m.sheenNode = n.sheen;
  // Nhuộm upholstery chạy sau trên vật liệu này (không ảnh → màu đích chép thẳng). Ga trắng trên giường → màu chăn ga của
  // phong cách (cùng họ trắng); không bỏ dấu `upholsteryHex` của gốc để nhuộm chạy lại.
  const tag = src.userData.upholstery as UpholsteryTag | undefined;
  const upholstery: UpholsteryTag | undefined = tag ?? (bedding ? { kind: 'bedding', recolour: true } : undefined);
  m.userData = { fabricMat: true, ...(upholstery ? { upholstery } : {}) };
  sides.add(m.side);
  cache.set(key, m);
  return m;
}

// ---- Áp cho một món ----
export interface FabricItem {
  id?: string;
  asset?: { src?: string | null };
  slots?: Readonly<Record<string, unknown>> | null;
}

interface Capture {
  authoredMaterials?: Material | Material[];
  slotIds?: string | null | (string | null)[];
}

const report = {
  surfaces: { bed: 0, sofa: 0, curtain: 0, pillow: 0, throw: 0 } as Record<FabricRole, number>,
  match: { named: 0, tagged: 0, plain: 0 } as Record<FabricMatch, number>,
  items: new Map<string, { role: FabricRole; surfaces: number; generated: boolean }>(),
};
const luminance = (c: { r: number; g: number; b: number }): number => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
/** Ga trắng: độ sáng tuyến tính trên ngưỡng này mới nhuộm theo màu chăn ga của phong cách. */
export const BEDDING_LIGHT_MIN = 0.6;

/** Gọi từ `applyUpholstery` (trước khi chọn vật liệu nhuộm). Thay vật liệu vải của món bằng vật liệu vải dùng chung. */
export function applyFabricMaterials(meshes: readonly Mesh[], item: FabricItem | undefined): void {
  if (!on || !item) return;
  const role = fabricRoleOf(item.id, item.asset?.src, roleOfKey);
  if (!role) return;
  const generated = /(?:^|_)DRESS-/.test(item.id ?? '');
  let count = 0;
  for (const mesh of meshes) {
    const cap = mesh.userData.pascalItemMaterialCapture as Capture | undefined;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const hasUv = mesh.geometry.getAttribute('uv') != null;
    const next = list.map((mat, i) => {
      const src = mat as Src;
      if (src.userData.fabricMat) return mat;
      const authored = Array.isArray(cap?.authoredMaterials) ? cap.authoredMaterials[i] : cap?.authoredMaterials;
      const slot = Array.isArray(cap?.slotIds) ? cap.slotIds[i] : cap?.slotIds;
      // Khe người dùng gán vật liệu (món không sinh): giữ lựa chọn.
      if (slot && !generated && item.slots?.[slot] != null) return mat;
      const emissive = (src.emissiveIntensity ?? 0) > 0 && src.emissive != null && luminance(src.emissive) > 0;
      const match = fabricSurfaceOf({
        names: [authored?.name, slot, src.name.split('|')[0]],
        hasMap: src.map != null,
        hasUv,
        metalness: src.metalness ?? 0,
        roughness: src.roughness ?? 1,
        transparent: src.transparent || src.opacity < 1 || emissive,
        luminance: luminance(src.color ?? { r: 1, g: 1, b: 1 }),
        tagKind: (src.userData.upholstery as UpholsteryTag | undefined)?.kind ?? null,
      });
      if (!match) return mat;
      count += 1;
      report.match[match] += 1;
      return fabricMaterialFor(src, role === 'bed' && luminance(src.color ?? { r: 0, g: 0, b: 0 }) >= BEDDING_LIGHT_MIN);
    });
    if (next.some((m, i) => m !== list[i])) mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  }
  if (!count || !item.id || report.items.has(item.id)) return;
  report.items.set(item.id, { role, surfaces: count, generated });
  report.surfaces[role] += count;
}

/** `window.__pascalProbe.fabric()`: bề mặt đã áp theo vai, khớp theo luật, số khoá vật liệu thêm (= số `side`). */
export function fabricReport() {
  return {
    on,
    level,
    surfacesByRole: { ...report.surfaces },
    matchByRule: { ...report.match },
    items: report.items.size,
    generatedItems: [...report.items.values()].filter((i) => i.generated).length,
    materials: cache.size,
    shaderKeys: sides.size,
    doubleSided: sides.has(DoubleSide),
  };
}

let probed = false;
/** Khối probe riêng (không sửa probe.ts): gắn khi lần đầu áp. */
export function exposeFabricProbe(): void {
  if (probed || typeof window === 'undefined') return;
  const probe = (window as unknown as { __pascalProbe?: Record<string, unknown> }).__pascalProbe;
  if (!probe) return;
  probe.fabric = fabricReport;
  probed = true;
}

/** Cho test. */
export function clearFabricMaterials(): void {
  cache.clear();
  sides.clear();
  report.items.clear();
  for (const k of Object.keys(report.surfaces) as FabricRole[]) report.surfaces[k] = 0;
  for (const k of Object.keys(report.match) as FabricMatch[]) report.match[k] = 0;
}
