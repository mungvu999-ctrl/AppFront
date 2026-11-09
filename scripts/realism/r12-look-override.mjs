/**
 * R12 núm đo dáng: chấm màu, bloom đèn và môi trường lấy số từ `src/pascal-page/realism/lookOverride.ts`
 * (`DEFAULT_LOOK` + `?look=` để so ảnh). Mặc định = đúng số `scripts/pascal-render.mjs` đặt trước đây.
 * Tương phản/bão hoà trong chuỗi hậu kỳ đi qua uniform `GRADE_U` (`realism/grade.ts`) để đổi lúc chạy; ảnh chụp nhanh
 * (`snapshot-pipeline`) dùng cùng uniform, nên bão hoà do `applyTone` đặt (`agx-cal` = 1,10) ra cả trong ảnh xuất.
 */
const PP = 'viewer/src/components/viewer/post-processing.tsx';
const ENV = 'viewer/src/components/viewer/scene-environment.tsx';
const SNAP = 'viewer/src/lib/snapshot-pipeline.ts';
const IMPORT = "import { DEFAULT_LOOK, withLookOverride } from '@pascal-realism/lookOverride'";
const IMPORT_GRADE = "import { GRADE_U } from '@pascal-realism/grade'";

export const RULES = {
  [PP]: [
    [
      'export const GRADE_PARAMS = {\n  contrast: 1.12,\n  saturation: 1.08,\n}\n',
      `${IMPORT}\n${IMPORT_GRADE}\n// Tone mapper thật do realism/tone.ts đặt: AgX hiệu chỉnh mặc định (WebGPU trung/cao), ACES ở low/WebGL2 hoặc ?tone=aces.\nconst LOOK = withLookOverride(DEFAULT_LOOK)\nexport const GRADE_PARAMS = {\n  contrast: LOOK.contrast,\n  saturation: LOOK.saturation,\n}\n`,
    ],
    [
      'rgb.div(0.18).pow(vec3(GRADE_PARAMS.contrast)).mul(0.18),\n          GRADE_PARAMS.saturation,',
      'rgb.div(0.18).pow(vec3(GRADE_U.contrast)).mul(0.18),\n          GRADE_U.saturation,',
    ],
    ['tslFloat(1)), 0.15, 0.3, 3)', 'tslFloat(1)), LOOK.bloom, 0.3, 3)'],
  ],
  [SNAP]: [
    [
      "import { GRADE_PARAMS, SSGI_PARAMS } from '../components/viewer/post-processing'",
      `import { SSGI_PARAMS } from '../components/viewer/post-processing'
${IMPORT_GRADE}`,
    ],
    [
      'vec3(GRADE_PARAMS.contrast)).mul(0.18), GRADE_PARAMS.saturation)',
      'vec3(GRADE_U.contrast)).mul(0.18), GRADE_U.saturation)',
    ],
  ],
  [ENV]: [
    [
      'const ENV_INTENSITY = 0.8\n',
      `${IMPORT}\nconst LOOK = withLookOverride(DEFAULT_LOOK)\nconst ENV_INTENSITY = LOOK.env\n`,
    ],
    ['const ENV_INTENSITY_DARK = 0.3\n', 'const ENV_INTENSITY_DARK = LOOK.envDark\n'],
  ],
};
