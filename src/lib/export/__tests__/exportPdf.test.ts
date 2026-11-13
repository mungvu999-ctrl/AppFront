import { describe, expect, it } from 'vitest';

import type { Violation } from '@/domain/rules/registry';
import {
  SAMPLE_BUILDING,
  SAMPLE_ROOM_COUNT,
  sampleDoorId,
  sampleLevelId,
  sampleRoomId,
  sampleWallId,
} from '@/domain/spatial/__fixtures__/sampleBuilding';

import {
  buildAttachmentsPage,
  buildCoverPage,
  buildPdfDocument,
  buildPdfFooter,
  BUILDING_SCOPE_LABEL,
  NO_VIOLATIONS_TEXT,
  PDF_COVER_TITLE,
  type ExportPdfInput,
  type PdfAttachmentInput,
  renderPdfHtml,
} from '../exportPdf';
import { PDF_FONT, PDF_SECTION_KINDS, type PdfDocument, type PdfPage } from '../pdfSchema';

/* -------------------------------------------------------------------------- */
/* Fixtures: the standard sample building plus a small, known rule run.        */
/* -------------------------------------------------------------------------- */

const EXPORTED_AT = new Date('2026-08-17T07:32:05+07:00');
const TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DATA_VERSION = 'r128';
const PREPARER_NAME = 'Vũ Xuân Mừng';
const PREPARER_NOTE = 'Đã đối chiếu với bản khảo sát hiện trạng.';

function violationOf(overrides: Partial<Violation>): Violation {
  return {
    ruleCode: 'WALL-THICKNESS',
    severity: 'critical',
    levelId: sampleLevelId(0),
    entityId: sampleWallId(0),
    message: `tường ${sampleWallId(0)} mỏng hơn mức tối thiểu`,
    suggestion: 'tăng bề dày tường lên ít nhất 90 mm',
    ...overrides,
  };
}

/**
 * Deliberately out of severity order, so the sorted table proves itself.
 * Penalties: 8 + 8 + 3 + 1 = 20, so the cover must read 80/100.
 */
const SAMPLE_VIOLATIONS: readonly Violation[] = [
  violationOf({
    ruleCode: 'ROOM-NAME',
    severity: 'suggestion',
    levelId: sampleLevelId(2),
    entityId: sampleRoomId(2),
    message: `phòng ${sampleRoomId(2)} chưa có tên sử dụng`,
    suggestion: 'Đặt tên phòng theo công năng',
  }),
  violationOf({}),
  violationOf({
    ruleCode: 'DOOR-WIDTH',
    severity: 'warning',
    entityId: sampleDoorId(0),
    message: `cửa ${sampleDoorId(0)} hẹp hơn 800 mm`,
    suggestion: 'mở rộng cửa lên ít nhất 800 mm',
  }),
  violationOf({
    ruleCode: 'LEVEL-ORDER',
    severity: 'critical',
    levelId: null,
    entityId: sampleLevelId(1),
    message: 'cao độ các tầng không tăng dần',
    suggestion: 'kiểm tra lại cao độ từng tầng',
  }),
];

const SAMPLE_ATTACHMENTS: readonly PdfAttachmentInput[] = [
  {
    id: 'view-front',
    title: 'Phối cảnh mặt trước',
    captionText: 'Nhìn từ trục A về trục D.',
    pngDataUrl: 'data:image/png;base64,QUFBQQ==',
  },
  {
    id: 'view-top',
    title: 'Phối cảnh từ trên xuống',
    pngDataUrl: 'data:image/png;base64,QkJCQg==',
  },
];

function baseInput(): ExportPdfInput {
  return {
    graph: SAMPLE_BUILDING,
    violations: SAMPLE_VIOLATIONS,
    dataVersion: DATA_VERSION,
    exportedAt: EXPORTED_AT,
    preparer: { name: PREPARER_NAME, note: PREPARER_NOTE },
    timeZone: TIME_ZONE,
  };
}

function pageOf<Kind extends PdfPage['kind']>(
  document: PdfDocument,
  kind: Kind,
): Extract<PdfPage, { kind: Kind }> {
  const page = document.pages.find((candidate): candidate is Extract<PdfPage, { kind: Kind }> =>
    candidate.kind === kind,
  );

  if (page === undefined) {
    throw new Error(`The document has no ${kind} page.`);
  }

  return page;
}

