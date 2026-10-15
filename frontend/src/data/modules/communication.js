import { all, get, insert, patch, remove, removeWhere, table, requireText, blankToNull } from '../collection'
import { nowStamp } from '../time'
import { isAdmin, requireAdmin, memberName, getMember } from '../members'
import { notify } from '../notifications'

const A = 'announcements'
const READS = 'announcement_reads'
const PROMPTS = 'checkin_prompts'
const RESPONSES = 'checkin_responses'
const O = 'one_on_ones'
const PROMPT_TYPES = ['scale', 'text', 'emoji']

// Deterministic key: a member reading on two devices writes one record.
const readKey = (announcementId, memberId) => `${announcementId}:${memberId}`

export function listAnnouncements(doc, memberId, { includeExpired = false, now = new Date() } = {}) {
  const stamp = nowStamp(now)
  const reads = table(doc, READS)
  return all(doc, A)
    .filter((a) => includeExpired || !a.expires_at || a.expires_at > stamp)
    .map((a) => ({ ...a, is_read: reads.has(readKey(a.id, memberId)) }))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at))
}

function editableAnnouncement(doc, actor, id) {
  const existing = get(doc, A, id)
  if (!existing || (!isAdmin(doc, actor) && existing.author_member_id !== actor.id)) throw new Error('Announcement not found')
  return existing
}

export function saveAnnouncement(doc, actor, input) {
  const fields = { body: requireText(input.body, 'body is required'), pinned: Boolean(input.pinned), expires_at: input.expires_at || null }
  if (input.id) {
    editableAnnouncement(doc, actor, input.id)
    patch(doc, A, input.id, fields)
    return input.id
  }
  return insert(doc, A, { ...fields, author_member_id: actor.id })
}

export function deleteAnnouncement(doc, actor, id) {
  editableAnnouncement(doc, actor, id)
  doc.transact(() => {
    removeWhere(doc, READS, (r) => r.announcement_id === id)
    remove(doc, A, id)
  })
}

export function markAnnouncementRead(doc, memberId, id) {
  const key = readKey(id, memberId)
  if (!table(doc, READS).has(key)) insert(doc, READS, { announcement_id: id, member_id: memberId, read_at: nowStamp() }, key)
}

