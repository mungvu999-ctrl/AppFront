// @vitest-environment node
/**
 * K-59: không còn `test.skip(true, ...)` trong `e2e/` và `qa/tests/`. Ở mức đầu tệp hay trong `describe`
 * mẫu đó giết cả nhóm bài mà không ai thấy. ESLint chỉ quét `e2e/` (`qa/` nằm trong `ignorePatterns`),
 * nên bài này phủ cả hai thư mục. Cần bỏ qua lúc chạy thì dùng điều kiện, hoặc `skipWithReason`
 * (`qa/tests/support/skip.ts`) bên trong thân một bài.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOTS = ['e2e', 'qa/tests'];
const BANNED = /\btest\.skip\(\s*true\b/u;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== 'node_modules') yield* files(path);
    } else if (/\.tsx?$/u.test(name)) yield path;
  }
}

describe('K-59 không bỏ qua vô điều kiện', () => {
  it('không tệp e2e/qa nào gọi test.skip(true, ...)', () => {
    const hits = [];
    for (const root of ROOTS) {
      for (const file of files(root)) {
        readFileSync(file, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (BANNED.test(line) && !/^\s*(\/\/|\*)/u.test(line)) hits.push(`${file}:${i + 1}`);
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
