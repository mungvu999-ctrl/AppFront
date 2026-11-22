// Phục vụ bản dựng production của worktree đang sửa, có proxy /api sang stack f14 — để đo trước/sau
// trên cùng một loại máy chủ (không dùng ảnh web f14, không dựng ảnh Docker mới).
// Dùng: PREVIEW_ROOT=<worktree> pnpm exec vite preview --config scripts/perf/vite.preview.config.mjs --port 18099 --strictPort
// Không đặt PREVIEW_ROOT thì phục vụ chính checkout chứa tệp này.
import { fileURLToPath } from 'node:url';

const ROOT = process.env.PREVIEW_ROOT ?? fileURLToPath(new URL('../..', import.meta.url));

export default {
  root: ROOT,
  build: { outDir: `${ROOT}/dist` },
  preview: {
    host: 'localhost',
    proxy: {
      // AppBack chỉ tin Origin http://localhost:18080 (PUBLIC_BASE_URL của stack f14).
      '/api': {
        target: process.env.API_TARGET ?? 'http://127.0.0.1:18080',
        changeOrigin: false,
        headers: { origin: 'http://localhost:18080' },
      },
    },
  },
};
