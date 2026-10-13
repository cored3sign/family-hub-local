<script setup>
import { ref, computed } from 'vue'
import {
  BookOpen, ScanLine, BookMarked, CheckCircle2, Star, Clock,
  AlertTriangle, ArrowRightLeft, ArrowDownToLine, ArrowUpFromLine, Pencil,
} from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { firstName } from '../lib/names'
import { useFamily, useLive } from '../data/vue'
import { assetUrl } from '../data/assets'
import {
  booksWithMembers, saveBook as saveBookRecord, convertToOwned as convertBookToOwned, deleteBook as deleteBookRecord,
  lookupIsbn as lookupIsbnRecord,
  saveReadingProgress, deleteReadingProgress, readingList,
  listLoans, saveLoan, returnLoan as returnLoanRecord, deleteLoan as deleteLoanRecord,
} from '../data/modules/library'

// Three-tab page shape (catalog, reading tracker, loans), same precedent
// as Recipes/Communication for a module with more than one distinct
// concept living on one page. There is no library-account connector.
const core = useCoreStore()
const { doc, actor } = useFamily()

const tab = ref('catalog') // catalog | reading | loans

// --- Catalog state (the want-to-read queue lives here too, as
// status='want_to_read' books) ---
const catalogFilter = ref('all') // all | want_to_read | owned
const library = useLive((d) => booksWithMembers(d, catalogFilter.value === 'all' ? null : catalogFilter.value))
const books = computed(() => library.value.books)
const members = computed(() => library.value.members)
// The catalog filter is already applied inside booksWithMembers above, so
// the visible list IS books -- filteredBooks stays as its own name because
// the template below still reads it (no filtering left to do client-side).
const filteredBooks = books

const showBookModal = ref(false)
const editingBookId = ref(null)
const bookForm = ref(blankBookForm())
const bookError = ref('')
const bookSaving = ref(false)
// The New Loan modal's Book dropdown needs a way to add a book that isn't
// in the catalog yet without abandoning the loan being created (otherwise:
// close this modal, go add the book on the Catalog tab, then reopen New
// Loan from scratch). This flag does it: when set, it means "the book
// modal was opened FROM the loan
// modal," so saveBook()'s success path re-opens the loan modal (which
// openAddBookFromLoan below keeps intact, not reset) with the newly
// created book pre-selected, instead of just closing to nothing.
const bookModalReturnTo = ref(null) // null | 'loan'

function blankBookForm(status = 'owned') {
  return {
    title: '',
    author: '',
    isbn: '',
    notes: '',
    owner_member_id: '',
    status,
    cover_url: '',
    format: 'physical',
  }
}

// --- ISBN lookup + camera scan, feeding the same add-book form ---
// This augments manual entry, it doesn't replace it: a user can just
// ignore this section and type everything by hand.
const showScanner = ref(false)
const isbnLookupState = ref('idle') // idle | loading | found | not_found | error
const isbnLookupMessage = ref('')

async function lookupIsbn(isbnValue) {
  const isbn = String(isbnValue || '').trim()
  if (!isbn) return
  isbnLookupState.value = 'loading'
  isbnLookupMessage.value = ''
  try {
    const result = await lookupIsbnRecord(isbn)
    if (result.found) {
      bookForm.value.title = result.title || bookForm.value.title
      bookForm.value.author = result.author || bookForm.value.author
      bookForm.value.isbn = result.isbn || isbn
      bookForm.value.cover_url = result.cover_url || ''
      isbnLookupState.value = 'found'
    } else if (result.error) {
      isbnLookupState.value = 'error'
      isbnLookupMessage.value = "Couldn't reach the lookup service. You can still fill in the details manually."
    } else {
      isbnLookupState.value = 'not_found'
      isbnLookupMessage.value = "No match found for that ISBN. You can still fill in the details manually."
    }
  } catch (e) {
    isbnLookupState.value = 'error'
    isbnLookupMessage.value = e.message || "Couldn't look up that ISBN. You can still fill in the details manually."
  }
}

function onIsbnScanned(digits) {
  showScanner.value = false
  bookForm.value.isbn = digits
  lookupIsbn(digits)
}

function memberName(id) {
  return firstName(members.value.find((m) => m.id === id)?.name) ?? null
}

const FORMAT_LABELS = { physical: 'Physical', ebook: 'Ebook', audiobook: 'Audiobook' }
function formatLabel(format) {
  return FORMAT_LABELS[format] ?? format
}

