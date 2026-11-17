/**
 * U82 — lời từ chối LÀM BỆ ĐỠ của một món khác không được cấm việc đặt xuống SÀN.
 *
 * Đây là kiểm CHUỖI MÃ, chỉ là bổ trợ: bằng chứng chính là kiểm hành vi bằng chuột thật
 * (`impl-tools/behaviour-drag.mjs`, kết quả ở `F:/runs/editor-perf2/b*`), vì luật này sửa một
 * nhánh điều kiện mà chỉ chạy thật mới biết có đúng chỗ không.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { RULES } from '../realism/u82-floor-drop-not-blocked.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

const FILE = 'editor/src/components/tools/item/use-placement-coordinator.tsx';

const patched = () => {
  let code = readFileSync(path.resolve('vendor/pascal/packages', FILE), 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to, times = 1] of RULES[FILE]) {
    const seen = code.split(from).length - 1;
    assert.equal(seen, times, `neo gặp ${seen} lần (cần ${times})`);
    code = code.replace(from, to);
  }
  return code;
};

describe('u82-floor-drop-not-blocked', () => {
  const code = patched();
  // `onSurfaceReject:` xuất hiện nhiều nơi trong tệp — neo vào chú thích DUY NHẤT của nhánh này.
  const at = code.indexOf('A rejected generic acquisition leaves the paired pointer');
  assert.ok(at > 0, 'không thấy nhánh onSurfaceReject cần kiểm');
  const body = code.slice(at, at + 2200);

  it('đang đặt trên sàn + lý do KHÔNG VỪA → bỏ qua, không ghi feedback', () => {
    assert.match(body, /placementState\.current\.surface === 'floor' &&\s*\(reason === 'footprint-outside-surface' \|\|\s*reason === 'footprint-exceeds-host' \|\|\s*reason === 'no-surface'\)/);
  });

  it('nhánh mới đứng SAU lối thoát `generic` và TRƯỚC khi giành con trỏ', () => {
    const generic = body.indexOf('generic &&');
    const mine = body.indexOf("placementState.current.surface === 'floor' &&");
    const claim = body.indexOf('surfaceOwnership.claim(');
    assert.ok(generic >= 0 && mine > generic, 'phải sau lối thoát generic');
    assert.ok(claim > mine, 'phải trước surfaceOwnership.claim — không giành con trỏ, không stopPropagation');
  });

  it('các lý do khác KHÔNG bị nới: cutout / đã có đồ / không nhận con / bệ không hợp lệ vẫn từ chối', () => {
    const branch = body.slice(body.indexOf("placementState.current.surface === 'floor' &&"), body.indexOf('surfaceOwnership.claim('));
    for (const r of ['surface-cutout', 'surface-occupied', 'child-not-accepted', 'host-not-eligible', 'invalid-hit']) {
      assert.ok(!branch.includes(r), `${r} không được nằm trong nhánh nới`);
    }
    assert.match(body, /feedback\.reject\(reason, event\.nativeEvent\.nativeEvent \?\? event\.nativeEvent\)/);
  });

  it('nhánh gỡ khỏi bệ đỡ (item-surface / shelf-surface) giữ nguyên', () => {
    assert.match(body, /detachItemSurfaceToFloor\(event as ItemEvent\)/);
    assert.match(body, /placementState\.current\.surface === 'item-surface' \|\|\s*placementState\.current\.surface === 'shelf-surface'/);
  });
});
