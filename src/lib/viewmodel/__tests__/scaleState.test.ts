import { describe, expect, it } from 'vitest';

import {
  CALIBRATE_BY_ONE_LENGTH,
  measureTextOf,
  provisionalScaleNoticeOf,
  SCALE_REASON_UNKNOWN,
  SCALE_STATE_VIEWS,
  scaleReasonsSentenceOf,
  scaleReasonTextOf,
  scaleStateMessageOf,
  scaleStateOf,
} from '../provisionalScale';

/** R9 lần T: N16 `scaleState` / `scaleReasons` → trạng thái, chữ số đo, câu lý do. */
describe('scaleStateOf (R9)', () => {
  it('theo scaleState khi máy chủ gửi; unresolved chỉ thành missing khi nguồn là mặc định dự án', () => {
    expect(scaleStateOf('unresolved', 'pipeline', 'determined')).toBe('measured');
    expect(scaleStateOf('unresolved', 'pipeline', 'estimated')).toBe('estimated');
    expect(scaleStateOf('unresolved', 'pipeline', 'unresolved')).toBe('undetermined');
    expect(scaleStateOf('unresolved', 'project_default', 'unresolved')).toBe('missing');
    expect(scaleStateOf(undefined, undefined, 'userCalibrated')).toBe('confirmed');
  });

  it('máy chủ cũ (vắng scaleState) giữ luật cũ', () => {
    expect(scaleStateOf('unresolved', 'pipeline')).toBe('check');
    expect(scaleStateOf('unresolved', 'project_default')).toBe('missing');
    expect(scaleStateOf(undefined, undefined)).toBe('confirmed');
  });

  it('đọc từ bản vẽ: trung tính, không mời hiệu chỉnh; ước lượng / chưa xác định: vàng, mời hiệu chỉnh', () => {
    expect(SCALE_STATE_VIEWS.measured).toEqual({ name: 'Tỷ lệ đọc từ bản vẽ', statusCode: 'neutral', action: null });
    expect(SCALE_STATE_VIEWS.estimated).toEqual({ name: 'Tỷ lệ ước lượng', statusCode: 'attention', action: 'Hiệu chỉnh tỷ lệ' });
    expect(SCALE_STATE_VIEWS.undetermined).toEqual({
      name: 'Tỷ lệ chưa xác định',
      statusCode: 'attention',
      action: 'Hiệu chỉnh tỷ lệ',
    });
  });
});

describe('measureTextOf (R9)', () => {
  it('determined / userCalibrated: số bình thường', () => {
    expect(measureTextOf('5.757 mm', 'unresolved', 'pipeline', 'determined')).toBe('5.757 mm');
    expect(measureTextOf('5.757 mm', undefined, undefined, 'userCalibrated')).toBe('5.757 mm');
  });

  it('estimated: "≈ X (ước lượng)"; unresolved: "≈ X (chưa xác định)"; mặc định dự án: "Chưa có"', () => {
    expect(measureTextOf('12,5 m²', 'unresolved', 'pipeline', 'estimated')).toBe('≈ 12,5 m² (ước lượng)');
    expect(measureTextOf('12,5 m²', 'unresolved', 'pipeline', 'unresolved')).toBe('≈ 12,5 m² (chưa xác định)');
    expect(measureTextOf('12,5 m²', 'unresolved', 'project_default', 'unresolved')).toBe('Chưa có');
  });
});

describe('lý do tỷ lệ (R9)', () => {
  it('mỗi mã một câu tiếng Việt; mã lạ và basisUnknown ra câu chung', () => {
    expect(scaleReasonTextOf('door')).toBe('Ước từ bề rộng cửa đi (giả định 745 mm)');
    expect(scaleReasonTextOf('sourceConflict')).toBe('Số đo trên bản vẽ mâu thuẫn với ước từ cửa và tường');
    expect(scaleReasonTextOf('basisUnknown')).toBe(SCALE_REASON_UNKNOWN);
    expect(scaleReasonTextOf('somethingNew')).toBe(SCALE_REASON_UNKNOWN);
    expect(scaleReasonTextOf('toString')).toBe(SCALE_REASON_UNKNOWN);
  });

  it('lý do userAccepted (K4) có câu tiếng Việt, đứng sau căn cứ của máy', () => {
    expect(scaleReasonTextOf('userAccepted')).toBe('Bạn đã chấp nhận số của máy, chưa nhập kích thước thật');
    expect(scaleReasonsSentenceOf(['door', 'userAccepted'])).toBe(
      'Ước từ bề rộng cửa đi (giả định 745 mm); Bạn đã chấp nhận số của máy, chưa nhập kích thước thật.',
    );
  });

  it('gộp thành một câu, bỏ câu trùng; rỗng thì null', () => {
    expect(scaleReasonsSentenceOf(['door', 'estimateSpread'])).toBe(
      'Ước từ bề rộng cửa đi (giả định 745 mm); Ước từ cửa và từ tường lệch nhau.',
    );
    expect(scaleReasonsSentenceOf(['x', 'basisUnknown'])).toBe(`${SCALE_REASON_UNKNOWN}.`);
    expect(scaleReasonsSentenceOf([])).toBeNull();
    expect(scaleReasonsSentenceOf(undefined)).toBeNull();
  });

  it('câu trạng thái nêu tên, lý do và lối hiệu chỉnh bằng một kích thước; số tin được thì không nhắc', () => {
    expect(scaleStateMessageOf('estimated', ['door'])).toBe(
      `Tỷ lệ ước lượng: Ước từ bề rộng cửa đi (giả định 745 mm). ${CALIBRATE_BY_ONE_LENGTH}`,
    );
    expect(scaleStateMessageOf('undetermined', [])).toBe(`Tỷ lệ chưa xác định. ${CALIBRATE_BY_ONE_LENGTH}`);
    expect(scaleStateMessageOf('measured', ['chain'])).toBeNull();
    expect(scaleStateMessageOf('confirmed', [])).toBeNull();
    expect(scaleStateMessageOf('check', [])).toBeNull();
  });

  it('dải màn Tỷ lệ: theo scaleState khi có, luật cũ khi vắng', () => {
    expect(provisionalScaleNoticeOf('unresolved', 'pipeline', 'determined', ['chain'])).toBeNull();
    expect(provisionalScaleNoticeOf('unresolved', 'pipeline', 'unresolved', ['chain', 'sourceConflict'])).toEqual({
      level: 'attention',
      message: `Tỷ lệ chưa xác định: Đọc từ chuỗi kích thước trên bản vẽ; Số đo trên bản vẽ mâu thuẫn với ước từ cửa và tường. ${CALIBRATE_BY_ONE_LENGTH}`,
    });
    expect(provisionalScaleNoticeOf('unresolved', 'project_default', 'unresolved', ['projectDefault'])?.level).toBe('violation');
    expect(provisionalScaleNoticeOf('unresolved', 'pipeline')?.message).toBe('Tỷ lệ tạm — số đo chưa tin được, hãy hiệu chỉnh tỷ lệ.');
  });
});