// --- Reading tracker state ---
const readingRows = useLive(readingList)

const myCurrentlyReading = computed(() =>
  readingRows.value.filter((r) => r.member_id === core.familyMemberId && r.status === 'reading')
)
const myWantToRead = computed(() =>
  readingRows.value.filter((r) => r.member_id === core.familyMemberId && r.status === 'want_to_read')
)
const familyHistory = computed(() =>
  readingRows.value
    .filter((r) => r.status === 'finished')
    .sort((a, b) => new Date(b.finished_at || 0) - new Date(a.finished_at || 0))
)

const readingModalOpen = ref(false)
const readingModalBook = ref(null) // the book being tracked
const readingForm = ref({ status: 'reading', progress_pct: '', rating: '', review: '' })
const readingSaving = ref(false)
const readingError = ref('')

function myProgressFor(bookId) {
  return readingRows.value.find((r) => r.book_id === bookId && r.member_id === core.familyMemberId) ?? null
}

function openReadingModal(book) {
  readingModalBook.value = book
  const existing = myProgressFor(book.id)
  readingForm.value = {
    status: existing?.status ?? 'want_to_read',
    progress_pct: existing?.progress_pct ?? '',
    rating: existing?.rating ?? '',
    review: existing?.review ?? '',
  }
  readingError.value = ''
  readingModalOpen.value = true
}

function closeReadingModal() {
  readingModalOpen.value = false
  readingModalBook.value = null
}

// A thrown error is shown to the person (readingError) rather than only
// resetting readingSaving, so they know their progress didn't save.
function saveReading() {
  if (!readingModalBook.value) return
  readingSaving.value = true
  readingError.value = ''
  try {
    saveReadingProgress(doc, actor(), {
      book_id: readingModalBook.value.id,
      status: readingForm.value.status,
      progress_pct: readingForm.value.status === 'reading' ? readingForm.value.progress_pct || null : null,
      rating: readingForm.value.status === 'finished' ? readingForm.value.rating || null : null,
      review: readingForm.value.status === 'finished' ? readingForm.value.review : '',
    })
    closeReadingModal()
  } catch (e) {
    readingError.value = e.message
  } finally {
    readingSaving.value = false
  }
}

function clearMyReading(book) {
  const existing = myProgressFor(book.id)
  if (!existing) return
  deleteReadingProgress(doc, actor(), existing.id)
}

// --- Loans state ---
const loansFilter = ref('out') // out | all
const loans = useLive((d) => listLoans(d, { onlyOut: loansFilter.value === 'out' }))
const newLoan = ref({ direction: 'lent_out', counterparty_name: '', book_id: '', due_date: '' })
const showLoanModal = ref(false)

function openAddLoan() {
  newLoan.value = { direction: 'lent_out', counterparty_name: '', book_id: '', due_date: '' }
  showLoanModal.value = true
}

function closeLoanModal() {
  showLoanModal.value = false
}

// The onlyOut filter is already applied inside listLoans above.
const visibleLoans = loans

function isOverdue(loan) {
  if (loan.returned_at || !loan.due_date) return false
  return new Date(loan.due_date) < new Date(new Date().toDateString())
}

function addLoan() {
  if (!newLoan.value.counterparty_name.trim()) return
  saveLoan(doc, actor(), {
    direction: newLoan.value.direction,
    counterparty_name: newLoan.value.counterparty_name,
    book_id: newLoan.value.book_id || null,
    due_date: newLoan.value.due_date || null,
  })
  showLoanModal.value = false
}

function returnLoan(id) {
  returnLoanRecord(doc, id)
}

function deleteLoan(id) {
  deleteLoanRecord(doc, id)
}

// --- Catalog actions ---
function openAddBook(status = 'owned') {
  editingBookId.value = null
  bookForm.value = blankBookForm(status)
  bookError.value = ''
  showScanner.value = false
  isbnLookupState.value = 'idle'
  isbnLookupMessage.value = ''
  bookModalReturnTo.value = null
  showBookModal.value = true
}

// Entry point for the New Loan modal's "+ Add a new book" option. Doesn't
// touch newLoan/showLoanModal -- the loan modal's own fields (direction,
// counterparty, due date already typed in) stay exactly as the person left
// them underneath, ready to reappear once the book modal closes.
function openAddBookFromLoan() {
  openAddBook()
  bookModalReturnTo.value = 'loan'
}

