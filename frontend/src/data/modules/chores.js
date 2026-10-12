import { all, get, insert, patch, remove, blankToNull, requireText } from '../collection'
import { notify } from '../notifications'
import { recordTransaction } from './funds'

const T = 'chores'

export function listChores(doc) {
  // Ordered by status, then sort_order, then creation time.
  return all(doc, T).sort((a, b) => a.status.localeCompare(b.status) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export function saveChore(doc, actor, input) {
  const title = requireText(input.title, 'title is required')
  if (input.id) {
    const prev = get(doc, T, input.id)
    if (!prev) throw new Error('Chore not found')
    const assignee = 'assigned_member_id' in input ? input.assigned_member_id || null : prev.assigned_member_id
    const assignedBy = assignee !== null && assignee !== prev.assigned_member_id ? actor.id : prev.assigned_by_member_id
    doc.transact(() => {
      patch(doc, T, input.id, {
        title,
        reward_amount: 'reward_amount' in input ? Number(input.reward_amount) || 0 : prev.reward_amount,
        description: 'description' in input ? blankToNull(input.description) : prev.description,
        assigned_member_id: assignee,
        assigned_by_member_id: assignedBy,
      })
      if (assignee !== null && assignee !== prev.assigned_member_id) {
        notify(doc, actor, { recipientId: assignee, type: 'chore_assigned', message: `You were assigned a chore: "${title}"`, relatedId: input.id })
      }
    })
    return input.id
  }
  const assignee = input.assigned_member_id || null
  let id
  doc.transact(() => {
    id = insert(doc, T, {
      title,
      reward_amount: Number(input.reward_amount) || 0,
      description: blankToNull(input.description),
      assigned_member_id: assignee,
      assigned_by_member_id: assignee ? actor.id : null,
      status: 'open',
      sort_order: 0,
    })
    if (assignee) notify(doc, actor, { recipientId: assignee, type: 'chore_assigned', message: `You were assigned a chore: "${title}"`, relatedId: id })
  })
  return id
}

export function completeChore(doc, actor, id) {
  const chore = get(doc, T, id)
  if (!chore) throw new Error('Chore not found')
  if (chore.status === 'done') return
  if (!chore.assigned_member_id) throw new Error('Chore must be assigned to a member before it can be completed')
  doc.transact(() => {
    patch(doc, T, id, { status: 'done' })
    if (chore.reward_amount > 0) {
      // Deterministic id: if two devices complete the same chore before
      // syncing, both writes land on one key and the reward is paid once.
      recordTransaction(doc, { memberId: chore.assigned_member_id, amount: chore.reward_amount, reason: `Chore: ${chore.title}`, choreId: id, actorId: actor.id }, `chore:${id}`)
    }
    if (chore.assigned_by_member_id) {
      notify(doc, actor, { recipientId: chore.assigned_by_member_id, type: 'chore_completed', message: `${actor.name} completed: "${chore.title}"`, relatedId: id })
    }
  })
}

export function deleteChore(doc, id) {
  // Payment history is kept: the transactions' chore_id is cleared rather
  // than the transactions deleted.
  doc.transact(() => {
    for (const tx of all(doc, 'fund_transactions')) if (tx.chore_id === id) patch(doc, 'fund_transactions', tx.id, { chore_id: null })
    remove(doc, T, id)
  })
}
