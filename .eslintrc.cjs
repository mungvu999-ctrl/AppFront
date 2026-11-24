/**
 * Điểm vào của ESLint. Cố ý mỏng.
 *
 * Luật riêng của dự án — sáu rule nội bộ, ranh giới import, sổ nợ kỹ thuật —
 * nằm gọn trong `eslint-plugin-local`, đọc ở `eslint-rules/configs/project.js`.
 * File này chỉ ghép nó vào các preset ngoài. Muốn biết dự án cấm gì thì mở đúng
 * một file, không phải hai.
 *
 * Sửa `eslint-rules/**` xong phải chạy lại `pnpm install`: pnpm sao chép cứng
 * thư mục đó vào `node_modules/.pnpm/` chứ không symlink, nên bản cũ vẫn được
 * dùng cho tới khi cài lại (CLAUDE.md mục 0.3).
 */
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
    'plugin:local/project',
  ],
  // `vendor/pascal` là mã Pascal đã chép vào làm mã của AppFront (xem
  // `vendor/pascal/NGUON.md`). Nó viết theo luật Biome của Pascal, không theo
  // bảy luật nội bộ ở `eslint-rules/`, nên để `eslint .` quét nó là biến cổng
  // lint thành hàng nghìn lỗi không ai định sửa. Ba cổng còn lại — độ dài,
  // typecheck, import vòng — vốn đã chỉ nhìn `src/**` nên không cần dòng nào.
  // `src/pascal-page/upstream` là bản chép NGUYÊN VĂN `apps/editor` của Pascal (README trong đó),
  // cùng lý do với `vendor`.
  ignorePatterns: ['dist', 'coverage', '.eslintrc.cjs', 'vendor', 'qa', 'src/pascal-page/upstream'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh', 'local', 'import'],
  settings: {
    // `eslint-plugin-import` mặc định dùng resolver của Node, và resolver đó
    // KHÔNG biết `.ts`, `.tsx` hay alias `@/` của `tsconfig.json`. Thiếu dòng
    // này thì mọi luật `import/*` nhìn thấy một đồ thị phụ thuộc RỖNG và báo
    // "không có vấn đề gì" — một cổng xanh vô điều kiện, đúng thứ mục E.10 cấm.
    // Đã kiểm bằng một vòng import cố ý: không có resolver thì `import/no-cycle`
    // im lặng, có resolver thì nó bắt.
    'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
    'import/resolver': {
      typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
    },
  },
  // K-59: `test.skip(true, ...)` ở mức đầu tệp hay trong `describe` giết cả nhóm bài mà không ai để ý
  // (cả nhóm Viewer3D cũ nằm chết như vậy từ 29eba219). Cần bỏ qua khi chạy thì dùng điều kiện
  // (`test.skip(({ isMobile }) => ..., lý do)`) hoặc `skipWithReason` ở `qa/tests/support/skip.ts`.
  // `qa/` nằm trong `ignorePatterns` nên ESLint không quét; phần đó do `scripts/__tests__/no-unconditional-skip.test.mjs` giữ.
  overrides: [
    {
      files: ['e2e/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "CallExpression[callee.object.name='test'][callee.property.name='skip'][arguments.0.value=true]",
            message: 'Cấm test.skip(true, ...): xoá bài chết, hoặc dùng điều kiện theo project/viewport (K-59).',
          },
        ],
      },
    },
  ],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

    // `eslint-plugin-import` từng được nạp mà KHÔNG bật luật nào — mỗi lần lint
    // trả tiền thời gian khởi động cho một plugin không kiểm gì (khiếm khuyết D6).
    // Năm luật dưới đây đều rẻ: chúng chỉ nhìn từng file một, không dựng đồ thị
    // phụ thuộc như `import/no-cycle` — luật đó nằm riêng ở `pnpm cycles` đúng vì
    // nó đắt. Cả năm đo được 0 vi phạm lúc bật, nên chúng chặn cái sắp tới chứ
    // không biến mã cũ thành bãi lỗi.
    'import/no-duplicates': 'error',
    'import/no-self-import': 'error',
    'import/no-useless-path-segments': 'error',
    'import/no-absolute-path': 'error',
    'import/export': 'error',

    // CSP thật (`AppBack/deploy/nginx/snippets/security_headers.conf:6`) không có
    // `'unsafe-eval'`: mọi lượt dựng mã từ chuỗi đều ném EvalError lúc chạy, mà
    // máy dev không gửi CSP nên chỉ bản triển khai mới thấy (FIX-380). Chặn ở mã
    // nguồn; bản dựng có lượt quét riêng trong `scripts/check-bundle-size.mjs`.
    //
    // `vendor/` KHÔNG qua ba luật này (nó nằm trong `ignorePatterns` ở trên), dù
    // fork Pascal chạy trên trình duyệt. Gỡ khỏi `ignorePatterns` thì nó nhận cả
    // các preset, và `--report-unused-disable-directives` bắn vào chú thích tắt
    // luật Biome của fork. Lưới cho fork vì thế là lượt quét `dist/` của `pnpm
    // size` — nó cũng bắt bí danh (`const F = Function`) mà `no-new-func` trượt.
    // Đo 2026-10-06 bằng `eslint --no-eslintrc --no-inline-config` chỉ ba luật này
    // trên `vendor/pascal/packages/{core,viewer,nodes,editor}/src`: 2 351 tệp, 0 vi phạm.
    'no-eval': 'error',
    'no-new-func': 'error',
    'no-implied-eval': 'error',
  },
};
