# e2e FE + BE trên compose (F-14)

Một chuỗi Playwright chạy trên trình duyệt thật, nói chuyện với AppBack thật. Chuỗi không dùng mock và không dùng `page.route`. Nó nằm ngoài `pnpm e2e` và ngoài CI của FE.

```sh
pnpm e2e:fullstack
```

Chuỗi gồm các bước: đăng nhập, CSP/Draco, tạo dự án, thêm tầng, tải bản vẽ, pipeline (SSE), sửa tường có tự lưu, 3D, Pascal, phục hồi phiên bản, registry (N23/N25/N27 và N24 qua nút trên màn).

**Đã chạy thật một lần** ngày 2026-10-06 trên compose của AppBack (ảnh dựng từ AppBack + FIX-378, `web` từ AppFront `efbda6bd`). Lượt ấy dùng script dựng của điều phối, `backend/dieu-phoi/chay/F-14/chuoi.sh` trong repo AppBack. Chuỗi qua trọn 1→11 trong 18,8 s; N24 chạy thật, và registry trở về "Bản gốc". Các lệnh dưới đây chép từ script ấy. Lệnh nào chưa chạy thì ghi "chưa thử".

## Biến môi trường

| Biến | Việc |
|---|---|
| `E2E_FULLSTACK_BASE_URL` | Mặc định `http://localhost:8080`. Phải là **`localhost`**, không phải `127.0.0.1`, và phải trùng `PUBLIC_BASE_URL` của BE |
| `E2E_ADMIN_EMAIL` | Admin do `create-admin` tạo (điều kiện 4) |
| `E2E_ADMIN_PASSWORD` | Mật khẩu của admin ấy. Không bao giờ in ra |
| `E2E_DRAWING_PNG` | Đường tới PNG `render_plan(7)` (điều kiện 5). Đặt tên `drawing.png`: tên không đoán ra tầng, nên tệp vào khay "Tệp chưa gán tầng" và chuỗi tự gán nó cho tầng vừa thêm |
| `E2E_DEV_SERVER=1` | Chạy trên Vite `dev:be` (mã FE đang sửa) thay vì ảnh `web`: bỏ kiểm CSP và `?v=` của trang 3D, hai thứ chỉ nginx/bản build mới có |
| `E2E_SKIP_REGISTRY=1` | Bỏ bước 10. Bắt buộc khi stack đang chạy model đã huấn luyện: bước 10 kích hoạt lại "Bản gốc" và đè mất lựa chọn ấy |
| `E2E_REAL_PLANS` | Cho `realplan.fullstack.ts`: các ảnh bản vẽ căn hộ thật, ngăn bằng `;`, mỗi ảnh một test (ML thật, đặt tỷ lệ tay nếu máy không đọc được). Nhận `.png/.jpg/.pdf`; PDF nhiều trang thì chọn trang cuối. Trống thì bỏ qua |
| `E2E_SET_FILES` | Cho `houseset.fullstack.ts`: các tệp của **một** bộ hồ sơ (PDF/PNG/JPG), ngăn bằng `;`. BE cần `DRAWING_SET_ENABLED=true` và ML thật (`ML_BACKEND=onnx`). Đừng thêm `--trace`: trang 3D làm bước lưu vết treo tới 15 phút. Trống thì bỏ qua |

Thiếu biến nào thì `globalSetup` dừng ngay và liệt kê đủ các biến thiếu. Nếu BE không trả lời, hoặc CSP ở `GET /` thiếu `'wasm-unsafe-eval'` hay `worker-src blob:`, nó dừng với câu "chưa có AppBack ở …".

Đường kiểu `/tmp/...` hay `F:/...` chỉ đúng khi `pnpm e2e:fullstack` cũng chạy trong Git Bash. Chạy trong PowerShell hay cmd thì đặt `E2E_DRAWING_PNG` bằng đường Windows, ví dụ `F:\tmp\drawing.png`.

### Cổng trên máy chạy

Cổng mặc định có thể đã bị chiếm. Trên máy điều phối, Postgres giữ 5432 và Apache giữ 8080. Khi ấy phải đổi **bốn** biến **cùng nhau**. Ví dụ cho cổng 18080:

```sh
export POSTGRES_HOST_PORT=15432 WEB_HTTP_PORT=18080 PUBLIC_BASE_URL=http://localhost:18080
export E2E_FULLSTACK_BASE_URL=http://localhost:18080
```

Nếu `PUBLIC_BASE_URL` và `E2E_FULLSTACK_BASE_URL` lệch nhau, mọi `POST /api/auth/*` trả 403 `ORIGIN_MISMATCH`.

## Bảy điều kiện trước (AppBack lo, chuỗi không dựng)

Chạy các lệnh dưới đây từ gốc repo AppBack, trong **Git Bash**. `>` của PowerShell 5.1 ghi ra UTF-16, nên nó làm hỏng tệp nhị phân (PNG, ONNX). Hai biến dùng chung:

