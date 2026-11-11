/**
 * Phần chạy của cắt thấp (`cut.ts`), gọi mỗi khung từ hệ tường vendor (luật `r10-cut.mjs`).
 * - Cắt: nhóm tầng (registry `level`) LUÔN là `ClippingGroup` bật của three 0.186 (WebGPURenderer chỉ cắt
 *   qua nhóm, cả nhánh WebGPU lẫn WebGL2) với một mặt phẳng. Đổi chế độ chỉ dời mặt phẳng: Cắt → sàn + 1,0 m
 *   (tường, vách, cửa, cửa sổ, đồ cao, trần bị cắt; đổ bóng cắt theo), chế độ khác → 1e6 m (không cắt gì).
 *   Không bao giờ lật `enabled`/số mặt phẳng/`clipIntersection`/`clipShadows`: các trường đó nằm trong khoá
 *   bộ nhớ đệm của ClippingContext → lật là mọi lưới của mọi tầng (cả lượt bóng) dựng lại (~20 s).
 * - Mặt cắt: vật liệu tường (lẻ + lưới gộp dùng chung mảng vật liệu) được vá MỘT LẦN lúc tạo
 *   (`capCutMaterial`, luật `r9y-cut-cap.mjs` trên `wall-materials.ts`): hai mặt cố định, mặt sau + mặt hướng
 *   lên (lòng tường lộ qua mặt cắt) tô PHẲNG màu nắp sáng khi uniform `cutOn` = 1. Đổi chế độ chỉ đổi
 *   `cutOn.value`, không `needsUpdate`.
 * - Theo camera (`wantsLift`): mắt thấp hơn trần của tầng thì mặt cắt tầng ấy trượt lên trần trong 0,3 s rồi thành
 *   1e6 (không cắt); lên cao lại (quá trần + 0,6 m) thì trượt về sàn + 1,0 m. Vẫn chỉ dời `constant`.
 */
import { BackSide, Box3, DoubleSide, type EventDispatcher, FrontSide, type Material, type Mesh, type Object3D, Plane, Vector3 } from 'three';
import { color, frontFacing, materialColor, materialEmissive, normalWorld, select, uniform, vec3, vec4 } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';

import { CUT_CAP_COLOR, CUT_HEIGHT_M, DEFAULT_STOREY_M, liftedCutY, lowCutActive, stepLift, wantsLift } from './cut';
import { markDirty } from './idle';
import { lightFlagOn } from './lightFlag';
import { folderOf } from './itemLook';
import { CAP_TOP_FOLDER, matOn } from './matx';
import { hasPendingTextures, whenTexturesReady } from './texturePreload';

/** Hằng mặt phẳng khi không cắt: cao hơn mọi công trình → giữ hết. */
export const NO_CUT_CONSTANT = 1e6;

interface ClipGroupFields {
  isClippingGroup?: boolean;
  clippingPlanes?: Plane[];
  enabled?: boolean;
  clipIntersection?: boolean;
  clipShadows?: boolean;
}

export interface CutRegistry {
  nodes: { get(id: string): Object3D | undefined };
  byType: Readonly<Record<string, Set<string>>>;
}

// Kiểu three khai colorNode/emissiveNode hẹp hơn Node chung mà TSL trả về.
type ColorMaterial = Omit<NodeMaterial, 'colorNode' | 'emissiveNode'> & { colorNode: Node | null; emissiveNode: Node | null };

/** 1 khi đang cắt thấp: bật tô nắp trên mọi vật liệu tường đã vá. Dùng chung → đổi giá trị không dựng lại. */
export const cutOn = uniform(0);

const capped = new WeakSet<Material>();
const worldPos = new Vector3();
const NO_IDS: ReadonlySet<string> = new Set();
let lowCut = false;
/** Trạng thái nâng mặt cắt theo camera, từng nhóm tầng. */
const lifts = new WeakMap<Object3D, { lifted: boolean; lift: number }>();
let lastSyncMs: number | null = null;