function coverField(document: PdfDocument, label: string): string {
  const field = pageOf(document, 'cover').fields.find((entry) => entry.label === label);

  if (field === undefined) {
    throw new Error(`The cover has no field labelled ${label}.`);
  }

  return field.text;
}

/* -------------------------------------------------------------------------- */
/* Assembly: sections, order, footers.                                         */
/* -------------------------------------------------------------------------- */

describe('buildPdfDocument', () => {
  it('lays out the cover and every selected section, numbering each footer', () => {
    const document = buildPdfDocument({ ...baseInput(), attachments: SAMPLE_ATTACHMENTS });

    expect(document.pages.map((page) => page.kind)).toEqual([
      'cover',
      'levelSummary',
      'roomAreas',
      'violations',
      'attachments',
    ]);
    expect(document.pages.map((page) => page.footer.pageText)).toEqual([
      'Trang 1/5',
      'Trang 2/5',
      'Trang 3/5',
      'Trang 4/5',
      'Trang 5/5',
    ]);

    for (const page of document.pages) {
      expect(page.footer.versionText).toBe(`Phiên bản dữ liệu ${DATA_VERSION}`);
    }
  });

  it('keeps only the chosen sections, in schema order, and renumbers', () => {
    const document = buildPdfDocument({
      ...baseInput(),
      // Deliberately backwards: the dossier must ignore the asked-for order.
      sections: ['roomAreas', 'levelSummary'],
    });

    expect(document.pages.map((page) => page.kind)).toEqual(['cover', 'levelSummary', 'roomAreas']);
    expect(document.pages.map((page) => page.footer.pageText)).toEqual([
      'Trang 1/3',
      'Trang 2/3',
      'Trang 3/3',
    ]);
  });

  it('drops the attachments section when there is no image to show', () => {
    const document = buildPdfDocument({ ...baseInput(), sections: [...PDF_SECTION_KINDS] });

    expect(document.pages.map((page) => page.kind)).toEqual([
      'cover',
      'levelSummary',
      'roomAreas',
      'violations',
    ]);
  });

  it('carries the embedded Vietnamese-capable font contract', () => {
    const document = buildPdfDocument(baseInput());

    expect(document.font).toBe(PDF_FONT);
    expect(document.font.mustEmbed).toBe(true);
    expect(document.font.family.length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* The cover.                                                                  */
/* -------------------------------------------------------------------------- */

describe('buildCoverPage', () => {
  it('states project, date, preparer and the three headline figures, formatted', () => {
    const document = buildPdfDocument(baseInput());
    const cover = pageOf(document, 'cover');

    expect(cover.title).toBe(PDF_COVER_TITLE);
    expect(cover.projectNameText).toBe('Chung cư Hoàng Anh');
    expect(coverField(document, 'Địa chỉ')).toBe('12 Nguyễn Huệ, Quận 1');
    expect(coverField(document, 'Ngày lập')).toBe('17/08/2026');
    expect(coverField(document, 'Người lập')).toBe(PREPARER_NAME);
    expect(coverField(document, 'Phiên bản dữ liệu')).toBe(DATA_VERSION);
    expect(coverField(document, 'Tổng diện tích')).toBe('248,60 m²');
    expect(coverField(document, 'Điểm chất lượng')).toBe('80/100');
    expect(coverField(document, 'Tổng vi phạm')).toBe('4');
    expect(cover.preparerNoteText).toBe(PREPARER_NOTE);
  });

  it('leaves the preparer note off entirely when none was written', () => {
    const cover = buildCoverPage(
      { ...baseInput(), preparer: { name: PREPARER_NAME } },
      buildPdfFooter(1, 1, DATA_VERSION),
    );

    expect('preparerNoteText' in cover).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The level summary.                                                          */
/* -------------------------------------------------------------------------- */

describe('buildLevelSummaryPage', () => {
  it('writes one row per level plus the building-wide row, all counts formatted', () => {
    const page = pageOf(buildPdfDocument(baseInput()), 'levelSummary');

    // Level 0 carries one critical and one warning: 100 − 11 = 89.
    expect(page.rows.map((row) => row.cells)).toEqual([
      ['Level 0', '12', '4', '4', '2', '89'],
      ['Level 1', '12', '4', '4', '0', '100'],
      ['Level 2', '12', '3', '4', '1', '99'],
      ['Level 3', '12', '3', '4', '0', '100'],
      [BUILDING_SCOPE_LABEL, '—', '—', '—', '1', '92'],
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* The rooms-and-areas table: the standard sample set, to the digit.           */
/* -------------------------------------------------------------------------- */

describe('buildRoomAreasPage', () => {
  it('lists exactly the 14 sample rooms and closes on 248,60 m²', () => {
    const page = pageOf(buildPdfDocument(baseInput()), 'roomAreas');

    expect(page.rows).toHaveLength(SAMPLE_ROOM_COUNT);
    expect(page.rows).toHaveLength(14);
    expect(page.totalArea).toEqual({ label: 'Tổng diện tích', text: '248,60 m²' });
  });

  it('prints each room the way its QC card reads: name, level, usage, area', () => {
    const page = pageOf(buildPdfDocument(baseInput()), 'roomAreas');
    const areaCells = page.rows.map((row) => row.cells[3]);

    expect(areaCells.filter((cell) => cell === '17,00 m²')).toHaveLength(13);
    expect(areaCells.filter((cell) => cell === '27,60 m²')).toHaveLength(1);

    const firstRow = page.rows[0];
    expect(firstRow?.cells).toEqual(['Room 0', 'Level 0', 'phòng ngủ', '17,00 m²']);
    // Sample rooms are human-approved, and only that earns the verified code.
    expect(page.rows.every((row) => row.statusCode === 'verified')).toBe(true);
  });

  it('UX-23: mọi tầng chưa xác nhận tỷ lệ thì mọi diện tích ghi "(tạm)"', () => {
    const everyLevelId = SAMPLE_BUILDING.levels.map((level) => String(level.id));
    const page = pageOf(buildPdfDocument({ ...baseInput(), provisionalLevelIds: everyLevelId }), 'roomAreas');

    expect(page.rows[0]?.cells[3]).toBe('17,00 m² (tạm)');
    expect(page.totalArea.text).toBe('≈ 248,60 m² (tạm)');
  });

  it('R10: chỉ tầng chưa tin được mới bị đánh dấu, và tổng gọi tên tầng đó', () => {
    const [first, second] = SAMPLE_BUILDING.levels;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    const page = pageOf(buildPdfDocument({ ...baseInput(), provisionalLevelIds: [String(second.id)] }), 'roomAreas');
    const onFirst = page.rows.filter((row) => row.cells[1] === first.name);
    const onSecond = page.rows.filter((row) => row.cells[1] === second.name);

    expect(onFirst.length).toBeGreaterThan(0);
    expect(onSecond.length).toBeGreaterThan(0);
    expect(onFirst.every((row) => row.cells[3]?.includes('(tạm)') === false)).toBe(true);
    expect(onSecond.every((row) => row.cells[3]?.includes('(tạm)') === true)).toBe(true);
    expect(page.totalArea.text).toBe(`≈ 248,60 m² (tạm) ở ${second.name}`);
  });

  it('R10: trang bìa cũng mang dấu, không chỉ trang Diện tích phòng', () => {
    const everyLevelId = SAMPLE_BUILDING.levels.map((level) => String(level.id));
    const cover = pageOf(buildPdfDocument({ ...baseInput(), provisionalLevelIds: everyLevelId }), 'cover');
    const total = cover.fields.find((field) => field.label === 'Tổng diện tích');

    expect(total?.text).toBe('≈ 248,60 m² (tạm)');
  });

  it('không tầng nào tạm thì không dấu nào xuất hiện, kể cả trang bìa', () => {
    const document = buildPdfDocument(baseInput());

    expect(pageOf(document, 'roomAreas').totalArea.text).toBe('248,60 m²');
    expect(pageOf(document, 'cover').fields.find((field) => field.label === 'Tổng diện tích')?.text).toBe(
      '248,60 m²',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The violations table.                                                       */
/* -------------------------------------------------------------------------- */

describe('buildViolationsPage', () => {
  it('sorts worst first and prints level names, not level ids', () => {
    const page = pageOf(buildPdfDocument(baseInput()), 'violations');

    expect(page.rows.map((row) => row.cells[0])).toEqual([
      'WALL-THICKNESS',
      'LEVEL-ORDER',
      'DOOR-WIDTH',
      'ROOM-NAME',
    ]);
    expect(page.rows.map((row) => row.cells[1])).toEqual([
      'Nghiêm trọng',
      'Nghiêm trọng',
      'Cảnh báo',
      'Gợi ý',
    ]);
    expect(page.rows.map((row) => row.cells[3])).toEqual([
      'Level 0',
      BUILDING_SCOPE_LABEL,
      'Level 0',
      'Level 2',
    ]);
    expect(page.rows.map((row) => row.statusCode)).toEqual([
      'violation',
      'violation',
      'attention',
      'neutral',
    ]);
    expect(page.emptyText).toBeUndefined();
  });

  it('replaces the empty table with a sentence, and the cover with a clean score', () => {
    const document = buildPdfDocument({ ...baseInput(), violations: [] });
    const page = pageOf(document, 'violations');

    expect(page.rows).toHaveLength(0);
    expect(page.emptyText).toBe(NO_VIOLATIONS_TEXT);
    expect(coverField(document, 'Điểm chất lượng')).toBe('100/100');
    expect(coverField(document, 'Tổng vi phạm')).toBe('0');
  });
});

/* -------------------------------------------------------------------------- */
/* The attachments.                                                            */
/* -------------------------------------------------------------------------- */

describe('buildAttachmentsPage', () => {
  it('passes images through and captions an uncaptioned one with its title', () => {
    const page = buildAttachmentsPage(SAMPLE_ATTACHMENTS, buildPdfFooter(1, 1, DATA_VERSION));

    expect(page.images).toHaveLength(2);
    expect(page.images[0]?.captionText).toBe('Nhìn từ trục A về trục D.');
    expect(page.images[1]?.captionText).toBe('Phối cảnh từ trên xuống');
    expect(page.images[1]?.pngDataUrl).toBe('data:image/png;base64,QkJCQg==');
  });
});

/* -------------------------------------------------------------------------- */
/* Every string in the dossier is finished display text.                       */
/* -------------------------------------------------------------------------- */

/** Walks the document collecting every string except the image payloads. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    out.push(value);
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, out);
    }
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      if (key !== 'pngDataUrl') {
        collectStrings(entry, out);
      }
    }
  }
}

describe('every string handed to the PDF', () => {
  it('is non-empty, trimmed, and free of unformatted numbers or leaked values', () => {
    const document = buildPdfDocument({ ...baseInput(), attachments: SAMPLE_ATTACHMENTS });
    const strings: string[] = [];
    collectStrings(document, strings);

    expect(strings.length).toBeGreaterThan(0);

    // A dot-decimal such as `248.6` is a raw JavaScript number that skipped
    // the formatter. Vietnamese grouping dots (`1.234`) always precede three
    // digits, so one or two digits after a dot can only be a leak.
    const rawDecimal = /\d\.\d{1,2}(?![\d.])/u;
    const leakedValue = /NaN|Infinity|undefined|Invalid Date|\[object/u;

    for (const text of strings) {
      expect(text).not.toBe('');
      expect(text).toBe(text.trim());
      expect(text).not.toMatch(rawDecimal);
      expect(text).not.toMatch(leakedValue);
    }
  });

  it('writes every figure in Vietnamese notation with its unit attached', () => {
    const document = buildPdfDocument(baseInput());
    const rooms = pageOf(document, 'roomAreas');

    // Comma decimals, unit after a space — exactly what `formatArea` writes.
    for (const row of rooms.rows) {
      expect(row.cells[3]).toMatch(/^\d{1,3}(\.\d{3})*,\d{2} m²$/u);
    }
    expect(rooms.totalArea.text).toMatch(/^\d{1,3}(\.\d{3})*,\d{2} m²$/u);
  });
});

describe('renderPdfHtml', () => {
  it('dựng một trang in có đủ trang của hồ sơ và thoát ký tự HTML', () => {
    const document = buildPdfDocument(baseInput());
    const html = renderPdfHtml(document);

    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html.match(/<section>/g)).toHaveLength(document.pages.length);
    expect(html).not.toContain('<script');
  });
});
