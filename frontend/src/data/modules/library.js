import { all, get, insert, patch, remove, removeWhere, table, blankToNull, requireText, byText } from '../collection'
import { nowStamp } from '../time'
import { getMember, listMembers } from '../members'

const BOOKS = 'books'
const PROGRESS = 'reading_progress'
const LOANS = 'loans'
export const COVER_PREFIX = 'https://covers.openlibrary.org/'
const BOOK_STATUSES = ['want_to_read', 'owned']
const FORMATS = ['physical', 'ebook', 'audiobook']
const READING_STATUSES = ['want_to_read', 'reading', 'finished']

const progressKey = (bookId, memberId) => `${bookId}:${memberId}`

function checkOwner(doc, ownerId) {
  if (ownerId && !getMember(doc, ownerId)) throw new Error('owner_member_id must be a real member of this family')
}

export function listBooks(doc, status = null) {
  const progress = all(doc, PROGRESS)
  return all(doc, BOOKS)
    .filter((b) => !BOOK_STATUSES.includes(status) || b.status === status)
    .map((b) => ({ ...b, reading_progress: progress.filter((p) => p.book_id === b.id) }))
    .sort((a, b) => byText(a.title, b.title))
}

export function booksWithMembers(doc, status = null) {
  return { books: listBooks(doc, status), members: listMembers(doc) }
}

export function saveBook(doc, actor, input) {
  const title = requireText(input.title, 'title is required')
  const status = input.status ?? 'owned'
  if (!BOOK_STATUSES.includes(status)) throw new Error('status must be want_to_read or owned')
  const format = input.format ?? 'physical'
  if (!FORMATS.includes(format)) throw new Error('format must be physical, ebook or audiobook')
  const ownerId = input.owner_member_id || null
  checkOwner(doc, ownerId)
  const cover = blankToNull(input.cover_url)
  const fields = {
    title,
    author: blankToNull(input.author),
    isbn: blankToNull(input.isbn),
    notes: blankToNull(input.notes),
    owner_member_id: ownerId,
    status,
    format,
    cover_url: cover && cover.startsWith(COVER_PREFIX) ? cover : null,
  }
  if (input.id) {
    if (!patch(doc, BOOKS, input.id, fields)) throw new Error('Book not found')
    return input.id
  }
  return insert(doc, BOOKS, { ...fields, added_by_member_id: actor.id })
}

export function convertToOwned(doc, { id, isbn, owner_member_id }) {
  const book = get(doc, BOOKS, id)
  if (!book) throw new Error('Book not found')
  const ownerId = owner_member_id || book.owner_member_id
  checkOwner(doc, ownerId)
  patch(doc, BOOKS, id, { status: 'owned', isbn: blankToNull(isbn) ?? book.isbn, owner_member_id: ownerId ?? null })
  return id
}

export function deleteBook(doc, id) {
  doc.transact(() => {
    removeWhere(doc, PROGRESS, (p) => p.book_id === id)
    for (const loan of all(doc, LOANS)) if (loan.book_id === id) patch(doc, LOANS, loan.id, { book_id: null })
    remove(doc, BOOKS, id)
  })
}