/** Camera + cao tầng cho mặt cắt theo camera; thiếu thì cắt 1,0 m như trước. */
export interface CutView {
  eye: { y: number };
  storeyHeight: (levelId: string) => number | undefined;
}

/**
 * Cắt thấp đang bật (khung gần nhất). Trần + đồ treo trần của tầng bị cắt theo nhóm tầng, nhưng phần
 * vẽ thêm nằm ngoài nhóm tầng (quầng đèn âm trần `halo.ts`) phải tự tắt theo, không thì thành đĩa
 * lơ lửng ở cao độ trần trên tường cắt 1 m (bench-3d P6, ảnh ngang mắt).
 */
export function lowCutOn(): boolean {
  return lowCut;
}

/**
 * Vá vật liệu tường một lần, lúc tạo: hai mặt cố định; khi `cutOn` = 1, lòng tường lộ qua mặt cắt (mặt sau,
 * đỉnh móng hướng lên) nằm trong bóng của chính khối tường → tắt khuếch tán và phát sáng phẳng màu nắp.
 * Đổ bóng giữ phía như trước khi vá (PCF: lật phía) để bóng ở chế độ thường không đổi.
 * Vá tại chỗ (vật liệu dùng chung giữ danh tính cho lưới gộp và các vá khác như normal thạch cao).
 */
export function capCutMaterial<T extends Material>(material: T): T {
  const nodeMaterial = material as unknown as ColorMaterial;
  if (capped.has(material) || !nodeMaterial.isNodeMaterial || material.transparent) return material;
  capped.add(material);
  const cap = cutOn.greaterThan(0.5).and(frontFacing.not().or(normalWorld.y.greaterThan(0.5)));
  nodeMaterial.colorNode = select(cap, vec3(0, 0, 0), vec3((nodeMaterial.colorNode ?? materialColor) as Node<'vec3'>));
  nodeMaterial.emissiveNode = select(
    cap,
    vec3(color(CUT_CAP_COLOR) as unknown as Node<'vec3'>),
    vec3((nodeMaterial.emissiveNode ?? materialEmissive) as Node<'vec3'>),
  );
  material.shadowSide ??= material.side === FrontSide ? BackSide : material.side === BackSide ? FrontSide : DoubleSide;
  material.side = DoubleSide;
  material.needsUpdate = true;
  return material;
}

/** Vật liệu gốc → biến thể có nắp (clone riêng; gốc không bao giờ bị vá). */
const itemCapVariants = new WeakMap<Material, Material>();
const itemBox = new Box3();
/** `?disable=itemwhole`: quay về cắt mọi món ở 1,0 m. */
const WHOLE_OFF = typeof location !== 'undefined' && (new URLSearchParams(location.search).get('disable') ?? '').split(',').includes('itemwhole');
const levelPos = new Vector3();

type TextureKeyed = Material & Record<string, unknown>;

/** Biến thể theo ảnh của gốc: map gán muộn (vật liệu thư viện, `tuneItemMaterial` chờ ảnh) chép sang khi gốc báo xong. */
function followSourceTextures(variant: Material, source: Material): void {
  delete variant.userData.texPending;
  if (!hasPendingTextures(source)) return;
  variant.userData.texPending = 1;
  void whenTexturesReady(source).then(() => {
    const from = source as TextureKeyed;
    const to = variant as TextureKeyed;
    for (const key of Object.keys(from)) {
      const t = from[key] as { isTexture?: boolean } | null;
      if (t?.isTexture && to[key] !== t) to[key] = t;
    }
    delete variant.userData.texPending;
    variant.needsUpdate = true;
    (variant as unknown as EventDispatcher<{ texturesready: object }>).dispatchEvent({ type: 'texturesready' });
  });
}

