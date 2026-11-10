/**
 * Plugin vite chỉnh chất lượng dựng hình của Pascal LÚC DỰNG (FE3D-FIX-002 U06).
 *
 * Không sửa vendor (quyết định A), cùng cách `pascal-vi.mjs`: thay chuỗi trên mã nguồn
 * trước mọi plugin khác. Các luật (nghiên cứu ở `qa-results/fe3d-fix/v2/Q2.md`):
 * 1. cờ góc khu đất chỉ hiện ở pha site, không hiện ở chế độ chọn;
 * 2. (bỏ: Preview nay dùng chung khung 3D với khung sửa nên có sẵn `<SceneEnvironment />`);
 * 3. bóng đổ 2048 thay 1024, `normalBias` 0.04 (texel nhỏ hơn nên bias nhỏ hơn);
 * 4. ánh sáng môi trường nền tối 0.2 → 0.4;
 * 5. khu đất không vẽ đường ranh vàng (nền + bóng đổ vẫn vẽ) — cái đế dưới nhà như trang đăng nhập.
 *
 * Dáng arch-viz ấm (FE3D-FIX-004 thẻ R; số đèn/SSGI ở `src/pascal-page/renderLook.ts`):
 * 6. ánh sáng môi trường nền tối 0.2 → 0.6, nguồn là `RoomEnvironment` (PMREM) của three/addons
 *    thay cho dải màu ban ngày — chỉ khi có WebGPU, WebGL2 giữ dải màu rẻ;
 * 7. bóng của đèn chính đậm hơn: trần 0.75 → 0.85 (ánh sáng nền đã hạ, góc tối hơn);
 * 8. chấm màu: tương phản 1.05 → 1.12, bão hoà 1.1 → 1.08;
 * 9. bloom nhẹ chỉ ở điểm sáng của đèn (ngưỡng cao) + vignette mềm, chỉ ở `rendered`
 *    (chuỗi hậu kỳ chỉ dựng khi có WebGPU nên WebGL2 không tốn thêm gì).
 *
 * "Ban ngày" (FE3D-FIX-004 thẻ L; số đèn ở `renderLook.ts` `applyDayLook`):
 * 10. ánh sáng môi trường (dải trời) của chủ đề sáng 0.6 → 0.8: phòng trong bóng vẫn sáng như ban ngày.
 *
 * Dáng A (docs/blender-vs-editor/BAO-CAO.md):
 * 11. tone mapping ACES Filmic → AgX lúc tạo renderer. KHÔNG có hiệu lực: R3F `configure()` (gl là hàm) đặt lại
 *     ACES ngay sau đó. Tone thật do `src/pascal-page/realism/tone.ts` đặt, gọi sau `ToneMappingExposure`
 *     (luật `scripts/realism/m6-tone.mjs`): mặc định AgX hiệu chỉnh trên WebGPU mức trung/cao, ACES ở low/WebGL2,
 *     `?tone=aces` = baseline cũ. Phơi sáng theo chủ đề ở `renderLook.ts`;
 * 12. vignette 16 % → 7 %: góc khung không còn tối bẩn quanh nhà.
 * (Lọc dị hướng 8 cho texture vật liệu đã có ở `scripts/realism/r8-pack1.mjs`.)
 *
 * Báo đỏ thay vì im lặng: chuỗi gốc không còn hoặc xuất hiện hơn một lần trong tệp, hay
 * tệp trong bảng không được dựng tới → ném lỗi, lượt dựng hỏng.
 */

