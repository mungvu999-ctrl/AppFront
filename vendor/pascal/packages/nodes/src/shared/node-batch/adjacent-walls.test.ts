import { expect, test } from 'bun:test'
import type { WallNode } from '@pascal-app/core'
import type { WallTreatmentLevelData } from '../../wall/treatment-level-data'
import { adjacentTreatmentWalls } from './system'

const wall = (id: string, start: [number, number], end: [number, number], thickness = 0.1) =>
  ({ id, type: 'wall', start, end, thickness }) as unknown as WallNode
const level = (walls: WallNode[]) => ({ walls, miterDataByProud: new Map() }) as WallTreatmentLevelData

// Room A (bottom) – B (right) – C (top) – D (left).
const a = wall('wall_a', [0, 0], [4, 0])
const b = wall('wall_b', [4, 0], [4, 3])
const c = wall('wall_c', [4, 3], [0, 3])
const d = wall('wall_d', [0, 3], [0, 0])

test('thickening one wall re-stales it and both corner neighbours, not the far wall', () => {
  const thick = { ...a, thickness: 0.22 } as WallNode
  expect(adjacentTreatmentWalls(level([a, b, c, d]), level([thick, b, c, d])).sort()).toEqual([
    'wall_a',
    'wall_b',
    'wall_d',
  ])
})

test('deleting a wall re-stales the walls that met it', () => {
  expect(adjacentTreatmentWalls(level([a, b, c, d]), level([b, c, d])).sort()).toEqual(['wall_b', 'wall_d'])
})

test('unchanged walls or a first publish mark nothing', () => {
  const walls = [a, b, c, d]
  expect(adjacentTreatmentWalls(level(walls), level([...walls]))).toEqual([])
  expect(adjacentTreatmentWalls(undefined, level(walls))).toEqual([])
})
