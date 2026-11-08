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
import { BackSide, DoubleSide, FrontSide, type Material, type Object3D, Plane, type Side, Vector3 } from 'three';
import { color, frontFacing, materialColor, materialEmissive, normalWorld, select, uniform, vec3, vec4 } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';

import { CUT_CAP_COLOR, DEFAULT_STOREY_M, liftedCutY, lowCutActive, stepLift, wantsLift } from './cut';
import { markDirty } from './idle';

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

const itemCapped = new WeakSet<Material>();

/**
 * Biến thể của `capCutMaterial` cho vật liệu ĐỒ (luật `r7-item-materials.mjs`, chỉ đồ cao quá mặt cắt): khi `cutOn` = 1
 * chỉ MẶT SAU (ruột lộ qua mặt cắt) tô phẳng màu nắp; mặt hướng lên (mặt bàn, mặt giường) giữ vật liệu. Giữ alpha của
 * màu (lá cây alphaTest). Vật liệu GLB thường (không NodeMaterial) cũng vá được: WebGPURenderer đổi sang NodeMaterial lúc
 * dựng bằng cách chép mọi khoá (`NodeLibrary.fromMaterial`), kể cả colorNode/emissiveNode. Bỏ qua vật liệu trong suốt và
 * vật liệu vốn hai mặt / mặt sau (mặt sau là mặt thật: rèm, lá). `userData.cutCapSide` giữ phía gốc: bản clone chép
 * userData + side đã đổi nhưng (vật liệu thường) không chép colorNode → vẫn nhận ra để vá lại.
 */
export function capCutItemMaterial<T extends Material>(material: T): T {
  if (itemCapped.has(material) || material.transparent) return material;
  const ud = material.userData;
  const side = (ud.cutCapSide as Side | undefined) ?? material.side;
  if (side !== FrontSide) return material;
  itemCapped.add(material);
  ud.cutCapSide = side;
  const m = material as unknown as ColorMaterial;
  const cap = cutOn.greaterThan(0.5).and(frontFacing.not());
  const base = vec4((m.colorNode ?? materialColor) as Node<'vec4'>);
  m.colorNode = select(cap, vec4(0, 0, 0, base.a), base);
  m.emissiveNode = select(
    cap,
    vec3(color(CUT_CAP_COLOR) as unknown as Node<'vec3'>),
    vec3((m.emissiveNode ?? materialEmissive) as Node<'vec3'>),
  );
  material.shadowSide ??= BackSide;
  material.side = DoubleSide;
  material.needsUpdate = true;
  return material;
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
    level.clipShadows = true;
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
