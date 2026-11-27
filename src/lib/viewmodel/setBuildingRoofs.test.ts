import { describe, expect, it } from 'vitest';

import { RoofDecisionSchema } from '@/api/schemas/setBuilding';

import { pitchFromText, readRoofNumber, roofTypedText } from './setBuildingRoofs';

describe('pitchFromText — độ dốc người duyệt gõ, quy về độ', () => {
  it.each([
    ['30', 30],
    ['30°', 30],
    [' 26,5 ° ', 26.5],
    ['26.5', 26.5],
    ['0', 0],
  ])('độ: "%s" → %s', (text, degrees) => {
    expect(pitchFromText(text)).toBe(degrees);
  });

  it.each([
    ['100%', 45],
    ['58 %', 30.1],
    ['6:12', 26.6],
    ['12 : 12', 45],
    ['4,5:12', 20.6],
  ])('phần trăm và tỉ lệ: "%s" → %s°, làm tròn một chữ số', (text, degrees) => {
    expect(pitchFromText(text)).toBe(degrees);
  });

  it.each(['', 'dốc', '30độ', '6:0', '6:12:3', '-5', '1e2', '30°%', '1.000', '+30'])(
    'chữ lạ không được đoán thành số: "%s"',
    (text) => {
      expect(pitchFromText(text)).toBeUndefined();
    },
  );
});

describe('readRoofNumber — số gửi được, hoặc một câu báo', () => {
  it('độ dốc: nhận trong khoảng 0° đến dưới 85°; ngoài khoảng và chữ lạ có câu riêng', () => {
    expect(readRoofNumber('pitchDeg', '6:12')).toEqual({ value: 26.6 });
    expect(readRoofNumber('pitchDeg', '85')).toEqual({
      problem: 'Độ dốc phải từ 0° đến dưới 85°.',
    });
    expect(readRoofNumber('pitchDeg', 'dốc vừa')).toEqual({
      problem: 'Nhập độ dốc theo độ, phần trăm hoặc tỉ lệ, ví dụ 30°, 58% hoặc 7:12.',
    });
  });

  it('cốt diềm, cốt đỉnh: số nguyên mm, được âm, trong dải cốt của dây', () => {
    expect(readRoofNumber('eaveElevationMm', '6.600')).toEqual({ value: 6600 });
    expect(readRoofNumber('ridgeElevationMm', '−300')).toEqual({ value: -300 });
    expect(readRoofNumber('eaveElevationMm', '6,6')).toEqual({
      problem: 'Nhập số nguyên theo mm.',
    });
    expect(readRoofNumber('ridgeElevationMm', '99999999')).toMatchObject({
      problem: expect.stringMatching(/^Cốt đỉnh phải trong khoảng .+ đến .+ mm\.$/u),
    });
  });

  it('độ đua, chiều cao tường chắn mái: 0 đến 5.000 mm', () => {
    expect(readRoofNumber('overhangMm', '600')).toEqual({ value: 600 });
    expect(readRoofNumber('parapetMm', '0')).toEqual({ value: 0 });
    expect(readRoofNumber('overhangMm', '-1')).toEqual({
      problem: 'Độ đua phải trong khoảng 0 đến 5.000 mm.',
    });
    expect(readRoofNumber('parapetMm', '5001')).toEqual({
      problem: 'Chiều cao tường chắn mái phải trong khoảng 0 đến 5.000 mm.',
    });
  });

  it.each([
    ['pitchDeg', '84,9'],
    ['eaveElevationMm', '3300'],
    ['ridgeElevationMm', '8100'],
    ['overhangMm', '5000'],
    ['parapetMm', '1200'],
  ] as const)('số được nhận của `%s` luôn qua schema gửi đi', (field, text) => {
    const read = readRoofNumber(field, text);

    if (!('value' in read)) throw new Error(read.problem);
    expect(
      RoofDecisionSchema.safeParse({ levelRef: 'v1', skip: false, [field]: read.value }).success,
    ).toBe(true);
  });
});

describe('roofTypedText — chữ đặt sẵn vào ô sửa', () => {
  it('độ dốc viết dấu phẩy, số mm viết liền; đọc lại ra đúng số đó', () => {
    expect(roofTypedText('pitchDeg', 26.6)).toBe('26,6');
    expect(roofTypedText('eaveElevationMm', 6600)).toBe('6600');
    expect(readRoofNumber('pitchDeg', roofTypedText('pitchDeg', 26.6))).toEqual({ value: 26.6 });
    expect(readRoofNumber('eaveElevationMm', roofTypedText('eaveElevationMm', -300))).toEqual({
      value: -300,
    });
  });
});