/**
 * Biến thể nắp cắt của một vật liệu ĐỒ (chỉ gắn cho mesh cao quá mặt cắt, `capItemMeshesForCut`): bản CLONE, cache
 * theo vật liệu gốc (uuid|capped), nên instance thấp dùng chung vật liệu gốc giữ nguyên một mặt. Khi `cutOn` = 1 chỉ
 * MẶT SAU (ruột lộ qua mặt cắt) tô phẳng màu nắp; mặt hướng lên (mặt bàn, mặt giường) giữ vật liệu. Giữ alpha của màu
 * (lá cây alphaTest). Vật liệu GLB thường (không NodeMaterial) vẫn được: WebGPURenderer đổi sang NodeMaterial lúc
 * dựng bằng cách chép mọi khoá (`NodeLibrary.fromMaterial`), kể cả colorNode/emissiveNode. Trả nguyên gốc cho vật liệu
 * trong suốt và vật liệu vốn hai mặt / mặt sau (mặt sau là mặt thật: rèm, lá). `color` dùng CHUNG đối tượng với gốc:
 * nhuộm vải (`applyUpholstery`, có thể trễ khi chờ ảnh) đổi gốc thì biến thể đổi theo.
 */
export function cutCapVariant<T extends Material>(material: T, capDoubleSided = false): T {
  if (material.transparent) return material;
  // `?mat=cap-top`: tủ GLB vốn hai mặt (không lá alphaTest) cũng nắp; mặt sau vẫn là lòng tủ lộ qua mặt cắt.
  const doubleSided = capDoubleSided && material.side === DoubleSide && !material.alphaTest;
  if (material.side !== FrontSide && !doubleSided) return material;
  const hit = itemCapVariants.get(material);
  if (hit) return hit as T;
  const variant = material.clone() as T;
  const colored = material as unknown as { color?: unknown };
  if (colored.color) (variant as unknown as { color?: unknown }).color = colored.color;
  followSourceTextures(variant, material);
  variant.name = `${material.name}|capped`;
  const m = variant as unknown as ColorMaterial;
  const cap = cutOn.greaterThan(0.5).and(frontFacing.not());
  const base = vec4((m.colorNode ?? materialColor) as Node<'vec4'>);
  m.colorNode = select(cap, vec4(0, 0, 0, base.a), base);
  m.emissiveNode = select(
    cap,
    vec3(color(CUT_CAP_COLOR) as unknown as Node<'vec3'>),
    vec3((m.emissiveNode ?? materialEmissive) as Node<'vec3'>),
  );
  if (!doubleSided) variant.shadowSide ??= BackSide;
  variant.side = DoubleSide;
  variant.needsUpdate = true;
  itemCapVariants.set(material, variant);
  return variant;
}

/** Đáy món cách sàn tầng không quá mức này = món ĐỨNG SÀN (tủ, kệ, tủ lạnh, đèn cây); cao hơn là treo tường/trần. */
export const FLOOR_REST_M = 0.15;
/**
 * Món "TẤM MỎNG" (rèm, mành, gương đứng, vách bình phong): bề dày ≤ 0,15 m VÀ ≤ 10 % chiều cao. Đứng sàn nhưng hành xử
 * như tường → cắt cùng tường (để nguyên sẽ thành tấm cao tới trần lơ lửng trên tường đã hạ). Đo từ node
 * (`asset.dimensions` × |scale|, không phụ thuộc xoay), thiếu node thì từ hộp bao thế giới của các mesh.
 */
export const THIN_PANEL_M = 0.15;
export const THIN_PANEL_RATIO = 0.1;
/** Khe hở dọc tối đa giữa hai phần của một mẫu vẫn coi là "chồng lên nhau" (nóc tủ, sách trên kệ). */
export const STACK_GAP_M = 0.05;
const itemWholeVariants = new WeakMap<Material, Material>();
const noClipping = (): null => null;
const noHardwareClipping = (builder: { hardwareClipping: boolean }): void => {
  builder.hardwareClipping = false;
};
const NO_CLIP = { setupClipping: noClipping, setupHardwareClipping: noHardwareClipping };

