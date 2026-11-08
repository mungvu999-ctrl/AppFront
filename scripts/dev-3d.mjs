/**
 * `pnpm dev:3d`: như `pnpm dev:be` (http://localhost:18080, `/api` → stack f14), cộng
 * trang 3D `/editor3d.html` chạy từ mã nguồn có HMR — sửa `src/pascal-page/**` hay
 * `vendor/pascal/**` là trang cập nhật, không cần `pnpm pascal` lại.
 *
 * Hai dev server vite trong một tiến trình (một Ctrl+C dừng cả hai): Pascal (Tailwind 4,
 * `vite.pascal.config.ts`) ở 18082, app chính ở 18080 chuyển tiếp `/editor3d.html` và
 * `/assets/pascal/**` (cả websocket HMR) sang đó qua `PASCAL_DEV_URL`. Người dùng vẫn chỉ
 * mở 18080 nên cookie đăng nhập giữ nguyên.
 */
import process from 'node:process';
import { createServer } from 'vite';

/** `DEV3D_PORT`/`DEV3D_PASCAL_PORT`: chạy bản thứ hai cạnh 18080 (so trước/sau); nhớ đặt `VITE_API_PROXY_ORIGIN`. */
const MAIN_PORT = Number(process.env.DEV3D_PORT ?? 18080);
const PASCAL_PORT = Number(process.env.DEV3D_PASCAL_PORT ?? 18082);

const pascal = await createServer({
  configFile: 'vite.pascal.config.ts',
  // IPv4 cố định: với `localhost`, Node thử ::1 rồi 127.0.0.1, mỗi lần 250 ms — lúc vite
  // đang dịch hàng nghìn module Pascal, proxy hỏng hàng loạt ETIMEDOUT.
  server: { host: '127.0.0.1', port: PASCAL_PORT, strictPort: true },
});
await pascal.listen();

process.env.PASCAL_DEV_URL = `http://127.0.0.1:${PASCAL_PORT}`;
const main = await createServer({ mode: 'be', server: { port: MAIN_PORT, strictPort: true } });
await main.listen();
main.printUrls();
console.log(`  Trang 3D (HMR): /editor3d.html → Pascal dev server ở :${PASCAL_PORT}`);
