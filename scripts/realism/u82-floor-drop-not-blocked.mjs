/**
 * U82: món khác từ chối làm BỆ ĐỠ thì không được cấm luôn việc đặt xuống SÀN.
 *
 * NGUYÊN NHÂN GỐC (đo 16/11, `impl-tools/u1-trace.mjs` trên bản dựng có luật chẩn đoán):
 * kéo sofa `item_F-…NC0936AAHBA12NC5XC` trong phòng khách. Chuỗi gesture chạy ĐÚNG hết
 * (`pointerdown` tới selection-manager → cổng kéo thẳng mở → `engageMoveDrag` → `movingNode`
 * → 32 lượt `grid-move` → `onReleaseCommit` có việc để chốt), nhưng lượt chốt dừng ở
 * `onGridClick`: `feedback.reason = 'footprint-exceeds-host'`.
 * Nhật ký chỉ đích danh: mọi lượt rê, **một món khác** (`item_F-…NC2MQ2WC5CSOYR8W2L`,
 * `generic: false`) báo "footprint vượt bệ đỡ của tôi", trong khi chính sofa đang đặt trên
 * `surface: 'floor'`, `surfaceItemId: null`, `attachTo: null`.
 *
 * Nói cách khác: tia chuột quét qua một món có mời bệ đỡ; sofa không vừa trên nó (đương nhiên —
 * sofa 2,79 m, bàn nhỏ hơn) nên nó từ chối, và lời từ chối ấy ĐẦU ĐỘC tuyến đặt trên SÀN.
 * `createSurfaceRejectionFeedback` cố ý giữ lời từ chối qua lượt grid đi kèm
 * (`shared/surface-rejection.test.tsx`: "the paired grid cannot erase a refusal"), nên tới lúc
 * thả, `feedback.reason` vẫn còn và `onGridClick` thoát sớm.
 *
 * Đo đối chứng: đường CŨ ("Di chuyển" của menu nổi → bấm chỗ mới) trên bản dựng GỐC chưa sửa
 * cũng không dời được món ấy (`F:/runs/editor-perf2/mb-base`) → chỗ chặn nằm ở cổng hợp lệ dùng
 * chung, không phải ở nhánh kéo thẳng (u80/u81).
 *
 * SỬA: mã đã có sẵn khái niệm "để tuyến sàn giữ quyền" nhưng chỉ cho sự kiện `generic`. Thêm một
 * nhánh: khi món đang đặt trên SÀN và lý do từ chối là lý do KHÔNG VỪA
 * (`footprint-exceeds-host` / `footprint-outside-surface` / `no-surface`) thì bỏ qua — không
 * giành con trỏ, không `stopPropagation`, không ghi `feedback`.
 *
 * GIỮ NGUYÊN: `surface-cutout`, `surface-occupied`, `child-not-accepted`, `host-not-eligible`,
 * `invalid-hit` vẫn từ chối như cũ; nhánh gỡ khỏi bệ đỡ (`detachItemSurfaceToFloor`) cho
 * `item-surface`/`shelf-surface` không đổi.
 */
const FILE = 'editor/src/components/tools/item/use-placement-coordinator.tsx';

export const RULES = {
  [FILE]: [
    [
      `          if (
            generic &&
            placementState.current.surfaceItemId !== event.node.id &&
            reason !== 'surface-cutout' &&
            reason !== 'surface-occupied'
          ) {
            return
          }`,
      `          if (
            generic &&
            placementState.current.surfaceItemId !== event.node.id &&
            reason !== 'surface-cutout' &&
            reason !== 'surface-occupied'
          ) {
            return
          }
          // U82: đang đặt trên SÀN mà một món khác báo "không vừa trên tôi" — đó là lời từ chối
          // LÀM BỆ ĐỠ, không phải lời cấm đặt xuống sàn. Bỏ qua để tuyến sàn giữ quyền.
          if (
            placementState.current.surface === 'floor' &&
            (reason === 'footprint-outside-surface' ||
              reason === 'footprint-exceeds-host' ||
              reason === 'no-surface')
          ) {
            return
          }`,
    ],
  ],
};
