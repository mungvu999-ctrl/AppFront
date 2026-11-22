/**
 * K-10 — máy canh R-69: không chữ nào trong sản phẩm hứa một tính năng chưa có
 * ("sắp ra mắt", "sẽ có ở bản sau", "coming soon"…). Thiếu tính năng thì gỡ nút
 * (cờ `false`, affordance rời khỏi DOM), không treo lời hứa.
 *
 * Quét mọi `.ts`/`.tsx`/`.json` dưới `src/` (bỏ test, stories, mã Pascal gốc), bỏ chú
 * thích trong mã — tài liệu được phép nhắc các cụm này để giải thích. Câu nói THẬT về
 * giới hạn ("Chưa hỗ trợ tự quay; bạn vẫn quay được bằng tay.") vào {@link ALLOWED}
 * kèm lý do.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROMISE_WORDS =
  /sắp ra mắt|sắp có|đang phát triển|chưa triển khai|tính năng này chưa|sẽ có sớm|sẽ sớm có|(?:ở|trong) (?:các )?(?:phiên )?bản (?:sau|tới)|coming soon|not implemented|chưa hỗ trợ/iu;

/** Câu khớp mẫu nhưng nói đúng sự thật hiện tại, không hứa gì — tệp + câu, không chỉ tệp. */
const ALLOWED: readonly { readonly file: string; readonly text: string; readonly why: string }[] = [
  {
    file: 'i18n/vi.json',
    text: 'Chưa hỗ trợ tự quay; bạn vẫn quay được bằng tay.',
    why: 'Nói giới hạn thật của thư viện mô hình (canAutoSpin: false) kèm cách làm thay, không hứa ngày có.',
  },
];

const SRC = resolve(process.cwd(), 'src');
const SKIP_DIR = /^(?:__tests__|__fixtures__|upstream)$/u;
const SKIP_FILE = /\.(?:test|stories)\.tsx?$/u;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIR.test(entry.name) ? [] : sourceFiles(full);
    if (SKIP_FILE.test(entry.name)) return [];
    return /\.(?:tsx?|json)$/u.test(entry.name) ? [full] : [];
  });
}

/** Bỏ chú thích khối và dòng; giữ số dòng để báo đúng chỗ. */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//gu, (block) => block.replace(/[^\n]/gu, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1');
}

interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

function findPromiseWords(file: string, raw: string): Hit[] {
  const text = file.endsWith('.json') ? raw : stripComments(raw);
  return text.split('\n').flatMap((line, index) =>
    PROMISE_WORDS.test(line) ? [{ file, line: index + 1, text: line.trim() }] : [],
  );
}

function isAllowed(hit: Hit): boolean {
  return ALLOWED.some((entry) => entry.file === hit.file && hit.text.includes(entry.text));
}

const FILES = sourceFiles(SRC).map((full) => ({
  file: relative(SRC, full).split('\\').join('/'),
  raw: readFileSync(full, 'utf8'),
}));

describe('chữ hứa tính năng chưa có (K-10, R-69)', () => {
  it('quét được mã nguồn (không thì bài dưới xanh rỗng)', () => {
    expect(FILES.length).toBeGreaterThan(500);
    expect(FILES.some(({ file }) => file === 'i18n/vi.json')).toBe(true);
  });

  it('bộ dò bắt chuỗi hứa trong mã và trong vi.json, bỏ qua chú thích', () => {
    expect(findPromiseWords('a.tsx', "const label = 'Tính năng sắp ra mắt';")).toHaveLength(1);
    expect(findPromiseWords('a.tsx', 'const t = `Sẽ có ở bản sau`;')).toHaveLength(1);
    expect(findPromiseWords('i18n/vi.json', '  "soon": "Coming soon"')).toHaveLength(1);
    expect(findPromiseWords('a.ts', '// chưa hỗ trợ ở máy chủ')).toHaveLength(0);
    expect(findPromiseWords('a.ts', '/* sắp ra mắt */ const x = 1;')).toHaveLength(0);
  });

  it('mỗi dòng trong danh sách cho phép vẫn còn trong mã (danh sách không mục)', () => {
    for (const entry of ALLOWED) {
      const source = FILES.find(({ file }) => file === entry.file);
      expect(source?.raw, entry.file).toContain(entry.text);
    }
  });

  it('không chuỗi nào trong sản phẩm hứa tính năng chưa có', () => {
    const hits = FILES.flatMap(({ file, raw }) => findPromiseWords(file, raw))
      .filter((hit) => !isAllowed(hit))
      .map((hit) => `${hit.file}:${hit.line}: ${hit.text}`);
    expect(hits).toEqual([]);
  });
});