/**
 * Biến thể KHÔNG CẮT của vật liệu đồ đứng sàn cao quá mặt cắt: tủ bị xẻ ở 1,0 m lộ lòng tủ — ảnh màu của nhiều mẫu
 * (ABO) nướng sẵn bóng đen trong lòng → người xem thấy "nóc tủ đen"/đồ rỗng. Giữ nguyên món như các trình dựng nội
 * thất khác: tường hạ, đồ đứng sàn nguyên khối. Không thêm shader: chỉ bỏ bước cắt của NodeMaterial cho bản clone
 * (`NodeLibrary.fromMaterial` chép mọi khoá, kể cả hai hàm ghi đè). Bóng đổ: xem `markShadowWhole`.
 */
export function cutWholeVariant<T extends Material>(material: T): T {
  const hit = itemWholeVariants.get(material);
  if (hit) return hit as T;
  const variant = material.clone() as T;
  const colored = material as unknown as { color?: unknown };
  if (colored.color) (variant as unknown as { color?: unknown }).color = colored.color;
  followSourceTextures(variant, material);
  variant.name = `${material.name}|whole`;
  Object.assign(variant, NO_CLIP);
  itemWholeVariants.set(material, variant);
  return variant;
}

/**
 * Bóng đổ của món nguyên khối. three 0.186 vẽ bản đồ bóng bằng MỘT vật liệu chung cho mỗi đèn (`scene.overrideMaterial`
 * = `ShadowBaseNode._getShadowMaterial`, `Renderer.renderObject` thay vật liệu của mesh bằng nó) → hai hàm ghi đè trên
 * biến thể `|whole` không tới được lượt bóng, nhóm tầng vẫn cắt bóng ở 1,0 m. Sửa đúng chỗ three cho móc: `onBeforeShadow`
 * (gọi ngay trước `renderObject` trong lượt bóng, nhận vật liệu bóng) gắn tạm hai hàm bỏ cắt lên vật liệu bóng,
 * `onAfterShadow` gỡ. Khoá dựng (`RenderObject.getMaterialCacheKey`) duyệt `Object.keys` của vật liệu và ghi chuỗi hàm
 * → mesh nguyên khối có bản dựng bóng riêng, mesh khác không bị lây. Khi một mesh đổi loại, khoá cũ của RenderObject chỉ
 * được so lại khi version vật liệu bóng đổi → tăng `shadowEpoch`, lần vẽ bóng kế tiếp mỗi vật liệu bóng `needsUpdate` một lần.
 */
const shadowWholeMeshes = new WeakSet<Object3D>();
/** Mesh đã được phân loại ít nhất một lần (có thể đã có bản dựng bóng cũ). Mesh mới dựng chưa vẽ bóng → không cần so lại khoá. */
const classifiedMeshes = new WeakSet<Object3D>();
const shadowEpochSeen = new WeakMap<Material, number>();
let shadowEpoch = 0;
type ShadowHook = (r: unknown, object: Object3D, c: unknown, sc: unknown, g: unknown, depth: Material) => void;
const shadowBefore: ShadowHook = (_r, object, _c, _sc, _g, depth) => {
  if (shadowEpochSeen.get(depth) !== shadowEpoch) {
    shadowEpochSeen.set(depth, shadowEpoch);
    depth.needsUpdate = true;
  }
  if (shadowWholeMeshes.has(object)) Object.assign(depth, NO_CLIP);
};
const shadowAfter: ShadowHook = (_r, _o, _c, _sc, _g, depth) => {
  const d = depth as Material & Partial<typeof NO_CLIP>;
  delete d.setupClipping;
  delete d.setupHardwareClipping;
};

/** Gắn/gỡ "bóng nguyên khối" cho một mesh. Xuất cho test. */
export function markShadowWhole(mesh: Mesh, whole: boolean): void {
  const seen = classifiedMeshes.has(mesh);
  classifiedMeshes.add(mesh);
  if (shadowWholeMeshes.has(mesh) === whole) return;
  if (whole) shadowWholeMeshes.add(mesh);
  else shadowWholeMeshes.delete(mesh);
  if (seen) shadowEpoch++;
  Object.assign(mesh, { onBeforeShadow: shadowBefore, onAfterShadow: shadowAfter });
}

