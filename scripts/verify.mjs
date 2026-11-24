/**
 * Lệnh kiểm tổng — `pnpm verify`.
 *
 * Một lệnh chạy hết những gì quyết định "xong": kiểu, luật, test, độ phủ, kích
 * thước gói, độ dài file, import vòng.
 *
 * Vì sao "test" và "độ phủ" là MỘT bước: `vitest run --coverage` chạy đúng bộ
 * test đó một lần rồi đối chiếu ngưỡng trong `vitest.config.ts`. Tách làm hai
 * lệnh thì bộ test chạy hai lượt, tốn gấp đôi thời gian CI mà không biết thêm
 * điều gì. Bước này hỏng khi có test đỏ HOẶC độ phủ dưới ngưỡng.
 *
 * Lịch chạy (PERF-01 gate5): bước nào không đọc kết quả của bước khác thì không
 * phải chờ nó. Test + độ phủ là bước dài nhất (vài phút) và chỉ cần mã nguồn,
 * nên khởi động NGAY từ đầu, song song với:
 *
 *     t=0 ── test + độ phủ ─────────────────────────────────────────┐
 *     t=0 ── typecheck ─┐                                            │
 *     t=0 ── lint + import vòng ─┴─ build ── kích thước gói          ├─ bảng
 *     t=0 ── độ dài file                                             │
 *
 * `build` chờ typecheck + lint chứ không chạy từ đầu: nó không cần kết quả của
 * hai bước đó, nhưng cả ba cùng ăn RAM (tsc, ESLint dựng đồ thị import, Rollup)
 * và máy này thường chỉ còn vài GB trống — dồn cả ba lên đầu là đẩy vitest ra
 * đĩa. Chờ thì đỉnh RAM bằng lịch cũ, mà build vẫn xong trước test nên không
 * nằm trên đường găng. Kiểu/luật hỏng thì `build` và `kích thước gói` ghi
 * "chưa chạy" (bản dựng của mã sai kiểu không nói được gì). `kích thước gói`
 * đọc `dist/` nên luôn chờ `build`.
 *
 * `lint` và `import vòng` dùng CHUNG một lượt ESLint (C3): `import/no-cycle` tự
 * nó đã phải dựng đồ thị phụ thuộc của toàn bộ `src`, phần tốn thời gian nhất.
 * Một lượt, lọc message theo `ruleId` thành hai "bước" để báo cáo. Lượt ESLint
 * chạy trong TIẾN TRÌNH CON (`--lint`): chạy trong tiến trình này thì vòng sự
 * kiện bị ESLint chiếm từng quãng dài, ống stdout của vitest đầy mà không ai
 * đọc, và vitest đứng chờ.
 *
 * `build` của verify KHÔNG gọi `tsc` lần hai (C2): bước `typecheck` đã xác nhận
 * kiểu, nên chỉ dựng Pascal (có đệm, `scripts/pascal-cached.mjs`) rồi
 * `vite build`. `pnpm build` (lệnh ngoài verify) vẫn giữ `tsc && vite build`.
 *
 * Cấm báo "đạt" cho bước chưa chạy (CLAUDE.md mục E.10). Bảng tổng kết chỉ in
 * trạng thái lấy từ mã thoát thật; bước chưa tới ghi "chưa chạy". Output từng
 * bước được đệm rồi in theo đúng thứ tự bước — các bước chạy song song nên
 * không bao giờ in thẳng ra màn — chỉ có một dòng tiến độ ngắn khi mỗi bước xong.
 */
import { spawn } from 'node:child_process';
import { ESLint } from 'eslint';

const PENDING = 'chưa chạy';
const PASSED = 'đạt';
const FAILED = 'HỎNG';

const T0 = Date.now();
const seconds = (from) => ((Date.now() - from) / 1000).toFixed(1);

/** Luật chặn import vòng — cùng tham số với `check-import-cycles.mjs`. */
const CYCLE_RULE = { 'import/no-cycle': ['error', { maxDepth: '∞', ignoreExternal: true }] };

/** Bảy bước — thứ tự này là thứ tự in log và bảng tổng kết. */
const STEPS = [
  { name: 'typecheck', description: 'tsc --noEmit' },
  { name: 'lint', description: 'bộ luật dự án, --max-warnings 0' },
  { name: 'import vòng', description: 'import/no-cycle — cùng lượt ESLint với lint (C3)' },
  { name: 'test + độ phủ', description: 'vitest run --coverage, ngưỡng domain 90% / lib 80%' },
  { name: 'build', description: 'pnpm pascal && vite build — tsc đã chạy ở bước typecheck' },
  { name: 'kích thước gói', description: 'ngân sách gzip' },
  { name: 'độ dài file', description: 'R-21/R-22 — .ts/.tsx, dòng có nội dung, nhắc 250, hỏng 400, ratchet theo baseline' },
];

