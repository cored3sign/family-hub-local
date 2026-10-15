import { all, byText, get, insert, patch, remove, requireText } from '../collection'
import { listMembers } from '../members'

const T = 'birthdays'
const NOTIFICATIONS = 'notifications'
export const REMINDER_TYPE = 'birthday'

// Birthdays are calendar dates, kept as YYYY-MM-DD text (which sorts correctly as text). "Today" is the
// device's own date, the same way the calendar works out today.
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86400000

function pad(n) {
  return String(n).padStart(2, '0')
}

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

// The parts of a real calendar date written YYYY-MM-DD, or null (13th month, 30 February, wrong shape).
export function parseIsoDate(text) {
  const match = ISO_DATE.exec(String(text ?? ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
  return { year, month, day }
}

// The day a birthday is celebrated in a given year. A 29 February birthday is celebrated on 28 February in
// years without one.
export function celebrationDate(birthDate, year) {
  const { month, day } = parseIsoDate(birthDate)
  const celebrated = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
  return `${year}-${pad(month)}-${pad(celebrated)}`
}

// The next celebration on or after `today`, as YYYY-MM-DD.
export function nextCelebration(birthDate, today = todayIso()) {
  const year = Number(today.slice(0, 4))
  const thisYear = celebrationDate(birthDate, year)
  return thisYear >= today ? thisYear : celebrationDate(birthDate, year + 1)
}

// The age someone is on a date. The birthday counts from its celebration day, so the day before is still
// the old age.
export function ageOn(birthDate, date) {
  const year = Number(date.slice(0, 4))
  const born = parseIsoDate(birthDate).year
  return year - born - (date < celebrationDate(birthDate, year) ? 1 : 0)
}

function daysBetween(from, to) {
  const a = parseIsoDate(from)
  const b = parseIsoDate(to)
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / DAY_MS)
}

function validateBirthDate(text, today) {
  const parsed = parseIsoDate(text)
  if (!parsed) throw new Error('birth_date must be a date like 2018-03-14')
  if (parsed.year < 1900) throw new Error('birth_date must be after 1900')
  if (text > today) throw new Error("birth_date can't be in the future")
  return text
}

// Adds or edits a birthday (`input.id` makes it an edit). Any reminder due today is written straight away, so
// a birthday entered on the day still gets its reminder.
export function saveBirthday(doc, input, today = todayIso()) {
  const name = requireText(input.name, 'name is required')
  const birth_date = validateBirthDate(input.birth_date, today)
  let id = input.id
  if (id) {
    if (!get(doc, T, id)) throw new Error('Birthday not found')
    patch(doc, T, id, { name, birth_date })
  } else {
    id = insert(doc, T, { name, birth_date })
  }
  recordBirthdayReminders(doc, today)
  return id
}

export function deleteBirthday(doc, id) {
  remove(doc, T, id)
}

// Every birthday with its next celebration, how old that makes them, and how many days away it is. Soonest first.
export function listBirthdays(doc, today = todayIso()) {
  return all(doc, T)
    .map((b) => {
      const date = nextCelebration(b.birth_date, today)
      return { ...b, next_date: date, turns: ageOn(b.birth_date, date), days_until: daysBetween(today, date) }
    })
    .sort((a, b) => a.next_date.localeCompare(b.next_date) || byText(a.name, b.name))
}

// A reminder is written on the day, and on any of the six days after it. That covers a family whose devices were
// all off on the birthday: the first device opened in that week writes it.
const CATCH_UP_DAYS = 6

// Writes one reminder to each family member for each birthday from the last six days (today included). The
// reminder's id is fixed by the birthday, the celebration year and the member, so two devices that both write it
// end up with one record, not two, and a reminder is never written twice. Returns how many were written. Safe to
// call as often as you like.
export function recordBirthdayReminders(doc, today = todayIso()) {
  const year = Number(today.slice(0, 4))
  const due = []
  for (const b of all(doc, T)) {
    for (const celebrationYear of [year - 1, year]) {
      const date = celebrationDate(b.birth_date, celebrationYear)
      const daysAgo = daysBetween(date, today)
      if (daysAgo >= 0 && daysAgo <= CATCH_UP_DAYS) due.push({ b, date, daysAgo, celebrationYear })
    }
  }
  if (due.length === 0) return 0
  const members = listMembers(doc)
  let written = 0
  doc.transact(() => {
    for (const { b, date, daysAgo, celebrationYear } of due) {
      const turns = ageOn(b.birth_date, date)
      const message = reminderText(b.name, turns, daysAgo)
      for (const m of members) {
        const id = `birthday-${b.id}-${celebrationYear}-${m.id}`
        if (get(doc, NOTIFICATIONS, id)) continue
        insert(doc, NOTIFICATIONS, { recipient_member_id: m.id, type: REMINDER_TYPE, message, related_id: b.id, read_at: null }, id)
        written++
      }
    }
  })
  return written
}

function reminderText(name, turns, daysAgo) {
  if (daysAgo === 0) return turns >= 1 ? `Today is ${name}'s birthday, turning ${turns}.` : `Today is ${name}'s birthday.`
  const when = daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`
  return turns >= 1 ? `${name} turned ${turns} ${when}.` : `${name}'s birthday was ${when}.`
}