function openEditBook(book) {
  editingBookId.value = book.id
  bookForm.value = {
    title: book.title,
    author: book.author ?? '',
    isbn: book.isbn ?? '',
    notes: book.notes ?? '',
    owner_member_id: book.owner_member_id ?? '',
    status: book.status,
    cover_url: book.cover_url ?? '',
    format: book.format ?? 'physical',
  }
  bookError.value = ''
  showScanner.value = false
  isbnLookupState.value = 'idle'
  isbnLookupMessage.value = ''
  bookModalReturnTo.value = null // editing from the Catalog tab, not via the loan flow
  showBookModal.value = true
}

function closeBookModal() {
  showBookModal.value = false
  showScanner.value = false
  // Canceling out of "+ Add a new book" (opened from New Loan) goes back to
  // the loan modal rather than dropping the person on the bare Catalog tab
  // with no memory of the loan they were mid-way through creating.
  if (bookModalReturnTo.value === 'loan') {
    showLoanModal.value = true
  }
  bookModalReturnTo.value = null
}

function saveBook() {
  if (!bookForm.value.title.trim()) {
    bookError.value = 'A title is required.'
    return
  }
  bookSaving.value = true
  bookError.value = ''
  try {
    const id = saveBookRecord(doc, actor(), {
      id: editingBookId.value ?? undefined,
      title: bookForm.value.title,
      author: bookForm.value.author,
      isbn: bookForm.value.isbn,
      notes: bookForm.value.notes,
      owner_member_id: bookForm.value.owner_member_id || null,
      status: bookForm.value.status,
      cover_url: bookForm.value.cover_url || null,
      format: bookForm.value.format,
    })
    showBookModal.value = false
    if (bookModalReturnTo.value === 'loan') {
      // The newly created book's id is the only thing saveBook() gives back
      // beyond the id itself -- pre-select it so the person doesn't have to
      // find their own book in a (now one-longer) dropdown a second time.
      newLoan.value.book_id = id
      showLoanModal.value = true
    }
    bookModalReturnTo.value = null
  } catch (e) {
    bookError.value = e.message
  } finally {
    bookSaving.value = false
  }
}

function deleteBook(id) {
  deleteBookRecord(doc, id)
}

// One-click want-to-read -> owned, keeps the same row.
function convertToOwned(book) {
  convertBookToOwned(doc, { id: book.id })
}
</script>

