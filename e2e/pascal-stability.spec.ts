/**
 * Độ ổn định của trang 3D Pascal (`/editor3d.html`) — đưa các kịch bản đo tay của vòng 8
 * (`F:/runs/m8/manifest.mjs`, `floors.mjs`) vào repo, chạy với máy chủ giả `installFakeApi`.
 *
 * Năm điều được khẳng định:
 *   1. Thư viện chậm (`GET /api/library` trễ): manifest cảnh y như lần mở không trễ; `ready()` không true trước khi
 *      thư viện về (nội dung cảnh không được phụ thuộc tốc độ mạng — `serverLibrary.ts`).
 *   2. Concept chậm (`GET …/design-concept` trễ): manifest y như lần không trễ.
 *   3. Thư viện 500 → cảnh vẫn dựng, nguồn `fallback:<lý do>`, câu báo tiếng Việt nhìn thấy; 403/404 → dự phòng im lặng.
 *   4. Đổi tầng nhanh ngay sau khi mở: tầng cuối đúng, nhãn "Đang chuẩn bị tầng…" tự tắt, tầng đang hiện báo sẵn sàng,
 *      số món của tầng không đổi so với lúc vừa mở.
 *   5. Chỉ xem thì không ghi: mọi ca trên đếm `PUT/POST/PATCH/DELETE` tới `/api/` (trừ `/api/auth/*`) = 0.
 *
 * Không khẳng định thời gian tuyệt đối (CI/máy bận chậm) — chỉ thứ tự và trạng thái cuối, timeout rộng.
 *
 * Ghi chú: triệu chứng "mất lớp cảnh gốc" thấy một lần ở ch-10 (vòng 8) VẪN CHƯA XÁC ĐỊNH nguyên nhân; ở đây không có
 * ca nào giả định nguyên nhân cho nó. Manifest (tập id món + mẫu `src` + số món + nguồn thư viện/concept) là lưới bắt:
 * nếu triệu chứng lặp lại dưới trễ mạng, ca 1/2 sẽ đỏ vì manifest lệch.
 */
import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';

import { fixtureF1, fixtureF5 } from '../src/lib/pascal/__fixtures__';

import { installFakeApi, type WireGraphDocument } from './fixtures/fakeApi';
import { CONCEPT_FOLDER, conceptState, DEFAULT_CLOSET_FILE, richLibraryBody } from './fixtures/stabilityLibrary';

const PROJECT_ID = 'P-FIXTURE0001';
const VIEWPORT = { width: 1440, height: 900 } as const;
/*
 * TRẦN CHỜ — spec này chỉ kiểm CHỨC NĂNG, không khẳng định thời gian. Mọi hằng `*_TIMEOUT_MS` / `*_CEILING_MS` dưới đây
 * là trần cho runner CI dựng hình bằng phần mềm (không GPU, luồng chính bận dựng tầng hàng chục giây), KHÔNG phải
 * ngân sách UX. Đừng siết chúng để "đo" hiệu năng; đo hiệu năng chuyển tầng làm riêng (kit đo `F:/runs/m10/floor/switch.mjs`).
 */
/** Như `pascal-perf.spec.ts`: gói Pascal lớn, máy bận thì "đã dựng xong" tới muộn. */
const READY_TIMEOUT_MS = 150_000;
/** Bấm hàng tầng khi luồng chính đang dựng tầng trước (6a281dc4: CI không GPU vượt 10 s). */
const LEVEL_CLICK_CEILING_MS = 90_000;
/** Câu báo / lớp "đang chọn" hiện sau khi cảnh đã dựng. */
const UI_SETTLE_CEILING_MS = 30_000;
/** Nhãn "Đang chuẩn bị tầng…" tắt và mọi tầng đang hiện báo sẵn sàng sau loạt đổi tầng. */
const LEVEL_READY_CEILING_MS = 120_000;
/** Mỗi ca mở trang 2 lần (đối chứng + biến thể). */
const TEST_TIMEOUT_MS = 330_000;
const SLOW_MS = 4_000;
/** Trùng `LIBRARY_FALLBACK_NOTICE` (`src/lib/pascal/serverLibrary.ts`) — phần đầu, đủ phân biệt. */
const LIBRARY_NOTICE = 'Chưa tải được thư viện nội thất';

