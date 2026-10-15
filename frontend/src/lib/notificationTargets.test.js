import { describe, it, expect } from 'vitest'
import { notificationTarget } from './notificationTargets.js'

describe('notificationTarget', () => {
  it('a task or item notification opens its page on that item', () => {
    expect(notificationTarget({ type: 'todo_assigned', related_id: 'a1' })).toBe('/todos?item=a1')
    expect(notificationTarget({ type: 'chore_completed', related_id: 'c 2' })).toBe('/chores?item=c%202')
    expect(notificationTarget({ type: 'wishlist_assigned', related_id: 'w9' })).toBe('/wishlist?item=w9')
  })

  it('a 1:1 request opens its answer screen, and an accepted or declined 1:1 opens Speak on that 1:1', () => {
    expect(notificationTarget({ type: 'one_on_one_requested', related_id: 'o1' })).toBe('/one-on-one/o1')
    expect(notificationTarget({ type: 'one_on_one_accepted', related_id: 'o1' })).toBe('/communication?item=o1')
    expect(notificationTarget({ type: 'one_on_one_declined', related_id: 'o1' })).toBe('/communication?item=o1')
  })

  it('a notification without an item opens the page', () => {
    expect(notificationTarget({ type: 'goal_assigned', related_id: null })).toBe('/goals')
  })

  it('an unknown type has no target', () => {
    expect(notificationTarget({ type: 'mystery', related_id: 'x' })).toBe(null)
  })
})