<template>
  <div class="module-page library-page">
    <h2>Books</h2>

    <div class="library-tabs" role="tablist">
      <button
        type="button"
        class="library-tab"
        role="tab"
        :aria-selected="tab === 'catalog'"
        :class="{ active: tab === 'catalog' }"
        @click="tab = 'catalog'"
      >
        <BookOpen :size="16" />
        Catalog
      </button>
      <button
        type="button"
        class="library-tab"
        role="tab"
        :aria-selected="tab === 'reading'"
        :class="{ active: tab === 'reading' }"
        @click="tab = 'reading'"
      >
        <BookMarked :size="16" />
        Reading
      </button>
      <button
        type="button"
        class="library-tab"
        role="tab"
        :aria-selected="tab === 'loans'"
        :class="{ active: tab === 'loans' }"
        @click="tab = 'loans'"
      >
        <ArrowRightLeft :size="16" />
        Loans
      </button>
    </div>

    <!-- Catalog + want-to-read queue -->
    <section v-if="tab === 'catalog'" class="library-section">
      <div class="library-toolbar">
        <AppButton variant="primary" @click="openAddBook('owned')">+ Add a book</AppButton>
        <!-- A plain <select> scopes the catalog without competing with the
             tab row's own look (a second row of pill chips styled like the
             Catalog/Reading/Loans tabs above would read as two stacked
             filter systems for the same list). -->
        <select v-model="catalogFilter" class="library-catalog-filter" aria-label="Filter catalog">
          <option value="all">All books</option>
          <option value="owned">Owned</option>
          <option value="want_to_read">Want to read</option>
        </select>
      </div>

      <ul class="module-list">
        <ListRow v-for="b in filteredBooks" :key="b.id" deletable class="book-list-row" @delete="deleteBook(b.id)">
          <div class="book-row">
            <!-- This row is a real edit trigger (openEditBook), but
                 cursor:pointer alone is invisible on
                 touch devices and easy to miss even with a mouse next to
                 two other, visibly-buttoned actions on the same row. The
                 pencil + role/aria-label make the affordance and its
                 purpose explicit without adding a whole extra button. -->
            <div
              class="book-row__body"
              role="button"
              tabindex="0"
              :aria-label="`Edit ${b.title}`"
              @click="openEditBook(b)"
              @keydown.enter="openEditBook(b)"
            >
              <img v-if="b.cover_url" :src="b.cover_url" alt="" class="book-row__cover" />
              <div v-else class="book-row__icon-tile" :class="`book-row__icon-tile--${b.status}`">
                <BookMarked v-if="b.status === 'want_to_read'" :size="20" />
                <BookOpen v-else :size="20" />
              </div>
              <div class="book-row__text">
                <strong>{{ b.title }}</strong>
                <span v-if="b.author" class="book-row__author">by {{ b.author }}</span>
                <div class="book-row__meta">
                  <!-- Non-color status signal: distinct icon + label per status, not color alone -->
                  <AppTag v-if="b.status === 'want_to_read'" class="book-row__status-tag">
                    <BookMarked :size="12" /> Want to read
                  </AppTag>
                  <AppTag v-else class="book-row__status-tag book-row__status-tag--owned">
                    <CheckCircle2 :size="12" /> Owned
                  </AppTag>
                  <AppTag v-if="b.owner_member_id">{{ memberName(b.owner_member_id) }}'s</AppTag>
                  <AppTag v-else-if="b.status === 'owned'">Family</AppTag>
                  <AppTag v-if="b.format && b.format !== 'physical'">{{ formatLabel(b.format) }}</AppTag>
                </div>
              </div>
              <Pencil class="book-row__edit-hint" :size="16" aria-hidden="true" />
            </div>
            <div class="book-row__actions">
              <AppButton
                v-if="b.status === 'want_to_read'"
                variant="secondary"
                @click="convertToOwned(b)"
              >
                Mark as owned
              </AppButton>
              <AppButton variant="ghost" @click="openReadingModal(b)">Track reading</AppButton>
            </div>
          </div>
        </ListRow>
      </ul>
      <EmptyState v-if="filteredBooks.length === 0 && books.length > 0">
        No books match this filter.
      </EmptyState>
      <EmptyState v-if="books.length === 0" illustration="books">
        No books yet. Add one you own, or something you want to read.
      </EmptyState>
    </section>

    <!-- Reading tracker -->
    <section v-else-if="tab === 'reading'" class="library-section">
      <h3 class="library-subhead">Currently reading</h3>
      <ul class="module-list">
        <ListRow v-for="r in myCurrentlyReading" :key="r.id">
          <div class="reading-row">
            <div class="reading-row__icon-tile reading-row__icon-tile--reading">
              <BookOpen :size="20" />
            </div>
            <div class="reading-row__text">
              <strong>{{ r.book_title }}</strong>
              <span v-if="r.book_author" class="book-row__author">by {{ r.book_author }}</span>
              <AppTag v-if="r.progress_pct !== null && r.progress_pct !== undefined">{{ r.progress_pct }}% read</AppTag>
            </div>
            <AppButton variant="ghost" @click="openReadingModal(books.find((b) => b.id === r.book_id) || { id: r.book_id, title: r.book_title })">
              Update
            </AppButton>
          </div>
        </ListRow>
      </ul>
      <EmptyState v-if="myCurrentlyReading.length === 0">
        Nothing in progress. Start one from the Catalog tab.
      </EmptyState>

      <h3 class="library-subhead">My want-to-read queue</h3>
      <ul class="module-list">
        <ListRow v-for="r in myWantToRead" :key="r.id" deletable @delete="clearMyReading({ id: r.book_id })">
          <div class="reading-row">
            <div class="reading-row__icon-tile reading-row__icon-tile--queued">
              <BookMarked :size="20" />
            </div>
            <div class="reading-row__text">
              <strong>{{ r.book_title }}</strong>
              <span v-if="r.book_author" class="book-row__author">by {{ r.book_author }}</span>
            </div>
          </div>
        </ListRow>
      </ul>
      <EmptyState v-if="myWantToRead.length === 0">Nothing queued up.</EmptyState>

      <h3 class="library-subhead">Family reading history</h3>
      <ul class="module-list">
        <ListRow v-for="r in familyHistory" :key="r.id">
          <div class="history-row">
            <div class="history-row__avatar" :style="{ background: r.avatar_color || 'var(--accent-container)' }">
              <img v-if="assetUrl(r.avatar_asset_id)" :src="assetUrl(r.avatar_asset_id)" alt="" />
              <span v-else>{{ r.member_name?.[0] }}</span>
            </div>
            <div class="history-row__body">
              <strong>{{ r.book_title }}</strong>
              <span class="book-row__author">
                {{ firstName(r.member_name) }} finished{{ r.finished_at ? ` on ${new Date(r.finished_at).toLocaleDateString()}` : '' }}
              </span>
              <div v-if="r.rating" class="history-row__rating">
                <Star
                  v-for="n in 5"
                  :key="n"
                  :size="14"
                  :fill="n <= r.rating ? 'currentColor' : 'none'"
                />
              </div>
              <p v-if="r.review" class="history-row__review">{{ r.review }}</p>
            </div>
          </div>
        </ListRow>
      </ul>
      <EmptyState v-if="familyHistory.length === 0">No finished books yet.</EmptyState>
    </section>

    <!-- Lending / borrowing. "+ New Loan" opens a modal instead of inline
         form fields at the top of the list -- matches the "Add a book"
         pattern below (this page's own precedent) rather than an
         always-visible form. -->
    <section v-else class="library-section">
      <AppButton variant="primary" @click="openAddLoan">+ New Loan</AppButton>

      <div class="library-filter-chips">
        <button
          type="button"
          class="library-filter-chip"
          :class="{ active: loansFilter === 'out' }"
          @click="loansFilter = 'out'"
        >
          Out right now
        </button>
        <button
          type="button"
          class="library-filter-chip"
          :class="{ active: loansFilter === 'all' }"
          @click="loansFilter = 'all'"
        >
          All
        </button>
      </div>

      <ul class="module-list">
        <ListRow v-for="l in visibleLoans" :key="l.id" :done="!!l.returned_at" deletable @delete="deleteLoan(l.id)">
          <div class="loan-row">
            <!-- Non-color signal for returned loans: icon swap (arrow -> check)
                 + desaturated tile + strikethrough (from ListRow's .done, global)
                 + "Returned" tag text, never color alone. -->
            <div class="loan-row__icon-tile" :class="{ 'loan-row__icon-tile--returned': l.returned_at }">
              <CheckCircle2 v-if="l.returned_at" :size="20" />
              <ArrowUpFromLine v-else-if="l.direction === 'lent_out'" :size="20" />
              <ArrowDownToLine v-else :size="20" />
            </div>
            <div class="loan-row__body">
              <strong>{{ l.book_title || '(book not in catalog)' }}</strong>
              <span class="book-row__author">
                {{ l.direction === 'lent_out' ? 'Lent to' : 'Borrowed from' }} {{ l.counterparty_name }}
              </span>
              <div class="book-row__meta">
                <AppTag v-if="l.returned_at" class="loan-row__status-tag loan-row__status-tag--returned">
                  <CheckCircle2 :size="12" /> Returned
                </AppTag>
                <AppTag v-else-if="isOverdue(l)" class="loan-overdue">
                  <AlertTriangle :size="12" /> Overdue
                </AppTag>
                <AppTag v-else-if="l.due_date">
                  <Clock :size="12" /> Due {{ new Date(l.due_date).toLocaleDateString() }}
                </AppTag>
                <AppTag v-else>No due date</AppTag>
              </div>
            </div>
            <AppButton v-if="!l.returned_at" variant="secondary" @click="returnLoan(l.id)">Mark returned</AppButton>
          </div>
        </ListRow>
      </ul>
      <EmptyState v-if="visibleLoans.length === 0">
        {{ loansFilter === 'out' ? "Nothing out right now." : "No loans yet." }}
      </EmptyState>
    </section>

    <!-- Add/edit book modal -->
    <AppModal :open="showBookModal" :title="editingBookId ? 'Edit book' : 'Add a book'" @close="closeBookModal">
      <div class="book-form">
        <!-- Scan or type an ISBN to prefill title/author/cover below.
             Entirely optional -- manual entry works if this is ignored. -->
        <div class="isbn-lookup">
          <div class="isbn-lookup__row">
            <FormField
              v-model="bookForm.isbn"
              label="ISBN (optional)"
              placeholder="e.g. 9780547928227"
              @keyup.enter.prevent="lookupIsbn(bookForm.isbn)"
            />
            <div class="isbn-lookup__buttons">
              <AppButton
                variant="secondary"
                :disabled="!bookForm.isbn.trim() || isbnLookupState === 'loading'"
                @click="lookupIsbn(bookForm.isbn)"
              >
                {{ isbnLookupState === 'loading' ? 'Looking up…' : 'Look up' }}
              </AppButton>
              <AppButton variant="secondary" @click="showScanner = true">
                <ScanLine :size="16" class="isbn-lookup__btn-icon" /> Scan barcode
              </AppButton>
            </div>
          </div>

          <BarcodeScanner v-if="showScanner" @detected="onIsbnScanned" @close="showScanner = false" />

          <p v-if="isbnLookupState === 'found'" class="isbn-lookup__status isbn-lookup__status--found">
            Found a match — title and author filled in below. Review before saving.
          </p>
          <p
            v-else-if="isbnLookupState === 'not_found' || isbnLookupState === 'error'"
            class="isbn-lookup__status isbn-lookup__status--muted"
          >
            {{ isbnLookupMessage }}
          </p>

          <img v-if="bookForm.cover_url" :src="bookForm.cover_url" alt="" class="isbn-lookup__cover" />
        </div>

        <FormField v-model="bookForm.title" label="Title" placeholder="e.g. The Hobbit" required />
        <FormField v-model="bookForm.author" label="Author" placeholder="e.g. J.R.R. Tolkien" />

        <label class="form-field">
          <span class="form-field__label">Status</span>
          <select v-model="bookForm.status">
            <option value="owned">Owned</option>
            <option value="want_to_read">Want to read</option>
          </select>
        </label>

        <label class="form-field">
          <span class="form-field__label">Format</span>
          <select v-model="bookForm.format">
            <option value="physical">Physical</option>
            <option value="ebook">Ebook</option>
            <option value="audiobook">Audiobook</option>
          </select>
        </label>

        <label class="form-field">
          <span class="form-field__label">Belongs to</span>
          <select v-model="bookForm.owner_member_id">
            <option value="">Family (no specific owner)</option>
            <option v-for="m in members" :key="m.id" :value="m.id">{{ firstName(m.name) }}</option>
          </select>
        </label>

        <label class="form-field">
          <span class="form-field__label">Notes (optional)</span>
          <textarea v-model="bookForm.notes" rows="3" placeholder="Anything worth remembering about this book…"></textarea>
        </label>

        <p v-if="bookError" class="error">{{ bookError }}</p>

        <div class="book-form__actions">
          <AppButton variant="primary" :disabled="bookSaving" @click="saveBook">
            {{ bookSaving ? 'Saving…' : 'Save' }}
          </AppButton>
          <AppButton variant="ghost" @click="closeBookModal">Cancel</AppButton>
        </div>
      </div>
    </AppModal>

    <!-- New loan modal -->
    <AppModal :open="showLoanModal" title="New loan" @close="closeLoanModal">
      <form class="book-form" @submit.prevent="addLoan">
        <label class="form-field">
          <span class="form-field__label">Direction</span>
          <select v-model="newLoan.direction">
            <option value="lent_out">Lent out (we gave it away)</option>
            <option value="borrowed">Borrowed (we have theirs)</option>
          </select>
        </label>
        <FormField v-model="newLoan.counterparty_name" label="Who?" placeholder="e.g. Grandma, the library" required />
        <label class="form-field">
          <span class="form-field__label">Book (optional)</span>
          <select v-model="newLoan.book_id">
            <option value="">Not in catalog</option>
            <option v-for="b in books" :key="b.id" :value="b.id">{{ b.title }}</option>
          </select>
        </label>
        <!-- Loaning out a book that isn't in the catalog yet doesn't
             require canceling this whole modal and adding the book on the
             Catalog tab first: this keeps everything already typed above in
             place. -->
        <AppButton type="button" variant="ghost" class="book-form__inline-add" @click="openAddBookFromLoan">
          + Add a new book
        </AppButton>
        <FormField v-model="newLoan.due_date" type="date" label="Due date (optional)" />

        <div class="book-form__actions">
          <AppButton type="submit" variant="primary">Add loan</AppButton>
          <AppButton type="button" variant="ghost" @click="closeLoanModal">Cancel</AppButton>
        </div>
      </form>
    </AppModal>

    <!-- Reading tracker modal -->
    <AppModal :open="readingModalOpen" :title="readingModalBook ? `Track: ${readingModalBook.title}` : 'Track reading'" @close="closeReadingModal">
      <div class="book-form">
        <label class="form-field">
          <span class="form-field__label">My status</span>
          <select v-model="readingForm.status">
            <option value="want_to_read">Want to read</option>
            <option value="reading">Reading</option>
            <option value="finished">Finished</option>
          </select>
        </label>

        <FormField
          v-if="readingForm.status === 'reading'"
          v-model="readingForm.progress_pct"
          label="Progress (% read, optional)"
          type="number"
          :min="0"
          :max="100"
          placeholder="e.g. 40"
        />

        <template v-if="readingForm.status === 'finished'">
          <label class="form-field">
            <span class="form-field__label">Rating (optional)</span>
            <select v-model="readingForm.rating">
              <option value="">No rating</option>
              <option v-for="n in [1, 2, 3, 4, 5]" :key="n" :value="n">{{ '★'.repeat(n) }}</option>
            </select>
          </label>
          <label class="form-field">
            <span class="form-field__label">Review (optional)</span>
            <textarea v-model="readingForm.review" rows="3" placeholder="What did you think?"></textarea>
          </label>
        </template>

        <p v-if="readingError" class="error">{{ readingError }}</p>

        <div class="book-form__actions">
          <AppButton variant="primary" :disabled="readingSaving" @click="saveReading">
            {{ readingSaving ? 'Saving…' : 'Save' }}
          </AppButton>
          <AppButton variant="ghost" @click="closeReadingModal">Cancel</AppButton>
        </div>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
/* Tabs: icon-tile-forward segmented control. Active state carries THREE
   non-color signals together (filled background + bold weight + underline
   dot), matching the multi-signal approach the Dashboard reference uses for
   its own active/done states -- never color alone. */
/* Underline-tab pattern, matching Communication's .comm-tabs/.comm-tab
   (CommunicationPage.vue), so Books uses the same nav style as Speak. */
.library-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--border);
}

