import { describe, it, expect, beforeEach } from 'vitest'
import { newFamilyDoc } from '../data/testing'
import { insert } from '../data/collection'
import { RELAY_REMOTE_ORIGIN } from '../data/origins'
import { forgetRemoteChanges, watchRemoteChanges } from '../data/recentChanges'
import { nowStamp } from '../data/time'
import { targetAfterPush, targetForChange } from './pushOpen'

beforeEach(() => forgetRemoteChanges())

// A family whose changes from "another device" are recorded, so the push logic sees them.
function watchedFamily() {
  const fam = newFamilyDoc()
  watchRemoteChanges(fam.doc, ['todos', 'shopping_items', 'notifications', 'announcement_reads'])
  return fam
}

describe('where a changed record is shown', () => {
  it('a record opens its page, on the record', () => {
    const { doc, kid } = watchedFamily()
    expect(targetForChange(doc, { collection: 'todos', id: 't1' }, kid.id)).toBe('/todos?item=t1')
    expect(targetForChange(doc, { collection: 'shopping_items', id: 's1' }, kid.id)).toBe('/shopping?item=s1')
  })

  it('a notification opens what it is about, and only for the member it is for', () => {
    const { doc, admin, kid } = watchedFamily()
    doc.transact(() => insert(doc, 'notifications', { recipient_member_id: kid.id, type: 'todo_assigned', message: 'x', related_id: 't1', read_at: null }, 'n1'), RELAY_REMOTE_ORIGIN)
    expect(targetForChange(doc, { collection: 'notifications', id: 'n1' }, kid.id)).toBe('/todos?item=t1')
    expect(targetForChange(doc, { collection: 'notifications', id: 'n1' }, admin.id)).toBe(null)
  })

  it('a collection with no page, such as read marks, gives nothing', () => {
    const { doc, kid } = watchedFamily()
    expect(targetForChange(doc, { collection: 'announcement_reads', id: 'r1' }, kid.id)).toBe(null)
  })
})

describe('where to open after a notification', () => {
  it('opens the newest change from another device that has a page', () => {
    const { doc, kid } = watchedFamily()
    doc.transact(() => {
      insert(doc, 'todos', { title: 'Earlier', updated_at: '2026-10-15 08:00:00' }, 't-early')
      insert(doc, 'shopping_items', { title: 'Milk', updated_at: '2026-10-15 09:00:00' }, 's-milk')
    }, RELAY_REMOTE_ORIGIN)
    expect(targetAfterPush(doc, kid.id)).toBe('/shopping?item=s-milk')
  })

  it('a newer change with no page is passed over for one that has a page', () => {
    const { doc, kid } = watchedFamily()
    doc.transact(() => insert(doc, 'todos', { title: 'Todo', updated_at: '2026-10-15 08:00:00' }, 't1'), RELAY_REMOTE_ORIGIN)
    doc.transact(() => insert(doc, 'announcement_reads', { member_id: kid.id, updated_at: '2026-10-15 09:00:00' }, 'read-1'), RELAY_REMOTE_ORIGIN)
    expect(targetAfterPush(doc, kid.id)).toBe('/todos?item=t1')
  })

  it('changes from before the cut-off are not used', () => {
    const { doc, kid } = watchedFamily()
    doc.transact(() => insert(doc, 'todos', { title: 'Old' }, 't-old'), RELAY_REMOTE_ORIGIN)
    expect(targetAfterPush(doc, kid.id, { since: Date.now() + 1000 })).toBe(null)
  })

  it('with no recent change, falls back to the newest unread notification from the last two hours', () => {
    const { doc, kid } = watchedFamily()
    const now = nowStamp()
    insert(doc, 'notifications', { recipient_member_id: kid.id, type: 'goal_assigned', message: 'x', related_id: 'g1', read_at: null, created_at: now }, 'n-now')
    expect(targetAfterPush(doc, kid.id)).toBe('/goals?item=g1')
  })

  it('an old unread notification is not used, and an empty family opens nothing', () => {
    const { doc, kid } = watchedFamily()
    insert(doc, 'notifications', { recipient_member_id: kid.id, type: 'goal_assigned', message: 'x', related_id: 'g1', read_at: null, created_at: '2020-01-01 00:00:00' }, 'n-old')
    expect(targetAfterPush(doc, kid.id)).toBe(null)
  })
})