```sh
DC="docker compose -p f14 -f deploy/compose/ci.yml --env-file deploy/compose/env.example --profile ml"
BASE=$E2E_FULLSTACK_BASE_URL
```

1. **Ảnh `web` dựng tay từ sha AppFront có đủ F.** `tools/contract/APPFRONT_SHA` đang ghim một bản cũ (F-00c), nên đừng dựng `web` bằng `tools/ci/job.sh build`. Cũng đừng sửa `APPFRONT_SHA`: nâng sha là một việc riêng, phải hỏi trước.

   ```sh
   SHA=<sha AppFront>          # lượt thật dùng efbda6bd
   APPFRONT_REPO=<repo AppFront> bash deploy/docker/web-context.sh "$SHA" <thư mục ctx>
   docker build -t appback-web:"$IMAGE_TAG" -f deploy/docker/web.Dockerfile \
     --build-context appfront=<thư mục ctx> --build-arg APPFRONT_SHA="$SHA" .
   ```

   Ảnh `api` và `worker` dựng bằng `deploy/docker/api.Dockerfile` và `deploy/docker/worker.Dockerfile`, cùng tag.

2. **`ML_BACKEND=fake` cho `ml` và cờ `scene.pascal-viewer` cho `api`.** Có hai đường, tuỳ AppBack đã gộp FIX-378 hay chưa:
   - **FIX-378 đã gộp** (lượt chạy thật đi đường này). `ML_BACKEND` và `FEATURE_FLAGS` là biến môi trường mà compose chuyển vào dịch vụ, nên **không cần tệp đè**:

     ```sh
     export IMAGE_TAG=f14 ML_BACKEND=fake FEATURE_FLAGS='{"scene.pascal-viewer": true}'
     ```

   - **FIX-378 chưa gộp.** `base.yml` và `ci.yml` không chuyển `ML_BACKEND`, mà mặc định của nó là `onnx`. Cần một tệp đè đặt ngoài repo, rồi thêm `-f <tệp đè>` vào `$DC` (chưa thử):

     ```yaml
     services:
       ml:
         environment:
           ML_BACKEND: fake
     ```

     **Đừng** đặt `FEATURE_FLAGS` ở đường này. AppBack khi chưa gộp FIX-378 chỉ biết 5 khoá cờ (`apps/api/telemetry/flags.py`). Một khoá lạ làm `TelemetrySettings` ném lỗi lúc nạp, `api` không lên, và `globalSetup` báo "chưa có AppBack". Hệ quả là bước 8b (Pascal) hỏng.

   Bước 8b còn cần thêm phía FE: bản FE phải nạp cờ server sau khi có phiên (FIX-379). Bản FE nào chưa có FIX-379 thì không bao giờ gọi `GET /api/feature-flags`, nên bước 8b đỏ. Đó là kết quả đúng, không phải lỗi của chuỗi.

3. **Dựng compose.** `env.example` đặt `APP_ENV=dev`, giá trị cho phép bộ giả.

   ```sh
   $DC up -d --wait
   $DC exec -T ml printenv ML_BACKEND        # phải in "fake"
   curl -sI $BASE/ | grep -i content-security-policy
   ```

   Trình duyệt phải vào `$BASE`. Nếu vào `web:8080`, trình duyệt bỏ cookie `Secure`.

4. **Admin đầu tiên.** Lệnh này chỉ tạo admin đầu tiên, nên cơ sở dữ liệu phải trắng:

   ```sh
   printf '%s' "$E2E_ADMIN_PASSWORD" | $DC exec -T api \
     python -m apps.api.auth.cli create-admin --email "$E2E_ADMIN_EMAIL" --name E2E --password-stdin
   ```

5. **Bản vẽ `render_plan(7)`** (seed của e2e B5-07). Bộ giả chỉ trả tường cho đúng ảnh này.

   ```sh
   $DC exec -T ml python -c "import sys; from packages.ml_contracts.synthetic import render_plan; sys.stdout.buffer.write(render_plan(7).image_png)" > drawing.png
   python -c "import sys; assert open(sys.argv[1],'rb').read(8)==b'\x89PNG\r\n\x1a\n'; print('PNG ok')" drawing.png
   export E2E_DRAWING_PNG="$PWD/drawing.png"
   ```

6. **Registry seed.** Migration `r20260928_b6_01_ml_registry.py` (dịch vụ `migrate`) seed "Bản gốc" của từng họ ở trạng thái `pending` và kích hoạt sẵn bản ấy. Với `ML_BACKEND=fake`, `ml_eval` đưa bản về `completed`, nhưng việc này **chậm**: lượt đo ngày 2026-10-06 cần khoảng 4,5 phút, và một lượt khác vẫn còn `pending` sau 5 phút. Vì thế vòng chờ ở điều kiện 7 chờ **mọi** bản của họ, kể cả "Bản gốc", với trần 10 phút. Bước 10 soát trước khi đổi gì: nếu "Bản gốc" của họ "Nhận diện cửa và đồ đạc" chưa `onnx` + `completed`, chuỗi hỏng ngay mà không kích hoạt bản nào.

