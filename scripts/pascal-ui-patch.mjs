/**
 * Vá lớp giao diện cứng của vendor Pascal LÚC DỰNG (thẻ T5 pascal-polish).
 *
 * Chỉ những chỗ CSS không đè gọn được: vendor gắn `.dark` lên khung nên biến thể
 * `dark:` luôn bật (nền tối ở chế độ sáng), hoặc lớp xuất hiện ở nhiều nơi.
 * Lớp thay vào PHẢI đã có sẵn trong style.css (Tailwind chỉ quét nguồn vendor,
 * không quét kết quả vá): bg-background, bg-card, bg-muted, border-border, hover:bg-accent.
 * Neo mất hoặc sai số lần → ném lỗi, lượt dựng hỏng (như scripts/pascal-vi.mjs).
 *
 * Bỏ qua có chủ ý (CSS đè được, không cần vá): hover:bg-white/*, bg-[#2C2C2E], bg-[#3e3e3e],
 * bg-black/5, bg-neutral-950/85 (overlay chụp ảnh, cố ý tối), viewer-stage.tsx bg-neutral-100.
 */
import path from 'node:path';

/** file → [[trước, sau, số lần xuất hiện]] */
export const UI_PATCHES = {
  // Nền khung sau canvas + khe giữa các panel: neutral-100 sáng chói ở chế độ tối.
  'editor/src/components/editor/index.tsx': [
    ['"dark relative h-full w-full overflow-hidden bg-neutral-100 text-foreground"', '"dark relative h-full w-full overflow-hidden bg-background text-foreground"', 1],
    ['"dark flex h-full w-full gap-3 bg-neutral-100 p-3 text-foreground"', '"dark flex h-full w-full gap-3 bg-background p-3 text-foreground"', 1],
  ],
  // La bàn: dark:* luôn bật nên ở chế độ sáng vẫn nền tối; chuyển sang token.
  'editor/src/components/viewer/floorplan-compass-button.tsx': [
    [
      'border border-black/10 bg-white/85 shadow-sm backdrop-blur-md transition hover:bg-white hover:shadow-md dark:border-white/10 dark:bg-neutral-900/85 dark:hover:bg-neutral-900"',
      'border border-border bg-card shadow-sm transition hover:bg-accent hover:shadow-md"',
      1,
    ],
    ['bg-[#b8b8b8] shadow-inner dark:bg-neutral-700"', 'bg-muted shadow-inner"', 1],
  ],
  // Nhãn trình đọc màn hình cho nút chỉ-biểu-tượng (chỉ thêm thuộc tính). Nhãn Mở/Thu gọn đã do pascal-vi dịch.
  'editor/src/components/ui/panels/panel-wrapper.tsx': [
    ['onClick={onBack}', 'aria-label="Quay lại" title="Quay lại" onClick={onBack}', 1],
    ['onClick={onReset}', 'aria-label="Đặt lại" title="Đặt lại" onClick={onReset}', 1],
    ['onClick={onClose}', 'aria-label="Đóng bảng" title="Đóng bảng" onClick={onClose}', 1],
  ],
  // UX-R1 K48: nút thanh dưới chỉ có hình + chữ phím, tên đọc ra là "V"/"Z"/"X". Đặt tên = nhãn (phím),
  // như tooltip; nút tự truyền aria-label (Đo) vẫn thắng vì `{...props}` đứng sau.
  'editor/src/components/ui/action-menu/action-button.tsx': [
    ['ref={ref}\n            {...props}', 'aria-label={shortcut ? `${label} (${shortcut})` : label}\n            ref={ref}\n            {...props}', 1],
  ],
  'editor/src/components/ui/floating-level-selector.tsx': [
    [
      'className="flex min-h-6 min-w-6 shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 group-focus-within/level:opacity-100 group-hover/level:opacity-100"',
      'aria-label="Tuỳ chọn tầng" className="flex min-h-6 min-w-6 shrink-0 items-center justify-center text-muted-foreground/40 opacity-0 transition-all hover:text-foreground focus-visible:opacity-100 group-focus-within/level:opacity-100 group-hover/level:opacity-100"',
      1,
    ],
    // UX-R1 K39/K46 (Codex P2): nút "+" chèn tầng nằm giữa ô (left-1/2), đè lên tên tầng. Có từ hai tầng
    // thì danh sách mở cột riêng bên trái (`data-level-gutter`); nút chèn (`data-level-insert`) đứng
    // trong cột đó — pascal-chrome.css xếp chỗ, chỉ hiện khi rê chuột/focus. Một tầng: không cột, vendor
    // cũng không vẽ nút chèn. Chỉ thêm thuộc tính: lớp Tailwind mới không có trong style.css.
    [
      'className="flex flex-col gap-0.5 rounded-xl border border-border bg-background/90 p-1 shadow-2xl backdrop-blur-md"',
      "data-level-gutter={reversedLevels.length > 1 ? '' : undefined} className=\"flex flex-col gap-0.5 rounded-xl border border-border bg-background/90 p-1 shadow-2xl backdrop-blur-md\"",
      1,
    ],
    ['onClick={() => handleInsertBetween(sortedIndex - 1)}', 'data-level-insert="" onClick={() => handleInsertBetween(sortedIndex - 1)}', 1],
    // UX-R2 K36: tầng chưa có tỷ lệ bị cầu bỏ nội dung và gắn `metadata.appfrontNotBuilt` (bridge `markNotBuilt`).
    // Dòng của nó mờ đi và có nhãn "Chưa dựng" thay vì trông như mọi tầng khác. Kiểu ở pascal-chrome.css.
    [
      'const canDeleteLevel = level.level !== 0',
      'const canDeleteLevel = level.level !== 0\n  const notBuilt = (level.metadata as Record<string, unknown> | undefined)?.appfrontNotBuilt === true',
      1,
    ],
    [
      "<div\n          className={cn(\n            'flex items-center rounded-lg transition-colors',",
      "<div\n          data-level-not-built={notBuilt ? '' : undefined}\n          className={cn(\n            'flex items-center rounded-lg transition-colors',",
      1,
    ],
    [
      '<span className="truncate">{getLevelDisplayName(level)}</span>',
      '<span className="truncate">{getLevelDisplayName(level)}</span>\n            {notBuilt && <span data-level-not-built-tag="" title="Tầng chưa có tỷ lệ nên chưa dựng trong 3D">Chưa dựng</span>}',
      1,
    ],
    // UX41 U52: tầng của dự án chưa có bản vẽ không nằm trong cảnh; cầu ghi tên vào window.__appfrontUndrawnFloors
    // (bridge UNDRAWN_FLOORS_KEY). Vẽ thêm dòng tắt, chỉ hiển thị: không là node nên không vào đường lưu.
    [
      '                })}\n              </div>\n            </SortableContext>',
      '                })}\n                {((globalThis as Record<string, unknown>).__appfrontUndrawnFloors as string[] | undefined)?.map((name) => (\n                  <div aria-disabled="true" data-level-undrawn="" key={`undrawn-${name}`}>\n                    <span className="truncate">{name}</span>\n                    <span data-level-not-built-tag="">Chưa có bản vẽ</span>\n                  </div>\n                ))}\n              </div>\n            </SortableContext>',
      1,
    ],
  ],
  // UX41 U42: nút bảng phụ trên thanh trái (Công cụ, Thư viện, "+") chỉ có biểu tượng, cây truy cập đọc ra
  // `button ""`. Đặt tên = nhãn tooltip. Khu đất/Cài đặt đã có tên qua `alt` của ảnh.
  'editor/src/components/ui/sidebar/icon-rail.tsx': [
    [
      'onClick={() => onPanelChange(panel.id)}\n            type="button"\n          >\n            <span',
      'aria-label={panel.label}\n            onClick={() => onPanelChange(panel.id)}\n            type="button"\n          >\n            <span',
      1,
    ],
  ],
  // UX41 U21: chế độ mặt bằng "Mặc định" chỉ vẽ vạch đo khi nó đang được chọn; vạch vừa đo xong không
  // được chọn nên 2D không hiện số nào. Vạch đo do người dùng tự đặt → luôn hiện trong trình sửa (như 3D);
  // bản xuất giữ nguyên.
  'editor/src/lib/floorplan/floorplan-mode.ts': [['    measurements: selected,', '    measurements: interactive,', 1]],
  // UX41 U21: nhãn số đo kiểu "outlined" là chữ trắng viền màu `measurementStroke`; bảng màu tối của
  // mặt bằng đặt màu ấy là #e2e8f0 nên chữ trắng viền gần trắng, nhòe thành một vệt. Viền xám đậm cố định
  // (#334155, như bảng màu sáng và floorplan-geometry-renderer) đọc được trên cả nền sáng lẫn tối.
  'editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx': [
    ['stroke={outlined ? palette.measurementStroke : undefined}', "stroke={outlined ? '#334155' : undefined}", 1],
  ],
  // Đợt sửa 2 H1 (C2): ở chế độ Chọn, bấm giường/ghế/tủ hay trúng tường cắt (ẩn) hoặc sàn lọt giữa chân ghế.
  // Trước khi Pascal xử lý cú bấm, hỏi src/pascal-page/upstream/lib/select-priority-install.ts (cài từ page.tsx):
  // có đồ vật đứng trước mặt chắn đầu tiên thì thay sự kiện bằng sự kiện của đồ vật. Chưa cài hook → như cũ.
  // Hàm onClick này chỉ đăng ký khi mode === 'select', nên công cụ Tường/Cửa/Sơn giữ nguyên hành vi Pascal.
  'editor/src/components/editor/selection-manager.tsx': [
    [
      "      if (activeScope.kind === 'reshaping' && activeScope.reshape === 'endpoint') return\n\n      if (dispatchSceneAction(event.node, getEventObject(event))) {",
      "      if (activeScope.kind === 'reshaping' && activeScope.reshape === 'endpoint') return\n\n      event =\n        ((globalThis as Record<string, unknown>).__appfrontPreferItemHit as\n          | ((e: NodeEvent) => NodeEvent | null)\n          | undefined)?.(event) ?? event\n\n      if (dispatchSceneAction(event.node, getEventObject(event))) {",
      1,
    ],
    // Đợt 3 nhóm D: viền sáng khi rê chuột (hover chế độ Chọn) theo cùng luật ưu tiên, để viền hiện đúng món
    // mà cú bấm sẽ chọn. Hook nhận 'hover' (vào/di trên lưới) và 'leave' (rời lưới: trả lại món đã thay để xoá
    // viền). Nghe thêm `:move` vì trên cùng một lưới (sàn, tường) món được ưu tiên đổi theo vị trí chuột; chỉ
    // ghi hoveredId khi đổi để khỏi báo store mỗi lần di chuột.
    [
      '      if (useViewer.getState().inputDragging) return\n      const node = resolveCanvasSelectionNode({\n        node: resolveSelectModeNodeTarget(event),',
      "      if (useViewer.getState().inputDragging) return\n      event =\n        ((globalThis as Record<string, unknown>).__appfrontPreferItemHit as\n          | ((e: NodeEvent, phase?: 'hover' | 'leave') => NodeEvent | null)\n          | undefined)?.(event, 'hover') ?? event\n      const node = resolveCanvasSelectionNode({\n        node: resolveSelectModeNodeTarget(event),",
      1,
    ],
    [
      '      event.stopPropagation()\n      useViewer.setState({ hoveredId: node.id })\n    }\n\n    const onLeave = (event: NodeEvent) => {\n      if (useViewer.getState().inputDragging) return\n      const nodeId = resolveCanvasSelectionNode({',
      "      event.stopPropagation()\n      if (useViewer.getState().hoveredId !== node.id) useViewer.setState({ hoveredId: node.id })\n    }\n\n    const onLeave = (event: NodeEvent) => {\n      if (useViewer.getState().inputDragging) return\n      event =\n        ((globalThis as Record<string, unknown>).__appfrontPreferItemHit as\n          | ((e: NodeEvent, phase?: 'hover' | 'leave') => NodeEvent | null)\n          | undefined)?.(event, 'leave') ?? event\n      const nodeId = resolveCanvasSelectionNode({",
      1,
    ],
    [
      '      emitter.on(`${type}:enter` as any, onEnter as any)\n      emitter.on(`${type}:leave` as any, onLeave as any)\n      emitter.on(`${type}:double-click` as any, onDoubleClick as any)',
      '      emitter.on(`${type}:enter` as any, onEnter as any)\n      emitter.on(`${type}:move` as any, onEnter as any)\n      emitter.on(`${type}:leave` as any, onLeave as any)\n      emitter.on(`${type}:double-click` as any, onDoubleClick as any)',
      1,
    ],
    [
      '        emitter.off(`${type}:enter` as any, onEnter as any)\n        emitter.off(`${type}:leave` as any, onLeave as any)\n        emitter.off(`${type}:double-click` as any, onDoubleClick as any)',
      '        emitter.off(`${type}:enter` as any, onEnter as any)\n        emitter.off(`${type}:move` as any, onEnter as any)\n        emitter.off(`${type}:leave` as any, onLeave as any)\n        emitter.off(`${type}:double-click` as any, onDoubleClick as any)',
      1,
    ],
  ],
};

export function applyUiPatches(code, file, pairs) {
  let out = code;
  for (const [from, to, times] of pairs) {
    const n = out.split(from).length - 1;
    if (n !== times) {
      throw new Error(`pascal-ui-patch: chuỗi ${JSON.stringify(from)} trong ${file} xuất hiện ${n} lần, cần ${times} — upstream đã đổi, cập nhật scripts/pascal-ui-patch.mjs`);
    }
    out = out.split(from).join(to);
  }
  return out;
}

export function pascalUiPatch({ packagesDir, patches = UI_PATCHES } = {}) {
  const root = path.resolve(packagesDir);
  const seen = new Set();
  return {
    name: 'pascal-ui-patch',
    enforce: 'pre',
    transform(code, id) {
      const file = path.relative(root, id.split('?')[0]).split(path.sep).join('/');
      const pairs = patches[file];
      if (!pairs) return null;
      seen.add(file);
      return { code: applyUiPatches(code, file, pairs), map: null };
    },
    buildEnd(error) {
      if (error) return;
      const missing = Object.keys(patches).filter((f) => !seen.has(f));
      if (missing.length) throw new Error(`pascal-ui-patch: tệp không được dựng tới: ${missing.join(', ')}`);
    },
  };
}
