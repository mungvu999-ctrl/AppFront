/**
 * R-21 / R-22 — độ dài file nguồn (`.ts` và `.tsx`).
 *
 * Một file dài không hỏng lúc chạy; nó hỏng lúc đọc. Quá một màn hình
 * thì không ai giữ được toàn bộ file trong đầu, nên người sửa tiếp theo thêm
 * nhánh mới vào cuối thay vì tách — và file dài thêm. Cổng này biến "hơi dài"
 * thành một con số phải nhìn.
 *
 * ĐƠN VỊ ĐẾM: **dòng có nội dung**, tức `line.trim() !== ''`. Dòng trống không
 * tính. Hai cách đếm cho ra hai bộ số khác nhau trên cùng cây mã (8/2 so với
 * 12/3), nên đơn vị phải nói ra chứ không để người đọc đoán.
 *
 * HAI NGƯỠNG:
 *   - 250 — nhắc. In ra, không làm hỏng lệnh. Đây là R-21, mức NÊN.
 *   - 400 — hỏng. Thoát mã 1. Đây là R-22.
 *
 * PHẠM VI (K-55): cả `.ts` lẫn `.tsx`. Trước đây chỉ `.tsx`, nên logic nặng tách
 * sang hook `.ts` (hàng nghìn dòng) không ai bị chặn. Bỏ qua: `.d.ts`, `*.test.*`,
 * `*.spec.*`, `*.stories.*`, thư mục `__mocks__`, `__tests__`, `upstream`, `node_modules`.
 *
 * BASELINE (ratchet): `scripts/file-length-baseline.json` ghi {đường dẫn: số dòng}
 * cho các file ĐÃ vượt 400 khi cổng mở rộng. Hỏng khi: file không có trong baseline
 * vượt 400; file trong baseline dài thêm so với số đã ghi. File trong baseline mà đã
 * ngắn đi hoặc xuống ≤ 400 thì chỉ nhắc — chạy
 * `node scripts/check-file-length.mjs --update-baseline` để ghi lại số nhỏ hơn / xoá mục.
 * `--update-baseline` KHÔNG BAO GIỜ thêm file mới hay nâng số: nó chỉ hạ (trừ khi chưa có
 * tệp baseline, khi đó ghi mọi file đang vượt). Hợp nhất xung đột baseline: lấy số nhỏ hơn.
 *
 * NGƯỠNG KHÔNG ĐƯỢC NỚI ĐỂ CHO QUA. Vượt thì tách file, không sửa số ở đây.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** Chỉ quét mã sản phẩm trong `src`. */
const ROOT = 'src';

/** Tệp baseline: {đường dẫn: số dòng có nội dung}. Không có tệp thì coi là rỗng. */
const BASELINE_PATH = 'scripts/file-length-baseline.json';

/** Ngưỡng nhắc — R-21. */
const WARN_AT = 250;

/** Ngưỡng hỏng mặc định — R-22. Ghi đè bằng `--max <số>`. */
const DEFAULT_FAIL_AT = 400;

/**
 * File không phải mã sản phẩm: bộ test, story, khai báo kiểu.
 *
 * Chúng dài là chuyện bình thường — một story đủ bảy trạng thái của A11 thì
 * phải có bảy khối. Áp ngưỡng lên chúng chỉ tạo áp lực viết ít test đi.
 */
const NOT_PRODUCT = /\.(test|spec|stories)\.tsx?$|\.d\.ts$/;

/** Mã nguồn cần đếm. */
const SOURCE = /\.tsx?$/;

/**
 * Thư mục bỏ qua hoàn toàn. `upstream` = `src/pascal-page/upstream`, bản chép NGUYÊN VĂN
 * `apps/editor` của Pascal (như `vendor`, vốn nằm ngoài `src`): tách nó là sửa mã upstream.
 */
const SKIP_DIRS = new Set(['__tests__', '__mocks__', 'node_modules', 'upstream']);