7. **Bản model thứ hai cho họ "Nhận diện cửa và đồ đạc"**, để bước 10b có bản mà bấm "Kích hoạt". Màn F-12 không tự sinh được bản kích hoạt được: huấn luyện cần bộ dữ liệu dựng bằng công cụ dòng lệnh, và trainer luôn là trainer thật. Bản thứ hai được nạp bằng N26.

   Đăng nhập tay phải gửi `"rememberMe": false` trong thân request; thiếu trường này thì #1 trả 422. Tệp `.onnx` không cần là model thật: N26 chỉ soát byte đầu là `0x08`, và bộ giả không nạp trọng số.

   ```sh
   jar=$(mktemp)
   # Thân đi qua stdin (`--data @-`): `printf` là lệnh có sẵn của bash, nên mật khẩu không vào argv
   # của tiến trình nào (cùng lý do `create-admin` dùng `--password-stdin`).
   printf '{"email":"%s","password":"%s","rememberMe":false}' "$E2E_ADMIN_EMAIL" "$E2E_ADMIN_PASSWORD" \
     | curl -s -c "$jar" -o /dev/null -w '%{http_code}\n' -H "Origin: $BASE" -H 'Content-Type: application/json' \
       --data @- $BASE/api/auth/login
   TOK=$(curl -s -b "$jar" -H "Origin: $BASE" -X POST $BASE/api/auth/refresh \
     | python -c "import json,sys; d=json.load(sys.stdin); print(d.get('accessToken') or d.get('access_token') or '')")

   $DC exec -T ml python -c "
   import sys
   try:
       import onnx, onnx.helper as h
       g=h.make_graph([h.make_node('Identity',['x'],['y'])],'g',[h.make_tensor_value_info('x',1,[1])],[h.make_tensor_value_info('y',1,[1])])
       sys.stdout.buffer.write(h.make_model(g).SerializeToString())
   except ImportError:
       sys.stdout.buffer.write(bytes([8,7])+b'\x00'*64)
   " > second.onnx
   SUM=$(sha256sum second.onnx | cut -d' ' -f1)
   printf '{"checksumSha256":"%s","family":"openingAndFurnitureDetection","label":"e2e-%s","weightsFormat":"onnx"}' \
     "$SUM" "$(date -u +%m%d%H%M)" > meta.json
   curl -s -w '\nHTTP %{http_code}\n' -H "Origin: $BASE" -H "Authorization: Bearer $TOK" \
     -F "metadata=@meta.json;type=application/json" -F "weights=@second.onnx;type=application/octet-stream" \
     $BASE/api/admin/ml/model-versions

   # Chờ MỌI bản của họ, kể cả "Bản gốc", tới completed; tối đa 10 phút:
   for i in $(seq 1 60); do
     S=$(curl -s -H "Authorization: Bearer $TOK" "$BASE/api/admin/ml/model-versions?family=openingAndFurnitureDetection" \
       | python -c "import json,sys; print(' '.join(f\"{v['label']}:{v['evaluationStatus']}\" for v in json.load(sys.stdin)['items']))")
     echo "$S"; case "$S" in *pending*|*running*|"") sleep 10;; *) break;; esac
   done
   ```

   Nếu thiếu bản này, bước 10 **hỏng** với câu chỉ về điều kiện 7. Bước 10b kích hoạt bản thứ hai bằng nút trên màn. Sau đó, trong `finally`, nó kích hoạt lại "Bản gốc" cũng bằng nút trên màn, nên môi trường trở về như trước, kể cả khi lượt kích hoạt hỏng sau N24.

## Đọc kết quả

- Báo cáo HTML nằm ở `playwright-report/fullstack`, đầu ra nằm ở `test-results/fullstack`. Không commit hai thư mục này.
- **Trace** chỉ bật **sau** bước đăng nhập và chỉ được lưu khi chuỗi hỏng (`trace.zip`, đính trong báo cáo HTML). Dù vậy, trace và báo cáo HTML vẫn chứa cookie phiên và access token. Vì thế chỉ dùng tài khoản e2e riêng, và đừng đính trace vào báo cáo hay vào `FIX.md`. Để mở trace: `pnpm exec playwright show-trace test-results/fullstack/<thư mục>/trace.zip`.
- Lỗi `/api/` được in đủ danh sách trước khi chuỗi ném, mỗi dòng gồm method, đường, status, `code` và `requestId`. Chỉ một trường hợp được bỏ qua: `POST /api/auth/refresh` 401 trước lượt đăng nhập.
- Bước 6 hỏng với câu "pipeline xong trước khi màn mở luồng; FE không mở S1" khi bộ giả xong trước lượt mồi #8 của màn. Khi ấy FE không mở luồng SSE (`useProcessingScreen.ts:933`), nên không có sự kiện nào để kiểm. Chạy lại, hoặc chạy trên worker chậm hơn.
