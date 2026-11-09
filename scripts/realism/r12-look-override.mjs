/**
 * R12 núm đo dáng: chấm màu, bloom đèn và môi trường lấy số từ `src/pascal-page/realism/lookOverride.ts`
 * (`DEFAULT_LOOK` + `?look=` để so ảnh). Mặc định = đúng số `scripts/pascal-render.mjs` đặt trước đây.
 */
const PP = 'viewer/src/components/viewer/post-processing.tsx';
const ENV = 'viewer/src/components/viewer/scene-environment.tsx';
const IMPORT = "import { DEFAULT_LOOK, withLookOverride } from '@pascal-realism/lookOverride'";

export const RULES = {
  [PP]: [
    [
      'export const GRADE_PARAMS = {\n  contrast: 1.12,\n  saturation: 1.08,\n}\n',
      `${IMPORT}\nconst LOOK = withLookOverride(DEFAULT_LOOK)\nexport const GRADE_PARAMS = {\n  contrast: LOOK.contrast,\n  saturation: LOOK.saturation,\n}\n`,
    ],
    [
      'tslFloat(1)), 0.15, 0.3, 3)',
      'tslFloat(1)), LOOK.bloom, 0.3, 3)',
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
