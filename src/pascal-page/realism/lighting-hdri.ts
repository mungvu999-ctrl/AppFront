/**
 * R4: HDRI cho chủ đề sáng. Vendor `scene-environment.tsx` gọi qua `@pascal-realism/lighting-hdri`
 * (vá `scripts/realism/r4-lighting.mjs`). Lỗi / quá 10 s / không WebGPU / cờ tắt → giữ nguyên môi trường cũ.
 *
 * Tốc độ mở trang: đổi `scene.environment` sau lượt vẽ đầu làm three tạo nút môi trường MỚI (id mới) →
 * khoá cache của mọi RenderObject có ánh sáng đổi → dựng lại + biên dịch lại pipeline (25–40/75 lượt).
 * Nên cài MỘT `PMREMNode` làm `scene.environmentNode` ngay lúc cài (giữ trời gradient), HDRI về thì chỉ
 * đổi `envNode.value` — PMREM tính lại, không vật liệu nào dựng lại. Byte HDRI tải từ lúc mở trang
 * (`prefetchHdri` trong `main.tsx`), không còn đợi trình duyệt rảnh.
 *
 * Đổi chủ đề cũng vậy: chủ đề tối dùng `RoomEnvironment`, chủ đề sáng dùng trời + HDRI. Nút giữ nguyên qua mọi
 * chủ đề, kể cả chủ đề tối (không có HDRI), nếu không mỗi lần đổi lại dựng lại toàn bộ shader (đo 04/11).
 */
import { EquirectangularReflectionMapping, FileLoader, FloatType, type Scene, type Texture } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { pmremTexture } from 'three/tsl';

import { HDRI_SCALE, HDRI_TIMEOUT_MS, HDRI_VARIANT, type HdriVariant, hdriAutoScale, hdriUrlFor, mixGradient, shouldLoadHdri } from './lighting';
import { makeSkyTexture, setHdriSky, setWinSky } from './reflect';
import { useRealism } from './store';
import { parseWinView, WIN_FLOOR, WIN_URL, winViewState } from './winView';

/** `?hdri=pure|gradient|off` để chấm mù hai biến thể (không có = HDRI_VARIANT). */
const askedHdri = () => (typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('hdri'));

const buffers = new Map<string, Promise<ArrayBuffer>>();

/** Byte thô của HDRI theo chủ đề, tải một lần (đổi chủ đề qua lại không tải lại). Lỗi → lần sau thử lại. */
const hdriBytes = (themeId: string): Promise<ArrayBuffer> => bytesOf(hdriUrlFor(themeId));

function bytesOf(url: string): Promise<ArrayBuffer> {
  let pending = buffers.get(url);
  if (!pending) {
    pending = new FileLoader().setResponseType('arraybuffer').loadAsync(url) as Promise<ArrayBuffer>;
    pending.catch(() => buffers.delete(url));
    buffers.set(url, pending);
  }
  return pending;
}

/**
 * Gọi lúc mở trang: tải trước HDRI nếu chủ đề hiện tại sẽ dùng. Backend thật chưa biết (renderer chưa
 * init) → coi `navigator.gpu` là WebGPU; đoán sai chỉ tốn một lượt tải ~1 MB.
 */
export function prefetchHdri(themeId: string, appearance: string): void {
  const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const flag = useRealism.getState().flags.hdri;
  if (askedHdri() === 'off' || !shouldLoadHdri({ backend: gpu ? 'webgpu' : 'webgl', flag, appearance })) return;
  hdriBytes(themeId).catch(() => {});
}

const stableEnv = new WeakMap<Scene, ReturnType<typeof pmremTexture>>();

/**
 * Nút môi trường của cảnh, một nút suốt đời cảnh và mọi chủ đề: chỉ đổi `value` theo `scene.environment` hiện tại.
 * Null khi chưa có trời, hoặc cảnh đang có nút của chủ khác (bầu trời `scene-atmosphere`).
 */
function stableEnvNode(scene: Scene): ReturnType<typeof pmremTexture> | null {
  if (!scene.environment) return null;
  let node = stableEnv.get(scene);
  if (!node) {
    node = pmremTexture(scene.environment);
    stableEnv.set(scene, node);
  }
  if (scene.environmentNode && scene.environmentNode !== node) return null;
  if (node.value !== scene.environment) node.value = scene.environment;
  scene.environmentNode = node;
  return node;
}

