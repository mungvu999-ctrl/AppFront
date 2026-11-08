import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Cấu hình cho `vite dev` và `vite build`. KHÔNG cấu hình test ở đây.
 *
 * File này từng khai một khối `test` mà không lần chạy nào đọc tới: vitest tìm
 * `vitest.config.ts` trước, và khi file đó tồn tại thì nó thay thế hoàn toàn chứ
 * không hợp nhất. Hai chỗ khai cùng một thứ, một chỗ im lặng không có tác dụng —
 * người sửa ngưỡng hay `environment` ở đây sẽ tưởng mình đã đổi được gì đó.
 *
 * Cấu hình test — môi trường, setup, ngưỡng độ phủ theo tầng — nằm ở
 * `vitest.config.ts`, và chỉ ở đó.
 */
/** Băm 8 ký tự theo nội dung tệp — đuôi `?v=` của tài sản mang tên cố định. */
const contentVersion = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);

/**
 * B-V10-41 cho trang 3D: `editor3d.html` chép nguyên từ `public/` nạp `pascal-page.js` và
 * `style.css` mang tên cố định, mà `/assets/` được gửi `immutable` một năm — không có `?v=`
 * thì sau mỗi lần triển khai trình duyệt cứ chạy bó cũ. Chỉ sửa bản trong thư mục ra:
 * `public/editor3d.html` giữ nguyên vì `vite.pascal.config.ts` (dev) so đúng chuỗi ấy.
 * Các chunk khác của Pascal đã mang băm trong tên.
 */
