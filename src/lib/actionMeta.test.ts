import { describe, expect, it } from 'vitest'
import { poopDetailsLabel } from './actionMeta'

describe('Poop detail labels', () => {
  it('formats a Spotted amount for shared event displays and reports', () => {
    expect(poopDetailsLabel({ size: 'spotted', consistency: 'formed', color: 'mustard_yellow' }))
      .toBe('Spotted · Solid · Mustard')
  })
})
