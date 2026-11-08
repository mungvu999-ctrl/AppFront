/**
 * Plugin gom luật editor-realism: mỗi luật trong `scripts/realism/*.mjs` khớp đúng số lần trên tệp
 * vendor thật (sau `pascal-render`), neo mất thì ném lỗi, tệp không được dựng tới thì lượt dựng hỏng.
 * Chạy bằng `node --test` hoặc vitest (như pascal-render.test.mjs).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { pascalRealism, REALISM_RULES, transformRealism } from '../pascal-realism.mjs';
import { RENDER_RULES, transformRender } from '../pascal-render.mjs';
import { partitionSkirtingData, RULES as R9V_RULES } from '../realism/r9v-partition-skirt.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');
const PACKAGES = path.resolve('vendor/pascal/packages');
const ID = '/x/vendor/pascal/packages/viewer/src/a.ts';
const rule = (pairs) => [{ source: 'r9-test.mjs', file: 'viewer/src/a.ts', pairs }];

describe('pascal-realism', () => {
  for (const file of new Set(REALISM_RULES.map((r) => r.file))) {
    it(`luật áp được trên ${file} (sau pascal-render)`, () => {
      const id = path.join(PACKAGES, file);
      const raw = readFileSync(id, 'utf8');
      const code = RENDER_RULES[file] ? transformRender(raw, id) : raw;
      const out = transformRealism(code, id);
      assert.notEqual(out, code);
    });
  }

  it('thay đúng số lần, ném lỗi kèm tên file luật khi sai số lần', () => {
    assert.equal(transformRealism('a b a', ID, rule([['a', 'c', 2]])), 'c b c');
    assert.equal(transformRealism('a b', ID, rule([['a', 'c']])), 'c b');
    assert.throws(() => transformRealism('a b a', ID, rule([['a', 'c']])), /gặp 2 lần \(cần 1\).*r9-test\.mjs/);
    assert.throws(() => transformRealism('b', ID, rule([['a', 'c']])), /gặp 0 lần/);
  });

  it('tệp ngoài bảng → null; CRLF giữ CRLF', () => {
    assert.equal(transformRealism('a', '/x/packages/viewer/src/b.ts', rule([['a', 'c']])), null);
    assert.equal(transformRealism('x\r\ny', ID, rule([['x\ny', 'x\nz']])), 'x\r\nz');
  });

  it('buildEnd ném lỗi khi tệp trong bảng không được dựng tới', () => {
    const plugin = pascalRealism({ rules: rule([['a', 'c']]) });
    assert.throws(() => plugin.buildEnd(), /không được dựng tới: viewer\/src\/a\.ts/);
    assert.deepEqual(plugin.transform('a', ID), { code: 'c', map: null });
    plugin.buildEnd();
  });
});

describe('r9v-partition-skirt: vach giua hai phong bo phao ngoai, gop vao lo cap nhat mat tuong', () => {
  const skirting = { enabled: true, sides: 'both', height: 0.1, exterior: { height: 0.25, proud: 0.02, profile: 'flat' } };

  it('hai mat trong phong -> bo exterior, sides interior; con lai giu nguyen', () => {
    assert.deepEqual(partitionSkirtingData(skirting, true, true), { skirting: { enabled: true, sides: 'interior', height: 0.1 } });
    assert.equal(partitionSkirtingData(skirting, true, false), null);
    assert.equal(partitionSkirtingData(skirting, false, false), null);
    assert.equal(partitionSkirtingData({ ...skirting, exterior: undefined }, true, true), null);
    assert.equal(partitionSkirtingData(undefined, true, true), null);
  });

  it('khop space-detection.ts cua vendor, khong them updateNodes rieng', () => {
    const id = 'core/src/lib/space-detection.ts';
    const code = readFileSync(path.join(PACKAGES, id), 'utf8');
    const out = transformRealism(code, path.join(PACKAGES, id), [{ source: 'r9v-partition-skirt.mjs', file: id, pairs: R9V_RULES[id] }]);
    assert.equal((out.match(/withPartitionSkirting\(/g) ?? []).length, 3);
    assert.equal((out.match(/updateNodes\(wallBatch\)/g) ?? []).length, 2);
  });
});

describe('u40/u42: nhan ten phong thuong truc, khoi cho tai noi that thap va co depthTest', () => {
  const apply = (id) => {
    const full = path.join(PACKAGES, id);
    const raw = readFileSync(full, 'utf8');
    return transformRealism(RENDER_RULES[id] ? transformRender(raw, full) : raw, full);
  };

  it('u42: khoi cho khong nhin xuyen tuong, khong soc chay, cao toi da 0.3 m', () => {
    const out = apply('nodes/src/item/renderer.tsx');
    assert.doesNotMatch(out, /material\.depthTest = false/);
    assert.doesNotMatch(out, /material\.opacityNode = previewOpacity/);
    assert.match(out, /<boxGeometry args=\{\[w, Math\.min\(h, 0\.3\), d\]\} \/>/);
  });

  it('u40: nhan theo co roomLabels, nam ngoai showZones, bam dup moi bay toi phong (N1, U45)', () => {
    const out = apply('nodes/src/zone/renderer.tsx');
    assert.match(out, /useFloorplanAnnotationVisibility\(\(s\) => s\.visibility\.roomLabels\)/);
    const label = out.indexOf('{showRoomLabelsU40 && levelShownU70 && levelVisibleU70 && node.visible !== false && node.name && (');
    assert.ok(label > 0 && label < out.indexOf('{showZones && ('));
    const block = out.slice(label, out.indexOf('{showZones && ('));
    // Html boc ngoai khong an chuot; nut ben trong chi an chuot o che do Chon / Xem truoc.
    assert.match(block, /style=\{\{ pointerEvents: 'none' \}\}/);
    assert.match(block, /pointerEvents: labelClickU40 \? 'auto' : 'none', cursor: 'pointer'[\s\S]*opacity: 1/);
    assert.match(block, /appfront:fit-room', \{ detail: node\.id \}/);
    // U45: chuot bam don khong bay camera (detail > 0); ban phim va bam dup van bay.
    assert.match(block, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); if \(e\.detail === 0\) window\.dispatchEvent/);
    assert.match(block, /onDoubleClick=\{\(e\) => \{ e\.stopPropagation\(\); window\.dispatchEvent/);
    // R3F nghe pointerdown/up tren khung chua canvas: chan o nut thi khong chon tuong phia sau.
    assert.match(block, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);
    assert.match(block, /onPointerUp=\{\(e\) => e\.stopPropagation\(\)\}/);
  });

  it('u70: nhan chi ve khi tang cua vung dang hien (luat chung isLevelShown)', () => {
    const out = apply('nodes/src/zone/renderer.tsx');
    assert.match(out, /import \{ isLevelShown \} from '@\/pascal-page\/upstream\/lib\/level-shown'/);
    assert.match(out, /isSelected: s\.selection\.levelId === node\.parentId \}\)\)/);
    assert.match(out, /s\.nodes\[node\.parentId\]\?\.visible : undefined\) !== false\)/);
  });
});

describe('u70: tang an khong do bong (khong con shadow-only)', () => {
  it('resolveLevelVisibility dung isLevelShown, shadowOnly luon false', () => {
    const full = path.join(PACKAGES, 'viewer/src/systems/level/level-utils.ts');
    const raw = readFileSync(full, 'utf8');
    const out = transformRealism(raw, full);
    assert.match(raw, /index > selectedIndex/);
    assert.doesNotMatch(out, /index > selectedIndex/);
    assert.match(out, /return \{ visible: isLevelShown\(\{ levelMode, hasSelectedLevel, isSelected \}\), shadowOnly: false \}/);
    assert.match(out, /import \{ isLevelShown \} from '@\/pascal-page\/upstream\/lib\/level-shown'/);
  });
});

describe('u20: keo trai xoay khong tu huy khi camera dang troi (transitionstart bat cameraDragging)', () => {
  it('mien cameraDragging cho lan keo-xoay, Shift-keo van bi chan nhu cu', () => {
    const id = 'editor/src/components/tools/select/box-select-tool.tsx';
    const full = path.join(PACKAGES, id);
    const out = transformRealism(readFileSync(full, 'utf8'), full);
    assert.match(out, /\(viewer\.cameraDragging && !orbitFromU20\.current\) \|\|/);
    assert.match(out, /if \(\(viewer\.cameraDragging && wantsBoxSelectU20\(event\)\) \|\| viewer\.inputDragging\) return/);
  });
});

describe('r9x-wall-caps: nhom vat lieu 0 cua tuong (nap tren/day) dung vat lieu son mat trong', () => {
  it('chi doi nhanh textures, giu vai tro Lambert khi tat texture', () => {
    const file = 'viewer/src/systems/wall/wall-materials.ts';
    const id = path.join(PACKAGES, file);
    const out = transformRealism(readFileSync(id, 'utf8'), id);
    assert.match(out, /\? \[\n {10}resolveWallFaceMaterial\(wallNode, 'interior', shading, sceneMaterials\),\n {10}resolveWallFaceMaterial\(wallNode, 'interior'/);
    assert.match(out, /Array\.from\(\{ length: 12 \}, \(\) => wallRoleMaterial\)/);
  });
});

describe('u43 + r10-ao: post-processing khong dung lai khi doi co canvas; GTAO chi khi scene pass 1 mau', () => {
  const full = path.join(PACKAGES, 'viewer/src/components/viewer/post-processing.tsx');
  const raw = readFileSync(full, 'utf8');
  const out = transformRealism(transformRender(raw, full), full);

  it('deps cua effect dung pipeline la hasSize, khong phai size.width/height', () => {
    assert.match(out, /const hasSize = size\.width >= 1 && size\.height >= 1\n {2}\/\/ Build \/ rebuild/);
    assert.match(out, /\n {4}hasSize,\n {4}zoneLayers,\n/);
    assert.doesNotMatch(out, /\n {4}size\.(width|height),\n/);
  });

  it('gtaoOn nhan transparentBackground (cung dieu kien traaOn)', () => {
    assert.match(out, /const aoMrt = gtaoOn\(shading, ssgiEnabled, transparentBackground\)/);
  });
});

describe('r9y-cut-cap: doi che do tuong khong dung lai vat lieu / luoi gop', () => {
  const apply = (file) => {
    const id = path.join(PACKAGES, file);
    const raw = readFileSync(id, 'utf8');
    return transformRealism(RENDER_RULES[file] ? transformRender(raw, id) : raw, id);
  };

  it('vat lieu visible va nap cat mot lan luc tao', () => {
    const out = apply('viewer/src/systems/wall/wall-materials.ts');
    assert.match(out, /import \{ capCutMaterial \} from '@pascal-realism\/cutSync'/);
    assert.match(out, /visible\.forEach\(\(material\) => capCutMaterial\(material\)\)\n {2}const result: WallMaterials = \{/);
  });

  it('tam dung gop: an/hien luoi gop, khong huy; tang cu van gop lai', () => {
    const out = apply('nodes/src/wall/wall-batch-system.tsx');
    assert.match(out, /record\.mesh\.visible = !suspended/);
    assert.match(out, /if \(!suspended && staleLevels\.has\(levelId\)\) \{\n {8}disposeLevelBatches\(levelId\)/);
    assert.doesNotMatch(out, /if \(batchingSuspended\) \{\n {4}staleLevels\.clear\(\)/);
    assert.match(out, /holdBatchedWallsAfterCapture\(\): void \{\n.*\n {2}if \(batchingSuspended\) return/);
  });
});

describe('r3t-tiers: doi muc khong doi khoa vat lieu canh (chi dung lai quad hau ky)', () => {
  const patched = (file) => {
    const id = path.join(PACKAGES, file);
    const raw = readFileSync(id, 'utf8');
    return transformRealism(RENDER_RULES[file] ? transformRender(raw, id) : raw, id);
  };

  it('mot nut MRT dung chung moi lan dung pipeline (mrt.id moi = dung lai moi vat lieu)', () => {
    const pp = patched('viewer/src/components/viewer/post-processing.tsx');
    assert.equal(pp.split(/\bmrt\(\{/).length - 1, 1);
    assert.match(pp, /SCENE_MRTS\[String\(traaOn\)\] \?\?= mrt\(\{/);
    assert.match(pp, /scenePass\.setMRT\(sceneMrt\(traaOn\)\)/);
    // MRT theo muc CANH (TRAA cua sceneTier): ha low giua phien tat GTAO/SSGI nhung giu MRT.
    assert.match(pp, /const gtaoEnabled = aoMrt && realismTier !== 'low'\n\s+const needsNormalMRT = ssgiEnabled \|\| inkEnabled \|\| aoMrt\n/);
    // Tai o low: SSGI tat toi khi mo lai trang (bat = them MRT = dung lai moi vat lieu).
    assert.match(pp, /ao: set\.has\('ao'\) \|\| !tierConfig\(currentTier\(\)\)\.ssgiOn \|\| !tierConfig\(sceneTier\(\)\)\.ssgiOn,\n/);
    // So dich cua pass phai nhu nhau (khoa context): albedo xin ngay sau normal, ca khi low khong dung.
    assert.match(pp, /normalTexture\.type = UnsignedByteType\n\s+scenePass\.getTexture\('diffuseColor'\)\.type = UnsignedByteType\n/);
  });

  it('shadowMap theo muc canh (luc tai); ha low giua phien: den chinh intensity 0 + dung cap nhat bong', () => {
    const index = patched('viewer/src/components/viewer/index.tsx');
    assert.match(index, /enabled: shadowsEnabled && sceneTier\(\) !== 'low',\n/);
    assert.doesNotMatch(index, /realismTier !== 'low'/);
    const lights = patched('viewer/src/components/viewer/lights.tsx');
    assert.match(lights, /if \(lowShadow\) light\.shadow\.intensity = 0\n\s+light\.shadow\.autoUpdate = !lowShadow/);
  });
});

describe('u44: thanh noi giu trong cua so ngay trong khung', () => {
  for (const file of ['floating-action-menu.tsx', 'group-floating-action-menu.tsx']) {
    it(file, () => {
      const full = path.join(PACKAGES, 'editor/src/components/editor', file);
      const out = transformRealism(readFileSync(full, 'utf8'), full);
      assert.match(out, /import \{ clampBarsAtAnchor, newBarCache \} from '@\/pascal-page\/upstream\/lib\/clamp-bar'/);
      assert.match(out, /clampBarsAtAnchor\(root, group\.position, state, .+, barCacheRef\.current\)\n\s+\}, 0\.5\)/);
    });
  }
});

describe('u45: cam giac camera', () => {
  const apply = (id) => {
    const full = path.join(PACKAGES, id);
    const raw = readFileSync(full, 'utf8');
    return transformRealism(RENDER_RULES[id] ? transformRender(raw, full) : raw, full);
  };

  it('xem truoc: bam chon zone khong con bay toi bbox, camera da luu van con', () => {
    const out = apply('editor/src/components/editor/custom-camera-controls.tsx');
    const effect = out.slice(out.indexOf('const previewTargetNodeId'), out.indexOf('const captureMode'));
    assert.match(effect, /node\.camera/);
    assert.equal((effect.match(/setLookAt/g) ?? []).length, 1);
  });

  it('wheel nghe o cha canvas, khong passive, truoc listener cua thu vien', () => {
    const out = apply('editor/src/components/editor/custom-camera-controls.tsx');
    assert.match(out, /wheelTarget\.addEventListener\('wheel', onWheel, \{ capture: true, passive: false \}\)/);
    assert.match(out, /wheelTarget\.removeEventListener\('wheel', onWheel, true\)/);
    assert.match(out, /controls\.current\.draggingSmoothTime = DRAG_SMOOTH_S/);
  });

  it('tuong het sang quay lai luoi gop, khong con danh dau ca tang', () => {
    const out = apply('nodes/src/wall/wall-batch-system.tsx');
    assert.match(out, /if \(record\) litReleasedWalls\.set\(nodeId, record\)/);
    assert.match(out, /wallsReadyToRejoin\(/);
    assert.match(out, /BATCH_SETTLE_MS &&\s+!useViewer\.getState\(\)\.cameraDragging/);
  });
});
