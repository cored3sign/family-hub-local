import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from '../testing'
import { remove } from '../collection'
import { listNotifications } from '../notifications'
import {
  listAnnouncements, saveAnnouncement, deleteAnnouncement, markAnnouncementRead,
  listCheckinPrompts, saveCheckinPrompt, respondCheckin, listCheckinResponses,
  listOneOnOnes, saveOneOnOne, logOneOnOne,
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
  it('requests notify the other member; log marks it happened', () => {
    const { doc, admin, kid } = newFamilyDoc()
    expect(() => saveOneOnOne(doc, admin, { member_a_id: admin.id, member_b_id: admin.id })).toThrow('A 1:1 needs two different members')
    const id = saveOneOnOne(doc, admin, { member_a_id: admin.id, member_b_id: kid.id, scheduled_date: '2026-10-03' })
    expect(listNotifications(doc, kid.id)[0].message).toBe('Pat Parent requested 1:1 time with you on 2026-10-03')
    expect(listOneOnOnes(doc, 'upcoming')[0]).toMatchObject({ member_a_name: 'Pat Parent', member_b_name: 'Kit Kid' })
    logOneOnOne(doc, id, 'Went for ice cream')
    expect(listOneOnOnes(doc, 'upcoming')).toEqual([])
    expect(listOneOnOnes(doc, 'history')[0]).toMatchObject({ notes: 'Went for ice cream' })
  })
})
