import { all, get, insert, patch, remove, blankToNull, requireText } from '../collection'
import { notify } from '../notifications'
import { nowStamp, stampMinutesAgo } from '../time'

const T = 'todos'
export const TODO_STATUSES = ['todo', 'doing', 'done']
export const NUDGE_COOLDOWN_MINUTES = 5

export function listTodos(doc) {
  return all(doc, T).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export function saveTodo(doc, actor, input) {
  const title = requireText(input.title, 'title is required')
  if (input.status != null && !TODO_STATUSES.includes(input.status)) throw new Error('status must be one of todo, doing, done')
  if (!input.assigned_member_id) throw new Error('assigned_member_id is required')
  const assignee = input.assigned_member_id

  if (input.id) {
    const prev = get(doc, T, input.id)
    if (!prev) throw new Error('To-do not found')
    const status = input.status ?? prev.status
    const assignedBy = assignee !== prev.assigned_member_id ? actor.id : prev.assigned_by_member_id
    const completedAt = status !== 'done' ? null : prev.status === 'done' ? prev.completed_at : nowStamp()
    doc.transact(() => {
      patch(doc, T, input.id, {
        title,
        status,
        assigned_member_id: assignee,
        assigned_by_member_id: assignedBy,
        completed_at: completedAt,
        description: 'description' in input ? blankToNull(input.description) : prev.description,
        deadline: 'deadline' in input ? blankToNull(input.deadline) : prev.deadline,
      })
      if (assignee !== prev.assigned_member_id) {
        notify(doc, actor, { recipientId: assignee, type: 'todo_assigned', message: `You were assigned a to-do: "${title}"`, relatedId: input.id })
      }
      if (status === 'done' && prev.status !== 'done' && assignedBy) {
        notify(doc, actor, { recipientId: assignedBy, type: 'todo_completed', message: `${actor.name} completed: "${title}"`, relatedId: input.id })
      }
    })
    return input.id
  }

  const status = input.status ?? 'todo'
  let id
  doc.transact(() => {
    id = insert(doc, T, {
      title,
      description: blankToNull(input.description),
      status,
      assigned_member_id: assignee,
      assigned_by_member_id: actor.id,
      deadline: blankToNull(input.deadline),
      completed_at: status === 'done' ? nowStamp() : null,
      sort_order: 0,
    })
    notify(doc, actor, { recipientId: assignee, type: 'todo_assigned', message: `You were assigned a to-do: "${title}"`, relatedId: id })
  })
  return id
}

export function deleteTodo(doc, id) {
  remove(doc, T, id)
}

export function nudgeTodo(doc, actor, id, now = new Date()) {
  const todo = get(doc, T, id)
  if (!todo) throw new Error('Not found')
  if (!todo.assigned_member_id) throw new Error('This to-do has no assignee to nudge')
  if (todo.assigned_member_id === actor.id) return { nudged: false }
  const since = stampMinutesAgo(NUDGE_COOLDOWN_MINUTES, now)
  const recent = all(doc, 'notifications').some(
    (n) => n.type === 'todo_nudge' && n.related_id === id && n.recipient_member_id === todo.assigned_member_id && n.created_at > since,
  )
  if (recent) throw new Error('Already nudged recently -- try again in a few minutes')
  notify(doc, actor, { recipientId: todo.assigned_member_id, type: 'todo_nudge', message: `${actor.name} nudged you about: "${todo.title}"`, relatedId: id })
  return { nudged: true }
}
