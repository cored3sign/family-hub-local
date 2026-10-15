import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from '../testing'
import { all, remove } from '../collection'
import { listNotifications } from '../notifications'
import {
  listAnnouncements, saveAnnouncement, deleteAnnouncement, markAnnouncementRead,
  listCheckinPrompts, saveCheckinPrompt, respondCheckin, listCheckinResponses,
  listOneOnOnes, oneOnOnesFor, saveOneOnOne, respondOneOnOne, logOneOnOne,
} from './communication'

describe('announcements', () => {
  it('pinned first, per-member read state, expiry, author-or-admin edits', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const old = saveAnnouncement(doc, kid, { body: 'Early dismissal', expires_at: '2020-01-01 00:00:00' })
    const pinned = saveAnnouncement(doc, admin, { body: 'Family dinner Sunday', pinned: true })
    expect(listAnnouncements(doc, kid.id).map((a) => a.id)).toEqual([pinned])
    expect(listAnnouncements(doc, kid.id, { includeExpired: true })).toHaveLength(2)
    markAnnouncementRead(doc, kid.id, pinned)
    markAnnouncementRead(doc, kid.id, pinned)
    expect(listAnnouncements(doc, kid.id)[0].is_read).toBe(true)
    expect(listAnnouncements(doc, admin.id)[0].is_read).toBe(false)
    expect(() => saveAnnouncement(doc, kid, { id: pinned, body: 'hijack' })).toThrow('Announcement not found')
    saveAnnouncement(doc, admin, { id: old, body: 'Edited by admin' })
    deleteAnnouncement(doc, admin, pinned)
    expect(doc.getMap('announcement_reads').size).toBe(0)
  })
})

describe('check-ins', () => {
  it('admin manages prompts; private responses are only visible to their author', () => {
    const { doc, admin, kid } = newFamilyDoc()
    expect(listCheckinPrompts(doc)).toHaveLength(3)
    expect(() => saveCheckinPrompt(doc, kid, { prompt_text: 'x' })).toThrow('Only an admin can do that')
    expect(() => saveCheckinPrompt(doc, admin, { prompt_text: 'x', prompt_type: 'poll' })).toThrow('prompt_type must be scale, text or emoji')
    const retired = saveCheckinPrompt(doc, admin, { prompt_text: 'Old one', active: false })
    expect(listCheckinPrompts(doc).some((p) => p.id === retired)).toBe(false)
    expect(listCheckinPrompts(doc, { includeInactive: true }).some((p) => p.id === retired)).toBe(true)
    respondCheckin(doc, kid, { prompt_id: 'checkin-default-1', value: '4' })
    respondCheckin(doc, kid, { prompt_id: 'checkin-default-2', value: 'tired', visibility: 'private' })
    expect(listCheckinResponses(doc, admin.id)).toHaveLength(1)
    expect(listCheckinResponses(doc, kid.id)[0]).toMatchObject({ member_name: 'Kit Kid' })
    expect(listCheckinResponses(doc, kid.id)).toHaveLength(2)
  })

  it('survives a response whose prompt was deleted on another device', () => {
    const { doc, kid } = newFamilyDoc()
    respondCheckin(doc, kid, { prompt_id: 'checkin-default-1', value: '5' })
    remove(doc, 'checkin_prompts', 'checkin-default-1')
    expect(listCheckinResponses(doc, kid.id)[0]).toMatchObject({ prompt_text: null, member_name: 'Kit Kid' })
  })
})

