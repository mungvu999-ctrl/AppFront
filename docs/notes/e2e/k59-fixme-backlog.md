# K-59 — danh sách việc cho các `test.fixme` còn lại

Đợt K-59 (24/11/2026) đã xoá bài chết của Viewer3D cũ (`/3d` chuyển sang `editor3d.html` từ `29eba219`:
`viewer3d`, `v6/viewer-tool-keys`, `v8/*`, `v9/*`, khối chết trong `editor-tour*`, `pascal-viewer`) và đổi
`test.skip(true, PHONE_OUT_OF_SCOPE)` sang điều kiện theo viewport. Các `fixme` dưới đây GIỮ LẠI, chưa
sửa/xoá; mỗi dòng cần người quyết. Ba `fixme` của `v8/viewer-panels` đã đi cùng tệp bị xoá.

| Tệp | Lý do ghi trong mã | Việc cần làm |
|---|---|---|
| `e2e/pascal-fixtures.spec.ts:277` | T17 (băng cảnh báo tỉ lệ, `scaleBanner.tsx`) chưa vào | Tự bật khi tệp xuất hiện; xoá `fixme` khi T17 xong |
| `e2e/v2v3/project-settings.spec.ts:146` | V3-SET-3: phím mũi tên/Home/End trên dải thẻ | Sửa dải thẻ hoặc sửa bài |
| `e2e/v4v5/processing.spec.ts:48` | B-V4-08: mỗi màn dựng bộ mẫu riêng nên lượt tải không sang màn xử lý | Dùng bộ mẫu chung hoặc chuyển bài sang fullstack |
| `e2e/v7/floor-manager.spec.ts:71` | B-V7-21: mã tầng bộ mẫu dev không phải `LevelId` hợp lệ | Sửa bộ mẫu dev |
| `qa/tests/phase02_dashboard_edge.spec.ts:2027` | telemetry `project.open` | Quyết: sửa hay xoá |
| `qa/tests/phase02_dashboard_edge.spec.ts:3811` | wizard "Tiếp tục sửa" không focus trường nào | Quyết: sửa hay xoá |
| `qa/tests/phase02_dashboard_edge.spec.ts:3936` | SCR-06 màn cảm ứng, biểu tượng "Đánh dấu đã đọc" từ 640 px | Quyết: sửa hay xoá (liên quan phạm vi điện thoại) |
| `qa/tests/phase06_pipeline.spec.ts:563`, `phase06_versions_edge.spec.ts:282,379,671,1226`, `phase06_versions_ui.spec.ts:125,459` | UX 26/10: lịch sử phiên bản bỏ tab JSON, ô chọn so sánh, chữ chip diff cũ (`test.fixme(true, ...)`) | Viết lại theo giao diện mới hoặc xoá 7 bài |

Nhóm skip có điều kiện của `phase02/03/06/08` chưa đọc hết lý do — chưa đụng.