.library-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: var(--type-label);
  padding: 10px 14px;
  min-height: 44px;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}

.library-tab:hover {
  color: var(--text);
}

.library-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 700;
}

.library-tab:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.library-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* "Add a book" (want-to-read is just a status choice inside that same
   modal, per openAddBook's own signature) sits inline with a plain
   <select> for catalog scope (see .library-catalog-filter), which reads as
   one lightweight, clearly-secondary control rather than a second
   segmented-pill row competing with the tabs above. */
.library-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.library-catalog-filter {
  min-width: 160px;
}

.library-filter-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.library-filter-chip {
  font: var(--type-label);
  padding: 6px 14px;
  min-height: var(--control-min);
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

.library-filter-chip:hover {
  border-color: color-mix(in srgb, var(--text) 30%, var(--border));
  color: var(--text);
}

.library-filter-chip.active {
  background: var(--accent-container);
  color: var(--on-accent-container);
  border-color: transparent;
  font-weight: 700;
}

.library-subhead {
  font: var(--type-title);
  margin: 16px 0 4px;
}

.library-subhead:first-child {
  margin-top: 0;
}

/* .book-row__actions' own flex: 1 1 100% would force .list-row__main
   (its parent, a sibling of the shared trash-can button) to full row width,
   leaving .list-row nowhere to put the trash can but its own line beneath
   "Track reading" -- same footgun fixed on Goals/Cook. Constraining
   .list-row__main here lets it share the row with the trash can; the action
   buttons still wrap onto their own full-width line below on narrow screens. */
.book-list-row :deep(.list-row__main) {
  flex: 1;
  min-width: 0;
}

/* Catalog rows -- cover art when we have it, otherwise a gradient icon tile
   sized/shaped to match a real cover (see .book-row__icon-tile below) so
   every row reads as "book" at a glance even with no cover. */
.book-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}

.book-row__body {
  flex: 1;
  min-width: 200px;
  cursor: pointer;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.book-row__body:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 8px;
}

/* This whole row is a working edit trigger, but cursor:pointer is
   invisible on touch, and easy
   to miss next to two other rows' visibly-buttoned actions. A quiet pencil
   (muted by default, same accent the rest of the app uses for an active/
   hover affordance) makes "this opens editing" legible without adding a
   whole extra button next to Mark as owned / Track reading. */
.book-row__edit-hint {
  flex: none;
  align-self: center;
  color: var(--text-muted);
  opacity: 0.5;
}

.book-row__body:hover .book-row__edit-hint,
.book-row__body:focus-visible .book-row__edit-hint {
  color: var(--accent);
  opacity: 1;
}

/* Matches the cover's own proportions/radius/shadow (book-row__cover,
   above) rather than the app's generic 44x44 rounded-12 icon-tile shape: a
   generic square sitting next to a 44x60 rounded-6 photographic cover on
   the next row would read as a broken image loading, not an intentional
   placeholder. With matching proportions both read as "book cover art,"
   one photographic and one illustrated. */
.book-row__icon-tile {
  flex: none;
  width: 44px;
  height: 60px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--tile-library), var(--tile-library-deep));
  box-shadow: var(--elevation-1);
}

