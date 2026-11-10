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
const closedCapVariants = new WeakMap<Material, Material>();
/** Hệ số sáng của mặt sau đồ kín khi không cắt (so với màu thân). */
export const CLOSED_BACK_TINT = 0.85;
const itemBox = new Box3();
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
export function cutCapVariant<T extends Material>(material: T, capDoubleSided = false, closed = capDoubleSided): T {
  if (material.transparent) return material;
  // `?mat=cap-top`: tủ GLB vốn hai mặt (không lá alphaTest) cũng nắp; mặt sau vẫn là lòng tủ lộ qua mặt cắt.
  const doubleSided = capDoubleSided && material.side === DoubleSide && !material.alphaTest;
  if (material.side !== FrontSide && !doubleSided) return material;
  const cache = closed ? closedCapVariants : itemCapVariants;
  const hit = cache.get(material);
  if (hit) return hit as T;
  const variant = material.clone() as T;
  const colored = material as unknown as { color?: unknown };
  if (colored.color) (variant as unknown as { color?: unknown }).color = colored.color;
  followSourceTextures(variant, material);
  variant.name = `${material.name}|capped`;
  const m = variant as unknown as ColorMaterial;
  const base = vec4((m.colorNode ?? materialColor) as Node<'vec4'>);
  const cutting = cutOn.greaterThan(0.5);
  // Đồ KÍN (`closed`, thư mục dạng tủ): mặt sau chỉ lộ qua nóc hở của mô hình / mặt cắt → luôn tô phẳng, kể cả khi
  // không cắt (nhìn từ trên xuống `cutOn` = 0: lòng tủ trước đây đen tuyền do AO + bóng). Không cắt: màu thân × 0,85
  // (khớp thân, không kim loại); đang cắt: màu nắp tường như cũ.
  const cap = closed ? frontFacing.not() : cutting.and(frontFacing.not());
  const capColor = vec3(color(CUT_CAP_COLOR) as unknown as Node<'vec3'>);
  m.colorNode = select(cap, vec4(0, 0, 0, base.a), base);
  m.emissiveNode = select(
    cap,
    closed ? select(cutting, capColor, vec3(base.rgb.mul(CLOSED_BACK_TINT))) : capColor,
    vec3((m.emissiveNode ?? materialEmissive) as Node<'vec3'>),
  );
  if (!doubleSided) variant.shadowSide ??= BackSide;
  variant.side = DoubleSide;
  variant.needsUpdate = true;
  cache.set(material, variant);
  return variant;
}

/** Đỉnh hộp bao THẾ GIỚI của mesh (đã áp xoay/scale, kể cả scale âm), tính từ sàn tầng chứa nó (nhóm tầng cắt). */
export function meshTopAboveLevel(mesh: Mesh): number {
  mesh.updateWorldMatrix(true, false);
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  itemBox.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld);
  let levelY = 0;
  for (let o = mesh.parent; o; o = o.parent) {
    if ((o as ClipGroupFields).isClippingGroup) {
      levelY = o.getWorldPosition(levelPos).y;
      break;
    }
  }
  return itemBox.max.y - levelY;
}

/**
 * Gọi từ item renderer (luật `r7-item-materials.mjs`) NGAY SAU khi vendor gán lại vật liệu gốc cho mọi mesh của món —
 * lúc dựng và mỗi lần vị trí/xoay/scale của node đổi. Quyết định theo TỪNG MESH và trạng thái thật: mesh vượt mặt cắt
 * thấp (đỉnh > sàn + 1,0 m) đổi sang biến thể có nắp; mesh thấp giữ vật liệu gốc (một mặt, không nhánh shader).
 */
export function capItemMeshesForCut(meshes: readonly Mesh[], src?: string | null): void {
  const ds = matOn('cap-top') && CAP_TOP_FOLDER.test(folderOf(src) ?? '');
  const cap = (m: Material): Material => cutCapVariant(m, ds, ds);
  for (const mesh of meshes) {
    if (meshTopAboveLevel(mesh) <= CUT_HEIGHT_M) continue;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(cap) : cap(mesh.material);
  }
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
  // Mọi tầng đang hiện đã nâng (camera trong nhà): thôi tô nắp, quầng đèn trần hiện lại.
  if (lowCut && !anyCut && shown > 0) lowCut = false;
  cutOn.value = lowCut ? 1 : 0;
}
