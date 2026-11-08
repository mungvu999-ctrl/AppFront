import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  realismRoofSegmentDefaults,
  realismWallDefaults,
  setDetailsEnabled,
  EXTERIOR_SKIRTING,
  INTERIOR_SKIRTING,
} from './details'
import { wallDressingOf } from '@/lib/pascal/sceneDressing'

beforeEach(() => setDetailsEnabled(true))
afterEach(() => setDetailsEnabled(false))

describe('realism details (R6)', () => {
  it('new roof segment gets fascia + auto gutters', () => {
    expect(realismRoofSegmentDefaults()).toEqual({ fascia: true, metadata: { autoGutter: true } })
  })

  it('new wall gets interior skirting + exterior plinth, same as toPascal for an outer wall', () => {
    const { height, proud, profile } = EXTERIOR_SKIRTING
    expect(realismWallDefaults()).toEqual({
      skirting: { ...wallDressingOf({ kind: 'envelope', heightMm: 2700 }).skirting, sides: 'both', exterior: { height, proud, profile } },
    })
    expect(INTERIOR_SKIRTING.height).toBe(0.09)
  })

  it('tool preset spread after realism defaults wins (same order as vendor patch)', () => {
    const preset = { fascia: false, metadata: { autoGutter: false } }
    expect({ ...realismRoofSegmentDefaults(), ...preset }).toEqual(preset)
    const wallPreset = { skirting: { enabled: false } }
    expect({ ...realismWallDefaults(), ...wallPreset }).toEqual(wallPreset)
  })

  it('flag off -> nothing added', () => {
    setDetailsEnabled(false)
    expect(realismRoofSegmentDefaults()).toEqual({})
    expect(realismWallDefaults()).toEqual({})
  })

  it('returns fresh objects (no shared mutation between nodes)', () => {
    const a = realismWallDefaults() as { skirting: { height: number; exterior: { height: number } } }
    a.skirting.height = 9
    a.skirting.exterior.height = 9
    const b = realismWallDefaults() as { skirting: { height: number; exterior: { height: number } } }
    expect(b.skirting.height).toBe(0.09)
    expect(b.skirting.exterior.height).toBe(0.25)
    const r = realismRoofSegmentDefaults() as { metadata: Record<string, unknown> }
    r.metadata.x = 1
    expect(realismRoofSegmentDefaults()).toEqual({ fascia: true, metadata: { autoGutter: true } })
  })
})