/* Want-to-read tile is visually quieter (outline-weight icon on a softer
   fill) than an owned book's filled tile -- a shape/weight signal on top of
   the tag text below, not a color-only difference. */
.book-row__icon-tile--want_to_read {
  background: var(--surface-variant);
  color: var(--text-muted);
}

.book-row__cover {
  flex: none;
  width: 44px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  box-shadow: var(--elevation-1);
}

.book-row__text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.book-row__text strong {
  font: var(--type-title);
}

.book-row__author {
  color: var(--text-muted);
  font-size: 13px;
}

.book-row__meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.book-row__status-tag {
  display: inline-flex !important;
  align-items: center;
  gap: 3px;
}

.book-row__status-tag--owned {
  background: var(--complement-soft);
  color: var(--on-accent-container);
}

.book-row__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  flex: 1 1 100%;
  justify-content: flex-end;
}

@media (min-width: 480px) {
  .book-row__actions {
    flex: 0 0 auto;
  }
}

/* Reading tab rows */
.reading-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}

.reading-row__icon-tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
}

.reading-row__icon-tile--reading {
  background: linear-gradient(135deg, var(--accent-soft), var(--accent));
}

.reading-row__icon-tile--queued {
  background: var(--surface-variant);
  color: var(--text-muted);
}