const clipGroupOf = (mesh: Mesh): Object3D | null => {
  for (let o = mesh.parent; o; o = o.parent) if ((o as ClipGroupFields).isClippingGroup) return o;
  return null;
};
const levelYOf = (mesh: Mesh): number => clipGroupOf(mesh)?.getWorldPosition(levelPos).y ?? 0;

/** Đáy hộp bao THẾ GIỚI của mesh, tính từ sàn tầng chứa nó. */
export function meshBottomAboveLevel(mesh: Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  itemBox.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld);
  return itemBox.min.y - levelYOf(mesh);
}

/** Đỉnh hộp bao THẾ GIỚI của mesh (đã áp xoay/scale, kể cả scale âm), tính từ sàn tầng chứa nó (nhóm tầng cắt). */
export function meshTopAboveLevel(mesh: Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  itemBox.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld);
  return itemBox.max.y - levelYOf(mesh);
}

/** Phần node Pascal mà luật cắt đọc (luật vá `w5-cut-node.mjs` truyền cả node). */
export interface CutItemNode {
  id?: string;
  wallId?: string;
  scale?: readonly number[];
  asset?: { attachTo?: string; dimensions?: readonly number[] };
}
export type ItemCutKind = 'whole' | 'capped' | 'plain';
export interface ItemCutInfo {
  kind: ItemCutKind;
  /** floor | floor+lifted:<n> | wall-attached | thin-panel | hung | low | disabled | no-mesh */
  reason: string;
  /** Đáy/đỉnh của món (m, tính từ sàn tầng chứa nó). */
  bottom: number;
  top: number;
  /** Số mesh vượt mặt cắt theo từng loại. */
  whole: number;
  capped: number;
  src?: string;
}
const itemCutInfo = new Map<string, ItemCutInfo>();
/** Đầu dò: id món → loại cắt + lý do + đáy/đỉnh (`__pascalProbe.itemCut()`). */
export const itemCutReport = (): Record<string, ItemCutInfo> => Object.fromEntries(itemCutInfo);

/** Món dựng trước khi nhóm tầng thành ClippingGroup (lần `syncLowCut` đầu): chưa biết cao độ sàn → phân loại lại sau. */
interface PendingItem {
  meshes: readonly Mesh[];
  sources: (Material | Material[])[];
  assigned: (Material | Material[])[];
  src?: string | null;
  node?: CutItemNode | null;
}
let pending: PendingItem[] = [];

const span = (mesh: Mesh): { bottom: number; top: number } => ({ bottom: meshBottomAboveLevel(mesh), top: meshTopAboveLevel(mesh) });

/** Lý do món KHÔNG đứng sàn (→ cắt cùng tường), hoặc null khi là món đứng sàn. */
function cutWithWallReason(node: CutItemNode | null | undefined, meshes: readonly Mesh[], bottom: number): string | null {
  const attach = node?.asset?.attachTo;
  if (attach === 'wall' || attach === 'wall-side' || attach === 'ceiling' || node?.wallId) return 'wall-attached';
  if (bottom > FLOOR_REST_M) return 'hung';
  let thick: number;
  let height: number;
  const dims = node?.asset?.dimensions;
  if (dims && dims.length === 3) {
    const s = node?.scale ?? [1, 1, 1];
    thick = Math.min(Math.abs(dims[0]! * (s[0] ?? 1)), Math.abs(dims[2]! * (s[2] ?? 1)));
    height = Math.abs(dims[1]! * (s[1] ?? 1));
  } else {
    const box = new Box3();
    for (const mesh of meshes) box.union(itemBox.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld));
    thick = Math.min(box.max.x - box.min.x, box.max.z - box.min.z);
    height = box.max.y - box.min.y;
  }
  return thick <= THIN_PANEL_M && thick <= THIN_PANEL_RATIO * height ? 'thin-panel' : null;
}