/** Chạy một lệnh con, đệm stdout/stderr để in sau mà không trộn với lệnh khác. */
function runBuffered(command, args = []) {
  return new Promise((resolve) => {
    const chunks = [];
    // `shell: true` vì trên Windows `pnpm` là file .cmd, không phải file thực thi.
    const child = spawn(command, args, { shell: true });
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('close', (code) => resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString('utf8') }));
  });
}

/**
 * Một lượt ESLint phục vụ cả "lint" và "import vòng" — chạy ở tiến trình con
 * (`node verify.mjs --lint`), in kết quả hai nhóm dạng JSON ra stdout.
 */
async function lintChild() {
  const eslint = new ESLint({
    extensions: ['ts', 'tsx'],
    reportUnusedDisableDirectives: 'error',
    overrideConfig: { rules: CYCLE_RULE },
  });
  const results = await eslint.lintFiles(['.']);
  const formatter = await eslint.loadFormatter('stylish');

  const bucket = (isCycle) => {
    const filtered = results.map((result) => {
      const messages = result.messages.filter((m) => (m.ruleId === 'import/no-cycle') === isCycle);
      return {
        ...result,
        messages,
        errorCount: messages.filter((m) => m.severity === 2).length,
        warningCount: messages.filter((m) => m.severity === 1).length,
      };
    });
    const problems = filtered.reduce((n, r) => n + r.errorCount + r.warningCount, 0);
    // `--max-warnings 0`: một cảnh báo cũng là hỏng, giống `pnpm lint`.
    return { code: problems > 0 ? 1 : 0, output: formatter.format(filtered) };
  };

  process.stdout.write(JSON.stringify({ lint: bucket(false), cycles: bucket(true) }));
}

async function runLintAndCycles() {
  const run = await runBuffered('node', ['scripts/verify.mjs', '--lint']);
  try {
    // stderr của tiến trình con (cảnh báo deprecated…) có thể đứng trước JSON.
    return JSON.parse(run.output.slice(run.output.lastIndexOf('{"lint"')));
  } catch {
    // ESLint tự sập (cấu hình hỏng, hết bộ nhớ…): cả hai bước hỏng, kèm nguyên log.
    const failed = { code: run.code || 1, output: run.output };
    return { lint: failed, cycles: failed };
  }
}

function printStep(label, output) {
  console.log(`\n${'='.repeat(72)}`);
  console.log(`▶ ${label}`);
  console.log('='.repeat(72));
  if (output) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`);
}

async function main() {
  const results = STEPS.map((step) => ({ step, status: PENDING, output: '', time: '' }));
  const byName = Object.fromEntries(results.map((r) => [r.step.name, r]));

  /** Ghi kết quả thật của một bước (từ mã thoát) và in một dòng tiến độ. */
  const record = (name, started, { code, output }) => {
    const entry = byName[name];
    entry.status = code === 0 ? PASSED : FAILED;
    entry.code = code;
    entry.output = output;
    entry.time = `${seconds(started)} s`;
    console.log(`[${seconds(T0)} s] ${name}: ${entry.status} (${entry.time})`);
    return code === 0;
  };

  const step = (name, command, args) => {
    const started = Date.now();
    return runBuffered(command, args).then((run) => record(name, started, run));
  };

  const testDone = step('test + độ phủ', 'pnpm', [
    'coverage',
    '--coverage.reporter=text',
    '--coverage.reporter=json-summary',
  ]);
  const lengthDone = step('độ dài file', 'pnpm', ['length']);
  const typecheckDone = step('typecheck', 'pnpm', ['typecheck']);
  const lintStarted = Date.now();
  const lintDone = runLintAndCycles().then(({ lint, cycles }) => {
    const lintOk = record('lint', lintStarted, lint);
    const cyclesOk = record('import vòng', lintStarted, cycles);
    return lintOk && cyclesOk;
  });

  const buildDone = Promise.all([typecheckDone, lintDone]).then(async ([typesOk, lintOk]) => {
    if (!typesOk || !lintOk) return false;
    if (!(await step('build', 'pnpm pascal && pnpm exec vite build'))) return false;
    return step('kích thước gói', 'pnpm', ['size']);
  });

  await Promise.all([testDone, lengthDone, buildDone]);

  for (const { step: s, output } of results) {
    printStep(`${s.name} — ${s.description}`, output);
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`KIỂM TỔNG — ${seconds(T0)} s`);
  console.log('='.repeat(72));

  for (const { step: s, status, time } of results) {
    console.log(`  ${status.padEnd(9)} ${s.name.padEnd(16)} ${time}`);
  }

  console.log('');

  const failed = results.find((r) => r.status === FAILED);
  if (failed !== undefined) {
    console.error(
      `Hỏng ở bước "${failed.step.name}" (mã thoát ${failed.code}). ` +
        'Sửa mã cho đạt, không hạ ngưỡng và không tắt luật.\n',
    );
    process.exit(failed.code || 1);
  }

  console.log('Tất cả các bước đều đạt.\n');
}

(process.argv[2] === '--lint' ? lintChild() : main()).catch((error) => {
  console.error(error);
  process.exit(1);
});