/** Đường dẫn tương đối từ `vendor/pascal/packages` → các cặp `[gốc, mới]`, mỗi gốc đúng một lần. */
export const RENDER_RULES = {
  'editor/src/lib/site-boundary.ts': [
    ["return args.phase === 'site' || args.mode === 'select'", "return args.phase === 'site'"],
  ],
  'viewer/src/components/viewer/lights.tsx': [
    ['shadow-mapSize={[1024, 1024]}', 'shadow-mapSize={[2048, 2048]}'],
    ['const SHADOW_NORMAL_BIAS = 0.08', 'const SHADOW_NORMAL_BIAS = 0.04'],
    ['const MAX_SHADOW_INTENSITY = 0.75', 'const MAX_SHADOW_INTENSITY = 0.85'],
  ],
  'viewer/src/components/viewer/post-processing.tsx': [
    [
      "import { ssgi } from 'three/addons/tsl/display/SSGINode.js'",
      "import { ssgi } from 'three/addons/tsl/display/SSGINode.js'\nimport { bloom } from 'three/addons/tsl/display/BloomNode.js'",
    ],
    ['  contrast: 1.05,\n  saturation: 1.1,\n', '  contrast: 1.12,\n  saturation: 1.08,\n'],
    [
      'const withOverlay = mix(composited, overlayColor.rgb, overlayColor.a)',
      [
        '// pascal-render: bloom on lamp hot spots only (input = scene before outlines, high',
        '      // luminance threshold, pre-tone-map) + soft vignette. Rendered shading only.',
        '      let looked: any = composited',
        "      if (shading === 'rendered' && !transparentBackground) {",
        '        const lampGlow = bloom(vec4(sceneColor.rgb.mul(contentAlpha), tslFloat(1)), 0.15, 0.3, 3)',
        '        resources.passes.push(lampGlow as any)',
        '        const edge = smoothstep(tslFloat(0.4), tslFloat(0.78), screenUV.sub(0.5).length())',
        '        looked = add(composited, vec4(lampGlow).rgb).mul(mix(tslFloat(1), tslFloat(0.93), edge))',
        '      }',
        '      const withOverlay = mix(looked, overlayColor.rgb, overlayColor.a)',
      ].join('\n'),
    ],
  ],
  'viewer/src/components/viewer/index.tsx': [
    ['renderer.toneMapping = THREE.ACESFilmicToneMapping', 'renderer.toneMapping = THREE.AgXToneMapping'],
  ],
  'nodes/src/site/renderer.tsx': [
    ['{showSiteSurfaces && !ribbons && (', '{false && showSiteSurfaces && !ribbons && ('],
  ],
  'viewer/src/components/viewer/scene-environment.tsx': [
    [
      "import * as THREE from 'three/webgpu'",
      "import * as THREE from 'three/webgpu'\nimport { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'",
    ],
    ['const ENV_INTENSITY = 0.6', 'const ENV_INTENSITY = 0.8'],
    ['const ENV_INTENSITY_DARK = 0.2', 'const ENV_INTENSITY_DARK = 0.3'],
    [
      'export function SceneEnvironment() {',
      [
        '// pascal-render: dark themes take light from a neutral studio box (RoomEnvironment, PMREM)',
        '// instead of the daylight gradient. WebGPU only; WebGL2 keeps the cheap gradient.',
        '// ponytail: the PMREMGenerator is never disposed (one per theme switch, a few small RTs).',
        'function buildRoomEnvironment(gl: unknown): THREE.Texture | null {',
        "  if (typeof navigator === 'undefined' || !('gpu' in navigator)) return null",
        '  try {',
        '    return new THREE.PMREMGenerator(gl as THREE.WebGPURenderer).fromScene(new RoomEnvironment(), 0.04).texture',
        '  } catch (error) {',
        "    console.warn('[pascal-render] RoomEnvironment failed, using the gradient sky', error)",
        '    return null',
        '  }',
        '}',
        '',
        'export function SceneEnvironment() {',
      ].join('\n'),
    ],
    [
      '  const texture = useMemo(buildGradientSky, [])\n  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)\n',
      [
        '  const gl = useThree((state) => state.gl)',
        '  const appearance = useViewer((state) => getSceneTheme(state.sceneTheme).appearance)',
        "  const texture = useMemo(() => (appearance === 'dark' && buildRoomEnvironment(gl)) || buildGradientSky(), [appearance, gl])",
        '',
      ].join('\n'),
    ],
  ],
};

const fileOf = (id) => {
  const norm = id.split('?')[0].replaceAll('\\', '/');
  return Object.keys(RENDER_RULES).find((f) => norm.endsWith(`/packages/${f}`));
};

/** Áp luật cho một module; tệp ngoài bảng → `null`. */
export function transformRender(code, id) {
  const file = fileOf(id);
  if (!file) return null;
  const crlf = code.includes('\r\n');
  let out = code;
  for (const [rawFrom, rawTo] of RENDER_RULES[file]) {
    const from = crlf ? rawFrom.replaceAll('\n', '\r\n') : rawFrom;
    const to = crlf ? rawTo.replaceAll('\n', '\r\n') : rawTo;
    const count = out.split(from).length - 1;
    if (count !== 1) {
      throw new Error(`pascal-render: chuỗi gốc ${JSON.stringify(rawFrom)} gặp ${count} lần (cần đúng 1) trong ${file} — upstream đã đổi, cập nhật scripts/pascal-render.mjs`);
    }
    out = out.replace(from, () => to);
  }
  return out;
}

export function pascalRender() {
  const seen = new Set();
  return {
    name: 'pascal-render',
    enforce: 'pre',
    transform(code, id) {
      const out = transformRender(code, id);
      if (out === null) return null;
      seen.add(fileOf(id));
      return { code: out, map: null };
    },
    buildEnd(error) {
      if (error) return;
      const missing = Object.keys(RENDER_RULES).filter((f) => !seen.has(f));
      if (missing.length) throw new Error(`pascal-render: tệp trong bảng không được dựng tới: ${missing.join(', ')}`);
    },
  };
}