// Online-only extra: works from the browser directly (Open Library sends
// CORS headers), so no server is needed. Offline it reports lookup_failed
// and the page's existing "couldn't look that up" state shows.
export async function lookupIsbn(rawIsbn, fetchImpl = globalThis.fetch) {
  const isbn = String(rawIsbn ?? '').replace(/[^0-9Xx]/g, '').toUpperCase()
  if (isbn.length < 10 || isbn.length > 20) throw new Error('Enter a valid ISBN')
  let data
  try {
    const res = await fetchImpl(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}&fields=title,author_name,cover_i&limit=1`)
    if (!res.ok) return { found: false, isbn, error: 'lookup_failed' }
    data = await res.json()
  } catch {
    return { found: false, isbn, error: 'lookup_failed' }
  }
  const record = Array.isArray(data?.docs) ? data.docs[0] : null
  const title = String(record?.title ?? '').trim()
  if (!title) return { found: false, isbn }
  const authors = (Array.isArray(record.author_name) ? record.author_name : [])
    .filter((n) => typeof n === 'string' && n.trim() !== '')
    .map((n) => n.trim())
  const coverUrl = Number.isInteger(record.cover_i) ? `${COVER_PREFIX}b/id/${record.cover_i}-M.jpg` : null
  return { found: true, isbn, title, author: authors.length ? authors.join(', ') : null, cover_url: coverUrl }
}

export function saveReadingProgress(doc, actor, input) {
  if (!input.book_id) throw new Error('book_id is required')
  const status = input.status ?? 'reading'
  if (!READING_STATUSES.includes(status)) throw new Error('status must be want_to_read, reading or finished')
  let rating = null
  if (input.rating !== undefined && input.rating !== '' && input.rating !== null) {
    rating = parseInt(input.rating, 10)
    if (!(rating >= 1 && rating <= 5)) throw new Error('rating must be between 1 and 5')
  }
  let progressPct = null
  if (status === 'reading' && input.progress_pct !== undefined && input.progress_pct !== '' && input.progress_pct !== null) {
    progressPct = parseInt(input.progress_pct, 10)
    if (!(progressPct >= 0 && progressPct <= 100)) throw new Error('progress_pct must be between 0 and 100')
  }
  if (!get(doc, BOOKS, input.book_id)) throw new Error('Book not found')
  const key = progressKey(input.book_id, actor.id)
  const existing = get(doc, PROGRESS, key)
  const fields = {
    status,
    progress_pct: progressPct,
    rating,
    review: blankToNull(input.review),
    started_at: existing?.started_at ?? (status === 'reading' ? nowStamp() : null),
    finished_at: status === 'finished' ? (existing?.finished_at ?? nowStamp()) : null,
  }
  if (existing) patch(doc, PROGRESS, key, fields)
  else insert(doc, PROGRESS, { ...fields, book_id: input.book_id, member_id: actor.id }, key)
  return key
}

export function deleteReadingProgress(doc, actor, id) {
  if (get(doc, PROGRESS, id)?.member_id === actor.id) remove(doc, PROGRESS, id)
}

export function readingList(doc) {
  const books = table(doc, BOOKS)
  return all(doc, PROGRESS)
    .map((p) => {
      const member = getMember(doc, p.member_id)
      return {
        ...p,
        book_title: books.get(p.book_id)?.get('title') ?? null,
        book_author: books.get(p.book_id)?.get('author') ?? null,
        member_name: member?.name ?? null,
        avatar_color: member?.avatar_color ?? null,
        avatar_asset_id: member?.avatar_asset_id ?? null,
      }
    })
    .sort((a, b) => Number(a.status === 'finished') - Number(b.status === 'finished') || b.updated_at.localeCompare(a.updated_at))
}

export function listLoans(doc, { onlyOut = false } = {}) {
  const books = table(doc, BOOKS)
  return all(doc, LOANS)
    .filter((l) => !onlyOut || !l.returned_at)
    .map((l) => ({
      ...l,
      book_title: l.book_id ? (books.get(l.book_id)?.get('title') ?? null) : null,
      book_author: l.book_id ? (books.get(l.book_id)?.get('author') ?? null) : null,
    }))
    .sort((a, b) =>
      Number(Boolean(a.returned_at)) - Number(Boolean(b.returned_at)) ||
      Number(a.due_date === null) - Number(b.due_date === null) ||
      String(a.due_date ?? '').localeCompare(String(b.due_date ?? '')) ||
      b.created_at.localeCompare(a.created_at))
}

export function saveLoan(doc, actor, input) {
  if (!['lent_out', 'borrowed'].includes(input.direction)) throw new Error('direction must be lent_out or borrowed')
  const counterparty = requireText(input.counterparty_name, 'counterparty_name is required')
  const bookId = input.book_id || null
  if (bookId && !get(doc, BOOKS, bookId)) throw new Error('Book not found')
  const fields = { book_id: bookId, direction: input.direction, counterparty_name: counterparty, due_date: blankToNull(input.due_date) }
  if (input.id) {
    if (!patch(doc, LOANS, input.id, fields)) throw new Error('Loan not found')
    return input.id
  }
  return insert(doc, LOANS, { ...fields, returned_at: null, created_by_member_id: actor.id })
}

export function returnLoan(doc, id) {
  const loan = get(doc, LOANS, id)
  if (loan && !loan.returned_at) patch(doc, LOANS, id, { returned_at: nowStamp() })
}

export function deleteLoan(doc, id) {
  remove(doc, LOANS, id)
}