/**
 * Gọi từ item renderer (luật `r7-item-materials.mjs`, node do `w5-cut-node.mjs`) NGAY SAU khi vendor gán lại vật liệu
 * gốc cho mọi mesh của món — lúc dựng và mỗi lần vị trí/xoay/scale của node đổi (nhấc/hạ đồ → gọi lại, đổi loại đúng).
 * Chỉ mesh vượt mặt cắt (đỉnh > sàn + 1,0 m) bị đổi vật liệu. Luật:
 * - Món CẮT CÙNG TƯỜNG (biến thể nắp `cutCapVariant`): gắn tường/trần theo node (`asset.attachTo`, `wallId`), treo (đáy
 *   > 0,15 m), hoặc tấm mỏng (`THIN_PANEL_*`). Tủ bếp trên là món gắn tường → cắt cùng tường: thường nằm trọn trên 1,0 m
 *   nên biến mất cùng phần tường đã hạ, tủ dưới đứng sàn nguyên khối — không có tủ trên xẻ nửa lơ lửng.
 * - Món ĐỨNG SÀN (biến thể `cutWholeVariant` + bóng nguyên khối): giữ nguyên, TRỪ "phần nhấc" trong cùng mẫu — mesh có
 *   đáy > 1,0 m và cách phần chồng từ sàn lên (mọi mesh có đáy ≤ 1,0 m hoặc tựa lên phần ấy, khe ≤ `STACK_GAP_M`)
 *   → cắt như tường. Bộ bếp liền khối GLB: tủ trên lơ lửng trên mặt bếp biến mất cùng tường; nóc tủ, sách trên kệ vẫn
 *   tựa phần dưới nên giữ. Mesh hoặc nguyên, hoặc nằm trọn trên mặt cắt → không bao giờ có nửa mesh trong món nguyên.
 * - `?disable=itemwhole`: mọi mesh vượt mặt cắt cắt + nắp (hành vi trước vòng 9).
 */
export function capItemMeshesForCut(meshes: readonly Mesh[], src?: string | null, node?: CutItemNode | null): void {
  const ds = matOn('cap-top') && CAP_TOP_FOLDER.test(folderOf(src) ?? '');
  const sources = meshes.map((m) => m.material);
  const spans = meshes.map(span);
  const bottom = spans.length ? Math.min(...spans.map((s) => s.bottom)) : 0;
  const top = spans.length ? Math.max(...spans.map((s) => s.top)) : 0;
  const reason = meshes.length === 0 ? 'no-mesh' : WHOLE_OFF ? 'disabled' : (cutWithWallReason(node, meshes, bottom) ?? 'floor');
  const floor = reason === 'floor';
  // Phần chồng từ sàn lên (chỉ món đứng sàn): duyệt theo đáy tăng dần.
  const lifted = new Set<number>();
  if (floor) {
    let stackTop = -Infinity;
    for (const i of spans.map((_, i) => i).sort((a, b) => spans[a]!.bottom - spans[b]!.bottom)) {
      const s = spans[i]!;
      if (s.bottom <= CUT_HEIGHT_M || s.bottom <= stackTop + STACK_GAP_M) stackTop = Math.max(stackTop, s.top);
      else lifted.add(i);
    }
  }
  let nWhole = 0;
  let nCapped = 0;
  meshes.forEach((mesh, i) => {
    const tall = spans[i]!.top > CUT_HEIGHT_M;
    const whole = tall && floor && !lifted.has(i);
    markShadowWhole(mesh, whole);
    if (!tall) return;
    const cap = (m: Material): Material => (whole ? cutWholeVariant(m) : cutCapVariant(m, ds));
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cap) : cap(mesh.material);
    if (whole) nWhole++;
    else nCapped++;
  });
  const kind: ItemCutKind = nWhole ? 'whole' : nCapped ? 'capped' : 'plain';
  const info: ItemCutInfo = { kind, reason: !nWhole && !nCapped && floor ? 'low' : lifted.size ? `floor+lifted:${lifted.size}` : reason, bottom, top, whole: nWhole, capped: nCapped };
  if (src) info.src = src;
  if (node?.id) itemCutInfo.set(node.id, info);
  if (meshes.some((m) => !clipGroupOf(m))) pending.push({ meshes, sources, assigned: meshes.map((m) => m.material), src, node });
}

