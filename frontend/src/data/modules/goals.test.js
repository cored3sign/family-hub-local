import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from '../testing'
import { listNotifications } from '../notifications'
import { listGoals, saveGoal, toggleGoalComplete, deleteGoal } from './goals'

describe('goals', () => {
  it('assigns with notification, toggles completion, validates color', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveGoal(doc, admin, { title: 'Read 10 books', assigned_member_id: kid.id, progress_note: ' ' })
    expect(listGoals(doc)[0]).toMatchObject({ color: '#4d5faf', status: 'active', assigned_by_member_id: admin.id, progress_note: null })
    expect(listNotifications(doc, kid.id)[0].message).toBe('You were assigned a goal: "Read 10 books"')
    expect(toggleGoalComplete(doc, kid, id)).toBe('complete')
    expect(listNotifications(doc, admin.id)[0].message).toBe('Kit Kid completed: "Read 10 books"')
    expect(toggleGoalComplete(doc, kid, id)).toBe('active')
    expect(() => saveGoal(doc, admin, { title: 'x', color: 'red' })).toThrow('color must be a hex color like #4d5faf')
    deleteGoal(doc, id)
    expect(listGoals(doc)).toEqual([])
  })
})
