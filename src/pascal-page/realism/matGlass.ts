/**
 * M5-L3b `?matx=glass`: env riêng cho kính cửa sổ. Vòng 3 (l2b) kính `sheet` chỉ phản chiếu trời đục → ô kính sáng
 * nhạt chứ không "có mặt". Ở đây kính lấy phản xạ từ HDRI sân đô thị (nhà, cây, cửa sổ đối diện), chuẩn hoá cùng
 * cách HDRI cảnh (`hdriAutoScale`), không đổi `scene.environment` (ánh sáng toàn cục là việc làn 3a).
 * Ảnh: Poly Haven `urban_courtyard` 1k (CC0), 1,65 MB, tải khi có kính đầu tiên.
 */
import { EquirectangularReflectionMapping, FloatType, type Material } from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { pmremTexture, vec3 } from 'three/tsl';

import { HDRI_SCALE, hdriAutoScale } from './lighting';
import { GLASS_ENV_INTENSITY, GLASS_TINT } from './matx';

export const GLASS_ENV_URL = '/assets/textures/glass-env-urban-courtyard-1k.hdr';

type EnvMaterial = Material & { envNode?: unknown };

let env: unknown = null;
let loading = false;
const waiting: EnvMaterial[] = [];

function attach(m: EnvMaterial): void {
  m.envNode = env;
  m.needsUpdate = true;
}

/** Gắn env riêng cho vật liệu kính; ảnh chưa về → gắn khi về (chỉ vài vật liệu kính dựng lại). */
export function withGlassEnv(m: Material): void {
  const target = m as EnvMaterial;
  if (env) return attach(target);
  waiting.push(target);
  if (loading) return;
  loading = true;
  const t0 = performance.now();
  new HDRLoader().setDataType(FloatType).load(GLASS_ENV_URL, (tex) => {
    const { data, width, height } = tex.image as { data: Float32Array; width: number; height: number };
    const scale = hdriAutoScale(data, width, height) * HDRI_SCALE;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = data[i]! * scale;
      data[i + 1] = data[i + 1]! * scale;
      data[i + 2] = data[i + 2]! * scale;
    }
    tex.mapping = EquirectangularReflectionMapping;
    tex.needsUpdate = true;
    env = pmremTexture(tex).mul(vec3(...GLASS_TINT).mul(GLASS_ENV_INTENSITY));
    for (const w of waiting.splice(0)) attach(w);
    performance.measure('matx-glass-env', { start: t0 });
  });
}