interface ProbeItem {
  readonly id: string;
  readonly src: string | undefined;
}
interface LevelReadiness {
  readonly levelId: string;
  readonly shown: boolean;
  readonly ready: boolean;
}
interface StabilityProbe {
  ready(): boolean;
  counts(): Record<string, number>;
  items(): ProbeItem[];
  node(id: string): unknown;
  levelReadiness(): LevelReadiness[] | null;
  sceneState(): { library?: string; libraryVersion?: string; concept?: string };
}
/** Kiểu của `window` trong `page.evaluate` — hàm truyền vào bị tuần tự hoá nên không gọi được trợ giúp ở mô-đun. */
interface ProbeWindow { __pascalProbe?: StabilityProbe }

interface Manifest {
  readonly nItems: number;
  readonly itemIds: readonly string[];
  /** `id|src` bỏ chuỗi truy vấn (URL ký đổi mỗi lượt). */
  readonly itemSrc: readonly string[];
  readonly library: string | undefined;
  readonly libraryVersion: string | undefined;
  readonly concept: string | undefined;
}

/** Một mẫu thư viện máy chủ hợp lệ (`LibraryItemSchema`) trỏ về GLB tự host, để nguồn là `server`. */
const libraryBody = (requestUrl: string): unknown[] => [
  {
    depthMm: 400,
    fileSizeBytes: 1000,
    group: 'decor',
    heightMm: 400,
    id: 'e2e-stability-decor',
    modelUrl: new URL('/pascal/items/ac-block/model.glb', requestUrl).href,
    name: 'Mẫu thử ổn định',
    source: 'catalogue',
    triangleCount: 100,
    widthMm: 400,
  },
];

interface LibraryMode {
  readonly delayMs?: number;
  readonly status?: 200 | 403 | 404 | 500;
  /** Thư viện nhiều mẫu (24, đủ 9 nhóm) thay cho một mẫu duy nhất. */
  readonly rich?: boolean;
}

interface OpenOptions {
  readonly graphDoc: WireGraphDocument;
  readonly library?: LibraryMode;
  readonly conceptDelayMs?: number;
  /** Concept `done` thật (phong cách + mẫu theo vai); vắng = máy chủ giả trả 404 (không concept). */
  readonly concept?: boolean;
}

interface Opened {
  readonly page: Page;
  /** Lượt ghi tới `/api/` ngoài đăng nhập/làm mới phiên. */
  readonly writes: string[];
  /** `ready()` đọc ngay trước khi trả thư viện bị trễ; `undefined` khi không trễ. */
  readonly readyBeforeLibrary: { value: boolean | null | undefined };
  /** Câu báo thư viện đã từng hiện từ lúc mở trang (toast tin tự gỡ sau `INFO_TOAST_MS` = 6 s, nên phải canh từ đầu). */
  readonly noticeSeen: () => boolean;
  /** Số lượt `design-concept` đã bị giữ trễ (ca concept chậm phải > 0, không thì ca rỗng). */
  readonly conceptDelayed: { count: number };
}

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Mở trang 3D trong một ngữ cảnh mới (cache lạnh), gắn máy chủ giả + các tuyến trễ/lỗi. Chưa chờ dựng. */
async function open(browser: Browser, { graphDoc, library = {}, conceptDelayMs = 0, concept = false }: OpenOptions): Promise<Opened> {
  const page = await browser.newPage({ viewport: VIEWPORT });
  await installFakeApi(page, { projectId: PROJECT_ID, graphDoc });
  const writes: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/') && request.method() !== 'GET') {
      writes.push(`${request.method()} ${pathname}`);
    }
  });
  const readyBeforeLibrary: Opened['readyBeforeLibrary'] = { value: undefined };
  // Tuyến đăng ký SAU thắng tuyến của `installFakeApi`; `fallback()` trả về cho máy chủ giả.
  await page.route(
    (url) => url.pathname === '/api/library',
    async (route) => {
      if (library.delayMs !== undefined) {
        await delay(library.delayMs);
        readyBeforeLibrary.value = await page.evaluate(() => (window as unknown as ProbeWindow).__pascalProbe?.ready() ?? null).catch(() => null);
      }
      const status = library.status ?? 200;
      await route.fulfill(
        status === 200
          ? { status, json: library.rich === true ? richLibraryBody(route.request().url()) : libraryBody(route.request().url()) }
          : { status, json: { code: status === 500 ? 'INTERNAL' : status === 403 ? 'FORBIDDEN' : 'NOT_FOUND', requestId: 'req-e2e' } },
      );
    },
  );
  if (concept) {
    await page.route(
      (url) => url.pathname.endsWith('/design-concept'),
      (route) => route.fulfill({ status: 200, json: conceptState() }),
    );
  }
  const conceptDelayed = { count: 0 };
  if (conceptDelayMs > 0) {
    await page.route(
      (url) => url.pathname.endsWith('/design-concept'),
      async (route) => {
        conceptDelayed.count += 1;
        await delay(conceptDelayMs);
        await route.fallback();
      },
    );
  }
  let seen = false;
  void page
    .getByText(LIBRARY_NOTICE)
    .first()
    .waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS })
    .then(
      () => {
        seen = true;
      },
      () => {},
    );
  await page.goto(`/editor3d.html?project=${PROJECT_ID}&probe=1`);
  return { page, writes, readyBeforeLibrary, noticeSeen: () => seen, conceptDelayed };
}

