import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from '../testing'
import { listNotifications } from '../notifications'
import { balanceOf } from './funds'
import { listChores, saveChore, completeChore, deleteChore } from './chores'

describe('chores', () => {
  it('assigning notifies; completing pays the reward and notifies the assigner', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveChore(doc, admin, { title: 'Trash', reward_amount: 2, assigned_member_id: kid.id })
    expect(listNotifications(doc, kid.id)[0].message).toBe('You were assigned a chore: "Trash"')
    completeChore(doc, kid, id)
    expect(listChores(doc)[0].status).toBe('done')
    expect(balanceOf(doc, kid.id)).toBe(2)
    expect(listNotifications(doc, admin.id)[0].message).toBe('Kit Kid completed: "Trash"')
    completeChore(doc, kid, id) // already done: no-op
    expect(balanceOf(doc, kid.id)).toBe(2)
  })

  it('pays exactly once when two devices complete concurrently', () => {
    const { doc: a, admin, kid } = newFamilyDoc()
    const id = saveChore(a, admin, { title: 'Trash', reward_amount: 2, assigned_member_id: kid.id })
    const b = forkDoc(a)
    completeChore(a, kid, id)
    completeChore(b, admin, id)
    syncDocs(a, b)
    expect(balanceOf(a, kid.id)).toBe(2)
    expect(balanceOf(b, kid.id)).toBe(2)
  })

  it('requires an assignee to complete; delete keeps the payment history', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const loose = saveChore(doc, admin, { title: 'Sweep', reward_amount: 1 })
    expect(() => completeChore(doc, admin, loose)).toThrow('Chore must be assigned to a member before it can be completed')
    const paid = saveChore(doc, admin, { title: 'Dishes', reward_amount: 3, assigned_member_id: kid.id })
    completeChore(doc, kid, paid)
    deleteChore(doc, paid)
    expect(balanceOf(doc, kid.id)).toBe(3)
  })
})
