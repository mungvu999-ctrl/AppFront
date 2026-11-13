/**
 * FIX-P0-15: cổng Xử lý đọc N16 `readiness`. Lỗi gốc: có chuỗi kích thước mà `scaleStatus: unresolved`
 * (tỷ lệ tạm) vẫn ra 'ready' — "Sẵn sàng duyệt tầng".
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FloorLayerDocument } from '@/api/schemas/spatialLayer';

import { ProcessingFloorChips } from './ProcessingFloorChips';
import { SAMPLE_SUMMARY, scenarioFor } from './ProcessingScreen.stories';
import { SCALE_ESTIMATED_NOTE } from '@/lib/viewmodel/provisionalScale';

import {
  CALIBRATE_LABEL,
  deriveProcessingGate,
  GEOMETRY_CHECK_SENTENCE,
  GO_REVIEW_LABEL,
  REVIEW_REASON_SENTENCE,
} from './processingGate';
import { toExtractionSummary } from './processingGateway';
import type { ProcessingReviewReason } from './types';

afterEach(cleanup);

/** Tầng có 1 chuỗi kích thước; `extra` thêm `scaleStatus`/`readiness`. */
const documentWith = (extra: Record<string, unknown>) =>
  ({
    dimensions: [{}],
    level: { scaleMillimetresPerPixel: 10 },
    layer: { walls: [], openings: [], furniture: [], rooms: [] },
    ...extra,
  }) as unknown as FloorLayerDocument;

const gateWith = (reviewReasons: readonly ProcessingReviewReason[]) => {
  const onCalibrateScale = vi.fn();
  const onReviewWalls = vi.fn();
  const gate = deriveProcessingGate({
    ...scenarioFor('success'),
    summary: { ...SAMPLE_SUMMARY, reviewReasons, onCalibrateScale, onReviewWalls },
  });
  return { gate, onCalibrateScale, onReviewWalls };
};

describe('toExtractionSummary — readiness', () => {
  it('BE chưa trả readiness, tỷ lệ tạm: suy needsReview/scaleUnresolved từ scaleStatus', () => {
    const summary = toExtractionSummary(documentWith({ scaleStatus: 'unresolved' }), 0.75);
    expect(summary.readiness).toEqual({ state: 'needsReview', reasons: ['scaleUnresolved'] });
  });

  it('readiness của BE thắng scaleStatus', () => {
    const readiness = { state: 'ready', reasons: [] };
    const summary = toExtractionSummary(documentWith({ readiness, scaleStatus: 'unresolved' }), 0.75);
    expect(summary.readiness).toEqual(readiness);
  });

  it('tỷ lệ đã đặt, BE không trả readiness: không có readiness', () => {
    expect(toExtractionSummary(documentWith({}), 0.75).readiness).toBeUndefined();
  });
});

