/**
 * U80 + U81 — kéo thẳng vật đang chọn. Hai luật phải đi cùng nhau, nên kiểm cùng chỗ.
 *
 * Nguyên nhân gốc đo được 16/11 (`impl-tools/u1-probe.mjs`): lớp bọc `<Html>` của menu nổi để
 * `pointerEvents: 'auto'`, hộp của nó neo ngay trên vật đang chọn và **nuốt `pointerdown`** —
 * nhật ký của `selection-manager` rỗng hoàn toàn khi nhấn-giữ trên vật đã chọn, và
 * `document.elementsFromPoint` tại tâm vật trả về `div` trước `canvas`. Sửa cổng `directDrag` (U80)
 * một mình **không đủ**: cú nhấn chưa bao giờ tới chỗ đó.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { RULES as U80 } from '../realism/u80-direct-drag.mjs';
import { RULES as U81 } from '../realism/u81-menu-clear-object.mjs';

const { describe, it } = globalThis.describe ? globalThis : await import('node:test');

const patched = (rules) => {
  const out = {};
  for (const [file, pairs] of Object.entries(rules)) {
    let code = readFileSync(path.resolve('vendor/pascal/packages', file), 'utf8').replace(/\r\n/g, '\n');
    for (const [from, to, times = 1] of pairs) {
      const seen = code.split(from).length - 1;
      assert.equal(seen, times, `neo gặp ${seen} lần (cần ${times}) trong ${file}: ${from.slice(0, 60)}…`);
      code = code.replace(from, to);
    }
    out[file] = code;
  }
  return out;
};

describe('u81-menu-clear-object', () => {
  const code = patched(U81)['editor/src/components/editor/floating-action-menu.tsx'];

  it("lớp bọc <Html> của menu KHÔNG nhận chuột (nếu không, nó nuốt cú nhấn trên chính vật)", () => {
    const html = code.slice(code.indexOf('<Html'), code.indexOf('<Html') + 600);
    assert.match(html, /pointerEvents: 'none'/);
    assert.doesNotMatch(html, /pointerEvents: 'auto'/);
  });

  it('hai phần nhận chuột vẫn tự bật lại pointer-events', () => {
    // Hàng nút nhanh trong chính tệp này…
    assert.match(code, /className="pointer-events-auto mt-1 inline-flex/);
    // …và gốc của NodeActionMenu (tệp khác, không qua luật nào).
    const menu = readFileSync(path.resolve('vendor/pascal/packages', 'editor/src/components/editor/node-action-menu.tsx'), 'utf8');
    assert.match(menu, /className="pointer-events-auto flex items-center/);
  });

  it('menu vẫn được đẩy lên khỏi vật, và chỉ khi cần', () => {
    assert.match(code, /translateY\(\$\{-liftPx\}px\) scale/);
    assert.match(code, /if \(Number\.isFinite\(needed\) && needed > 0\) liftPx = needed/);
  });
});

describe('u80-direct-drag', () => {
  const code = patched(U80)['editor/src/lib/direct-manipulation.ts'];

  it('vật đang chọn (và chỉ một vật) kéo thẳng được, không cần cờ `directDrag`', () => {
    assert.match(code, /if \(selectedIds\.length === 1 && selectedIds\[0\] === nodeId\) return true/);
  });

  it('giữ nguyên: tay nắm thắng trước, và chọn nhiều thì không kéo thẳng', () => {
    const body = code.slice(code.indexOf('export function shouldStartDirectMoveDrag'), code.indexOf('export function resolveDirectManipulationNode'));
    const handle = body.indexOf('if (handleOwnsPointer) return false');
    const mine = body.indexOf('if (selectedIds.length === 1 && selectedIds[0] === nodeId) return true');
    assert.ok(handle >= 0 && mine > handle, 'tay nắm phải được xét TRƯỚC nhánh mới');
    assert.match(body, /return allowPlainDrag && selectedIds\.length < 2/);
  });
});
