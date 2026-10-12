import { all, get, insert, patch, remove, blankToNull, requireText } from '../collection'
import { notify } from '../notifications'

const T = 'goals'
const DEFAULT_COLOR = '#4d5faf'

export function listGoals(doc) {
  // Ordered by status ('active' < 'complete'), then sort_order, then
  // creation time.
  return all(doc, T).sort((a, b) => a.status.localeCompare(b.status) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export function saveGoal(doc, actor, input) {
  const title = requireText(input.title, 'title is required')
  const color = blankToNull(input.color) ?? DEFAULT_COLOR
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('color must be a hex color like #4d5faf')
  const assignee = input.assigned_member_id || null
  const progressNote = blankToNull(input.progress_note)
  const assignMessage = `You were assigned a goal: "${title}"`

  if (input.id) {
    const prev = get(doc, T, input.id)
    if (!prev) throw new Error('Goal not found')
    const assignedBy = assignee !== null && assignee !== prev.assigned_member_id ? actor.id : prev.assigned_by_member_id
    doc.transact(() => {
      patch(doc, T, input.id, { title, color, assigned_member_id: assignee, assigned_by_member_id: assignedBy, progress_note: progressNote })
      if (assignee !== null && assignee !== prev.assigned_member_id) {
        notify(doc, actor, { recipientId: assignee, type: 'goal_assigned', message: assignMessage, relatedId: input.id })
      }
    })
    return input.id
  }
  let id
  doc.transact(() => {
    id = insert(doc, T, { title, color, assigned_member_id: assignee, assigned_by_member_id: assignee ? actor.id : null, progress_note: progressNote, status: 'active', sort_order: 0 })
    if (assignee) notify(doc, actor, { recipientId: assignee, type: 'goal_assigned', message: assignMessage, relatedId: id })
  })
  return id
}

export function toggleGoalComplete(doc, actor, id) {
  const goal = get(doc, T, id)
  if (!goal) throw new Error('Goal not found')
  const status = goal.status === 'complete' ? 'active' : 'complete'
  doc.transact(() => {
    patch(doc, T, id, { status })
    if (status === 'complete' && goal.assigned_by_member_id) {
      notify(doc, actor, { recipientId: goal.assigned_by_member_id, type: 'goal_completed', message: `${actor.name} completed: "${goal.title}"`, relatedId: id })
    }
  })
  return status
}

export function deleteGoal(doc, id) {
  remove(doc, T, id)
}
