import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from '../testing'
import { listNotifications } from '../notifications'
import { listTodos, saveTodo, deleteTodo, nudgeTodo } from './todos'

describe('todos', () => {
  it('creates with assignment, notifies the assignee, not the actor', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveTodo(doc, admin, { title: 'Mine', assigned_member_id: admin.id })
    const id = saveTodo(doc, admin, { title: 'Dishes', assigned_member_id: kid.id, deadline: '' })
    expect(listTodos(doc).find((t) => t.id === id)).toMatchObject({ status: 'todo', assigned_by_member_id: admin.id, deadline: null })
    expect(listNotifications(doc, kid.id).map((n) => n.message)).toEqual(['You were assigned a to-do: "Dishes"'])
    expect(listNotifications(doc, admin.id)).toEqual([])
  })

  it('completing sets completed_at and notifies whoever assigned it', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveTodo(doc, admin, { title: 'Dishes', assigned_member_id: kid.id })
    saveTodo(doc, kid, { id, title: 'Dishes', assigned_member_id: kid.id, status: 'done' })
    const todo = listTodos(doc)[0]
    expect(todo.completed_at).toMatch(/^\d{4}-/)
    expect(listNotifications(doc, admin.id)[0].message).toBe('Kit Kid completed: "Dishes"')
    saveTodo(doc, kid, { id, title: 'Dishes', assigned_member_id: kid.id, status: 'todo' })
    expect(listTodos(doc)[0].completed_at).toBe(null)
  })

  it('keeps description/deadline when omitted, validates input', () => {
    const { doc, admin } = newFamilyDoc()
    const id = saveTodo(doc, admin, { title: 'A', assigned_member_id: admin.id, description: 'note', deadline: '2026-10-01' })
    saveTodo(doc, admin, { id, title: 'A2', assigned_member_id: admin.id })
    expect(listTodos(doc)[0]).toMatchObject({ title: 'A2', description: 'note', deadline: '2026-10-01' })
    expect(() => saveTodo(doc, admin, { title: 'x' })).toThrow('assigned_member_id is required')
    expect(() => saveTodo(doc, admin, { title: 'x', assigned_member_id: admin.id, status: 'nope' })).toThrow('status must be one of todo, doing, done')
    deleteTodo(doc, id)
    expect(listTodos(doc)).toEqual([])
  })

  it('nudges with a 5-minute cooldown and never nudges yourself', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveTodo(doc, admin, { title: 'Dishes', assigned_member_id: kid.id })
    expect(nudgeTodo(doc, admin, id)).toEqual({ nudged: true })
    expect(() => nudgeTodo(doc, admin, id)).toThrow('Already nudged recently -- try again in a few minutes')
    expect(nudgeTodo(doc, admin, id, new Date(Date.now() + 6 * 60000))).toEqual({ nudged: true })
    expect(nudgeTodo(doc, kid, id)).toEqual({ nudged: false })
  })
})