describe('1:1s', () => {
  it('asking needs another real member, tells them, and puts nothing on the calendar until they accept', () => {
    const { doc, admin, kid } = newFamilyDoc()
    expect(() => saveOneOnOne(doc, admin, { member_b_id: admin.id })).toThrow('A 1:1 needs two different members')
    expect(() => saveOneOnOne(doc, admin, { member_b_id: 'ghost' })).toThrow('must be a real member')
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id, scheduled_date: '2026-10-03' })
    expect(listNotifications(doc, kid.id)[0]).toMatchObject({ type: 'one_on_one_requested', related_id: id, message: 'Pat Parent asked for 1:1 time with you on 2026-10-03' })
    expect(oneOnOnesFor(doc, kid.id)).toMatchObject({ incoming: [{ id, member_a_name: 'Pat Parent' }], upcoming: [] })
    expect(oneOnOnesFor(doc, admin.id)).toMatchObject({ outgoing: [{ id, status: 'requested' }] })
    expect(all(doc, 'events')).toEqual([])
  })

  it('accepting schedules it on the calendar and tells the person who asked', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id, scheduled_date: '2026-10-03' })
    respondOneOnOne(doc, kid, id, { accept: true })
    expect(oneOnOnesFor(doc, kid.id)).toMatchObject({ incoming: [], upcoming: [{ id, status: 'scheduled', scheduled_date: '2026-10-03' }] })
    expect(listNotifications(doc, admin.id)[0]).toMatchObject({ type: 'one_on_one_accepted', message: 'Kit Kid accepted your 1:1 on 2026-10-03', related_id: id })
    expect(all(doc, 'events')).toEqual([expect.objectContaining({ title: '1:1: Pat Parent and Kit Kid', event_date: '2026-10-03', all_day: true })])
  })

  it('accepting with a different date schedules that date instead', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id, scheduled_date: '2026-10-03' })
    respondOneOnOne(doc, kid, id, { accept: true, scheduled_date: '2026-10-10' })
    expect(oneOnOnesFor(doc, admin.id).upcoming).toMatchObject([{ id, scheduled_date: '2026-10-10' }])
    expect(all(doc, 'events')[0].event_date).toBe('2026-10-10')
  })

  it('accepting needs a date, either proposed or picked', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id })
    expect(() => respondOneOnOne(doc, kid, id, { accept: true })).toThrow('Pick a date to accept this 1:1')
    expect(() => respondOneOnOne(doc, kid, id, { accept: true, scheduled_date: '20 Oct' })).toThrow('The date must look like 2026-10-20')
    respondOneOnOne(doc, kid, id, { accept: true, scheduled_date: '2026-10-20' })
    expect(oneOnOnesFor(doc, kid.id).upcoming).toMatchObject([{ id, scheduled_date: '2026-10-20' }])
  })

  it('declining tells the person who asked and schedules nothing', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id, scheduled_date: '2026-10-03' })
    respondOneOnOne(doc, kid, id, { accept: false })
    expect(listNotifications(doc, admin.id)[0]).toMatchObject({ type: 'one_on_one_declined', message: "Kit Kid can't make the 1:1 on 2026-10-03" })
    expect(oneOnOnesFor(doc, admin.id)).toMatchObject({ outgoing: [{ id, status: 'declined' }], upcoming: [] })
    expect(all(doc, 'events')).toEqual([])
  })

  it('only the person asked can answer, and only once', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id, scheduled_date: '2026-10-03' })
    expect(() => respondOneOnOne(doc, admin, id, { accept: true })).toThrow('Only the person asked can answer this 1:1')
    respondOneOnOne(doc, kid, id, { accept: false })
    expect(() => respondOneOnOne(doc, kid, id, { accept: true })).toThrow('This 1:1 has already been answered')
  })

  it('two devices that both accept write one calendar entry', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id, scheduled_date: '2026-10-03' })
    const other = forkDoc(doc)
    respondOneOnOne(doc, kid, id, { accept: true })
    respondOneOnOne(other, kid, id, { accept: true })
    syncDocs(doc, other)
    expect(all(doc, 'events')).toHaveLength(1)
  })

  it('logging a 1:1 moves it from upcoming to history', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const id = saveOneOnOne(doc, admin, { member_b_id: kid.id, scheduled_date: '2026-10-03' })
    respondOneOnOne(doc, kid, id, { accept: true })
    logOneOnOne(doc, id, 'Went for ice cream')
    expect(listOneOnOnes(doc, 'upcoming')).toEqual([])
    expect(listOneOnOnes(doc, 'history')[0]).toMatchObject({ notes: 'Went for ice cream' })
  })
})
