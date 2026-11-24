# RULE.md — Bộ quy tắc viết mã của AppFront

Tài liệu này viết cho agent đọc trước khi sửa mã. Mỗi luật nêu **cách kiểm** cụ thể;
luật nào không kiểm được thì không có trong đây.

Bộ luật này được rút ra bằng cách đo mã nguồn hiện có (503 file, 112.037 dòng trong
`src/`), không chép từ bộ chuẩn ngoài. Mỗi luật dẫn ít nhất một trong ba loại bằng
chứng: mã đang làm như vậy, mã đang làm không nhất quán (kèm số đếm hai phía), hoặc
cấu hình dự án đã ép buộc.

**Ba mức:**

| Mức | Nghĩa |
|---|---|
| BẮT BUỘC | Chặn merge. Có đường thực thi tự động hoặc lệnh kiểm chạy được. |
| NÊN | Nhắc khi review. Vi phạm phải giải thích được. |
| KHUYẾN NGHỊ | Không chặn. Chỉ dấu để soi kỹ hơn. |

**Nguồn thực thi đã có sẵn:** `eslint-rules/configs/project.js` (bảy luật nội bộ +
ranh giới import + sổ nợ), `vitest.config.ts` (ngưỡng độ phủ theo tầng),
`scripts/verify.mjs` (bảy cổng tuần tự), `.github/workflows/ci.yml`.

---

## A. Ranh giới tầng và đường dẫn import

### R-01 — `src/lib/**` không được import React, store, hooks, components hay screens.
- **Vì sao:** `lib` là tầng thuần, được test không cần DOM và được dùng lại ở worker. Một import React ở đây biến toàn bộ tầng thành thứ chỉ chạy được trong trình duyệt.
- **Đúng:** `src/lib/http/platform.ts` — nhận transport từ nền tảng, không biết gì về React:
  ```ts
  export function getPlatformFetch(): typeof fetch | null {
    if (typeof globalThis.fetch !== 'function') return null;
    return globalThis.fetch.bind(globalThis);
  }
  ```
- **Sai:** chưa có vi phạm trong repo (0/212 file).
- **Kiểm bằng:** `no-restricted-imports`, khai tại `eslint-rules/configs/project.js:94-110`.
- **Mức:** BẮT BUỘC

### R-02 — `src/hooks/**` không import components/screens; `src/components/**` không import screens.
- **Vì sao:** Tầng dưới import tầng trên tạo vòng phụ thuộc và khiến một component không thể dùng lại ở màn khác.
- **Đúng:** toàn bộ 55 file trong `src/hooks/` — 0 import ngược chiều.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `no-restricted-imports`, `eslint-rules/configs/project.js:77-84`.
- **Mức:** BẮT BUỘC

### R-03 — `src/types/**` không import gì bên ngoài.
- **Vì sao:** Khai báo kiểu phải nạp được ở bất kỳ đâu mà không kéo theo mã chạy.
- **Đúng:** `src/types/spatial.ts`, `src/types/project.ts`, `src/types/pipeline.ts` — không file nào có import.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `no-restricted-imports`, `eslint-rules/configs/project.js:143-156`.
- **Mức:** BẮT BUỘC

### R-04 — Import xuyên thư mục dùng alias `@/`; `./` chỉ dùng trong cùng thư mục.
- **Vì sao:** Hiện có 483 import dùng `@/` và 645 dùng `../` (216 trong đó là `../../` trở lên). Hai kiểu lẫn nhau khiến tìm "ai đang dùng module này" phải grep hai lần, và mọi chuỗi `../../` phải sửa tay mỗi lần di chuyển thư mục.
- **Đúng:** `src/components/canvas/materialMap.ts` — dùng `@/lib/...`.
- **Sai:** `src/components/shell/StatusBar.tsx:2`
  ```ts
  import { Z_INDEX } from '../../lib/zIndex';
  // phải là: import { Z_INDEX } from '@/lib/zIndex';
  ```
- **Kiểm bằng:** `eslint-plugin-no-relative-import-paths` — luật `no-relative-import-paths/no-relative-import-paths` với `{ allowSameFolder: true, rootDir: 'src', prefix: '@' }`. **Đây là plugin có bộ sửa tự động.** `import/no-relative-parent-imports` KHÔNG có fixer; đừng cài nhầm, 645 dòng sẽ phải sửa tay.
- **Mức:** NÊN (xem lộ trình bật dần trong `BAO_CAO_DO_LECH.md`)

### R-05 — Không tạo import vòng.
- **Vì sao:** Một trong hai module trong vòng sẽ nhận `undefined` lúc nạp, và triệu chứng hiện ra ở chỗ khác hẳn nguyên nhân. `src/lib` có 212 file / 62.372 dòng — chỗ dễ sinh vòng nhất, và ranh giới tầng không ngăn được vòng *bên trong* một tầng.
- **Đúng:** toàn bộ `src/` — 0 vòng, đo 2026-08-21.
- **Sai:** chưa có vi phạm trong repo — đo 2026-08-21, `import/no-cycle` báo 0. Cổng `pnpm cycles` giữ nguyên con số đó.
- **Kiểm bằng:** `pnpm cycles` (`scripts/check-import-cycles.mjs`), chạy như **bước thứ ba của `pnpm verify`** và trong job `lint` của CI. **Cố ý KHÔNG bật trong `.eslintrc.cjs`**: luật phải dựng đồ thị phụ thuộc của hơn 500 file nên nó làm hỏng vòng lặp sửa-lint lúc phát triển.
- **BẪY, đã dính một lần:** `eslint-plugin-import` mặc định dùng resolver của Node, mà resolver đó không biết `.ts`, `.tsx` hay alias `@/`. Thiếu `settings['import/resolver']` VÀ `settings['import/parsers']` trong `.eslintrc.cjs` thì luật thấy một đồ thị RỖNG và báo "không có vấn đề gì" — một cổng xanh vô điều kiện. Thử bằng một vòng cố ý trước khi tin nó.
- **Mức:** BẮT BUỘC

---

## B. Mạng, hằng số và dữ liệu máy chủ

### R-06 — Mọi truy cập mạng đi qua `src/lib/http`.
- **Vì sao:** Đó là nơi duy nhất có timeout, retry, single-flight và hình dạng lỗi mà phần còn lại của ứng dụng đọc được. Ba adapter từng tự với tay lên `globalThis.fetch`; ba bản sao của cùng một quyết định, không chỗ nào biết chỗ nào.
- **Đúng:** `src/lib/http/platform.ts:32-38` là chỗ *tra cứu* transport duy nhất; `src/lib/auth/refresh.ts` nhận transport từ đó.
- **Sai:** chưa có vi phạm trong repo — sổ nợ của luật này **đã trả hết và bị xoá** (`eslint-rules/configs/project.js:175-181`). Đừng dựng lại nó.
- **Kiểm bằng:** `local/no-fetch-outside-http`.
- **Mức:** BẮT BUỘC