.reading-row__text {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.reading-row__text strong {
  font: var(--type-title);
}

/* Family reading history */
.history-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 100%;
}

.history-row__avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--on-accent-container);
  font: var(--type-title);
  flex-shrink: 0;
  overflow: hidden;
}

.history-row__avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-row__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.history-row__body strong {
  font: var(--type-title);
}

/* Rating stars: filled vs outline (lucide's fill prop) is a shape signal,
   independent of the amber tint -- not color alone. */
.history-row__rating {
  display: flex;
  gap: 2px;
  color: var(--tile-library-deep);
  margin: 2px 0;
}

.history-row__review {
  color: var(--text-muted);
  font-size: 13px;
  margin: 2px 0 0;
}

/* Loans tab */
.loan-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
}

.loan-row__icon-tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-contrast);
  background: linear-gradient(135deg, var(--complement-mid), var(--complement));
}

/* Returned state: desaturated tile fill (shape/weight signal) + icon swap
   (arrow -> check, handled in the template) + the "Returned" tag text below
   + ListRow's own strikethrough on .done -- four non-color signals total. */
.loan-row__icon-tile--returned {
  background: var(--surface-variant);
  color: var(--text-muted);
}

.loan-row__body {
  flex: 1;
  min-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.loan-row__body strong {
  font: var(--type-title);
}

.loan-row__status-tag {
  display: inline-flex !important;
  align-items: center;
  gap: 3px;
}

.loan-row__status-tag--returned {
  background: var(--surface-variant);
  color: var(--text-muted);
}

.loan-overdue {
  display: inline-flex !important;
  align-items: center;
  gap: 3px;
  color: var(--danger);
  background: var(--danger-container);
}

/* Modal forms */
.book-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.book-form textarea {
  font: var(--type-body);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  resize: vertical;
}

.book-form__actions {
  display: flex;
  gap: 8px;
}

/* Sits directly under the Book dropdown it's paired with, not stretched
   full-width like the modal's real submit actions -- reads as a small,
   secondary escape hatch out of the dropdown, not a second primary choice
   competing with "Add loan". Negative margin-top pulls it snug against the
   field above rather than taking the form's full 16px inter-field gap,
   since it's conceptually part of that field, not a new section. */
.book-form__inline-add {
  align-self: flex-start;
  margin-top: -8px;
}

.isbn-lookup {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--surface-variant);
}

.isbn-lookup__row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.isbn-lookup__row .form-field {
  flex: 1;
  min-width: 160px;
}

.isbn-lookup__buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.isbn-lookup__btn-icon {
  vertical-align: -3px;
  margin-right: 2px;
}

.isbn-lookup__status {
  font: var(--type-label);
  margin: 0;
}

.isbn-lookup__status--found {
  color: var(--accent-deep);
}

.isbn-lookup__status--muted {
  color: var(--text-muted);
}

.isbn-lookup__cover {
  width: 64px;
  height: auto;
  border-radius: 6px;
  align-self: flex-start;
  box-shadow: var(--elevation-1);
}
</style>