async function waitBuilt(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const probe = (window as unknown as ProbeWindow).__pascalProbe;
      return probe?.ready() === true && (probe.counts()['wall'] ?? 0) > 0 && probe.items().length > 0;
    },
    null,
    { timeout: READY_TIMEOUT_MS },
  );
}

const manifestOf = (page: Page): Promise<Manifest> =>
  page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pascalProbe!;
    const items = probe.items();
    const state = probe.sceneState();
    return {
      nItems: items.length,
      itemIds: items.map((item) => item.id).sort(),
      itemSrc: items.map((item) => `${item.id}|${String(item.src).split('?')[0]}`).sort(),
      library: state.library,
      libraryVersion: state.libraryVersion,
      concept: state.concept,
    };
  });

/** Số món theo tầng: đi `parentId` lên tới node `level`, khoá bằng tên tầng. */
const itemsPerLevel = (page: Page): Promise<Record<string, number>> =>
  page.evaluate(() => {
    const probe = (window as unknown as ProbeWindow).__pascalProbe!;
    const out: Record<string, number> = {};
    for (const item of probe.items()) {
      let node = probe.node(item.id) as { type?: string; name?: string; parentId?: string } | null;
      for (let hop = 0; node && node.type !== 'level' && hop < 10; hop += 1) {
        node = node.parentId ? (probe.node(node.parentId) as typeof node) : null;
      }
      const key = node?.type === 'level' ? String(node.name) : '?';
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  });

/** Lần mở không trễ, mỗi tệp chạy một lần (worker dùng chung mô-đun). */
let baseline: Promise<Manifest> | undefined;
const baselineManifest = (browser: Browser): Promise<Manifest> => {
  baseline ??= (async () => {
    const { page, writes } = await open(browser, { graphDoc: f1 });
    try {
      await waitBuilt(page);
      expect(writes, 'mở để xem không được ghi gì').toEqual([]);
      return await manifestOf(page);
    } finally {
      await page.context().close();
    }
  })();
  return baseline;
};

const f1 = fixtureF1({ ext: false }).doc as unknown as WireGraphDocument;
const f1Ext = fixtureF1({ ext: true }).doc as unknown as WireGraphDocument;

test.describe('Ổn định trang 3D Pascal', () => {
  test.describe.configure({ timeout: TEST_TIMEOUT_MS });

  test('thư viện chậm: manifest như lần không trễ, ready() không true trước khi thư viện về', async ({ browser }) => {
    const base = await baselineManifest(browser);
    expect(base.library).toBe('server');
    expect(base.libraryVersion).toMatch(/^lib-1-/u);

    const { page, writes, readyBeforeLibrary } = await open(browser, { graphDoc: f1, library: { delayMs: SLOW_MS } });
    try {
      await waitBuilt(page);
      console.log(`đối chứng: ${base.nItems} món · ${base.library} · ${base.libraryVersion} · concept ${base.concept} · ready lúc thư viện còn treo = ${readyBeforeLibrary.value}`);
      expect(readyBeforeLibrary.value, 'ready() phải chưa true khi thư viện còn treo').toBe(false);
      expect(await manifestOf(page)).toEqual(base);
      expect(writes).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  test('concept chậm: manifest như lần không trễ', async ({ browser }) => {
    const base = await baselineManifest(browser);
    const { page, writes, conceptDelayed } = await open(browser, { graphDoc: f1, conceptDelayMs: SLOW_MS });
    try {
      await waitBuilt(page);
      expect(conceptDelayed.count, 'trang phải đọc design-concept').toBeGreaterThan(0);
      expect(await manifestOf(page)).toEqual(base);
      expect(writes).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  test('thư viện lỗi 500: cảnh vẫn dựng, nguồn fallback, có câu báo tiếng Việt', async ({ browser }) => {
    const { page, writes, noticeSeen } = await open(browser, { graphDoc: f1, library: { status: 500 } });
    try {
      await waitBuilt(page);
      const { library } = await manifestOf(page);
      expect(library).toMatch(/^fallback:/u);
      await expect.poll(noticeSeen, { timeout: UI_SETTLE_CEILING_MS }).toBe(true);
      expect(writes).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  for (const [status, source] of [
    [403, 'fallback:forbidden'],
    [404, 'fallback:notFound'],
  ] as const) {
    test(`thư viện ${status}: dự phòng im lặng, không câu báo`, async ({ browser }) => {
      const { page, writes, noticeSeen } = await open(browser, { graphDoc: f1, library: { status } });
      try {
        await waitBuilt(page);
        expect((await manifestOf(page)).library).toBe(source);
        // Câu báo đến qua một promise đã xong trước `ready()`; chừa vài nhịp cho React vẽ rồi mới khẳng định chưa từng hiện.
        await page.waitForTimeout(1_000);
        expect(noticeSeen()).toBe(false);
        expect(writes).toEqual([]);
      } finally {
        await page.context().close();
      }
    });
  }

  test('đổi tầng nhanh ngay sau khi mở: tầng cuối đúng, nhãn tự tắt, tầng sẵn sàng, số món không đổi', async ({ browser }) => {
    const f5 = fixtureF5();
    expect(f5.expected.levels).toBeGreaterThanOrEqual(2);
    const levelNames = (f5.doc.graph.levels as readonly { readonly name: string }[]).map((level) => level.name);
    const { page, writes } = await open(browser, { graphDoc: f5.doc as unknown as WireGraphDocument });
    try {
      // Hàng tầng của bộ chọn tầng nổi (vendor `floating-level-selector.tsx`, mỗi hàng `div.group/level`).
      const button = (name: string) => page.locator('div[class~="group/level"]').getByRole('button', { name, exact: true });
      // Bấm ngay khi hàng tầng hiện (có thể trước khi cảnh dựng xong).
      await button(levelNames[1]!).click({ timeout: READY_TIMEOUT_MS });
      const sequence = [2, 0, 3, 1, 2, 3].map((index) => levelNames[index % levelNames.length]!);
      for (const name of sequence) {
        await button(name).click({ timeout: LEVEL_CLICK_CEILING_MS });
        await page.waitForTimeout(150);
      }
      const last = sequence.at(-1)!;

      await waitBuilt(page);
      // Tầng cuối đúng: hàng của nó mang nền "đang chọn" của bộ chọn tầng vendor.
      await expect(button(last).locator('..')).toHaveClass(/bg-white\/10/u, { timeout: UI_SETTLE_CEILING_MS });
      // Nhãn "Đang chuẩn bị tầng…" (nếu có) phải tự tắt.
      const status = page.getByTestId('level-warm-status');
      if ((await status.count()) > 0) await expect(status).toHaveText('', { timeout: LEVEL_READY_CEILING_MS });
      // Mọi tầng đang hiện báo sẵn sàng (luật w3 phải đã nạp: `null` = chưa áp → đỏ).
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const rows = (window as unknown as ProbeWindow).__pascalProbe?.levelReadiness();
              if (!rows) return 'chưa có levelReadiness';
              const shown = rows.filter((row) => row.shown);
              // Bất biến: tầng đang hiện chưa sẵn sàng thì phải có nhãn hoặc thông báo kẹt — UI không được im lặng.
              const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? '';
              if (shown.some((row) => !row.ready) && text('level-warm-status') === '' && text('level-warm-stalled') === '') {
                const again = (window as unknown as ProbeWindow).__pascalProbe?.levelReadiness()?.filter((row) => row.shown) ?? [];
                if (again.some((row) => !row.ready)) return `IM LẶNG: ${JSON.stringify(again)}`;
              }
              return shown.length > 0 && shown.every((row) => row.ready) ? 'ready' : 'pending';
            }),
          { timeout: LEVEL_READY_CEILING_MS },
        )
        .not.toBe('pending');
      // Kết thúc poll ở 'ready'; chuỗi "IM LẶNG…" làm đỏ ngay với dòng trạng thái kèm theo.
      expect(
        await page.evaluate(() => {
          const shown = (window as unknown as ProbeWindow).__pascalProbe?.levelReadiness()?.filter((row) => row.shown) ?? [];
          return shown.length > 0 && shown.every((row) => row.ready) ? 'ready' : JSON.stringify(shown);
        }),
      ).toBe('ready');

      // Số món theo tầng: đúng như một lần mở KHÔNG đổi tầng, và tầng cuối không ít hơn đồ của bộ mẫu.
      const perLevel = await itemsPerLevel(page);
      console.log(`đổi tầng: cuối ${last} · số món theo tầng ${JSON.stringify(perLevel)}`);
      const lastLevelId = (f5.doc.graph.levels as readonly { readonly id: string; readonly name: string }[]).find((l) => l.name === last)?.id;
      const fixtureCount = (f5.doc.graph.furniture as readonly { readonly levelId: string }[]).filter((item) => item.levelId === lastLevelId).length;
      expect(perLevel[last] ?? 0, JSON.stringify(perLevel)).toBeGreaterThanOrEqual(fixtureCount);
      expect(writes, 'đổi tầng chỉ để xem không được ghi gì').toEqual([]);

      const still = await open(browser, { graphDoc: f5.doc as unknown as WireGraphDocument });
      try {
        await waitBuilt(still.page);
        expect(perLevel).toEqual(await itemsPerLevel(still.page));
        expect(still.writes).toEqual([]);
      } finally {
        await still.page.context().close();
      }
    } finally {
      await page.context().close();
    }
  });

  test('concept thật + thư viện nhiều mẫu: concept áp (done), mẫu theo vai của concept có mặt trong cảnh', async ({ browser }) => {
    const { page, writes } = await open(browser, { graphDoc: f1Ext, library: { rich: true }, concept: true });
    try {
      await waitBuilt(page);
      const manifest = await manifestOf(page);
      console.log(`concept thật: ${manifest.nItems} món · ${manifest.library} · concept ${manifest.concept}`);
      expect(manifest.library).toBe('server');
      expect(manifest.concept).toBe('done');
      const folders = new Set(manifest.itemSrc.map((entry) => /\/items\/([^/]+)\/model\.glb/u.exec(entry)?.[1]));
      // Vai tủ áo: mục thư viện concept chọn thay tệp mặc định của vai (hai tủ áo của F1).
      expect(folders.has(CONCEPT_FOLDER), JSON.stringify([...folders])).toBe(true);
      expect(folders.has(DEFAULT_CLOSET_FILE), JSON.stringify([...folders])).toBe(false);
      expect(writes).toEqual([]);
    } finally {
      await page.context().close();
    }
  });

  test('concept thật + thư viện về chậm: cảnh không đổi mẫu âm thầm (manifest như lần không trễ)', async ({ browser }) => {
    const fast = await open(browser, { graphDoc: f1Ext, library: { rich: true }, concept: true });
    let base: Manifest;
    try {
      await waitBuilt(fast.page);
      base = await manifestOf(fast.page);
    } finally {
      await fast.page.context().close();
    }
    const slow = await open(browser, { graphDoc: f1Ext, library: { rich: true, delayMs: SLOW_MS }, concept: true, conceptDelayMs: 1_500 });
    try {
      await waitBuilt(slow.page);
      expect(slow.conceptDelayed.count, 'trang phải đọc design-concept').toBeGreaterThan(0);
      expect(slow.readyBeforeLibrary.value, 'ready() phải chưa true khi thư viện còn treo').toBe(false);
      expect(await manifestOf(slow.page)).toEqual(base);
      expect(slow.writes).toEqual([]);
    } finally {
      await slow.page.context().close();
    }
  });
});
