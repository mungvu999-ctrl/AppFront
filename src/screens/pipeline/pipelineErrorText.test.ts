import { describe, expect, it } from 'vitest';

import { APP_ERROR_KIND_CONFIG } from '@/lib/errors/kinds';

import { describePipelineError, PIPELINE_ERROR_CODES } from './pipelineErrorText';

/** Bảng khối [2] của F-05b, chép tay để bảng trong mã không tự xác nhận chính nó. */
const EXPECTED = {
  reload: ['PIPELINE_SUPERSEDED', 'FLOOR_DELETED'],
  retry: [
    'PIPELINE_CANCELLED',
    'PIPELINE_STALLED',
    'PIPELINE_STEP_TIMEOUT',
    'PIPELINE_ARTIFACT_MISSING',
    'GPU_LOCK_LOST',
    'RETRY_EXHAUSTED',
    'TASK_TIMEOUT',
    'WORKER_LOST',
  ],
  reupload: [
    'FILE_CORRUPT',
    'IMAGE_TOO_LARGE',
    'PDF_UNREADABLE',
    'FILE_TYPE_MISMATCH',
    'VALIDATION',
    'CAD_NOT_SUPPORTED',
    'PIPELINE_ARTIFACT_INVALID',
    'PIPELINE_BUILD_INVALID',
    'NOT_A_FLOOR_PLAN',
  ],
  contactAdmin: [
    'MODEL_PIN_MISMATCH',
    'PIPELINE_RESULT_INVALID',
    'LAYER_INTEGRITY_BROKEN',
    'LAYER_LEVEL_MISMATCH',
    'REVIEW_BY_AI_FORBIDDEN',
    'MODEL_CHECKSUM_MISMATCH',
    'MODEL_FORMAT_UNSUPPORTED',
    'MODEL_NOT_FOUND',
    'MODEL_VERSION_FAMILY_MISMATCH',
    'ML_DEVICE_UNAVAILABLE',
    'INTERNAL',
  ],
} as const;

describe('pipelineErrorText', () => {
  it('holds exactly the 30 codes of the contract table (29 + PIPELINE_CANCELLED, K-24)', () => {
    const expected = Object.values(EXPECTED).flat();
    expect(PIPELINE_ERROR_CODES).toHaveLength(30);
    expect([...PIPELINE_ERROR_CODES].sort()).toEqual([...expected].sort());
  });

  it.each(Object.entries(EXPECTED))('maps every %s code to that action', (action, codes) => {
    codes.forEach((code) => {
      expect(describePipelineError(code)).toMatchObject({ code, action, isKnown: true });
    });
  });

  it('gives every code a non-empty Vietnamese sentence without a code in it', () => {
    PIPELINE_ERROR_CODES.forEach((code) => {
      const { sentence } = describePipelineError(code);
      expect(sentence.length).toBeGreaterThan(0);
      expect(sentence).not.toMatch(/[A-Z]{2,}_/);
    });
  });

  it('falls back for an unknown code and keeps it for copying', () => {
    const unknown = describePipelineError('FOO_BAR');
    expect(unknown).toMatchObject({ code: 'FOO_BAR', action: 'contactAdmin', isKnown: false });
    expect(unknown.sentence.length).toBeGreaterThan(0);
    expect(describePipelineError('OCR_FAILED').isKnown).toBe(false);
  });

  it('uses the processing code when the code is missing', () => {
    expect(describePipelineError(undefined).code).toBe(APP_ERROR_KIND_CONFIG.processing.code);
  });
});
