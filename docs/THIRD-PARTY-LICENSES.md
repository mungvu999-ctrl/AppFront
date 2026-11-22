# Giấy phép thành phần bên thứ ba — AppFront

Bảng tóm tắt tài sản và mã vendor của frontend. Dự án là **đồ án phi thương mại**; đây là tóm tắt điều khoản công bố,
**không phải ý kiến pháp lý** — trước khi bán hoặc cho thuê dịch vụ cần tư vấn pháp lý và xử lý các dòng
"CHƯA XÁC ĐỊNH". Phần mô hình ML/dữ liệu huấn luyện: `docs/legal/THIRD-PARTY-LICENSES.md` trong repo AppBack.

Mỗi thư mục tài sản có tệp giấy phép riêng, là nguồn chi tiết; bảng này chỉ trỏ tới chúng. Kiểm lần cuối: 22/11/2026.

| Thành phần | Giấy phép | Nguồn điều khoản | Thương mại |
|---|---|---|---|
| Mã Pascal editor (`vendor/pascal/packages/*`; chép từ `pascalorg/editor` @`cd14090e`, có sửa đổi của AppFront) | MIT, bản quyền Pascal Group Inc. | `vendor/pascal/LICENSE`, `vendor/pascal/NGUON.md` | Có (giữ nguyên thông báo bản quyền) |
| 100 mẫu nội thất GLB + ảnh thu nhỏ của Pascal (`vendor/pascal/assets/items/*`) | **CHƯA XÁC ĐỊNH** — chép từ bucket supabase của Pascal; `LICENSE` MIT chỉ nói về mã; repo upstream không có giấy phép riêng cho tài sản | `vendor/pascal/NGUON.md` (mục "Tài sản của Pascal") | **CHƯA XÁC ĐỊNH** (chỉ dùng cho đồ án) |
| Âm thanh, phông, HDRI, vật liệu, biểu tượng trong `vendor/pascal/assets/` | CHƯA XÁC ĐỊNH (chưa lần nguồn từng tệp) | `vendor/pascal/NGUON.md` | CHƯA XÁC ĐỊNH |
| Bộ giải Basis (`vendor/basis/`) | giấy phép của `three@0.186.0`/Basis (kèm `LICENSE`, `LICENSE.zstd`) | `vendor/basis/NGUON.md`, `vendor/basis/LICENSE*` | Có (giữ thông báo) |
| Đồ nội thất bổ sung (`assets/appfront-items/`) | trộn: sinh bằng mã (mã dự án), Poly Haven CC0 1.0, **Sketchfab CC BY 4.0 (bắt buộc ghi công)** | `assets/appfront-items/LICENSES.md` | Có; CC BY phải ghi công (đã có thẻ ghi công trong thư viện) |
| HDRI tự host (`assets/hdri/`) | CC0 1.0 (Poly Haven) | `assets/hdri/LICENSE.md` | Có |
| Ảnh vật liệu thêm (`vendor-extra/materials/`) | CC0 1.0 (Poly Haven) | `vendor-extra/materials/LICENSE.md` | Có |
| Trang chủ `public/landing/` (texture, HDRI, phông) | CC0 1.0 (Poly Haven), phông SIL OFL 1.1 | `public/landing/LICENSES.md` | Có |
| Trang chủ `public/landing-lab/cinema/` | CC0 1.0 (Poly Haven) | `public/landing-lab/cinema/LICENSES.md` | Có |
| Trang chủ `public/landing-lab/maquette/` | CC0 1.0 (Poly Haven) + thủ tục (tự làm) | `public/landing-lab/maquette/LICENSES.md` | Có |
| Trang chủ `public/landing-lab/blueprint/` | SIL OFL 1.1 (phông), CC0 1.0 (ambientCG) | `public/landing-lab/blueprint/LICENSES.md` | Có |
| Trang chủ `public/landing-lab/combo/` (3 529 khung hình render) | **CHƯA XÁC ĐỊNH nguồn từng tài sản** | `public/landing-lab/combo/LICENSES.md` (nhánh K-46) | CHƯA XÁC ĐỊNH |
| Trang chủ `public/landing-lab/live/` (`house.glb`, `pano.webp`) | CHƯA XÁC ĐỊNH (chưa có `LICENSES.md`) | — | CHƯA XÁC ĐỊNH |
| Mã AppFront | Chưa có `LICENSE` ở gốc (mặc định giữ mọi quyền); dự thảo đang chờ chủ dự án duyệt (L6-N03) | — | — |

Các thư viện npm (React, Vite, three, …) theo giấy phép riêng của từng gói; danh sách ở `pnpm-lock.yaml`.