### R-07 — Đường dẫn API khai trong `src/api/endpoints.ts`, không viết chuỗi tại chỗ gọi.
- **Vì sao:** Đổi một đường dẫn ở máy chủ thì chỉ sửa một file. Chuỗi rải rác là loại lỗi chỉ lộ ra lúc chạy.
- **Đúng:** `src/api/endpoints.ts:26-32`
  ```ts
  export const ENDPOINTS = {
    projects: {
      read: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}`,
      update: (projectId: string): string => `${PROJECTS_ROOT}/${projectId}`,
    },
  } as const;
  ```
- **Sai:** chưa có vi phạm trong repo (0 chuỗi `/api/` rải rác ngoài 2 file hạ tầng).
- **Kiểm bằng:** `rg "['\"\`]/(projects|floors|drawings|feature-flags)" src --glob '!src/api/endpoints.ts'`
- **Mức:** BẮT BUỘC

### R-08 — Dữ liệu từ ngoài phải qua schema `zod` trước khi vào ứng dụng.
- **Vì sao:** Kiểu TypeScript biến mất lúc chạy. Không kiểm thì một trường thiếu ở máy chủ thành `undefined` chạy sâu vào tận tầng vẽ mới nổ.
- **Đúng:** `src/api/schemas/decode.ts` (228 dòng) + `src/api/schemas/index.ts` (181 dòng); `src/lib/auth/refresh.ts`, `src/lib/telemetry/events.ts`, `src/lib/export/shareLink.ts` đều decode bằng zod.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** soi tay khi review — mọi hàm trả dữ liệu từ `lib/http` phải đi qua một `decode*`.
- **Mức:** NÊN

### R-09 — Trạng thái máy chủ đi qua `src/lib/query` và `src/lib/mutations`, không tự viết `isLoading`/`error` bằng tay.
- **Vì sao:** `lib/query` (5 file) và `lib/mutations` (8 file) là tầng logic đã hoàn thành theo kế hoạch, có test và tính vào ngưỡng độ phủ 80% của `src/lib`. Chưa màn nào gọi tới vì chưa có màn thật nào được dựng — `App.tsx` là bảng chọn demo, `routes.tsx` chưa được gắn. Màn thật đầu tiên phải cắm vào tầng đó chứ không dựng lại nó lần nữa.
- **Đúng:** `src/lib/query/queryClient.ts`, `src/lib/query/queryKeys.ts`, `src/lib/mutations/createOptimisticMutation.ts`.
- **Sai:** `src/hooks/useShareLinks.ts:314-338` — tự viết `isLoading`, `errorMessage` và cờ `cancelled`. **Đây là ngoại lệ đi trước, không phải khuôn mẫu để chép.**
  ```ts
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    void listShareLinks(gateway, { projectId }).then((result) => {
      if (cancelled) return;
      if (result.ok) { setLinks(result.data.links); setErrorMessage(null); }
      else { setLinks([]); setErrorMessage(result.error.message); }
      setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [gateway, projectId, reloadCount]);
  ```
- **Kiểm bằng:** soi tay khi review. Dấu hiệu: `useState` tên `isLoading`/`error` đứng cạnh một lời gọi mạng trong cùng hook.
- **Mức:** NÊN

### R-10 — Khoá `localStorage`/`sessionStorage` khai thành hằng số xuất khẩu, không viết chuỗi tại chỗ.
- **Vì sao:** Khoá viết thẳng thì đọc và ghi ở hai chỗ khác nhau có thể lệch nhau một ký tự mà không ai biết, và không grep ra được cái gì đang chiếm chỗ trong storage của người dùng.
- **Đúng:** `src/store/index.ts:26`
  ```ts
  export const PERSIST_STORAGE_KEY = 'appfront-view-ui';
  ```
- **Sai:** chưa có vi phạm trong repo. Hai khoá của AppShell nay là hằng số xuất khẩu trong chính module sở hữu chúng.
- **Kiểm bằng:** `rg "(local|session)Storage\.(get|set|remove)Item\('" src`
- **Mức:** NÊN

### R-11 — Số có ý nghĩa nghiệp vụ phải là hằng số có tên kèm đơn vị.
- **Vì sao:** `700` không nói gì; `AMBIENT_LOOP_MS` nói được cả giá trị lẫn đơn vị lẫn ý đồ. Repo đã đi theo hướng này ở mọi tầng.
- **Đúng:** `MOTION_DURATIONS_MS`, `AMBIENT_LOOP_MS` (`src/lib/motion/tokens.ts`), `MS_PER_DAY` (`src/hooks/useShareLinks.ts`), `MILLIMETRES_PER_METRE` và `DEFAULT_ROUNDING_STEP` (`src/domain/units/types.ts:57,147`), `DOMAIN_THRESHOLD` (`vitest.config.ts:18`).
- **Sai:** `src/screens/ListReviewDemo.tsx:19` — `thickness: 220` viết thẳng, trùng với token `wall.220` nhưng không tham chiếu tới nó.
- **Kiểm bằng:** `local/no-raw-number` cho tầng view; ngoài tầng view thì soi tay.
- **Mức:** NÊN

---

## C. Kiểu dữ liệu TypeScript

### R-12 — Dùng `interface` cho hình dạng đối tượng; dùng `type` cho union, tuple và kiểu nhãn.
- **Vì sao:** Trộn lẫn không theo quy tắc nào. Chọn `interface` cho hình-dạng-thuần vì luật ESLint tương ứng chỉ chạm đúng nhóm đó — kiểu nhãn như `Quantity<'mm'>` nằm ngoài tầm luật và không bị đụng tới.
- **CẢNH BÁO VỀ CÁCH ĐẾM:** trường này từng ghi "445 chỗ vi phạm". 445 là số **mọi** type alias trong `src`; union, tuple và kiểu nhãn dùng `type` là **đúng theo chính luật này**. Đếm như vậy là đếm cả phía đúng. Số vi phạm thật lúc đo là 7.
- **Đúng:** `src/components/ui/Button.tsx:5`
  ```ts
  export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
  ```
  và `src/domain/units/types.ts:34` giữ nguyên vì là kiểu nhãn:
  ```ts
  export type Millimetres = Quantity<'mm'>;
  ```
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `@typescript-eslint/consistent-type-definitions: ['error', 'interface']` — có bộ sửa tự động, đã bật ở `eslint-rules/configs/project.js`.
- **Mức:** BẮT BUỘC

### R-13 — Hàm xuất khẩu phải khai kiểu trả về.
- **Vì sao:** 93,5% hàm xuất khẩu đã làm vậy (630/674). Kiểu suy ra được thì đổi lặng lẽ khi thân hàm đổi; kiểu khai ra thì lỗi hiện ngay tại chỗ sửa chứ không ở chỗ gọi.
- **Đúng:** `src/api/endpoints.ts:8`
  ```ts
  chunk: (projectId: string, uploadId: string): string =>
    `${PROJECTS_ROOT}/${projectId}${DRAWINGS_ROOT}/uploads/${uploadId}/chunks`,
  ```
- **Sai:** chưa có vi phạm trong repo trong `src/lib/**` và `src/domain/**`. Ngoài hai tầng đó luật cố ý không chạy — xem **Mức**.
- **Kiểm bằng:** `@typescript-eslint/explicit-module-boundary-types`, bật ở mức `error` trong `eslint-rules/configs/project.js` **chỉ cho `src/lib/**` và `src/domain/**`, trừ test**.
- **Mức:** BẮT BUỘC *trong hai tầng đó*. Tầng giao diện cố ý không bật: hàm component trả `JSX.Element`, khai ra thêm rất ít thông tin mà thêm nhiều nhiễu.

### R-14 — Nhập kiểu bằng `import type`.
- **Vì sao:** `isolatedModules: true` đang bật (`tsconfig.json:14`). Import kiểu không đánh dấu có thể còn lại trong bundle như một phụ thuộc chạy thật.
- **Đúng:** 604 chỗ đang làm đúng, ví dụ `.storybook/main.ts:1` và `tailwind.config.ts:1`.
- **Sai:** chưa có vi phạm trong repo.
- **CẢNH BÁO VỀ CÁCH ĐẾM:** trường này từng ghi "chưa tìm thấy vi phạm rõ ràng". Kết luận
  đó rút ra từ một phép `rg "import type"` — phép đo ấy **chỉ nhìn thấy phía ĐÚNG**. Vi
  phạm của R-14 là chỗ **thiếu** `import type`, và không mẫu grep nào phân biệt được
  `import { Foo }` nhập kiểu với `import { foo }` nhập giá trị: phải phân giải kiểu mới
  biết. Grep KHÔNG thay thế được luật ở đây.
- **Kiểm bằng:** `@typescript-eslint/consistent-type-imports` — có bộ sửa tự động, đã bật ở `eslint-rules/configs/project.js`. Chỉ luật này phát hiện được; đừng thay bằng grep.
- **Mức:** BẮT BUỘC

### R-15 — Không dùng `any`.
- **Vì sao:** `tsconfig.json` bật `strict`, `noUncheckedIndexedAccess` và `exactOptionalPropertyTypes` — ba mức chặt hơn mặc định. Một `any` xoá sạch cả ba trên đường nó đi qua.
- **Đúng:** 486/503 file không có `any` nào.
- **Sai:** **14 chỗ / 12 file**, toàn bộ nằm trong `.stories.tsx` — `any` chỉ ở `args`, nơi
  `Meta<typeof X>` đòi đủ props mà story lại dựng cây riêng trong `render`. Không chỗ nào vào
  bản dựng sản phẩm. Đây là món nợ đã ghi ở mục 3 của `BAO_CAO_DO_LECH.md`; trả nó khi viết
  được một type helper cho `args`. Ngoài file story: **chưa có vi phạm trong repo**.
- **Kiểm bằng:** `@typescript-eslint/no-explicit-any` (đã bật qua preset; `pnpm lint --max-warnings 0` biến cảnh báo thành lỗi).
- **Mức:** BẮT BUỘC

### R-16 — Không thêm dòng mới vào sổ nợ ESLint.
- **Vì sao:** Sổ nợ ở `eslint-rules/configs/project.js:158-174` chỉ được ngắn đi. Thêm một dòng vào đó là quyết định của người duyệt, không phải của người đang vội. Hiện có đúng 4 file được miễn `local/no-raw-number`.
- **Đúng:** sổ nợ của `local/no-fetch-outside-http` đã trả hết và bị xoá (`project.js:175-181`).
- **Sai:** chưa có vi phạm — nhưng đây là luật về quy trình, vi phạm chỉ hiện ra trong diff.
- **Kiểm bằng:** `git diff master -- eslint-rules/configs/project.js` — mọi dòng thêm vào khối `-- 3. SỔ NỢ` phải bị hỏi.
- **Mức:** BẮT BUỘC

### R-17 — Mỗi `eslint-disable` phải ghi lý do sau `--`.
- **Vì sao:** 31 chỗ tắt luật, chỉ 2 có lý do. 29 chỗ còn lại không ai biết còn cần thiết không, nên không ai dám xoá.
- **Đúng:** `src/components/feedback/ScreenErrorBoundary.tsx:93`
  ```ts
  // eslint-disable-next-line local/no-direct-set -- React's own component state,
  // not the zustand store; invariant A10 is about commit(patch, label).
  ```
- **Sai:** chưa có vi phạm trong repo — cả 30 chỗ tắt luật đều đã ghi lý do sau `--`.
- **Kiểm bằng:** `rg "eslint-disable" src | rg -v " -- "`
- **Mức:** NÊN

---

## D. Component React

### R-18 — Khai component bằng `export function`; chỉ dùng `const` khi `forwardRef` hoặc `memo` bắt buộc.
- **Vì sao:** Trong số các component được tự do chọn cách khai, 43/45 (95,6%) dùng `export function`. Hai kiểu lẫn nhau không đem lại gì ngoài việc người đọc phải quét cả hai dạng khi tìm.
- **Đúng:** `src/components/shell/StatusBar.tsx:26`
  ```tsx
  export function StatusBar({ x, y, scaleRatio, scaleDensity, saveText }: StatusBarProps) {
  ```
  Ngoại lệ hợp lệ — `src/components/ui/Button.tsx:20`:
  ```tsx
  export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ```
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `rg "^export const [A-Z]\w+ = \(" src --glob '*.tsx'` — mỗi kết quả phải giải thích được vì sao không dùng `function`.
- **Mức:** NÊN

### R-19 — Xuất component bằng tên, không xuất mặc định.
- **Vì sao:** 67 xuất có tên / 2 xuất mặc định. Xuất mặc định cho phép mỗi nơi import đặt một tên khác nhau, làm hỏng việc grep và việc đổi tên tự động. Ngoại lệ duy nhất là `export default meta` mà Storybook bắt buộc.
- **Đúng:** `src/screens/DataEntryDemo.tsx` — `export const DataEntryDemo`.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `rg "^export default" src --glob '*.tsx' --glob '!*.stories.tsx'`
- **Mức:** NÊN

### R-20 — File xuất component đặt tên PascalCase; mọi file khác camelCase.
- **Vì sao:** 502/503 file đã theo quy ước này. Nhìn tên file là biết bên trong có component hay không, không cần mở.
- **Đúng:** `src/components/ui/Button.tsx`, `src/hooks/useAppShell.ts`, `src/lib/http/singleFlight.ts`.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `rg --files src -g '*-*.ts' -g '*-*.tsx'`
- **Mức:** NÊN

### R-21 — File nguồn (`.ts`/`.tsx`) không quá 250 dòng.
- **Vì sao:** Trung vị file `.tsx` sản phẩm là ~110 dòng; phân vị 90 là ~330. Từ K-55 luật tính cả `.ts` (hook, gateway, lib: logic nặng nằm ở đó); không tính `.d.ts`, `*.test.*`, `*.spec.*`, `*.stories.*`, `__mocks__`, `__tests__`. Trên 250 dòng thì một component đang làm nhiều hơn một việc, và diff của nó không còn review được trong một lượt.
- **ĐƠN VỊ ĐẾM: dòng có nội dung**, tức `line.trim() !== ''`. Dòng trống không tính. Đơn
  vị phải nói ra chứ không để người đọc đoán: ở lần đo đầu, trên cùng cây mã này, đếm cả
  dòng trống cho ra 12 file vượt, đếm dòng có nội dung cho ra 8. Chênh lệch là dòng chỉ
  có khoảng trắng.
- **Đúng:** `src/components/ui/Badge.tsx` (51), `src/components/feedback/EmptyState.tsx` (51), `src/components/shell/StatusBar.tsx` (51).
- **Sai:** **6 file** vượt — `src/components/ui/Table.tsx` (367),
  `src/components/ui/Select.tsx` (346), `src/screens/auth/AuthScreen/AuthScreen.tsx` (340),
  `src/components/shell/AppShell.tsx` (292), `src/components/overlay/Drawer.tsx` (287),
  `src/components/overlay/Modal.tsx` (257). Con số này là 8 cho tới khi R-22 tách xong hai
  file vượt 400; R-21 là tập cha của R-22, nên nó chỉ về 0 sau.
- **Kiểm bằng:** `node scripts/check-file-length.mjs`. Script **đã tồn tại**; ở ngưỡng 250
  nó chỉ *nhắc*, không làm hỏng lệnh — đó là lý do R-21 ở mức NÊN còn R-22 ở mức BẮT BUỘC.
- **Mức:** NÊN

### R-22 — File nguồn (`.ts`/`.tsx`) không được vượt 400 dòng.
- **Vì sao:** Trên mức này thì tách là bắt buộc chứ không còn là gợi ý. Hai file từng ở đó đã tách, nên ngưỡng này hiện **không** biến mã cũ thành bãi lỗi — nó chỉ giữ nguyên con số 0.
- **ĐƠN VỊ ĐẾM:** như R-21 — dòng có nội dung, `line.trim() !== ''`.
- **Baseline (K-55):** file `.ts`/`.tsx` đã vượt 400 lúc cổng mở rộng được ghi trong `scripts/file-length-baseline.json` ({đường dẫn: số dòng}). Cổng hỏng khi file mới vượt 400 hoặc file trong baseline dài thêm; file ngắn đi chỉ nhắc, chạy `node scripts/check-file-length.mjs --update-baseline` để hạ số / xoá mục (lệnh này không bao giờ thêm file hay nâng số). Xung đột baseline giữa nhánh: lấy số nhỏ hơn. Baseline là nợ phải trả dần, không phải ngoại lệ vĩnh viễn.
- **Đúng:** `src/components/overlay/Modal.tsx` (257) — đã tách sẵn thành `ModalRoot`/`ModalHeader`/`ModalBody` gộp bằng `Object.assign`. Và hai thư mục vừa tách:
  `src/screens/project/ShareScreen/` (460 → khung 178 + `ShareForm` + `ShareList`) và
  `src/components/ui/Combobox/` (403 → `context` + `ComboboxRoot` + `ComboboxDropdown` +
  file gộp tên). Cả hai giữ nguyên đường nhập cũ nhờ `index.ts`, nên không nơi gọi nào
  phải sửa — tách file là quyết định xếp chỗ, không phải đổi API.
- **Sai:** **0 file.** `src/components/ui/Table.tsx` KHÔNG trong danh sách: 417 dòng thô
  nhưng **367 dòng có nội dung**, tức dưới ngưỡng.
- **Kiểm bằng:** `node scripts/check-file-length.mjs --max 400`, chạy như **bước thứ bảy
  của `pnpm verify`**.
- **Mức:** BẮT BUỘC — và từ lần đo thứ hai thì mức này mới **thật**. Trước đó R-22 ghi
  BẮT BUỘC nhưng lệnh kiểm trỏ vào một script **chưa từng tồn tại**, tức một luật chặn
  merge mà không có gì chặn được — đúng thứ R-56 cấm. Script đã dựng, đã vào `pnpm
  verify`, và bước đó đã ĐỎ thật vì đúng hai file trên trước khi chúng được tách. Cách
  xử lý đã dùng là tách file, không phải nới ngưỡng (R-49).

### R-23 — Không định nghĩa component bên trong thân của component khác.
- **Vì sao:** Component định nghĩa lại mỗi lần render là một kiểu component mới với React, nên React huỷ và dựng lại cả cây con, mất sạch state và focus bên trong.
- **Đúng:** `src/components/overlay/Modal.tsx:224-226` — khuôn compound component ở cấp module, không phải lồng trong render:
  ```tsx
  export const Modal = Object.assign(
    function ModalLegacy({ isOpen, onClose, title, ... }: LegacyModalProps) {
  ```
- **Sai:** chưa có vi phạm trong mã sản phẩm.
- **Kiểm bằng:** `rg "^\s{2,}(const|function) [A-Z]\w* ?= ?\(" src --glob '*.tsx'` — mỗi kết quả phải kiểm bằng mắt xem có nằm trong thân component không.
- **Mức:** NÊN

### R-24 — `key` phải là định danh ổn định của phần tử, không dùng chỉ số mảng.
- **Vì sao:** Khi danh sách được chèn, xoá hay sắp xếp lại, chỉ số dịch đi và React gán nhầm state cũ cho phần tử mới — ô nhập giữ nguyên giá trị của hàng vừa bị xoá.
- **Đúng:** `src/App.tsx:42` — `key={id}`.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `rg "key=\{(i|idx|index|\w*Index)\}" src`
- **Mức:** NÊN (miễn trừ hợp lệ: danh sách tĩnh không bao giờ đổi thứ tự, như khung xương `Skeleton`)

---

## E. Hook và tác dụng phụ

### R-25 — Không gọi hook trong điều kiện, trong vòng lặp, hay sau một `return` sớm.
- **Vì sao:** React nhận diện hook theo thứ tự gọi. Bỏ qua một hook ở lần render sau khiến mọi hook phía sau đọc nhầm ô của nhau.
- **Đúng:** `src/hooks/useShortcut.ts:106-109` — điều kiện nằm *bên trong* effect, không bọc quanh lời gọi hook:
  ```ts
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
  ```
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `react-hooks/rules-of-hooks`, bật qua `plugin:react-hooks/recommended` ở `.eslintrc.cjs:19`.
- **Mức:** BẮT BUỘC

### R-26 — Không dùng `useEffect` để lấy dữ liệu.
- **Vì sao:** Effect lấy dữ liệu phải tự lo huỷ bỏ, tranh chấp thứ tự trả về, đệm, và thử lại — bốn thứ mà `src/lib/query` đã cài sẵn và đã test. Viết lại tại chỗ nghĩa là viết lại cả bốn, thường thiếu ba.
- **Đúng:** `src/lib/query/prefetch.ts`, `src/lib/mutations/createOptimisticMutation.ts`.
- **Sai:** **1** — `src/hooks/useShareLinks.ts:314-318`. Đang hoãn có chủ ý (mục 3 của
  `BAO_CAO_DO_LECH.md`): chuyển cùng lúc màn thật đầu tiên dùng `lib/query`, để repo chỉ có
  một khuôn mẫu chứ không phải hai.
- **Kiểm bằng:** soi tay khi review. Dấu hiệu: `await`/`.then(` trong thân `useEffect`.
- **Mức:** NÊN

### R-27 — Không dùng `useEffect` để đồng bộ state này sang state khác.
- **Vì sao:** Đồng bộ bằng effect luôn tốn thêm một lượt render với dữ liệu cũ trên màn hình, và tạo một nguồn sự thật thứ hai có thể lệch. Giá trị suy ra được thì tính thẳng lúc render.
- **Đúng:** `src/App.tsx:31` — suy ra thẳng, không qua state:
  ```tsx
  const ActiveComponent = screens[activeScreen].component;
  ```
- **Sai:** **4**, còn lại sau khi `src/components/overlay/Drawer.tsx` và
  `src/components/feedback/SaveIndicator.tsx` chuyển sang khuôn "so với giá trị trước ngay
  trong lúc render". Bốn chỗ còn lại, mỗi chỗ một lý do:
  - `src/hooks/useCommitFlash.ts:13` và `src/hooks/useUndoableToast.ts:20` — **không phải**
    đồng bộ state sang state: giá trị chúng tính phụ thuộc THỜI GIAN (400 ms và 8 s), thứ
    không tính được lúc render. Tính lúc render còn phải gọi `Date.now()` trong thân render,
    đúng thứ R-29 cấm.
  - `src/hooks/useCombobox.ts:67` — kẹp chỉ số ở tầng đọc là suy ra được, nhưng `useSelect`
    dùng chỉ số nội bộ của nó khi bấm Enter; kẹp một phía làm Enter không chọn gì.
  - `src/components/feedback/Toast.tsx:52` — sửa đúng đòi ghi vào ref ngay trong lúc render,
    mà ghi ref lúc render thì phá tính thuần dưới `StrictMode`.
- **Kiểm bằng:** soi tay. Dấu hiệu: thân effect chỉ gồm `if (…) setX(…)` và mảng phụ thuộc là state khác.
- **Mức:** NÊN
- **Ngoại lệ đã dùng có chủ ý:** khuôn "ref mới nhất" (`ref.current = value`, không có mảng phụ thuộc) ở `src/hooks/useShortcut.ts:180-182` và 6 chỗ tương tự — đây là cách giữ callback mới nhất mà không phải đăng ký lại listener, không phải đồng bộ state.

### R-28 — Effect đăng ký listener, timer, RAF hay worker phải trả về hàm dọn dẹp.
- **Vì sao:** Không dọn thì listener sống lâu hơn component, giữ luôn cả cây DOM cũ trong bộ nhớ, và chạy callback trên state đã chết.
- **Đúng:** `src/components/overlay/CommandPalette.tsx:75-78`
  ```tsx
  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  ```
- **Sai:** chưa có vi phạm trong repo — cả 24 effect đăng ký hệ thống ngoài đều có hàm dọn.
- **Kiểm bằng:** `rg -U "useEffect\(\(\) => \{(?:(?!\}\s*,\s*\[)[\s\S])*?(addEventListener|setInterval|setTimeout|requestAnimationFrame)[\s\S]*?\}\s*,\s*\[" src` rồi soi từng kết quả xem có `return` không.
- **Mức:** NÊN

### R-29 — Không gọi `Math.random()`, `Date.now()`, `new Date()` trong thân render hoặc trong hàm cập nhật state.
- **Vì sao:** Hàm cập nhật state phải thuần — React gọi nó hai lần dưới `StrictMode`, mà `src/main.tsx:20` đang bật `StrictMode`. Giá trị ngẫu nhiên sinh ở đó cho hai kết quả khác nhau. Ngẫu nhiên ở cấp module thì phá luôn khả năng lặp lại của ảnh chuẩn Playwright.
- **Đúng:** `src/hooks/useShareLinks.ts:308` — đồng hồ tiêm được, mặc định mới lấy `new Date()`:
  ```ts
  const readClock = useCallback((): Date => nowRef.current?.() ?? new Date(), []);
  ```
- **Sai:** `src/components/feedback/Toast.tsx:147-152`
  ```tsx
  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    setQueue((prev) => {
      const newToast = { ...toast, id: Math.random().toString(36).substring(2, 9) };
      setSummaryResetKey(k => k + 1);   // gọi setState bên trong hàm cập nhật
      return [newToast, ...prev];
    });
  }, []);
  ```
  và `src/screens/ListReviewDemo.tsx:22` — `Math.random()` ở cấp module, 48 hàng dữ liệu đổi mỗi lần nạp.
- **Kiểm bằng:** `rg "Math\.random\(|Date\.now\(|new Date\(\)" src/components src/screens src/hooks`
- **Mức:** NÊN

### R-30 — Không tắt `react-hooks/exhaustive-deps` mà không ghi lý do.
- **Vì sao:** 6 chỗ đang tắt luật này. Mỗi chỗ là một mảng phụ thuộc mà trình biên dịch cho là sai; nếu người viết đúng thì phải nói vì sao, nếu sai thì đó là một effect chạy thiếu lần.
- **Đúng:** dùng khuôn "ref mới nhất" (`src/hooks/useShortcut.ts:180-182`) thay vì tắt luật.
- **Sai:** chưa có vi phạm trong repo — sáu chỗ tắt luật còn lại đều đã ghi lý do, và mỗi lý do nói rõ vì sao mảng phụ thuộc đang kê là đúng.
- **Kiểm bằng:** `rg "exhaustive-deps" src | rg -v " -- "`
- **Mức:** NÊN

### R-31 — Chỉ dùng `useCallback`/`useMemo` khi có người tiêu thụ cần tham chiếu ổn định.
- **Vì sao:** Repo có 110 `useCallback`, 8 `useMemo` và đúng **1** `memo()`. Một `useCallback` chỉ có tác dụng khi hàm đó là phụ thuộc của hook khác hoặc được truyền vào component đã bọc `memo`. Ngoài hai trường hợp đó nó chỉ thêm một mảng phụ thuộc phải bảo trì và một lần cấp phát.
- **Đúng:** `src/hooks/useShareLinks.ts:310` — `useMemo` cho kết quả được dùng làm phụ thuộc:
  ```ts
  const canCreate = useMemo(() => can('create', 'share', { roles }), [roles]);
  ```
- **Sai:** **74** trong 99 `useCallback`/`useMemo` của mã sản phẩm không có người tiêu thụ nào
  — đo bằng cách gom mọi tên xuất hiện trong bất kỳ mảng phụ thuộc nào của toàn repo, kể cả
  test và story, cộng mọi đối số của `useSyncExternalStore`. `src/hooks/useAppShell.ts` đã sửa.
- **VÌ SAO KHÔNG QUÉT NỐT:** phép đo theo tên có một lỗ — một callback có thể đổi tên ở ranh
  giới prop rồi mới rơi vào mảng phụ thuộc của component con (`onRetry={reload}` rồi
  `useEffect(…, [onRetry])`). Phép đo thấy `onRetry` mà không thấy `reload`, tức báo "an toàn"
  cho một chỗ không an toàn. Với 74 chỗ thì khả năng dính ít nhất một ca là đáng kể.
- **Kiểm bằng:** soi tay. Câu hỏi khi review: "ai đang cần tham chiếu này ổn định?" — không trả lời được thì bỏ.
- **Mức:** KHUYẾN NGHỊ

---

## F. Trạng thái ứng dụng

### R-32 — Ghi vào store bằng `commit(patch, label)`, không gọi `set()` trong component.
- **Vì sao:** `commit` là nơi duy nhất ghi được vào lịch sử hoàn tác. `set()` gọi thẳng thì thay đổi xảy ra nhưng Ctrl+Z không lùi lại được, và không ai biết cho tới khi người dùng thử.
- **Đúng:** `src/store/commit.ts`; 24 lời gọi `commit(` ở 15 file.
- **Sai:** chưa có vi phạm — 4 chỗ tắt luật đều có lý do, ví dụ `src/components/feedback/ScreenErrorBoundary.tsx:93` (state của React, không phải store).
- **Kiểm bằng:** `local/no-direct-set` (`eslint-rules/configs/project.js:65`).
- **Mức:** BẮT BUỘC

### R-33 — `draftSlice` chỉ được ghi từ tầng lệnh trong `src/store`.
- **Vì sao:** Bản nháp là trạng thái chưa xác nhận. Ghi vào nó từ ngoài thì không có gì bảo đảm nó được xác nhận hay huỷ đúng lúc — ví dụ khi đổi tầng, `src/store/index.ts:102-106` huỷ nháp bằng một subscription duy nhất.
- **Đúng:** `src/store/draftSlice.ts` + subscription ở `src/store/index.ts:102-106`.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `local/no-draft-write-outside-commands`.
- **Mức:** BẮT BUỘC

### R-34 — Một store toàn cục duy nhất; trạng thái mới là một slice mới, không phải một store mới.
- **Vì sao:** `src/store/index.ts:37` gộp 9 slice vào một `create()`, bọc `devtools(nameActions(persist(temporal(…))))`. Thêm store thứ hai thì nó nằm ngoài lịch sử hoàn tác, ngoài persist và ngoài devtools.
- **Đúng:** `src/store/index.ts:15-23` — `RootState` là giao của 9 slice.
- **Sai:** chưa có vi phạm — không store nào phục vụ riêng một màn.
- **Kiểm bằng:** `rg "create<.*>\(\)|create\(" src --glob '!src/store/index.ts'`
- **Mức:** NÊN

### R-35 — Đổi hình dạng dữ liệu được lưu lại phải tăng `PERSIST_VERSION` và viết `migrate`.
- **Vì sao:** Người dùng nạp lại trang với dữ liệu ghi bởi bản cũ. Không có `migrate` thì hoặc mất phiên làm việc, hoặc nạp vào một trường mang nghĩa khác.
- **Đúng:** `src/store/index.ts:69-78` — `migrate` dịch `colorMode` từ bảng cũ sang bảng mới thay vì bỏ đi.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** soi tay. Mọi diff chạm `partialize` ở `src/store/index.ts:81-92` phải kèm một lần tăng `PERSIST_VERSION`.
- **Mức:** NÊN

---

## G. Giao diện, token và chuyển động

### R-36 — Màu lấy từ token, không viết hex/rgb/hsl ở tầng giao diện.
- **Vì sao:** Chế độ tối và chế độ sáng chuyển bằng cách đổi biến CSS. Một mã màu viết thẳng không đổi theo, nên nó là chỗ duy nhất trên màn hình sai màu.
- **Đúng:** `src/App.tsx:34` — `className="… bg-bg-app text-text-primary"`. Bảng màu Tailwind ở `tailwind.config.ts:22-78` **thay hoàn toàn** bảng mặc định, nên `bg-blue-500` không tồn tại.
- **Sai:** chưa có vi phạm trong `src/components`, `src/screens`, `src/hooks` (0/66 lần xuất hiện). 66 lần còn lại nằm đúng ba chỗ hợp lệ: `src/styles/globals.css` (định nghĩa token), `src/lib/coloring/**` (bộ sinh thang màu), `src/lib/testing/expectNoRawColor.ts` (chính bộ kiểm).
- **Kiểm bằng:** `local/no-raw-color` (`eslint-rules/configs/project.js:55`).
- **Mức:** BẮT BUỘC

### R-37 — Thời lượng chuyển động chỉ được là 120, 180, 260, 340 hoặc 700 ms.
- **Vì sao:** Thang bốn tốc độ cộng một nhịp nền là thứ làm cả sản phẩm chuyển động giống nhau. `durationMs` trả `0` khi người dùng bật giảm chuyển động; một con số viết thẳng không đi qua đó.
- **Đúng:** `tailwind.config.ts:82-91` — mọi lớp `duration-*` sinh từ `MOTION_DURATIONS_MS`:
  ```ts
  const speed = (name: keyof typeof MOTION_DURATIONS_MS): string =>
    `${MOTION_DURATIONS_MS[name]}ms`;
  ```
- **Sai:** chưa có vi phạm trong `src/`.
- **Kiểm bằng:** `local/no-raw-duration` (`eslint-rules/configs/project.js:62`).
- **Mức:** BẮT BUỘC

### R-38 — Không định dạng số và không quy đổi đơn vị ở tầng giao diện.
- **Vì sao:** View nhận chuỗi đã xong từ viewmodel. Định dạng nằm rải trong view thì cùng một con số hiện ra hai kiểu khác nhau ở hai màn.
- **Đúng:** `src/lib/format/number.ts`, `src/lib/format/datetime.ts`, `src/lib/viewmodel/toViewModel.ts`.
- **Sai:** `src/components/shell/StatusBar.tsx:20-22` — nằm trong sổ nợ, không được chép sang chỗ khác:
  ```ts
  function formatCoord(n: number): string {
    return n.toFixed(2).replace('.', ',');
  }
  ```
  Ba file còn lại trong sổ nợ: `ConfidenceMeter.tsx`, `Slider.tsx`, `ListReviewDemo.tsx`.
- **Kiểm bằng:** `local/no-raw-number` (`eslint-rules/configs/project.js:59`), sổ nợ ở `project.js:165-170`.
- **Mức:** BẮT BUỘC

### R-39 — `motion`, `AnimatePresence` và `useAnimation` chỉ được nhập từ `@/lib/motion`.
- **Vì sao:** Ba tên này là đường duy nhất mà chuyển động lọt qua được `useReducedMotion`. 16 file trong `src/components` hiện nhập thẳng từ `framer-motion`, nên hoạt ảnh vẫn chạy khi người dùng đã tắt chuyển động trong hệ điều hành. Đây là lỗi khả năng tiếp cận, không phải chuyện thẩm mỹ mã. Phần còn lại của API framer (`useScroll`, `useDragControls`, kiểu dữ liệu…) vẫn nhập thẳng được — cổng chỉ đóng đúng ba tên rò.
- **Đúng:** khuôn tương đương đã chạy được cho mạng — `src/lib/http/platform.ts` là chỗ duy nhất chạm transport, nhờ đó `local/no-fetch-outside-http` cấm được toàn repo mà không cần miễn trừ file nào.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `local/no-framer-outside-motion`, đã viết và bật ở mức `error`.
- **SỬA LẠI MỘT ĐIỀU LUẬT NÀY TỪNG NÓI SAI:** bản trước ghi cửa nằm ở `src/lib/motion/index.ts`. **Không đặt ở đó được.** `framer-motion` nhập React, mà `src/lib/**` tuyệt đối không được import React (CLAUDE.md mục 0.4) — tái xuất từ đó sẽ kéo React vào 36 nơi đang nhập barrel ấy, gồm cả mã chạy trong worker. Thêm nữa, thứ thật sự đóng lỗ hổng là `useReducedMotion`, một HOOK, nên nó phải ở tầng React. Cửa là **`src/components/motion`**, và `MotionProvider` ở đó đặt `reducedMotion="user"` một lần cho toàn ứng dụng ở `src/App.tsx`.
- **Mức:** BẮT BUỘC (sau khi lớp bọc tái xuất xong và sổ nợ tạm được lập — xem lộ trình)

### R-40 — Viết style bằng lớp Tailwind; `style={{}}` chỉ dành cho giá trị tính lúc chạy.
- **Vì sao:** 903 lần `className=` / 90 lần `style={{}}`. Giá trị tĩnh viết inline thì lọt khỏi bảng token và khỏi chế độ tối.
- **Đúng:** `src/components/shell/StatusBar.tsx:29-30` — class cho thứ tĩnh, inline chỉ cho `z-index` lấy từ token:
  ```tsx
  className="h-8 shrink-0 flex items-center justify-between px-4 bg-bg-surface border-t border-border-default"
  style={{ zIndex: Z_INDEX.statusBar }}
  ```
- **Sai:** `src/components/ui/TreeItem.stories.tsx:81` — `style={{ paddingLeft: i * 16 + 8 }}` với hai số viết thẳng.
- **Kiểm bằng:** `rg "style=\{\{" src` — mỗi kết quả phải có ít nhất một giá trị chỉ biết được lúc chạy.
- **Mức:** NÊN

### R-41 — Màu thêm vào `tailwind.config.ts` phải trỏ tới một biến CSS.
- **Vì sao:** Bảng màu ở `tailwind.config.ts:22-78` toàn bộ là `var(--…)`, nhờ đó đổi chủ đề chỉ cần đổi biến. Một giá trị cứng trong file này lọt khỏi `local/no-raw-color` vì luật đó chỉ chạy trên `src/**`.
- **Đúng:** `tailwind.config.ts:33-41`
  ```ts
  bg: { app: 'var(--bg-app)', surface: 'var(--bg-surface)', sunken: 'var(--bg-sunken)' },
  ```
- **Sai:** **7 chỗ**, hai nhóm:
  ```ts
  // tailwind.config.ts:99-103 — năm boxShadow viết rgba() thẳng
  'rest': '0 1px 3px rgba(0,0,0,0.1)',
  'overlay': '0 8px 24px rgba(43,42,40,0.07)',

  // tailwind.config.ts:25-26 — hai màu tuyệt đối
  white: '#ffffff',
  black: '#000000',
  ```
- **KHÔNG MIỄN TRỪ `white`/`black`. Quyết định, viết ra ở đây để lệnh kiểm và câu luật nói
  cùng một điều:** hai dòng đó là bảng nền của Tailwind và không đổi theo chủ đề, nên rất
  dễ nghĩ chúng nên được tha. Vẫn tính là vi phạm, vì hai lý do. Một, mục đích của file
  này là "đổi chủ đề chỉ cần đổi biến"; một giá trị cứng dù bất biến vẫn là chỗ duy nhất
  phải sửa bằng tay khi có yêu cầu như chế độ tương phản cao, nơi `white` thôi không còn
  là `#ffffff`. Hai, miễn trừ theo tên là loại carve-out chỉ dài thêm: tha `white` hôm nay
  thì `off-white` xin tha tuần sau. Chi phí sửa là hai biến CSS.
  Hệ quả: **lệnh kiểm giữ nguyên, con số đúng là 7, không phải 5.**
- **Kiểm bằng:** `rg "rgba?\(|#[0-9a-fA-F]{3,8}" tailwind.config.ts`
- **Mức:** NÊN

---

## H. Chuỗi hiển thị và đơn vị đo

### R-42 — Chuỗi hiển thị viết thẳng bằng tiếng Việt có dấu; không dùng thư viện dịch lúc chạy.
- **Vì sao:** Đây là lựa chọn có chủ ý của dự án, không phải thiếu sót. `src/i18n/vi.json` là **từ điển để kiểm tra**, không phải bảng dịch — `src/lib/testing/expectVietnamese.ts:25-31` giải thích rõ. Một chuỗi tiếng Anh sót lại hoặc một chuỗi mất dấu ("Luu ban ve") không bị trình biên dịch nào bắt, nên bộ kiểm 726 dòng làm việc đó.
- **Đúng:** `src/components/shell/StatusBar.tsx:15` — `/** Văn bản trạng thái lưu, ví dụ "Đã lưu lúc 14:32" */`
- **Sai:** `src/App.tsx:17-25` — nhãn điều hướng bằng tiếng Anh (`'Design System'`, `'Canvas & Overlays'`). Chấp nhận được vì đây là bảng chọn demo cho lập trình viên, không phải màn sản phẩm; màn sản phẩm thì không.
- **Kiểm bằng:** `expectVietnamese(container)` trong test của mỗi màn.
- **Mức:** BẮT BUỘC (cho màn sản phẩm)

### R-43 — Mọi độ dài trong ứng dụng là milimét và mang kiểu `Millimetres`.
- **Vì sao:** Trộn milimét với mét là loại lỗi chết người trong phần mềm kỹ thuật — nó không nổ, nó chỉ vẽ ra một bản vẽ sai tỷ lệ 1000 lần. Kiểu nhãn khiến TypeScript chặn ngay tại chỗ gán.
- **Đúng:** `src/domain/units/types.ts:33-34,78`
  ```ts
  /** A length in millimetres. */
  export type Millimetres = Quantity<'mm'>;
  export function millimetres(value: number): Millimetres { … }
  ```
- **Sai:** chưa có vi phạm — hệ kiểu chặn trước khi lint kịp chạy.
- **Kiểm bằng:** `pnpm typecheck`.
- **Mức:** BẮT BUỘC

### R-44 — Quy đổi đơn vị chỉ qua hàm của `src/domain/units`.
- **Vì sao:** Nhân chia bằng tay ở chỗ gọi thì hệ số nằm rải khắp nơi, và mỗi chỗ tự chọn cách làm tròn riêng.
- **Đúng:** `src/domain/units/types.ts:111-117` — `metresToMillimetres`, `millimetresToMetres`, cùng hằng số `MILLIMETRES_PER_METRE` (dòng 57) và `DEFAULT_ROUNDING_STEP` (dòng 147).
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `local/no-raw-number` chặn quy đổi ở tầng view; ngoài đó `pnpm typecheck` chặn vì kết quả nhân tay không mang nhãn `Millimetres`.
- **Mức:** BẮT BUỘC

---

## I. Kiểm thử

### R-45 — Tìm phần tử trong test theo vai trò; không dùng `getByTestId` ngoài hai thư mục được miễn trừ.
- **Vì sao:** Tìm theo vai trò kiểm luôn khả năng tiếp cận: nút mất nhãn hay mất `role` thì test đỏ. Tìm theo `data-testid` thì nút có thể hỏng hoàn toàn với người dùng bàn phím mà test vẫn xanh, đồng thời buộc mã sản phẩm mang thuộc tính chỉ tồn tại vì test. Hiện là 148 `ByRole` / 77 `ByText` / 23 `ByTestId` / 16 `ByLabelText`.
- **Miễn trừ theo đường dẫn:** `src/components/canvas/**` và `src/lib/three/**` — vùng vẽ và cảnh 3D thật sự không có vai trò ARIA để bám vào.
- **Đúng:** `src/screens/auth/AuthScreen/AuthScreen.test.tsx` — 8 lần `getByRole` trong một file.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `rg "ByTestId|data-testid" src --glob '!src/components/canvas/**' --glob '!src/lib/three/**'`
- **Mức:** BẮT BUỘC

### R-46 — Không để `.skip` hay `.only` trong mã đã commit.
- **Vì sao:** `.only` khiến cả file chỉ chạy một test và CI vẫn xanh. `.skip` là một test đã tắt mà không ai nhớ tắt vì sao.
- **Đúng:** 143 file test, 0 chỗ skip/only.
- **Sai:** chưa có vi phạm trong repo.
- **Kiểm bằng:** `rg "\.(skip|only)\(|\bit\.todo|xit\(|xdescribe\(" src`
- **Mức:** BẮT BUỘC

### R-47 — Dữ liệu test lấy từ `src/lib/testing` hoặc `__fixtures__`, không bịa tại chỗ.
- **Vì sao:** Dữ liệu bịa tại chỗ thường thiếu trường, nên test xanh với một hình dạng mà sản phẩm không bao giờ gặp.
- **Đúng:** `src/lib/testing/fixtures.ts`, `src/lib/testing/sevenStateScenarios.ts`, `src/lib/testing/fakeClock.ts`, `src/domain/spatial/__fixtures__/sampleBuilding.ts`, `src/api/__mocks__/client.ts`.
- **Sai:** `src/mocks/spatial.ts` — 1.611 dòng dữ liệu mẫu nằm ngoài cả hai chỗ trên, ngoài tầm `coverage.exclude` của `vitest.config.ts:38-52`, nên bị tính vào mẫu số độ phủ như mã sản phẩm.
- **Kiểm bằng:** soi tay khi review.
- **Mức:** NÊN

### R-48 — Giữ ngưỡng độ phủ: `src/domain` 90%, `src/lib` 80%.
- **Vì sao:** `src/domain` là hàm thuần, không DOM, không mạng — không có lý do nào để một nhánh ở đó không được test.
- **Đúng:** `vitest.config.ts:54-67`.
- **Sai:** không đo được trong lượt này (không chạy được `pnpm coverage`).
- **Kiểm bằng:** `pnpm coverage` — bước `unit` của CI (`.github/workflows/ci.yml:58`) chạy `coverage` chứ không phải `test`, chính vì lý do này.
- **Mức:** BẮT BUỘC

### R-49 — Không hạ ngưỡng và không tắt luật để cổng kiểm xanh.
- **Vì sao:** `vitest.config.ts:16` viết thẳng: "hạ ngưỡng là đổi định nghĩa *xong* để khỏi phải làm". `scripts/verify.mjs:96` in ra cùng một câu khi có bước hỏng.
- **Đúng:** sổ nợ của `local/no-fetch-outside-http` được trả hết rồi xoá, thay vì nới luật.
- **Sai:** chưa có vi phạm trong lịch sử tôi quét được.
- **Kiểm bằng:** `git diff master -- vitest.config.ts eslint-rules/ .eslintrc.cjs` — mọi thay đổi hạ ngưỡng hoặc thêm miễn trừ phải được duyệt riêng.
- **Mức:** BẮT BUỘC

### R-50 — Component mới phải có story và đi qua `expectSevenStates` cùng `expectAccessible`.
- **Vì sao:** Repo đã bỏ công viết 728 dòng `expectAccessible`, 138 dòng `expectSevenStates` và bật `@storybook/addon-a11y`. Component không đi qua chúng thì khoản đầu tư đó không bảo vệ được gì.
- **Đúng:** 47 file `.stories.tsx` hiện có; `src/lib/testing/expectSevenStates.ts`, `expectAccessible.ts`.
- **Sai:** chưa có vi phạm trong repo — mọi component trong `src/components/**` đều có `*.stories.tsx` đi kèm.
- **Kiểm bằng:** soi tay khi review; `pnpm build-storybook` chưa nằm trong CI.
- **Mức:** NÊN

---

## K. Xử lý lỗi và khả năng tiếp cận

### R-51 — Không để khối `catch` rỗng và không chỉ ghi log rồi đi tiếp.
- **Vì sao:** Nuốt lỗi biến một sự cố thành một màn hình im lặng không đúng. Người dùng không biết thao tác của mình đã hỏng.
- **Đúng:** `src/lib/errors/toAppError.ts`, `describeError.ts`, `kinds.ts` — lỗi được quy về hình dạng mà giao diện đọc được.
- **Sai:** `catch` rỗng: **chưa có vi phạm trong repo**. `console.*` trong mã sản phẩm: **6**,
  và cả sáu đã soi từng cái rồi GIỮ có chủ ý — một là dòng chú thích
  (`shortcutRegistry.ts:269`), năm còn lại là kênh chẩn đoán của hạ tầng, mỗi chỗ đều có xử lý
  thật đứng cạnh chứ không nuốt lỗi rồi đi tiếp: `decode.ts:152` vẫn trả `AppError` khi quá tỉ
  lệ hỏng, `useAutosave.ts:35` kèm nhãn "Lưu thất bại" cho người dùng thấy,
  `shortcutRegistry.ts:361` có giá trị trả về thật, `eventChannel.ts:63` chỉ bỏ một message SSE
  hỏng, `screenErrorBoundary.ts:99` chỉ bọc nhánh telemetry.
- **Kiểm bằng:** `rg -U "catch\s*(\([^)]*\))?\s*\{\s*\}" src` và `rg "console\.(log|warn|error)" src --glob '!*.test.*' --glob '!*.stories.*'`
- **Mức:** NÊN

### R-52 — Không dùng `alert`, `confirm` hay `prompt` của trình duyệt.
- **Vì sao:** Chúng chặn luồng, không theo chủ đề, không dịch được, và không kiểm được bằng test. Repo đã có `Modal`, `Drawer` và `Toast` làm đúng việc đó.
- **Đúng:** `src/components/overlay/Modal.tsx`, `src/components/feedback/Toast.tsx`.
- **Sai:** chưa có vi phạm trong repo. Hai kết quả còn lại của lệnh kiểm là chuỗi dữ liệu test XSS ở `src/lib/export/__tests__/shareLink.test.ts:308,473` — dữ liệu, không phải lời gọi.
- **Kiểm bằng:** `rg "\b(window\.)?(alert|confirm|prompt)\(" src`
- **Mức:** BẮT BUỘC

### R-53 — Nút chỉ có biểu tượng phải có `aria-label`.
- **Vì sao:** Không có nhãn thì trình đọc màn hình đọc ra "button" và không nói được nút làm gì. Cũng chính là thứ khiến R-45 tìm được nó theo vai trò.
- **Đúng:** 190 lần `aria-label`/`aria-labelledby`/`aria-describedby` ở 52 file; `src/components/ui/IconButton.tsx` nhận nhãn qua props.
- **Sai:** cần `expectAccessible` chạy mới liệt kê được — chưa đo được trong lượt này.
- **Kiểm bằng:** `expectAccessible(container)` trong test; `@storybook/addon-a11y` khi xem story.
- **Mức:** NÊN

### R-54 — Phím tắt đăng ký qua `src/lib/input/shortcutRegistry`, không tự gắn listener bàn phím.
- **Vì sao:** Sổ đăng ký tập trung (676 dòng) là nơi duy nhất phát hiện được hai phím tắt trùng nhau — `registry.reportOverlaps()` ở `src/hooks/useShortcut.ts:238`. Listener gắn tay thì hai màn có thể cùng nghe `Escape` và không ai biết cái nào thắng.
- **Đúng:** `src/components/overlay/Drawer.tsx:88-91`
  ```tsx
  useShortcut(
    { id: 'drawer.close', combo: 'Escape', scope: 'dialog', preventDefault: false, onTrigger: onClose },
    { enabled: isOpen },
  );
  ```
- **Sai:** chưa có vi phạm trong repo. Kết quả duy nhất của lệnh kiểm là một dòng **chú thích** ở `src/hooks/useShortcut.ts:10`.
- **Kiểm bằng:** `rg "addEventListener\(['\"]key(down|up|press)['\"]" src --glob '!src/lib/input/**'`
- **Mức:** NÊN

### R-55 — Mỗi màn được bọc trong `ScreenErrorBoundary`.
- **Vì sao:** Không có ranh giới lỗi thì một ngoại lệ trong bất kỳ component nào làm trắng toàn bộ trang. Repo đã có sẵn 92 dòng cài đặt và 167 dòng test cho nó, xanh hoàn toàn — nhưng **không màn nào gắn**, nên bộ test đang chứng minh một thứ chưa được dùng.
- **Đúng:** `src/components/feedback/ScreenErrorBoundary.tsx` (cài đặt) và `src/lib/screen-state/screenErrorBoundary.ts`.
- **Sai:** chưa có vi phạm trong repo — `src/App.tsx` bọc màn đang hiện, có `key={activeScreen}` để ranh giới gắn lại mỗi lần đổi màn.
- **Kiểm bằng:** `rg "<ScreenErrorBoundary" src` — số kết quả phải bằng số màn.
- **Mức:** NÊN

---

## L. Cổng kiểm và quy trình

### R-56 — Chạy `pnpm verify` và để nó xanh trước khi mở pull request.
- **Vì sao:** `scripts/verify.mjs` chạy đúng năm cổng của CI theo đúng thứ tự phụ thuộc, dừng ở bước hỏng đầu tiên. Chạy trước thì biết sớm hơn CI khoảng mười phút.
- **Đúng:** `scripts/verify.mjs:20-51` — typecheck → lint → test+độ phủ → build → kích thước gói.
- **Sai:** chưa có vi phạm quan sát được.
- **Kiểm bằng:** `pnpm verify`
- **Mức:** BẮT BUỘC

### R-57 — Sửa bất cứ thứ gì trong `eslint-rules/**` thì phải chạy lại `pnpm install`.
- **Vì sao:** pnpm sao chép cứng thư mục đó vào `node_modules/.pnpm/` (khai bằng `file:eslint-rules`), **không symlink**. Không cài lại thì ESLint vẫn đọc bản cũ và bạn sẽ tưởng luật mình vừa viết không chạy.
- **Đúng:** ghi chú vận hành ở `eslint-rules/configs/project.js:19-21` và `.eslintrc.cjs:9-11`.
- **Sai:** không phát hiện được bằng grep — đây là luật về thao tác.
- **Kiểm bằng:** sau khi sửa `eslint-rules/`, chạy `pnpm install && pnpm lint` rồi kiểm rằng luật mới thật sự bắt được một vi phạm cố ý.
- **Mức:** BẮT BUỘC

### R-58 — Không báo "đạt" cho bước chưa chạy.
- **Vì sao:** `scripts/verify.mjs:14` viết thẳng luật này, và bảng tổng kết ở dòng 87-89 chỉ in trạng thái lấy từ mã thoát thật; bước chưa tới thì ghi "chưa chạy". Báo cáo sai làm hỏng thứ duy nhất mà cổng kiểm mang lại: sự tin cậy.
- **Đúng:** `scripts/verify.mjs:53-55`
  ```js
  const PENDING = 'chưa chạy';
  const PASSED  = 'đạt';
  const FAILED  = 'HỎNG';
  ```
- **Sai:** chưa có vi phạm quan sát được.
- **Kiểm bằng:** soi tay khi review báo cáo của agent — mỗi khẳng định "đạt" phải dẫn được ra đầu ra lệnh tương ứng.
- **Mức:** BẮT BUỘC

---

## Bảng tra nhanh

| Mã | Luật | Mức | Kiểm bằng |
|---|---|---|---|
| R-01 | `lib` không import React/store/hooks/components/screens | BẮT BUỘC | `no-restricted-imports` |
| R-02 | `hooks`/`components` không import tầng trên | BẮT BUỘC | `no-restricted-imports` |
| R-03 | `types` không import gì | BẮT BUỘC | `no-restricted-imports` |
| R-04 | Import xuyên thư mục dùng `@/` | NÊN | `no-relative-import-paths` |
| R-05 | Không import vòng | **BẮT BUỘC** | `pnpm cycles`, bước 3 của `pnpm verify` + CI |
| R-06 | Mạng đi qua `src/lib/http` | BẮT BUỘC | `local/no-fetch-outside-http` |
| R-07 | Đường dẫn API ở `src/api/endpoints.ts` | BẮT BUỘC | `rg` |
| R-08 | Dữ liệu ngoài qua `zod` | NÊN | soi tay |
| R-09 | Trạng thái máy chủ qua `lib/query`+`lib/mutations` | NÊN | soi tay |
| R-10 | Khoá storage là hằng số xuất khẩu | NÊN | `rg` |
| R-11 | Số nghiệp vụ là hằng số có tên | NÊN | `local/no-raw-number` + soi tay |
| R-12 | `interface` cho hình dạng, `type` cho union | **BẮT BUỘC** | `consistent-type-definitions`, đã bật |
| R-13 | Hàm xuất khẩu khai kiểu trả về *(chỉ `lib` + `domain`)* | **BẮT BUỘC** | `explicit-module-boundary-types`, đã bật |
| R-14 | Nhập kiểu bằng `import type` | **BẮT BUỘC** | `consistent-type-imports`, đã bật *(grep không thấy)* |
| R-15 | Không dùng `any` | BẮT BUỘC | `no-explicit-any` |
| R-16 | Không thêm dòng vào sổ nợ | BẮT BUỘC | `git diff` |
| R-17 | `eslint-disable` phải có lý do sau `--` | NÊN | `rg` |
| R-18 | Component khai bằng `export function` | NÊN | `rg` |
| R-19 | Xuất component bằng tên | NÊN | `rg` |
| R-20 | File component PascalCase | NÊN | `rg --files` |
| R-21 | File component ≤250 dòng *(dòng có nội dung)* | NÊN | `pnpm length` |
| R-22 | File component ≤400 dòng *(dòng có nội dung)* | BẮT BUỘC | `pnpm length`, bước 7 của `pnpm verify` |
| R-23 | Không lồng component trong component | NÊN | `rg` + soi tay |
| R-24 | `key` là định danh ổn định | NÊN | `rg` |
| R-25 | Không gọi hook có điều kiện | BẮT BUỘC | `rules-of-hooks` |
| R-26 | Không lấy dữ liệu bằng `useEffect` | NÊN | soi tay |
| R-27 | Không đồng bộ state→state bằng `useEffect` | NÊN | soi tay |
| R-28 | Effect đăng ký phải có hàm dọn | NÊN | `rg` + soi tay |
| R-29 | Không ngẫu nhiên/thời gian trong render | NÊN | `rg` |
| R-30 | Không tắt `exhaustive-deps` không lý do | NÊN | `rg` |
| R-31 | `useCallback` phải có người tiêu thụ | KHUYẾN NGHỊ | soi tay |
| R-32 | Ghi store qua `commit(patch, label)` | BẮT BUỘC | `local/no-direct-set` |
| R-33 | `draftSlice` chỉ ghi từ tầng lệnh | BẮT BUỘC | `local/no-draft-write-outside-commands` |
| R-34 | Một store duy nhất | NÊN | `rg` |
| R-35 | Đổi persist phải tăng version + migrate | NÊN | soi tay |
| R-36 | Màu lấy từ token | BẮT BUỘC | `local/no-raw-color` |
| R-37 | Thời lượng trong thang 120/180/260/340/700 | BẮT BUỘC | `local/no-raw-duration` |
| R-38 | Không định dạng số ở tầng view | BẮT BUỘC | `local/no-raw-number` |
| R-39 | `motion`/`AnimatePresence`/`useAnimation` qua `@/components/motion` | BẮT BUỘC | `local/no-framer-outside-motion`, đã viết và bật |
| R-40 | Style bằng class Tailwind | NÊN | `rg` |
| R-41 | Màu trong tailwind.config phải là `var(--…)` | NÊN | `rg` |
| R-42 | Chuỗi hiển thị tiếng Việt có dấu | BẮT BUỘC | `expectVietnamese` |
| R-43 | Độ dài là milimét, kiểu `Millimetres` | BẮT BUỘC | `pnpm typecheck` |
| R-44 | Quy đổi đơn vị qua `domain/units` | BẮT BUỘC | `pnpm typecheck` |
| R-45 | Tìm theo vai trò, cấm `getByTestId` | BẮT BUỘC | `rg` |
| R-46 | Không `.skip`/`.only` | BẮT BUỘC | `rg` |
| R-47 | Dữ liệu test từ `lib/testing`/`__fixtures__` | NÊN | soi tay |
| R-48 | Độ phủ domain 90% / lib 80% | BẮT BUỘC | `pnpm coverage` |
| R-49 | Không hạ ngưỡng, không tắt luật | BẮT BUỘC | `git diff` |
| R-50 | Component mới có story + bảy trạng thái | NÊN | soi tay |
| R-51 | Không `catch` rỗng, không chỉ log | NÊN | `rg` |
| R-52 | Không `alert`/`confirm`/`prompt` | BẮT BUỘC | `rg` |
| R-53 | Nút biểu tượng có `aria-label` | NÊN | `expectAccessible` |
| R-54 | Phím tắt qua `shortcutRegistry` | NÊN | `rg` |
| R-55 | Mỗi màn bọc `ScreenErrorBoundary` | NÊN | `rg` |
| R-56 | `pnpm verify` xanh trước khi mở PR | BẮT BUỘC | `pnpm verify` |
| R-57 | Sửa `eslint-rules/**` phải `pnpm install` lại | BẮT BUỘC | thao tác |
| R-58 | Không báo "đạt" cho bước chưa chạy | BẮT BUỘC | soi tay |

---

## Khối lệnh kiểm

Chạy được ngay, không cần cài thêm gì (ripgrep đi kèm Claude Code và VS Code).

```bash
# --- Cổng tự động: năm bước của pnpm verify -------------------------------
pnpm verify

# --- Kiểm tra bằng grep, theo mã luật -------------------------------------
echo "R-04 import tương đối vượt thư mục:"
rg -c "from '\.\./" src | sort -t: -k2 -rn | head -20

echo "R-07 đường dẫn API viết ngoài endpoints.ts:"
rg "['\"\`]/(projects|floors|drawings|feature-flags)" src --glob '!src/api/endpoints.ts'

echo "R-10 khoá storage viết thẳng:"
rg "(local|session)Storage\.(get|set|remove)Item\('" src

echo "R-13 hàm xuất khẩu thiếu kiểu trả về:"
rg "^export (async )?function \w+(<[^>]*>)?\([^)]*\)\s*\{" src

echo "R-17 / R-30 eslint-disable không có lý do:"
rg "eslint-disable" src | rg -v " -- "

echo "R-18 component khai bằng arrow:"
rg "^export const [A-Z]\w+ = \(" src --glob '*.tsx'

echo "R-19 xuất mặc định ngoài file story:"
rg "^export default" src --glob '*.tsx' --glob '!*.stories.tsx'

echo "R-20 file kebab-case:"
rg --files src -g '*-*.ts' -g '*-*.tsx'

echo "R-24 key theo chỉ số mảng:"
rg "key=\{(i|idx|index|\w*Index)\}" src

echo "R-29 ngẫu nhiên / thời gian ở tầng giao diện:"
rg "Math\.random\(|Date\.now\(|new Date\(\)" src/components src/screens src/hooks

echo "R-34 store thứ hai:"
rg "\bcreate(WithEqualityFn)?<" src --glob '!src/store/index.ts'

echo "R-39 framer-motion nhập thẳng:"
rg "from 'framer-motion'" src --glob '!src/lib/motion/**'

echo "R-41 màu cứng trong cấu hình Tailwind:"
rg "rgba?\(|#[0-9a-fA-F]{3,8}" tailwind.config.ts

echo "R-45 tìm theo test-id ngoài vùng miễn trừ:"
rg "ByTestId|data-testid" src --glob '!src/components/canvas/**' --glob '!src/lib/three/**'

echo "R-46 test bị skip / only:"
rg "\.(skip|only)\(|\bit\.todo|xit\(|xdescribe\(" src

echo "R-51 catch rỗng và log-rồi-đi-tiếp:"
rg -U "catch\s*(\([^)]*\))?\s*\{\s*\}" src
rg "console\.(log|warn|error)" src --glob '!*.test.*' --glob '!*.stories.*'

echo "R-52 hộp thoại trình duyệt:"
rg "\b(window\.)?(alert|confirm|prompt)\(" src

echo "R-54 listener bàn phím gắn tay:"
rg "addEventListener\(['\"]key(down|up|press)['\"]" src --glob '!src/lib/input/**'

echo "R-55 màn chưa bọc ranh giới lỗi:"
rg "<ScreenErrorBoundary" src
```

---

## Danh sách tự kiểm trước khi mở pull request

Đánh dấu từng dòng. Dòng nào không đánh dấu được thì ghi lý do vào mô tả PR.

**Cổng tự động**
- [ ] `pnpm verify` xanh cả năm bước. Không bước nào bị bỏ qua, không bước nào được báo "đạt" mà chưa chạy. (R-56, R-58)
- [ ] Nếu có sửa `eslint-rules/**`: đã chạy lại `pnpm install` và đã xác nhận luật mới thật sự bắt được một vi phạm cố ý. (R-57)

**Không nới lỏng**
- [ ] Không thêm dòng nào vào sổ nợ ở `eslint-rules/configs/project.js`. (R-16)
- [ ] Không hạ ngưỡng độ phủ trong `vitest.config.ts`, không tắt luật nào trong `.eslintrc.cjs`. (R-49)
- [ ] Mỗi `eslint-disable` mới đều có lý do viết sau `--`. (R-17)

**Ranh giới**
- [ ] Không import ngược chiều tầng; không import vòng mới. (R-01…R-03, R-05)
- [ ] Import xuyên thư mục dùng `@/`. (R-04)
- [ ] Mạng đi qua `src/lib/http`; đường dẫn lấy từ `src/api/endpoints.ts`. (R-06, R-07)

**Giao diện**
- [ ] Không mã màu thô, không thời lượng ngoài thang, không định dạng số ở tầng view. (R-36…R-38)
- [ ] `motion`/`AnimatePresence`/`useAnimation` nhập từ `@/lib/motion`. (R-39)
- [ ] Chuỗi hiển thị là tiếng Việt có dấu. (R-42)

**Component và hook**
- [ ] File component mới ≤250 dòng; không file nào vượt 400. (R-21, R-22)
- [ ] Không effect nào lấy dữ liệu hay đồng bộ state→state. (R-26, R-27)
- [ ] Effect đăng ký listener/timer đều có hàm dọn. (R-28)
- [ ] `key` là định danh ổn định. (R-24)

**Kiểm thử**
- [ ] Test mới tìm phần tử theo vai trò, không dùng `getByTestId`. (R-45)
- [ ] Không còn `.skip` hay `.only`. (R-46)
- [ ] Component mới có story và đi qua `expectSevenStates` + `expectAccessible`. (R-50)

**Lỗi**
- [ ] Không `catch` rỗng, không `console.*` còn sót trong mã sản phẩm. (R-51)
- [ ] Không `alert`/`confirm`/`prompt`. (R-52)
