import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from '../testing'
import { listEvents, saveEvent, deleteEvent } from './events'

describe('events', () => {
  it('creates, sorts by date, preserves omitted fields on update, deletes', () => {
    const { doc, kid } = newFamilyDoc()
    const late = saveEvent(doc, { title: 'Recital', event_date: '2026-11-02', event_time: '18:00', assigned_member_id: kid.id })
    saveEvent(doc, { title: 'Trip', event_date: '2026-10-01' })
    expect(listEvents(doc).map((e) => e.title)).toEqual(['Trip', 'Recital'])
    saveEvent(doc, { id: late, title: 'Recital!', event_date: '2026-11-03' })
    expect(listEvents(doc)[1]).toMatchObject({ title: 'Recital!', event_time: '18:00', category: 'event', assigned_member_id: kid.id })
    expect(() => saveEvent(doc, { title: 'x', event_date: '' })).toThrow('title and event_date are required')
    deleteEvent(doc, late)
    expect(listEvents(doc)).toHaveLength(1)
  })

  it('an event can have a location and notes; an edit keeps them unless it changes them', () => {
    const { doc } = newFamilyDoc()
    const id = saveEvent(doc, { title: 'Dentist', event_date: '2026-10-20', location: '  Main St Clinic ', description: 'Bring the insurance card' })
    expect(listEvents(doc)[0]).toMatchObject({ location: 'Main St Clinic', description: 'Bring the insurance card' })
    saveEvent(doc, { id, title: 'Dentist', event_date: '2026-10-21' })
    expect(listEvents(doc)[0]).toMatchObject({ location: 'Main St Clinic', description: 'Bring the insurance card' })
    saveEvent(doc, { id, title: 'Dentist', event_date: '2026-10-21', location: '', description: '   ' })
    expect(listEvents(doc)[0]).toMatchObject({ location: null, description: null })
  })
})
