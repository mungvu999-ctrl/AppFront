import { describe, expect, it } from 'vitest';

import { BUILDING_RULE_CODES, ruleSentence } from './buildingRules';

const UNKNOWN = ruleSentence({ code: 'X-99', values: [] });

describe('buildingRules — câu tiếng Việt theo mã luật', () => {
  it.each(BUILDING_RULE_CODES)('%s có câu riêng, viết hoa chữ đầu, kết thúc bằng dấu chấm', (code) => {
    const sentence = ruleSentence({ code, values: [] });

    expect(sentence).not.toBe(UNKNOWN);
    expect(sentence).toMatch(/^\p{Lu}.*\.$/u);
  });

  it('mã lạ ra câu chung có kèm mã, không ném lỗi', () => {
    expect(UNKNOWN).toContain('X-99');
  });

  it('số liệu vào câu đúng thứ tự BE gửi', () => {
    expect(ruleSentence({ code: 'T-02', values: [2, 3] })).toBe('Có 2 tầng có mặt bằng nhưng mặt cắt cho thấy 3 tầng.');
    expect(ruleSentence({ code: 'M-02', values: [7000, 6600] })).toBe('Cốt diềm mái 7.000 mm lệch đỉnh tường 6.600 mm.');
    expect(ruleSentence({ code: 'T-03', values: [6000] })).toBe(
      'Chiều cao tầng 6.000 mm nằm ngoài khoảng thường gặp (2.400–4.600 mm).',
    );
    expect(ruleSentence({ code: 'T-01', values: [600] })).toBe('Giữa tầng trên và đỉnh tầng dưới còn hở 600 mm.');
    expect(ruleSentence({ code: 'T-01', values: [-100] })).toBe(
      'Tầng trên thấp hơn đỉnh tầng dưới 100 mm: hai tầng chồng lấn nhau.',
    );
    expect(ruleSentence({ code: 'T-06', values: [12, 7] })).toContain('lẫn cả hệ mét và feet-inch');
    expect(ruleSentence({ code: 'T-06', values: [0, 0] })).toContain('Chưa đủ chữ');
  });

  it('M-06 nói đúng trường hợp: tum, tum có mái dốc, tầng áp mái', () => {
    expect(ruleSentence({ code: 'M-06', values: ['tum'] })).toContain('một tấm mái phủ tầng bên dưới');
    expect(ruleSentence({ code: 'M-06', values: ['tum', 'sloped'] })).toContain('không đề xuất mái');
    expect(ruleSentence({ code: 'M-06', values: ['attic'] })).toContain('tầng áp mái');
    expect(ruleSentence({ code: 'M-06', values: ['attic'] })).not.toContain('tum');
  });

  it('số liệu vào câu theo định dạng tiếng Việt', () => {
    expect(ruleSentence({ code: 'T-05', values: [3300, 3900] })).toMatch(/3\.300 mm.*3\.900 mm/u);
    expect(ruleSentence({ code: 'M-03', values: [30, 33.1] })).toMatch(/30°.*33,1°/u);
    expect(ruleSentence({ code: 'M-09', values: [8.5, 11.8, 'tile'] })).toMatch(/8,5°.*11,8°.*ngói/u);
    expect(ruleSentence({ code: 'M-19', values: ['1:2'] })).toContain('1:2');
  });

  it('cùng mã mà số liệu khác thì câu khác', () => {
    const assumed = ['elevationMm', 'heightMm', 'roofForm', 'roofPitchDeg'].map((field) => ruleSentence({ code: 'T-07', values: [field, 'default'] }));

    expect(new Set(assumed).size).toBe(4);
    expect(ruleSentence({ code: 'M-06', values: ['tum', 'sloped'] })).not.toBe(ruleSentence({ code: 'M-06', values: ['tum'] }));
    expect(ruleSentence({ code: 'T-06', values: [12, 7] })).not.toBe(ruleSentence({ code: 'T-06', values: [0, 0] }));
    expect(ruleSentence({ code: 'M-17', values: ['ridgeBelowEave', 'pitchTooHigh'] })).toBe(
      'Thông số mái không hợp lệ: đỉnh mái không cao hơn diềm; độ dốc từ 85° trở lên.',
    );
    expect(ruleSentence({ code: 'M-17', values: ['pitchTooLow'] })).toContain('dưới 5%');
    expect(ruleSentence({ code: 'M-09', values: [8, 9.5, 'shingle'] })).toContain('tấm lợp bitum');
  });
});