function versionPascalPage(): Plugin {
  return {
    name: 'version-pascal-page',
    apply: 'build',
    writeBundle(options) {
      const outDir = options.dir ?? path.resolve(__dirname, 'dist');
      const page = path.join(outDir, 'editor3d.html');

      if (!existsSync(page)) return;
      let html = readFileSync(page, 'utf8');

      for (const asset of ['/assets/pascal/pascal-page.js', '/assets/pascal/style.css']) {
        const file = path.join(outDir, asset);

        if (existsSync(file)) html = html.replace(`"${asset}"`, `"${asset}?v=${contentVersion(file)}"`);
      }
      writeFileSync(page, html);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // B-V10-41: `pascal-mount.js` mang tên cố định (`vite.pascal.config.ts`) mà `/assets/`
  // được gửi `immutable` một năm — đuôi `?v=` theo nội dung bắt trình duyệt nạp bản mới
  // sau mỗi lần triển khai. `pnpm build`/`pnpm dev` dựng gói đó TRƯỚC khi nạp file này.
  // Thiếu tệp (Storybook cũng nạp file này, `E2E_SKIP_PASCAL`) thì `''` — không ném.
  const pascalMountFile = path.resolve(__dirname, 'public/assets/pascal/pascal-mount.js');
  const pascalMountVersion = existsSync(pascalMountFile) ? contentVersion(pascalMountFile) : '';

  return {
    plugins: [react(), versionPascalPage()],
    server: {
      proxy: {
        // AppBack đọc `Origin` để so với `PUBLIC_BASE_URL`; dev server phải đặt
        // biến đó bằng origin của Vite (mặc định http://localhost:5173), không
        // thì POST /api/auth/* trả 403 ORIGIN_MISMATCH (BE-00 §5). Vì vậy không
        // rewrite path và không đổi Origin ở đây — proxy chỉ chuyển tiếp nguyên
        // trạng.
        '/api': {
          target: env.VITE_API_PROXY_TARGET || 'http://localhost:8080',
          changeOrigin: false,
          // Dev server thứ hai (cổng khác 18080) vẫn đăng nhập được vào stack f14: đặt
          // `VITE_API_PROXY_ORIGIN=http://localhost:18080` để proxy gửi đúng Origin BE chờ.
          ...(env.VITE_API_PROXY_ORIGIN && { headers: { origin: env.VITE_API_PROXY_ORIGIN } }),
        },
        // `pnpm dev:3d` (`scripts/dev-3d.mjs`): trang 3D lấy từ dev server Pascal (HMR)
        // thay vì bản dựng tĩnh trong `public/`. `base` của Pascal là `/assets/pascal/`
        // nên client, `@fs`, deps và websocket HMR của nó đều nằm dưới tiền tố đó.
        ...(env.PASCAL_DEV_URL && {
          '/editor3d.html': { target: env.PASCAL_DEV_URL },
          '/assets/pascal/': { target: env.PASCAL_DEV_URL, ws: true },
        }),
      },
      // Đầu ra Playwright nằm trong repo: theo dõi nó thì mỗi lần ghi báo cáo Vite tải lại trang
      // giữa bài e2e, và khoá tệp của Windows (EBUSY) làm sập cả dev server.
      watch: { ignored: ['**/playwright-report/**', '**/test-results/**'] },
    },
    build: {
      // terser thay vì esbuild: chậm hơn vài giây mỗi lần dựng, đổi lấy ~1,5%
      // gzip trên toàn bộ JS — đúng tinh thần cổng kích thước gói: sửa cách dựng,
      // không nới ngưỡng. Không mangle property nào; `passes: 2` cho terser nén
      // thêm một lượt (thêm ~2 s dựng, bớt ~2 KiB gzip nữa).
      minify: 'terser',
      terserOptions: { compress: { passes: 2, pure_getters: true } },
      // `dist/.vite/manifest.json` — bật vì cổng kích thước gói cần ĐỒ THỊ nhập,
      // không chỉ danh sách file. Từ khi router `lazy()` 25 màn, "tổng JS" không
      // còn là "chi phí màn hình đầu tiên": muốn biết cái sau thì phải đi từ chunk
      // `isEntry` theo `imports` (nhập tĩnh) và tách riêng `dynamicImports` (nhập
      // động, tải muộn). Manifest là chỗ duy nhất vite ghi sẵn đồ thị đó ra đĩa;
      // không có nó thì `scripts/check-bundle-size.mjs` chỉ cộng được kích thước
      // file và lại đo nhầm thứ nó sinh ra để chặn. Xem `docs/notes/bundle-size.md`.
      // File này chỉ nằm trong `dist/`, không được nhập vào gói và không đi ra dây.
      manifest: true,
      // Runtime React (react + react-dom + scheduler) vào một chunk riêng. React 19
      // nặng hơn 18 khoảng 25 KiB gzip; để chung với chunk vào thì chunk đó vượt trần
      // 170 KiB của "chunk JS lớn nhất". Tách ra là cách script cổng tự khuyên — sửa
      // cách dựng, không nới ngân sách. "Màn hình đầu tiên" vẫn tính cả hai file
      // (chunk vào nhập tĩnh chunk này), nên cổng đó không được lợi gì từ việc tách.
      rollupOptions: {
        // Client giả (`src/api/__mocks__/`) chỉ chạy dưới `import.meta.env.DEV`: mọi chỗ gọi
        // trong gói sản phẩm đã viết chữ `DEV` tại chỗ nên ràng buộc nhập bị bỏ, nhưng module
        // có mã chạy ở đỉnh (đóng băng bộ mẫu) nên Rollup vẫn giữ nó vì "có tác dụng phụ".
        // Khai nó không có tác dụng phụ thì nhập không dùng tới bị bỏ hẳn. Đo 2026-10-05 (F-07):
        // "chi phí thêm cho một màn" 281,3 → 273,5 KiB. Id của Rollup luôn dùng `/`, kể cả trên Windows.
        treeshake: {
          moduleSideEffects: (id) => !id.includes('/src/api/__mocks__/'),
        },
        output: {
          manualChunks: (id) =>
            /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // Mã Pascal ở `vendor/pascal` viết cho Next.js. Bề mặt Next của nó
        // ĐÓNG LẠI Ở ĐÚNG HAI module — đã đếm: `next/image` 26 tệp,
        // `next/link` 1 tệp, không có `next/router`/`next/head`/`next/navigation`.
        // Hai dòng dưới là toàn bộ cái cần để nó chạy trên Vite; đừng cài `next`.
        'next/image': path.resolve(__dirname, './vendor/pascal/shims/next-image.tsx'),
        'next/link': path.resolve(__dirname, './vendor/pascal/shims/next-link.tsx'),
      },
    },
    define: {
      // Mã Pascal đọc `process.env.NEXT_PUBLIC_*` Ở TẦNG MODULE, không trong
      // hàm — ví dụ `viewer/src/lib/asset-url.ts` đặt `ASSETS_CDN_URL` ngay lúc
      // nhập. Vite không polyfill `process`, nên thiếu những dòng này là
      // `ReferenceError: process is not defined` NGAY LÚC NHẬP MODULE, trước
      // khi có dòng mã nào chạy.
      //
      // Để rỗng là cố ý: mặc định của Pascal trỏ ra `https://editor.pascal.app`,
      // một CDN ngoài. Tài sản đã tự host ở `vendor/pascal/assets/`, và luật
      // `local/no-fetch-outside-http` không cho AppFront gọi thẳng ra ngoài.
      'process.env.NEXT_PUBLIC_ASSETS_CDN_URL': '"/pascal"',
      'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': '""',
      'process.env.NEXT_PUBLIC_APP_URL': '""',
      'process.env.NEXT_PUBLIC_VERCEL_ENV': '""',
      'process.env.NEXT_PUBLIC_VERCEL_URL': '""',
      'process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL': '""',
      'import.meta.env.VITE_PASCAL_MOUNT_VERSION': JSON.stringify(pascalMountVersion),
    },
  };
});
