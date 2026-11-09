/**
 * R10D: kính cửa sổ "có mặt". Luật `scripts/realism/r10d-glass-transmission.mjs` cho `createMaterial` (vật liệu
 * cảnh, vd `scene:mat_appfront_glass`) của vendor đổi kính sang biến thể ở đây.
 *
 * Kính vendor (`applyGlassFresnel`) = Standard trong suốt, opacity 0,25 nhìn thẳng: phản xạ môi trường bị NHÂN
 * với opacity khi trộn (src·α + nền·(1−α)) nên nhìn từ ngoài kính như lỗ trống. Ba chế độ, đổi bằng `?glass=`:
 * - `alpha`  : giữ nguyên vendor.
 * - `sheet`  : trộn "nhân trước" ONE, 1−α: kết quả = phản xạ (cộng đủ) + nền·(1−α). Màu khuếch tán gần đen nên
 *              phần cộng chủ yếu là phản xạ PBR (F≈0,04 nhìn thẳng → 1 khi xiên); α = 1 − (1−F)·T. Không ghi
 *              normal/diffuseColor/velocity vào MRT (SSGI/denoise/TRAA thấy mặt sau kính như khi không có kính).
 * - `transmission`: MeshPhysicalNodeMaterial transmission=1 (three tự chép khung đang vẽ làm ảnh khúc xạ).
 * Tier low / WebGL → luôn `alpha` (vật liệu cũ).
 * M5-L3b `?matx=glass`: ép `sheet` + env riêng có hình (`matGlass.ts`), tint xanh nhẹ trên phản xạ.
 */
import { type Color, CustomBlending, type Material, OneFactor, OneMinusSrcAlphaFactor, type Side } from 'three';
import { float, mix, mrt, positionViewDirection, transformedNormalView, vec4 } from 'three/tsl';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, type NodeBuilder } from 'three/webgpu';

import { withGlassEnv } from './matGlass';
import { matxOn } from './matx';
import { type RealismBackend, type RealismTier, useRealism } from './store';
import { sceneTier } from './tiers';

export type GlassMode = 'alpha' | 'sheet' | 'transmission';
/** Chế độ khi không có `?glass=`: `sheet` từ vòng 4 (đề xuất làn 3b: hết vạch "sữa" chân trời 3/3 ca); `?glass=alpha` = kính vendor cũ. */
export const GLASS_DEFAULT: GlassMode = 'sheet';

/** Chế độ kính: cờ URL (A/B), rồi hạ về `alpha` ở tier low hoặc WebGL. */
export function pickGlassMode(query: string | null, tier: RealismTier, backend: RealismBackend): GlassMode {
  const want: GlassMode = query === 'alpha' || query === 'sheet' || query === 'transmission' ? query : GLASS_DEFAULT;
  return tier === 'low' || backend === 'webgl' ? 'alpha' : want;
}

const glassQuery = (): string | null =>
  typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('glass');

/** Kính = Standard trong suốt opacity < 0,6 (ngưỡng fresnel vendor) và bóng (roughness ≤ 0,1, loại viền đồ mờ). */
interface GlassCandidate {
  isMeshStandardNodeMaterial?: boolean;
  transparent?: boolean;
  opacity?: number;
  roughness?: number;
}
export function isGlassCandidate(m: GlassCandidate): boolean {
  return m.isMeshStandardNodeMaterial === true && m.transparent === true && (m.opacity ?? 1) < 0.6 && (m.roughness ?? 1) <= 0.1;
}

/** Độ truyền qua T của `sheet` nhìn thẳng (α = 1 − T khi F≈0). */
export const SHEET_TRANSMIT = 0.8;
export const SHEET_ENV = 1;

// MRT riêng của kính sheet: α = 0 ở các đích phụ → trộn ONE, 1−α giữ nguyên giá trị mặt sau kính.
// Đích không có trong render target hiện tại bị MRTNode bỏ qua (velocity chỉ có khi TRAA).
const PASS_THROUGH = mrt({ normal: vec4(0), diffuseColor: vec4(0), velocity: vec4(0) });

type Src = MeshStandardNodeMaterial & { color: Color; side: Side };

function sheet(src: Src): MeshStandardNodeMaterial {
  const m = new MeshStandardNodeMaterial({
    name: src.name,
    color: 0x000000, // không khuếch tán: phần cộng chỉ là phản xạ (vòng 1: màu ×0,06 + nắng ra lớp sữa)
    roughness: 0.02,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: src.side,
  });
  m.blending = CustomBlending;
  m.blendSrc = OneFactor;
  m.blendDst = OneMinusSrcAlphaFactor;
  m.envMapIntensity = SHEET_ENV;
  // Schlick (n=1,5): F = 0,04 + 0,96·(1−cos)^5; α = 1 − (1−F)·T.
  const cos = transformedNormalView.dot(positionViewDirection).clamp(0, 1);
  const f = mix(float(0.04), float(1), cos.oneMinus().pow(5));
  m.opacityNode = f.oneMinus().mul(SHEET_TRANSMIT).oneMinus();
  // mrtNode chỉ gắn trong lúc dựng và chỉ khi pass có MRT: để null ngoài `setup` thì khoá vật liệu không đổi giữa
  // pass MRT và pass thường (probe PMREM, outline) — MRT vật liệu không có pass MRT sẽ thay luôn `output`.
  const setup = m.setup;
  m.setup = function (this: MeshStandardNodeMaterial, builder: NodeBuilder) {
    if (builder.renderer.getMRT()) this.mrtNode = PASS_THROUGH;
    try {
      return setup.call(this, builder);
    } finally {
      this.mrtNode = null;
    }
  };
  return m;
}

function transmission(src: Src): MeshPhysicalNodeMaterial {
  return new MeshPhysicalNodeMaterial({
    name: src.name,
    color: src.color,
    roughness: 0.02,
    metalness: 0,
    transmission: 1,
    thickness: 0.006,
    ior: 1.5,
    side: src.side,
  });
}

/** Biến thể thay cho kính `src` theo chế độ hiện tại; null = giữ vật liệu vendor. */
export function glassVariant(src: Material): Material | null {
  if (!isGlassCandidate(src as GlassCandidate)) return null;
  const matx = matxOn('glass');
  const mode = pickGlassMode(matx ? 'sheet' : glassQuery(), sceneTier(), useRealism.getState().backend);
  if (mode === 'alpha') return null;
  const m = mode === 'sheet' ? sheet(src as Src) : transmission(src as Src);
  if (matx) withGlassEnv(m);
  m.userData = { ...src.userData, realismGlass: mode };
  return m;
}
