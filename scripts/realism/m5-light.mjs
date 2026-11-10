/**
 * M5 làn 3a: thử nghiệm ánh sáng/chiều sâu/phản xạ bật bằng `?lightx=env|sun|ao|tone` (gộp bằng dấu phẩy).
 * Logic + mặc định "tắt" ở `src/pascal-page/realism/lightx.ts`; không có `?lightx=` thì mọi hook trả nguyên giá trị.
 * Tên `m5-` xếp TRƯỚC các luật `r*` → neo trên mã sau `pascal-render`, chọn chuỗi không luật nào khác neo.
 */
const VIEWER = 'viewer/src/components/viewer';
/** Chèn import sau một dòng import có sẵn (neo = cả dòng). */
const addImport = (line, names) => [`${line}\n`, `${line}\nimport { ${names} } from '@pascal-realism/lightx'\n`];

export const RULES = {
  [`${VIEWER}/post-processing.tsx`]: [
    addImport("import { useFrame, useThree } from '@react-three/fiber'", 'lightxAo'),
    ['        // Composite: scene * AO + diffuse * GI\n', '        ao = lightxAo(ao)\n        // Composite: scene * AO + diffuse * GI\n'],
  ],
  [`${VIEWER}/lights.tsx`]: [
    addImport("import { sceneRegistry } from '@pascal-app/core'", 'lightxTheme'),
    ['  const theme = getSceneTheme(sceneTheme)\n', '  const theme = lightxTheme(getSceneTheme(sceneTheme))\n'],
  ],
  [`${VIEWER}/scene-environment.tsx`]: [
    addImport("import { useThree } from '@react-three/fiber'", 'installLightxEnv'),
    [
      '  }, [scene, texture])\n',
      '  }, [scene, texture])\n\n  // M5 lightx=env: HDRI trong nhà cho IBL (đợi HDRI ngoài trời gắn xong rồi thay giá trị nút).\n  useEffect(() => installLightxEnv(scene, appearance), [scene, texture, appearance])\n',
    ],
  ],
  [`${VIEWER}/index.tsx`]: [
    ["'use client'\n", "'use client'\nimport { lightxExposure, lightxToneMapping } from '@pascal-realism/lightx'\n"],
    ['renderer.toneMapping = THREE.AgXToneMapping', 'renderer.toneMapping = lightxToneMapping(THREE.AgXToneMapping)'],
    [
      '    gl.toneMappingExposure = getSceneTheme(sceneTheme).toneMappingExposure\n',
      // R3F đặt lại gl.toneMapping = ACES sau createRenderer (đo 09/11: renderer.toneMapping = 4) → đặt lại ở đây.
      '    gl.toneMapping = lightxToneMapping(gl.toneMapping)\n    gl.toneMappingExposure = lightxExposure(getSceneTheme(sceneTheme).toneMappingExposure)\n',
    ],
  ],
};
