# Mã Pascal trong repo này

`packages/{core,viewer,editor,nodes}` chép từ upstream
`https://github.com/pascalorg/editor`, commit
`cd14090ef4d147a5de59aa4a100eab208f26e1da`, giấy phép **MIT** (`LICENSE` cạnh tệp này — phải giữ nguyên).
Không chép `node_modules/`, `dist/`, `.turbo/`, `tsconfig.tsbuildinfo`.

Bản chép **đã có sửa đổi của AppFront**, xem `git log -- vendor/pascal/packages`. Nâng phiên bản không còn là
chép đè cả thư mục: phải gộp lại các sửa đổi đó.

Tự host tài nguyên làm bằng `scripts/pascal-self-host.mjs` + `pascal-catalog-local.mjs` lúc build, không sửa `packages/`.

Mã riêng của AppFront nằm ở `src/` (trang 3D: `src/pascal-page/`, cầu dữ liệu: `src/lib/pascal/`),
nối vào Pascal qua alias của `vite.pascal.config.ts` (trỏ lối vào `dist/` về `src/`) và `pnpm.overrides`
(nối phụ thuộc nội bộ kiểu bun về workspace). Phần còn lại ở đây là của AppFront:
`shims/` (thay `next/image`, `next/link`), `assets/` (tài sản tự host, chép bằng
`scripts/copy-pascal-assets.mjs`; `assets/audios` từ `apps/editor/public/audios`), `scripts/`, `tooling/`.

## Tài sản của Pascal (không thuộc giấy phép MIT của mã)

`LICENSE` ở đây (MIT, Pascal Group Inc.) chỉ nói về **mã**. Tài sản dưới `vendor/pascal/assets/` không có giấy phép
riêng trong repo này, và trang `pascalorg/editor` cũng không nêu giấy phép cho mô hình/âm thanh/vật liệu (chỉ có
CC BY 4.0 cho video demo, không liên quan). Tình trạng **CHƯA XÁC ĐỊNH** — chỉ dùng cho đồ án, không coi là đã được cấp
quyền thương mại. Kiểm kê 22/11/2026:

| Thư mục | Nội dung | Nguồn / giấy phép |
|---|---|---|
| `assets/items/` | 100 thư mục (`model.glb` + `thumbnail.webp`, 200 tệp, ~2,4 MB) | chép 14/10/2026 (`ee93939c`, QA-05c) từ bucket supabase của Pascal qua `F:/pascal-editor`; giấy phép CHƯA XÁC ĐỊNH |
| `assets/material/` | 293 tệp (concrete, fabric, flooring, leather, metal, roofing, …; ~18 MB) | chưa lần nguồn; CHƯA XÁC ĐỊNH |
| `assets/audios/sfx/` | 25 tệp âm thanh | chưa lần nguồn; CHƯA XÁC ĐỊNH |
| `assets/hdri/venice_sunset_1k.hdr` | 1 HDRI | chưa lần nguồn; CHƯA XÁC ĐỊNH |
| `assets/fonts/` | `PlusJakartaSans-SemiBold.ttf`, `geist-regular.ttf` | phông có giấy phép riêng của tác giả (chưa đối chiếu); CHƯA XÁC ĐỊNH ở đây |
| `assets/icons/` (84 tệp), `cursor.svg` | biểu tượng | chưa lần nguồn |

Việc cần người làm (ngoài tài liệu): mở issue/gửi thư cho `pascalorg/editor` hỏi giấy phép tài sản và ghi câu trả lời
vào đây; hoặc thay bằng tài sản đã rõ giấy phép (`assets/appfront-items/LICENSES.md`) trước bản thương mại.
Ghi công Pascal trong màn "Giới thiệu"/chân trang: chưa kiểm (không thuộc lượt này).

## Chậm so với upstream

Bản chép ở `cd14090e`; so với `main` của upstream ngày 22/11/2026: **604 commit** phía trước (so sánh qua API GitHub).
Không nâng cả khối vì bản chép đã có sửa đổi của AppFront. Lọc tiêu đề 604 commit theo
`security|CVE|xss|vulnerab|sanitiz|injection|csrf|ssrf|audit|dependabot|license` thấy 5 commit liên quan bảo mật, đều là
nâng phụ thuộc/công cụ của upstream (chưa kiểm tệp từng commit có chạm `packages/{core,viewer,editor,nodes}` hay không):

| SHA | Ngày | Tiêu đề |
|---|---|---|
| `ee9adf1e` | 21/10 | `[Deps] mcp: MCP SDK 2.3.1 and @hono/node-server 1.19.17 (security) (#1119)` |
| `278ee533` | 21/10 | `Pin self-host runtime image to node:22.23.4-alpine (Oct 2026 security release) (#1121)` |
| `b1a29ed6` | 22/10 | `Bump Bun to 1.4.4 (security fixes) (#1124)` |
| `e0894b1c` | 24/10 | `Bump fast-uri to 3.1.9 for security advisories (#1139)` |
| `bf9743df` | 25/10 | `Refresh transitive deps for security advisories, bump Biome to 2.6.3 and hono to 4.13.14 (#1140)` |

Lọc theo tiêu đề không bắt được bản vá không ghi chữ khoá; đây là danh sách để người duyệt xem, không phải bằng chứng
"không có lỗ hổng". Không cập nhật vendor trong lượt này.
