import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from './testing'
import { notify, listNotifications, markNotificationsRead, clearNotifications } from './notifications'

describe('notifications', () => {
  it('never notifies the actor themself', () => {
    const { doc, admin } = newFamilyDoc()
    expect(notify(doc, admin, { recipientId: admin.id, type: 't', message: 'm' })).toBe(null)
    expect(listNotifications(doc, admin.id)).toEqual([])
  })

  it('lists newest first, marks read, clears only read ones', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const first = notify(doc, admin, { recipientId: kid.id, type: 'todo_assigned', message: 'one', relatedId: 'x' })
    notify(doc, admin, { recipientId: kid.id, type: 'todo_assigned', message: 'two' })
    expect(listNotifications(doc, kid.id)).toHaveLength(2)
    markNotificationsRead(doc, kid.id, first)
    clearNotifications(doc, kid.id)
    expect(listNotifications(doc, kid.id).map((n) => n.message)).toEqual(['two'])
    markNotificationsRead(doc, kid.id)
    clearNotifications(doc, kid.id)
    expect(listNotifications(doc, kid.id)).toEqual([])
  })
})