/** Trả hàm dọn (gỡ HDRI; nút môi trường ở lại). `themeId` chọn HDRI (Ban ngày khác Nắng chiều, gói 2B). */
export function installHdri(scene: Scene, appearance: string, themeId = ''): () => void {
  const undoTheme = installThemeHdri(scene, appearance, themeId);
  const undoWin = installWinView(appearance);
  return () => {
    undoTheme();
    undoWin();
  };
}

/**
 * E-WINVIEW (`winView.ts`): HDRI có cảnh CHỈ cho phông qua kính — không đụng `envNode`, probe phản chiếu hay tone.
 * Chạy cả chủ đề tối (lý do chính: "Buổi tối" vốn không có HDRI → cửa sổ là mảng xám) và độc lập với `?hdri=off`.
 */
function installWinView(appearance: string): () => void {
  const view = typeof location === 'undefined' ? null : parseWinView(location.search, appearance);
  const { backend, tier } = useRealism.getState();
  if (!view || backend !== 'webgpu' || tier === 'low') return () => {};
  Object.assign(winViewState, view, { loaded: false });
  let done = false;
  let sky: Texture | null = null;
  const warn = (error: unknown) => console.warn('[pascal-realism] phông cửa sổ không tải được, giữ phông cũ', error);
  bytesOf(WIN_URL[view.mode]).then((buffer) => {
    if (done) return;
    const url = URL.createObjectURL(new Blob([buffer]));
    new HDRLoader().setDataType(FloatType).load(
      url,
      (texture) => {
        URL.revokeObjectURL(url);
        if (done) return;
        const { data, width, height } = texture.image as { data: Float32Array; width: number; height: number };
        // Cùng chuẩn hoá với trời chủ đề, nhân gain; ảnh thuần (không pha gradient). Ảnh tải về chưa lên GPU → bỏ, không dispose.
        sky = makeSkyTexture(data, width, height, hdriAutoScale(data, width, height) * view.gain);
        winViewState.loaded = true;
        setWinSky(sky, view.scope, WIN_FLOOR);
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        warn(error);
      },
    );
  }, warn);
  return () => {
    done = true;
    winViewState.loaded = false;
    if (sky) setWinSky(null);
    sky?.dispose();
  };
}

function installThemeHdri(scene: Scene, appearance: string, themeId: string): () => void {
  const { backend, flags } = useRealism.getState();
  const asked = askedHdri();
  if (asked === 'off') return () => {};
  const envNode = stableEnvNode(scene);
  if (!envNode || !shouldLoadHdri({ backend, flag: flags.hdri, appearance })) return () => {};
  const variant: HdriVariant = asked === 'pure' || asked === 'gradient' ? asked : HDRI_VARIANT;
  let done = false;
  let hdr: Texture | null = null;
  let sky: Texture | null = null;
  const timer = setTimeout(() => {
    if (!hdr) done = true;
  }, HDRI_TIMEOUT_MS);
  const warn = (error: unknown) => console.warn('[pascal-realism] HDRI không tải được, giữ môi trường cũ', error);
  hdriBytes(themeId).then((buffer) => {
    if (done) return;
    // Blob URL giữ nguyên cách HDRLoader dựng texture (lọc, lật, không mipmap).
    const url = URL.createObjectURL(new Blob([buffer]));
    new HDRLoader().setDataType(FloatType).load(
      url,
      (texture) => {
        URL.revokeObjectURL(url);
        if (done) return texture.dispose();
        clearTimeout(timer);
        const { data, width, height } = texture.image as { data: Float32Array; width: number; height: number };
        const scale = hdriAutoScale(data, width, height) * HDRI_SCALE;
        // Phông trời qua kính dùng bản thuần (chép trước khi pha gradient).
        sky = makeSkyTexture(data.slice(), width, height, scale);
        mixGradient(data, width, height, variant === 'gradient' ? undefined : 0, scale);
        texture.mapping = EquirectangularReflectionMapping;
        texture.needsUpdate = true;
        hdr = texture;
        // Cùng nút → khoá cache vật liệu không đổi.
        envNode.value = texture;
        setHdriSky(sky);
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        warn(error);
      },
    );
  }, warn);
  return () => {
    done = true;
    clearTimeout(timer);
    if (sky) setHdriSky(null);
    hdr?.dispose();
    sky?.dispose();
  };
}