describe('deriveProcessingGate — readiness', () => {
  it('★ có kích thước + tỷ lệ tạm: không ra "ready", nút chính là Đặt tỷ lệ', () => {
    const { gate, onCalibrateScale, onReviewWalls } = gateWith(['scaleUnresolved']);

    expect(gate.kind).not.toBe('ready');
    expect(gate.kind).toBe('needs-review');
    expect(gate.isScaleOk).toBe(false);
    expect(gate.action?.label).toBe(CALIBRATE_LABEL);
    gate.action?.onClick();
    expect(onCalibrateScale).toHaveBeenCalledOnce();
    // Duyệt tầng vẫn là lối mềm, nhưng mở ở bước Tỷ lệ chứ không nhảy thẳng sang Tường (U28).
    expect(gate.secondaryAction?.label).toBe(GO_REVIEW_LABEL);
    gate.secondaryAction?.onClick();
    expect(onCalibrateScale).toHaveBeenCalledTimes(2);
    expect(onReviewWalls).not.toHaveBeenCalled();
  });

  it('readiness ready (không còn lý do): ra "ready"', () => {
    expect(gateWith([]).gate.kind).toBe('ready');
  });

  it.each([
    ['scaleUnresolved', 'scale'],
    ['criticalIssues', 'review'],
    ['geometrySuspect', 'review'],
    ['fallbackWallModel', 'review'],
    ['fallbackObjectModel', 'review'],
    ['fallbackTextModel', 'review'],
  ] as const)('%s: đúng câu và đúng đích nút (%s)', (reason, target) => {
    const { gate, onCalibrateScale, onReviewWalls } = gateWith([reason]);

    expect(gate.reviewRows).toEqual([{ key: reason, reason, sentence: REVIEW_REASON_SENTENCE[reason], target }]);
    gate.action?.onClick();
    expect(onCalibrateScale).toHaveBeenCalledTimes(target === 'scale' ? 1 : 0);
    expect(onReviewWalls).toHaveBeenCalledTimes(target === 'review' ? 1 : 0);
    expect(gate.action?.label).toBe(target === 'scale' ? CALIBRATE_LABEL : GO_REVIEW_LABEL);
  });

  it('nhiều lý do: mỗi lý do một dòng, tiêu đề đếm đúng', () => {
    const { gate } = gateWith(['scaleUnresolved', 'criticalIssues']);
    expect(gate.reviewRows?.map((row) => row.target)).toEqual(['scale', 'review']);
    expect(gate.title).toBe('Còn 2 việc cần xem lại');
  });

  it('BENCH3D-11: geometrySuspect tách một dòng cho mỗi mã kiểm; mã lạ dùng câu chung', () => {
    const gate = deriveProcessingGate({
      ...scenarioFor('success'),
      summary: {
        ...SAMPLE_SUMMARY,
        reviewReasons: ['scaleUnresolved', 'geometrySuspect'],
        reviewChecks: ['MULTIPLE_PLANS', 'NEW_CHECK'],
      },
    });

    expect(gate.reviewRows?.map((row) => [row.key, row.sentence])).toEqual([
      ['scaleUnresolved', REVIEW_REASON_SENTENCE.scaleUnresolved],
      ['MULTIPLE_PLANS', GEOMETRY_CHECK_SENTENCE.MULTIPLE_PLANS],
      ['NEW_CHECK', REVIEW_REASON_SENTENCE.geometrySuspect],
    ]);
    expect(GEOMETRY_CHECK_SENTENCE.MULTIPLE_PLANS).toMatch(/^Tờ có nhiều mặt bằng: hãy cắt từng căn/u);
    expect(gate.title).toBe('Còn 3 việc cần xem lại');
  });

  it('R9: câu trạng thái + lý do thay câu cũ, giá trị là tên trạng thái; lối "Đặt tỷ lệ" vẫn đi trước', () => {
    const onCalibrateScale = vi.fn();
    const gate = deriveProcessingGate({
      ...scenarioFor('success'),
      summary: {
        ...SAMPLE_SUMMARY,
        reviewReasons: ['scaleUnresolved'],
        scaleEstimated: true,
        scaleStateLabel: 'Tỷ lệ ước lượng',
        scaleStateNote: 'Tỷ lệ ước lượng: Ước từ bề rộng cửa đi (giả định 745 mm).',
        onCalibrateScale,
      },
    });

    expect(gate.scaleValue).toBe('Tỷ lệ ước lượng');
    expect(gate.scaleNote).toBe('Tỷ lệ ước lượng: Ước từ bề rộng cửa đi (giả định 745 mm).');
    gate.action?.onClick();
    expect(onCalibrateScale).toHaveBeenCalled();
  });

  it('R9: N16 có scaleState thì tóm tắt mang tên trạng thái và câu lý do; đọc từ bản vẽ chỉ nói căn cứ, không cần xem lại', () => {
    const unresolved = { scaleStatus: 'unresolved', scaleSource: 'pipeline' };
    const estimated = toExtractionSummary(documentWith({ ...unresolved, scaleState: 'estimated', scaleReasons: ['door'] }), 0.75);
    expect(estimated.scaleStateLabel).toBe('Tỷ lệ ước lượng');
    expect(estimated.scaleStateNote).toMatch(/^Tỷ lệ ước lượng: Ước từ bề rộng cửa đi \(giả định 745 mm\)\./u);

    const measured = toExtractionSummary(documentWith({ ...unresolved, scaleState: 'determined', scaleReasons: ['chain'] }), 0.75);
    expect(measured.scaleStateLabel).toBe('Tỷ lệ đọc từ bản vẽ');
    expect(measured.scaleStateNote).toBe('Đọc từ chuỗi kích thước trên bản vẽ.');
    expect(measured.readiness).toBeUndefined();
    expect(measured).not.toHaveProperty('scaleStateNeedsAttention');
    expect(estimated.scaleStateNeedsAttention).toBe(true);

    // e2e R9 mục 8: sau khi người dùng hiệu chỉnh, nguồn là người dùng — không phải "chuỗi kích thước".
    const calibrated = toExtractionSummary(documentWith({ scaleState: 'userCalibrated', scaleReasons: [] }), 0.75);
    expect(calibrated.scaleStateLabel).toBe('Tỷ lệ đã xác nhận');
    expect(calibrated.scaleStateNote).toBe('Do bạn hiệu chỉnh bằng một kích thước đã biết.');
    expect(calibrated.scaleStateNote).not.toContain('chuỗi kích thước');
    expect(toExtractionSummary(documentWith(unresolved), 0.75)).not.toHaveProperty('scaleStateLabel');
  });

  it('BENCH3D-11: tỷ lệ ước lượng (scaleBasis cửa/tường/mặc định) ghi nhãn cạnh tỷ lệ', () => {
    const gate = deriveProcessingGate({
      ...scenarioFor('success'),
      summary: { ...SAMPLE_SUMMARY, reviewReasons: ['scaleUnresolved'], scaleEstimated: true },
    });

    expect(gate.scaleNote).toBe(SCALE_ESTIMATED_NOTE);
    expect(SCALE_ESTIMATED_NOTE).toBe('Tỷ lệ ước lượng — nên hiệu chỉnh');
  });
});

describe('toExtractionSummary — BENCH3D-11', () => {
  it.each([
    ['door', true],
    ['wallThickness', true],
    ['default', true],
    ['chain', false],
    ['human', false],
  ] as const)('scaleBasis %s → scaleEstimated %s', (scaleBasis, estimated) => {
    expect(toExtractionSummary(documentWith({ scaleBasis }), 0.75).scaleEstimated === true).toBe(estimated);
  });

  it('readiness.checks đi kèm readiness tới hook', () => {
    const readiness = { state: 'needsReview', reasons: ['geometrySuspect'], checks: ['OPEN_ENVELOPE'] };
    expect(toExtractionSummary(documentWith({ readiness }), 0.75).readiness).toEqual(readiness);
  });
});

describe('ProcessingFloorChips — "Cần xem lại"', () => {
  it('chip tầng hiện nhãn khi có reviewLabel', () => {
    render(
      <ProcessingFloorChips
        floors={[
          {
            id: 'L-1',
            label: 'Tầng 1',
            status: 'done',
            statusLabel: 'đã xong',
            isActive: true,
            reviewLabel: 'Cần xem lại',
          },
        ]}
      />,
    );
    expect(screen.getByText('Cần xem lại')).toBeTruthy();
  });
});