export function listCheckinPrompts(doc, { includeInactive = false } = {}) {
  return all(doc, PROMPTS)
    .filter((p) => includeInactive || p.active)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

export function saveCheckinPrompt(doc, actor, input) {
  requireAdmin(doc, actor)
  const promptText = requireText(input.prompt_text, 'prompt_text is required')
  const promptType = input.prompt_type ?? 'scale'
  if (!PROMPT_TYPES.includes(promptType)) throw new Error('prompt_type must be scale, text or emoji')
  const fields = { prompt_text: promptText, prompt_type: promptType, active: 'active' in input ? Boolean(input.active) : true }
  if (input.id) {
    if (!patch(doc, PROMPTS, input.id, fields)) throw new Error('Prompt not found')
    return input.id
  }
  return insert(doc, PROMPTS, fields)
}

export function respondCheckin(doc, actor, input) {
  if (!input.prompt_id) throw new Error('prompt_id and value are required')
  const value = requireText(input.value, 'prompt_id and value are required')
  const visibility = input.visibility ?? 'family'
  if (!['private', 'family'].includes(visibility)) throw new Error('visibility must be private or family')
  return insert(doc, RESPONSES, { prompt_id: input.prompt_id, member_id: actor.id, value, visibility })
}

export function listCheckinResponses(doc, memberId) {
  const prompts = table(doc, PROMPTS)
  return all(doc, RESPONSES)
    .filter((r) => r.visibility === 'family' || r.member_id === memberId)
    .map((r) => ({
      ...r,
      member_name: memberName(doc, r.member_id),
      prompt_text: prompts.get(r.prompt_id)?.get('prompt_text') ?? null,
      prompt_type: prompts.get(r.prompt_id)?.get('prompt_type') ?? null,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

// A 1:1 moves from requested (asked, waiting for an answer) to scheduled (accepted, and on the calendar), or to
// declined. A row written before statuses existed counts as scheduled.
function oneOnOneStatus(row) {
  return row.status ?? 'scheduled'
}

function optionalDate(value) {
  if (value === '' || value === null || value === undefined) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('The date must look like 2026-10-20')
  return value
}

export function listOneOnOnes(doc, view = 'all') {
  const rows = all(doc, O).map((o) => ({ ...o, member_a_name: memberName(doc, o.member_a_id), member_b_name: memberName(doc, o.member_b_id) }))
  if (view === 'upcoming') return rows.filter((o) => oneOnOneStatus(o) === 'scheduled' && o.scheduled_date && !o.happened_at).sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
  if (view === 'history') return rows.filter((o) => o.happened_at).sort((a, b) => b.happened_at.localeCompare(a.happened_at))
  const when = (o) => o.happened_at ?? o.scheduled_date ?? o.created_at
  return rows.sort((a, b) => when(b).localeCompare(when(a)))
}

// The 1:1s a member is part of, in the three groups the Speak page shows: asked of them and waiting for their
// answer, asked by them and still waiting or declined, and accepted and on the calendar.
export function oneOnOnesFor(doc, memberId) {
  const rows = listOneOnOnes(doc)
  return {
    incoming: rows.filter((o) => o.member_b_id === memberId && oneOnOneStatus(o) === 'requested'),
    outgoing: rows.filter((o) => o.member_a_id === memberId && oneOnOneStatus(o) !== 'scheduled'),
    upcoming: rows
      .filter((o) => (o.member_a_id === memberId || o.member_b_id === memberId) && oneOnOneStatus(o) === 'scheduled' && o.scheduled_date && !o.happened_at)
      .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
  }
}

// Asks another member for a 1:1. The person asked answers it (respondOneOnOne); nothing goes on the calendar until they accept.
export function saveOneOnOne(doc, actor, input) {
  if (!input.member_b_id) throw new Error('member_b_id is required')
  if (actor.id === input.member_b_id) throw new Error('A 1:1 needs two different members')
  if (!getMember(doc, input.member_b_id)) throw new Error('member_b_id must be a real member of this family')
  const scheduled = optionalDate(input.scheduled_date)
  let id
  doc.transact(() => {
    id = insert(doc, O, {
      member_a_id: actor.id,
      member_b_id: input.member_b_id,
      scheduled_date: scheduled,
      notes: input.notes ?? null,
      status: 'requested',
      responded_at: null,
      happened_at: null,
    })
    const when = scheduled ? ` on ${scheduled}` : ''
    notify(doc, actor, { recipientId: input.member_b_id, type: 'one_on_one_requested', message: `${actor.name} asked for 1:1 time with you${when}`, relatedId: id })
  })
  return id
}

// The person asked answers. Accepting puts the 1:1 on the calendar on the agreed date. Either answer tells the
// person who asked, and a 1:1 can only be answered once.
export function respondOneOnOne(doc, actor, id, { accept, scheduled_date = null }) {
  const row = get(doc, O, id)
  if (!row) throw new Error('1:1 not found')
  if (row.member_b_id !== actor.id) throw new Error('Only the person asked can answer this 1:1')
  if (oneOnOneStatus(row) !== 'requested') throw new Error('This 1:1 has already been answered')
  const date = optionalDate(scheduled_date) ?? row.scheduled_date ?? null
  if (accept && !date) throw new Error('Pick a date to accept this 1:1')
  const when = date ? ` on ${date}` : ''
  doc.transact(() => {
    patch(doc, O, id, { status: accept ? 'scheduled' : 'declined', scheduled_date: date, responded_at: nowStamp() })
    if (accept) putOnCalendar(doc, id, `1:1: ${memberName(doc, row.member_a_id)} and ${memberName(doc, row.member_b_id)}`, date)
    notify(doc, actor, {
      recipientId: row.member_a_id,
      type: accept ? 'one_on_one_accepted' : 'one_on_one_declined',
      message: accept ? `${actor.name} accepted your 1:1${when}` : `${actor.name} can't make the 1:1${when}`,
      relatedId: id,
    })
  })
}

// The calendar entry for an accepted 1:1. Its id comes from the 1:1, so two devices answering write one entry.
function putOnCalendar(doc, oneOnOneId, title, date) {
  const eventId = `one-on-one-${oneOnOneId}`
  if (get(doc, 'events', eventId)) {
    patch(doc, 'events', eventId, { title, event_date: date })
    return
  }
  insert(doc, 'events', { title, description: null, event_date: date, end_date: null, event_time: null, all_day: true, category: 'event', assigned_member_id: null }, eventId)
}

export function logOneOnOne(doc, id, notes) {
  const fields = { happened_at: nowStamp() }
  if (notes !== undefined) fields.notes = notes
  if (!patch(doc, O, id, fields)) throw new Error('1:1 not found')
}
