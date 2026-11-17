/**
 * U83 — vien "re chuot" tat trong luc dang keo mot vat, khong chi khi xoay camera.
 *
 * Kiem CHUOI MA, bo tro. Bang chung chinh la so do: `impl-tools/item-drag-passes.mjs`, 4 luot moi ben
 * tren canh 21 tuong (F:/runs/editor-perf2/id-*): 36,65 -> 28,9 pass moi khung va 115,5 -> 85 khung
 * cham hon 33 ms, hai dai khong phu nhau.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { RULES } from '../realism/u83-hover-outline-off-while-dragging.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

const FILE = 'viewer/src/components/viewer/post-processing.tsx';

const patched = () => {
  let code = readFileSync(path.resolve('vendor/pascal/packages', FILE), 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to, times = 1] of RULES[FILE]) {
    const seen = code.split(from).length - 1;
    assert.equal(seen, times, `neo gap ${seen} lan (can ${times})`);
    code = code.replace(from, to);
  }
  return code;
};

describe('u83-hover-outline-off-while-dragging', () => {
  const code = patched();
  const at = code.indexOf('Hover outline is noise while orbiting');
  assert.ok(at > 0, 'khong thay nhanh suppressSecondary');
  const body = code.slice(at, at + 900);

  it('tat vien re chuot khi xoay camera HOAC khi dang keo vat', () => {
    assert.match(body, /suppressSecondary\s*=\s*\n?\s*viewerState\.cameraDragging \|\| viewerState\.inputDragging/);
  });

  it('van nam trong cong `!HOVER_DURING_DRAG` (co `?disable=hoverdrag` khoi phuc hanh vi cu)', () => {
    const gate = body.indexOf('!HOVER_DURING_DRAG');
    const assign = body.indexOf('suppressSecondary');
    assert.ok(gate > 0 && gate < assign, 'phep gan phai nam trong cong HOVER_DURING_DRAG');
  });

  it('khong dung toi nhom A (vien cua vat dang chon)', () => {
    assert.ok(!/suppressPrimary|primaryObjects\s*=/.test(body), 'khong duoc cham vao nhom dang chon');
  });

  it('doc store mot lan, khong goi getState() hai lan trong mot khung', () => {
    const calls = body.split('useViewer.getState()').length - 1;
    assert.equal(calls, 1, `goi getState() ${calls} lan trong nhanh nay`);
  });
});
