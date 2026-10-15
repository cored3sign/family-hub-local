import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from '../testing'
import { listNotifications } from '../notifications'
import { ageOn, celebrationDate, deleteBirthday, listBirthdays, nextCelebration, recordBirthdayReminders, saveBirthday } from './birthdays'

const TODAY = '2026-10-15'

function birthdayReminders(doc, memberId) {
  return listNotifications(doc, memberId).filter((n) => n.type === 'birthday')
}

describe('birthdays: dates', () => {
  it('a 29 February birthday is celebrated on 28 February in years without one', () => {
    expect(celebrationDate('2020-02-29', 2027)).toBe('2027-02-28')
    expect(celebrationDate('2020-02-29', 2028)).toBe('2028-02-29')
  })

  it('the next celebration is today on the day, and next year once it has passed', () => {
    expect(nextCelebration('2018-10-15', TODAY)).toBe('2026-10-15')
    expect(nextCelebration('2018-10-14', TODAY)).toBe('2027-10-14')
    expect(nextCelebration('2018-01-02', '2026-12-31')).toBe('2027-01-02')
  })

  it('age counts from the celebration day, so the day before is still the old age', () => {
    expect(ageOn('2018-03-14', '2026-03-13')).toBe(7)
    expect(ageOn('2018-03-14', '2026-03-14')).toBe(8)
    expect(ageOn('2020-02-29', '2027-02-28')).toBe(7)
  })
})

describe('birthdays: entering them', () => {
  it('needs a name and a real date that is not in the future', () => {
    const { doc } = newFamilyDoc()
    expect(() => saveBirthday(doc, { birth_date: '2018-03-14' }, TODAY)).toThrow('name is required')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_date: '2018-02-30' }, TODAY)).toThrow('birth_date must be a date like 2018-03-14')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_date: '14/03/2018' }, TODAY)).toThrow('birth_date must be a date like 2018-03-14')
    expect(() => saveBirthday(doc, { name: 'Ana', birth_date: '2026-10-16' }, TODAY)).toThrow("birth_date can't be in the future")
    expect(() => saveBirthday(doc, { name: 'Ana', birth_date: '1850-01-01' }, TODAY)).toThrow('birth_date must be after 1900')
  })

  it('lists the soonest first, with the age each person turns', () => {
    const { doc } = newFamilyDoc()
    saveBirthday(doc, { name: 'Zoe', birth_date: '2019-12-01' }, TODAY)
    saveBirthday(doc, { name: 'Ana', birth_date: '2018-10-20' }, TODAY)
    saveBirthday(doc, { name: 'Ben', birth_date: '2015-01-05' }, TODAY)
    expect(listBirthdays(doc, TODAY).map((b) => [b.name, b.next_date, b.turns, b.days_until])).toEqual([
      ['Ana', '2026-10-20', 8, 5],
      ['Zoe', '2026-12-01', 7, 47],
      ['Ben', '2027-01-05', 12, 82],
    ])
  })

  it('can be edited and deleted', () => {
    const { doc } = newFamilyDoc()
    const id = saveBirthday(doc, { name: 'Ana', birth_date: '2018-10-20' }, TODAY)
    saveBirthday(doc, { id, name: 'Ana B', birth_date: '2018-10-21' }, TODAY)
    expect(listBirthdays(doc, TODAY)).toMatchObject([{ name: 'Ana B', birth_date: '2018-10-21' }])
    deleteBirthday(doc, id)
    expect(listBirthdays(doc, TODAY)).toEqual([])
  })
})

describe('birthdays: reminders', () => {
  it('on the day, every family member gets one reminder, and a second check adds none', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_date: '2018-10-15' }, TODAY)
    expect(birthdayReminders(doc, kid.id)).toEqual([
      expect.objectContaining({ type: 'birthday', message: "Today is Ana's birthday, turning 8.", read_at: null }),
    ])
    expect(birthdayReminders(doc, admin.id)).toHaveLength(1)
    expect(recordBirthdayReminders(doc, TODAY)).toBe(0)
    expect(birthdayReminders(doc, kid.id)).toHaveLength(1)
  })

  it('no reminder for a birthday that is not in the last six days, or not yet', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ben', birth_date: '2018-10-01' }, TODAY)
    saveBirthday(doc, { name: 'Cal', birth_date: '2018-10-16' }, TODAY)
    expect(birthdayReminders(doc, kid.id)).toEqual([])
  })

  it('a device that was off on the day writes the reminder when it next opens, within six days', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_date: '2018-10-15' }, '2026-10-10')
    expect(recordBirthdayReminders(doc, '2026-10-18')).toBe(2)
    expect(recordBirthdayReminders(doc, '2026-10-18')).toBe(0)
    expect(birthdayReminders(doc, kid.id)).toEqual([expect.objectContaining({ message: 'Ana turned 8 3 days ago.' })])
  })

  it('nothing is written more than six days after the birthday', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_date: '2018-10-15' }, '2026-10-10')
    expect(recordBirthdayReminders(doc, '2026-10-22')).toBe(0)
    expect(birthdayReminders(doc, kid.id)).toEqual([])
  })

  it('a birthday just before New Year is still caught up in January', () => {
    const { doc, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ivy', birth_date: '2019-12-30' }, '2026-12-01')
    expect(recordBirthdayReminders(doc, '2027-01-02')).toBe(2)
    expect(birthdayReminders(doc, kid.id)).toEqual([expect.objectContaining({ message: 'Ivy turned 7 3 days ago.' })])
  })

  it('two devices that both record the day write one reminder per member', () => {
    const { doc, admin, kid } = newFamilyDoc()
    saveBirthday(doc, { name: 'Ana', birth_date: '2018-10-15' }, '2026-10-01')
    const other = forkDoc(doc)
    expect(recordBirthdayReminders(doc, TODAY)).toBe(2)
    expect(recordBirthdayReminders(other, TODAY)).toBe(2)
    syncDocs(doc, other)
    expect(birthdayReminders(doc, kid.id)).toHaveLength(1)
    expect(birthdayReminders(other, admin.id)).toHaveLength(1)
  })
})