/** Đọc `--max <số>`; không có thì dùng mặc định. */
function readFailThreshold(argv) {
  const index = argv.indexOf('--max');

  if (index === -1) {
    return DEFAULT_FAIL_AT;
  }

  const value = Number(argv[index + 1]);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--max cần một số nguyên dương, nhận được: ${argv[index + 1] ?? '(trống)'}`);
  }

  return value;
}

/** Tên có phải mã nguồn sản phẩm cần đếm không (`.ts`/`.tsx`, không phải test/story/`.d.ts`). */
function isProductSource(name) {
  return SOURCE.test(name) && !NOT_PRODUCT.test(name);
}

/**
 * Liệt kê `.ts`/`.tsx` sản phẩm dưới `dir`, đệ quy.
 *
 * Dùng `readdirSync` chứ không dùng `globSync`: `node:fs` chỉ xuất `globSync`
 * từ Node 22 và ở đó nó vẫn là API thử nghiệm, còn `.github/workflows/ci.yml`
 * chốt `node-version: '20'`.
 */
function listProductSources(dir) {
  const found = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) {
        found.push(...listProductSources(path));
      }
      continue;
    }

    if (isProductSource(entry)) {
      found.push(path);
    }
  }

  return found;
}

/** Số dòng có nội dung của một file. */
function countContentLines(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '').length;
}

/** Đọc baseline; không có tệp → `{}`. */
function readBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) {
    return {};
  }

  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * Phép ratchet, thuần: nhận `measured` ([{path, lines}]) và `baseline` ({path: lines}).
 *
 * - `failed`: file KHÔNG trong baseline vượt `failAt`, hoặc file trong baseline dài hơn số đã ghi.
 * - `warned`: file vượt `warnAt` mà không hỏng (gồm file baseline còn nguyên số).
 * - `shrunk`: file trong baseline đã ngắn đi hoặc xuống ≤ `failAt` — nhắc cập nhật baseline.
 * - `gone`: mục baseline không còn file (đã xoá/đổi tên) — nhắc cập nhật baseline.
 */
function evaluate(measured, baseline, failAt = DEFAULT_FAIL_AT, warnAt = WARN_AT) {
  const failed = [];
  const warned = [];
  const shrunk = [];
  const seen = new Set();

  for (const file of measured) {
    const recorded = baseline[file.path];
    seen.add(file.path);

    if (recorded === undefined) {
      if (file.lines > failAt) {
        failed.push({ ...file, reason: 'new' });
      } else if (file.lines > warnAt) {
        warned.push(file);
      }
      continue;
    }

    if (file.lines > recorded) {
      failed.push({ ...file, recorded, reason: 'grew' });
    } else if (file.lines <= failAt || file.lines < recorded) {
      shrunk.push({ ...file, recorded });
    } else {
      warned.push(file);
    }
  }

  const gone = Object.keys(baseline).filter((path) => !seen.has(path));

  return { failed, warned, shrunk, gone };
}

/**
 * Baseline mới sau `--update-baseline`. Có baseline cũ: chỉ HẠ số / xoá mục, không thêm file mới
 * và không nâng số (cổng phải còn đỏ cho file tăng). Chưa có baseline: ghi mọi file đang > `failAt`.
 */
function nextBaseline(measured, previous, failAt = DEFAULT_FAIL_AT) {
  const next = {};

  for (const file of measured) {
    if (file.lines <= failAt) {
      continue;
    }

    if (previous === null) {
      next[file.path] = file.lines;
    } else if (previous[file.path] !== undefined) {
      next[file.path] = Math.min(previous[file.path], file.lines);
    }
  }

  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function main() {
  const argv = process.argv.slice(2);
  const failAt = readFailThreshold(argv);

  const measured = listProductSources(ROOT)
    .map((path) => ({ path: path.replace(/\\/g, '/'), lines: countContentLines(path) }))
    .sort((left, right) => right.lines - left.lines);

  if (argv.includes('--update-baseline')) {
    const previous = existsSync(BASELINE_PATH) ? readBaseline() : null;
    const next = nextBaseline(measured, previous, failAt);

    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\nĐã ghi ${Object.keys(next).length} mục vào ${BASELINE_PATH}\n`);
    return;
  }

  const baseline = readBaseline();
  const { failed, warned, shrunk, gone } = evaluate(measured, baseline, failAt);

  console.log(`\nĐộ dài file nguồn (dòng có nội dung) — nhắc ${WARN_AT}, hỏng ${failAt}\n`);

  for (const file of failed) {
    const why =
      file.reason === 'grew' ? `dài thêm so với baseline ${file.recorded}` : `mới, vượt ${failAt}`;
    console.log(`  HỎNG  ${String(file.lines).padStart(4)} dòng  ${file.path}  (${why})`);
  }

  for (const file of warned) {
    console.log(`  nhắc  ${String(file.lines).padStart(4)} dòng  ${file.path}`);
  }

  if (failed.length === 0 && warned.length === 0) {
    console.log('  (không file nào vượt ngưỡng)');
  }

  if (shrunk.length > 0 || gone.length > 0) {
    console.log(
      `\n${shrunk.length + gone.length} mục baseline đã lỗi thời (file ngắn đi / xuống ≤ ${failAt} / không còn): ` +
        'chạy `node scripts/check-file-length.mjs --update-baseline` để ghi lại số nhỏ hơn.',
    );
  }

  console.log(
    `\n${measured.length} file đã quét · ${measured.filter((file) => file.lines > WARN_AT).length} vượt ${WARN_AT} · ` +
      `${measured.filter((file) => file.lines > failAt).length} vượt ${failAt} ` +
      `(${Object.keys(baseline).length} trong baseline)\n`,
  );

  if (failed.length > 0) {
    throw new Error(
      `${failed.length} file vi phạm (mới vượt ${failAt} hoặc dài thêm so với baseline). ` +
        'Tách trước, rồi sửa. Không nới ngưỡng để cho qua.',
    );
  }

  console.log('Độ dài file: đạt.\n');
}

export { evaluate, isProductSource, nextBaseline };

if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  try {
    main();
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
