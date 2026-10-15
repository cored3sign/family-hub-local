import { all, get, insert, patch, remove, blankToNull, requireText } from '../collection'

const T = 'events'
const REQUIRED = 'title and event_date are required'

export function listEvents(doc) {
  return all(doc, T).sort(
    (a, b) => a.event_date.localeCompare(b.event_date) || String(a.event_time ?? '').localeCompare(String(b.event_time ?? '')),
  )
}

export function saveEvent(doc, input) {
  const title = requireText(input.title, REQUIRED)
  const eventDate = requireText(input.event_date, REQUIRED)
  if (input.id) {
    const prev = get(doc, T, input.id)
    if (!prev) throw new Error('Event not found')
    patch(doc, T, input.id, {
      title,
      event_date: eventDate,
      event_time: 'event_time' in input ? blankToNull(input.event_time) : prev.event_time,
      category: 'category' in input ? input.category : prev.category,
      assigned_member_id: 'assigned_member_id' in input ? input.assigned_member_id || null : prev.assigned_member_id,
      location: 'location' in input ? blankToNull(input.location) : prev.location ?? null,
      description: 'description' in input ? blankToNull(input.description) : prev.description ?? null,
    })
    return input.id
  }
  return insert(doc, T, {
    title,
    description: blankToNull(input.description),
    location: blankToNull(input.location),
    event_date: eventDate,
    end_date: null,
    event_time: blankToNull(input.event_time),
    all_day: true,
    category: input.category ?? 'event',
    assigned_member_id: input.assigned_member_id || null,
  })
}

export function deleteEvent(doc, id) {
  remove(doc, T, id)
}
