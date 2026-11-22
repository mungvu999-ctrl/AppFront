/**
 * U83 — viền "rê chuột" tắt trong lúc đang kéo một vật, không chỉ khi xoay camera.
 *
 * Kiểm CHUỖI MÃ, bổ trợ. Bằng chứng chính là số đo: `impl-tools/item-drag-passes.mjs`, 4 lượt mỗi bên
 * trên cảnh 21 tường (F:/runs/editor-perf2/id-*): 36,65 → 28,9 pass mỗi khung và 115,5 → 85 khung
 * chậm hơn 33 ms, hai dải không phủ nhau.
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
    assert.equal(seen, times, `neo gặp ${seen} lần (cần ${times})`);
    code = code.replace(from, to);
  }
  return code;
};

describe('u83-hover-outline-off-while-dragging', () => {
  const code = patched();
  const at = code.indexOf('Hover outline is noise while orbiting');
  assert.ok(at > 0, 'không thấy nhánh suppressSecondary');
  const body = code.slice(at, at + 900);

  it('tắt viền rê chuột khi xoay camera HOẶC khi đang kéo vật', () => {
    assert.match(body, /suppressSecondary\s*=\s*\n?\s*viewerState\.cameraDragging \|\| viewerState\.inputDragging/);
  });

  it('vẫn nằm trong cổng `!HOVER_DURING_DRAG` (cờ `?disable=hoverdrag` khôi phục hành vi cũ)', () => {
    const gate = body.indexOf('!HOVER_DURING_DRAG');
    const assign = body.indexOf('suppressSecondary');
    assert.ok(gate > 0 && gate < assign, 'phép gán phải nằm trong cổng HOVER_DURING_DRAG');
  });

  it('không đụng tới nhóm A (viền của vật đang chọn)', () => {
    assert.ok(!/suppressPrimary|primaryObjects\s*=/.test(body), 'không được chạm vào nhóm đang chọn');
  });

  it('đọc store một lần, không gọi getState() hai lần trong một khung', () => {
    const calls = body.split('useViewer.getState()').length - 1;
    assert.equal(calls, 1, `gọi getState() ${calls} lần trong nhánh này`);
  });
});