/** Phân loại lại món dựng trước khi tầng thành nhóm cắt; bỏ qua món vendor đã gán lại vật liệu (đã tự gọi lại). */
function retryPending(): void {
  const list = pending;
  pending = [];
  let changed = false;
  for (const p of list) {
    if (p.meshes.some((m, i) => m.material !== p.assigned[i] || !clipGroupOf(m))) continue;
    p.meshes.forEach((m, i) => (m.material = p.sources[i]!));
    capItemMeshesForCut(p.meshes, p.src, p.node);
    changed = true;
  }
  if (changed) markDirty('cut-item');
}

/** Trả `true` khi tầng còn bị cắt (chưa nâng hết). */
function clipLevel(level: Object3D & ClipGroupFields, storeyM: number, view: CutView | undefined, dtS: number): boolean {
  let plane = level.clippingPlanes?.[0];
  if (!plane) {
    // Mặt phẳng hướng xuống: giữ phần dưới mặt cắt (khoảng cách ≥ 0). Bật một lần, không tắt nữa.
    plane = new Plane(new Vector3(0, -1, 0), NO_CUT_CONSTANT);
    level.clippingPlanes = [plane];
    level.clipIntersection = false;
    level.isClippingGroup = true;
    level.enabled = true;
    // `?light=cut-shadow`: phần bị cắt vẫn vẽ vào bản đồ bóng → nắng không lọt qua tường/trần đã cắt.
    level.clipShadows = !lightFlagOn('cut-shadow');
  }
  if (!lowCut) {
    plane.constant = NO_CUT_CONSTANT;
    return false;
  }
  level.getWorldPosition(worldPos);
  let state = lifts.get(level);
  if (!state) {
    // Lần đầu: nhảy thẳng về trạng thái đúng, không trượt lúc mở.
    const lifted = view ? wantsLift(false, view.eye.y - worldPos.y, storeyM) : false;
    state = { lifted, lift: lifted ? 1 : 0 };
    lifts.set(level, state);
  } else if (view) {
    state.lifted = wantsLift(state.lifted, view.eye.y - worldPos.y, storeyM);
    state.lift = stepLift(state.lift, state.lifted, dtS);
  } else {
    state.lifted = false;
    state.lift = 0;
  }
  if (state.lift >= 1) {
    plane.constant = NO_CUT_CONSTANT;
    return false;
  }
  plane.constant = liftedCutY(worldPos.y, storeyM, state.lift);
  if (state.lift > 0 || state.lifted) markDirty('cut-lift');
  return true;
}

export function syncLowCut(registry: CutRegistry, wallMode: string, view?: CutView, nowMs = performance.now()): void {
  const dtS = lastSyncMs === null ? 0 : Math.min(0.1, (nowMs - lastSyncMs) / 1000);
  lastSyncMs = nowMs;
  lowCut = lowCutActive(wallMode);
  let anyCut = false;
  let shown = 0;
  for (const id of registry.byType['level'] ?? NO_IDS) {
    const level = registry.nodes.get(id);
    if (!level) continue;
    // Mặt phẳng dời cho mọi tầng, nhưng chỉ tầng đang hiện (hệ tầng vendor đặt `visible`, vd. "Tầng: từng tầng")
    // quyết định tô nắp chung: tầng ẩn còn cắt không được bật nắp/tắt quầng đèn của tầng đang xem đã nâng.
    const cut = clipLevel(level as Object3D & ClipGroupFields, view?.storeyHeight(id) ?? DEFAULT_STOREY_M, view, dtS);
    if (level.visible === false) continue;
    shown++;
    if (cut) anyCut = true;
  }
  if (pending.length) retryPending();
  // Mọi tầng đang hiện đã nâng (camera trong nhà): thôi tô nắp, quầng đèn trần hiện lại.
  if (lowCut && !anyCut && shown > 0) lowCut = false;
  cutOn.value = lowCut ? 1 : 0;
}
