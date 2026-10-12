<script setup>
// Family Binder.
//
// Section browsing, plus rich-text post CRUD and reorder within a section
// (admin-only -- see data/modules/binder.js's requireAdmin calls for the
// reasoning).
// ONE responsive component that reflows between a mobile accordion
// and a desktop tab-strip via CSS, same pattern as ModuleCard/AppModal/
// AssigneeFilterChips -- not two
// parallel implementations. The state model that makes one markup tree work
// for both: `activeSectionId` picks the "open" section. On mobile every
// section header is always rendered and toggles its own body (accordion);
// on desktop the same headers become a tab strip (CSS flips the layout to
// row + hides collapsed bodies) and only the active section's body shows.
// Delete-guard -- enforced in data/modules/binder.js's deleteSection
// (throws when post_count > 0); this page also disables the delete button
// and shows the count so the guard rail is visible before the click, not
// just after a failed request.
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Pencil, X, Trash2, Plus, ArrowUp, ArrowDown, ChevronRight, MoreVertical, Upload } from 'lucide-vue-next'
import { useCoreStore } from '../stores/core'
import { useFamily, useLive } from '../data/vue'
import { putImageFile } from '../data/assets'
import AssetImage from '../components/AssetImage.vue'
import {
  listSections, saveSection as saveSectionRecord, deleteSection as deleteSectionRecord, reorderSections as reorderSectionsRecord,
  listPosts, savePost as savePostRecord, deletePost as deletePostRecord, reorderPosts as reorderPostsRecord,
  addPostImage, deletePostImage, importMarkdownFiles,
} from '../data/modules/binder'

const core = useCoreStore()
const { doc, assets, actor } = useFamily()

const sections = useLive(listSections)
const activeSectionId = ref(null)
const error = ref('')

// No bare-"x" instant delete anywhere -- every delete affordance requires a
// confirmation step first. Lightweight, file-local mechanism (no reusable
// confirm-delete component exists): a single key names whichever row has an
// armed pending delete; the confirm banner below that row (see template)
// offers explicit Delete/Cancel buttons rather than a second tap on the
// same control, since a row's Delete action can live inside its overflow
// menu, which closes as soon as it's chosen -- there's no persistent icon
// to tap a second time.
const pendingDeleteKey = ref(null)

function isPendingDelete(key) {
  return pendingDeleteKey.value === key
}

function cancelPendingDelete() {
  pendingDeleteKey.value = null
}

// Arms the pending-delete confirmation for `key` (the confirm banner then
// renders its own explicit Delete/Cancel buttons -- see the template).
function armDelete(key) {
  pendingDeleteKey.value = key
}

// Post rows carry a single overflow ("...") menu (up/down/pencil/trash)
// rather than a permanent row of icons -- `openMenuKey` names at most one
// open row menu at a time, closed by an outside click same as
// DashboardLayout's topbar__menu.
const openMenuKey = ref(null)
const menuRootEls = {}

function isMenuOpen(key) {
  return openMenuKey.value === key
}

function toggleMenu(key) {
  openMenuKey.value = openMenuKey.value === key ? null : key
}

function closeMenu() {
  openMenuKey.value = null
}

function setMenuRootEl(key, el) {
  if (el) menuRootEls[key] = el
  else delete menuRootEls[key]
}

function onClickOutsideMenu(e) {
  if (openMenuKey.value === null) return
  const openEl = menuRootEls[openMenuKey.value]
  if (openEl && !openEl.contains(e.target)) {
    closeMenu()
  }
}

onMounted(() => document.addEventListener('click', onClickOutsideMenu))
onUnmounted(() => document.removeEventListener('click', onClickOutsideMenu))

// --- Section CRUD (admin-only) ---
const showSectionModal = ref(false)
const editingSectionId = ref(null)
const sectionTitle = ref('')
const sectionSaving = ref(false)
const sectionError = ref('')

// --- Post CRUD (admin-only) ---
const showPostModal = ref(false)
const editingPostId = ref(null)
const postTitle = ref('')
const postBody = ref('')
const postSaving = ref(false)
const postError = ref('')

// useLive keeps `sections` current; only the "which section is open" state
// and a stale-selection guard are still needed here.
watch(sections, (list) => {
  if (list.length && activeSectionId.value === null) {
    activeSectionId.value = list[0].id
  }
  // Keep a stale activeSectionId from pointing at a since-deleted section.
  if (activeSectionId.value !== null && !list.some((s) => s.id === activeSectionId.value)) {
    activeSectionId.value = list[0]?.id ?? null
  }
}, { immediate: true })

const posts = useLive((d) => (activeSectionId.value ? listPosts(d, activeSectionId.value) : []))

function postsFor(sectionId) {
  return sectionId === activeSectionId.value ? posts.value : []
}

// Selecting a section (desktop tab click, or mobile accordion header click)
// just flips which section is "open" -- useLive already has every section's
// posts ready, nothing to fetch.
function selectSection(sectionId) {
  cancelPendingDelete()
  if (activeSectionId.value === sectionId) {
    // Mobile accordion: clicking the already-open section closes it.
    activeSectionId.value = null
    return
  }
  activeSectionId.value = sectionId
}

function isOpen(sectionId) {
  return activeSectionId.value === sectionId
}

// --- Section modal ---
function openAddSection() {
  editingSectionId.value = null
  sectionTitle.value = ''
  sectionError.value = ''
  showSectionModal.value = true
}

function openEditSection(section) {
  editingSectionId.value = section.id
  sectionTitle.value = section.title
  sectionError.value = ''
  showSectionModal.value = true
}

function closeSectionModal() {
  showSectionModal.value = false
}

function saveSection() {
  if (!sectionTitle.value.trim()) {
    sectionError.value = 'A title is required.'
    return
  }
  sectionSaving.value = true
  sectionError.value = ''
  try {
    const id = saveSectionRecord(doc, actor(), {
      id: editingSectionId.value ?? undefined,
      title: sectionTitle.value,
    })
    showSectionModal.value = false
    if (editingSectionId.value === null) {
      activeSectionId.value = id
    }
  } catch (e) {
    sectionError.value = e.message
  } finally {
    sectionSaving.value = false
  }
}

function deleteSection(section) {
  error.value = ''
  try {
    deleteSectionRecord(doc, actor(), section.id)
    cancelPendingDelete()
  } catch (e) {
    error.value = e.message
  }
}

function moveSection(section, direction) {
  const ids = sections.value.map((s) => s.id)
  const idx = ids.indexOf(section.id)
  const swapWith = idx + direction
  if (swapWith < 0 || swapWith >= ids.length) return
  ;[ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]]
  reorderSections(ids)
}

function reorderSections(ids) {
  try {
    reorderSectionsRecord(doc, actor(), ids)
  } catch (e) {
    error.value = e.message
  }
}

// --- Markdown import ---
const markdownInputEl = ref(null)
const markdownImporting = ref(false)
const markdownImportResult = ref(null)

function openMarkdownImport() {
  markdownImportResult.value = null
  error.value = ''
  markdownInputEl.value?.click()
}

async function onMarkdownImportChange(e) {
  const fileList = e.target.files
  if (!fileList || fileList.length === 0) return
  markdownImporting.value = true
  error.value = ''
  markdownImportResult.value = null
  try {
    const files = await Promise.all([...fileList].map(async (f) => ({ name: f.name, size: f.size, text: await f.text() })))
    markdownImportResult.value = importMarkdownFiles(doc, actor(), files)
  } catch (err) {
    error.value = err.message
  } finally {
    markdownImporting.value = false
    if (markdownInputEl.value) markdownInputEl.value.value = ''
  }
}

// --- Post modal ---
const postImages = ref([]) // current post's attached images, refreshed after save/upload/delete
const imageUploading = ref(false)
const imageInputEl = ref(null)

function openAddPost() {
  if (activeSectionId.value === null) return
  editingPostId.value = null
  postTitle.value = ''
  postBody.value = ''
  postError.value = ''
  postImages.value = []
  showPostModal.value = true
}

function openEditPost(post) {
  editingPostId.value = post.id
  postTitle.value = post.title
  postBody.value = post.body
  postError.value = ''
  postImages.value = post.images ?? []
  showPostModal.value = true
}

function closePostModal() {
  showPostModal.value = false
}

// Attached images -- attaching an image needs a real post_id, which
// a brand-new post doesn't have until its first save (same problem
// RecipesPage.vue's recipe photo upload solved). savePost() accepts
// `keepModalOpen` so the image-attach flow can save-to-get-an-id without
// closing the modal out from under the admin mid-edit.
function savePost({ keepModalOpen = false } = {}) {
  if (!postTitle.value.trim()) {
    postError.value = 'A title is required.'
    return
  }
  postSaving.value = true
  postError.value = ''
  try {
    const id = savePostRecord(doc, actor(), {
      id: editingPostId.value ?? undefined,
      section_id: activeSectionId.value,
      title: postTitle.value,
      body: postBody.value,
    })
    editingPostId.value = id
    if (!keepModalOpen) {
      showPostModal.value = false
    }
  } catch (e) {
    postError.value = e.message
  } finally {
    postSaving.value = false
  }
}

async function onImageChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  postError.value = ''
  if (!file.type.startsWith('image/')) {
    postError.value = 'Please choose an image file.'
    if (imageInputEl.value) imageInputEl.value.value = ''
    return
  }
  imageUploading.value = true
  try {
    // Ensure the post is saved (has a real id) before attaching an image --
    // a brand-new, never-saved post has no id yet.
    if (editingPostId.value === null) {
      savePost({ keepModalOpen: true })
      if (editingPostId.value === null) return // savePost's own validation failed
    }
    const assetId = await putImageFile(assets, file)
    addPostImage(doc, actor(), editingPostId.value, assetId)
    const thisPost = posts.value.find((p) => p.id === editingPostId.value)
    postImages.value = thisPost?.images ?? []
  } catch (err) {
    postError.value = err.message
  } finally {
    imageUploading.value = false
    if (imageInputEl.value) imageInputEl.value.value = ''
  }
}

function removeImage(imageId) {
  postError.value = ''
  try {
    deletePostImage(doc, actor(), imageId, assets)
    postImages.value = postImages.value.filter((img) => img.id !== imageId)
  } catch (e) {
    postError.value = e.message
  }
}

function deletePost(post) {
  error.value = ''
  try {
    deletePostRecord(doc, actor(), post.id, assets)
    cancelPendingDelete()
  } catch (e) {
    error.value = e.message
  }
}

function movePost(sectionId, post, direction) {
  const list = postsFor(sectionId)
  const ids = list.map((p) => p.id)
  const idx = ids.indexOf(post.id)
  const swapWith = idx + direction
  if (swapWith < 0 || swapWith >= ids.length) return
  ;[ids[idx], ids[swapWith]] = [ids[swapWith], ids[idx]]
  reorderPosts(sectionId, ids)
}

function reorderPosts(sectionId, ids) {
  try {
    reorderPostsRecord(doc, actor(), sectionId, ids)
  } catch (e) {
    error.value = e.message
  }
}

// Minimal, dependency-free markdown-ish rendering for post bodies (body is
// stored as markdown; no markdown library is in package.json, so this
// covers the common cases by hand rather than pulling in a new
// dependency).
// Escapes HTML first so this never becomes an XSS vector via v-html.
function renderBody(text) {
  if (!text) return ''
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const lines = escaped.split('\n')
  const html = []
  let inList = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (/^#{1,3}\s+/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false }
      const level = line.match(/^#{1,3}/)[0].length
      html.push(`<h${level + 3}>${inlineFormat(line.replace(/^#{1,3}\s+/, ''))}</h${level + 3}>`)
    } else if (/^[-*]\s+/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true }
      html.push(`<li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li>`)
    } else if (line === '') {
      if (inList) { html.push('</ul>'); inList = false }
    } else {
      if (inList) { html.push('</ul>'); inList = false }
      html.push(`<p>${inlineFormat(line)}</p>`)
    }
  }
  if (inList) html.push('</ul>')
  return html.join('')
}

function inlineFormat(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
}
</script>

<template>
  <div class="module-page binder-page">
    <div class="binder-header">
      <h2>Family Binder</h2>
      <div v-if="core.isAdmin" class="binder-header__actions">
        <AppButton variant="secondary" :disabled="markdownImporting" @click="openMarkdownImport">
          <Upload :size="16" style="vertical-align: -3px; margin-right: 4px" />{{ markdownImporting ? 'Importing…' : 'Import Markdown' }}
        </AppButton>
        <input
          ref="markdownInputEl"
          type="file"
          accept=".md,text/markdown"
          multiple
          style="display: none"
          @change="onMarkdownImportChange"
        />
        <AppButton variant="primary" @click="openAddSection">
          <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add section
        </AppButton>
      </div>
    </div>

    <p v-if="error" class="binder-error">{{ error }}</p>
    <p v-if="markdownImportResult" class="binder-import-result">
      Imported {{ markdownImportResult.imported }} file(s) into {{ markdownImportResult.sections }} section(s){{ markdownImportResult.skipped ? `, skipped ${markdownImportResult.skipped}` : '' }}.
    </p>

    <EmptyState v-if="sections.length === 0" illustration="binder">
      No sections yet.
      <template v-if="core.isAdmin"> Add one to start building the family binder.</template>
    </EmptyState>

    <!-- One responsive nav element -- mobile accordion / desktop tab
         strip, reflowed via CSS (.binder-nav / .binder-section media query),
         not two markup trees. -->
    <div v-else class="binder-body">
      <div class="binder-nav" role="tablist">
        <div v-for="section in sections" :key="section.id" class="binder-section" :class="{ 'binder-section--open': isOpen(section.id) }">
          <button
            type="button"
            class="binder-section__header"
            role="tab"
            :aria-selected="isOpen(section.id)"
            @click="selectSection(section.id)"
          >
            <span class="binder-section__titlewrap">
              <span class="binder-section__title">{{ section.title }}</span>
              <AppTag v-if="section.is_wellbeing" class="app-tag--muted">Wellbeing</AppTag>
            </span>
            <span class="binder-section__count">{{ section.post_count }}</span>
            <!-- Section actions: pencil/trash sit inline next to the
                 count/chevron (an overflow menu would need the section
                 expanded before its actions were reachable), same small
                 icon-button treatment as Communication's .comm-icon-btn
                 (44px tap target, 18px icon). -->
            <span v-if="core.isAdmin" class="binder-section__row-actions" @click.stop>
              <button
                type="button"
                class="comm-icon-btn"
                aria-label="Edit section"
                @click="openEditSection(section)"
              >
                <Pencil :size="18" />
              </button>
              <button
                type="button"
                class="comm-icon-btn comm-icon-btn--danger"
                aria-label="Delete section"
                :disabled="section.post_count > 0"
                :title="section.post_count > 0 ? `Move or delete ${section.post_count} post(s) first` : ''"
                @click="armDelete(`section:${section.id}`)"
              >
                <Trash2 :size="18" />
              </button>
            </span>
            <ChevronRight :size="18" class="binder-section__chevron" />
          </button>

          <p v-if="isPendingDelete(`section:${section.id}`)" class="binder-confirm-hint" @click.stop>
            <span class="binder-confirm-hint__text">Permanently delete this section?</span>
            <button type="button" class="binder-confirm-hint__cancel" @click="cancelPendingDelete">Cancel</button>
            <button type="button" class="binder-confirm-hint__confirm" @click="deleteSection(section)">Delete</button>
          </p>

          <!-- Accordion body on mobile; only the active section's body is
               shown at all on desktop (CSS hides the others entirely). -->
          <div v-if="isOpen(section.id)" class="binder-section__body">
              <div class="binder-posts">
                <article
                  v-for="post in postsFor(section.id)"
                  :key="post.id"
                  class="binder-post"
                  :class="{ 'binder-post--tappable': core.isAdmin }"
                  @click="core.isAdmin && openEditPost(post)"
                >
                  <header class="binder-post__header">
                    <h3 class="binder-post__title">{{ post.title }}</h3>
                    <!-- One overflow menu per post row, rather than a
                         second up/down/pencil/trash cluster nested inside
                         the section row's own actions. -->
                    <div v-if="core.isAdmin" class="binder-row-menu binder-post__admin-row" :ref="(el) => setMenuRootEl(`post:${post.id}`, el)">
                      <button
                        type="button"
                        class="binder-icon-btn"
                        title="Entry actions"
                        aria-label="Entry actions"
                        :aria-expanded="isMenuOpen(`post:${post.id}`)"
                        @click.stop="toggleMenu(`post:${post.id}`)"
                      >
                        <MoreVertical :size="18" />
                      </button>
                      <div v-if="isMenuOpen(`post:${post.id}`)" class="binder-row-menu__dropdown" @click.stop>
                        <button type="button" class="binder-row-menu__item" @click="movePost(section.id, post, -1); closeMenu()">
                          <ArrowUp :size="16" />Move up
                        </button>
                        <button type="button" class="binder-row-menu__item" @click="movePost(section.id, post, 1); closeMenu()">
                          <ArrowDown :size="16" />Move down
                        </button>
                        <button type="button" class="binder-row-menu__item" @click="openEditPost(post); closeMenu()">
                          <Pencil :size="16" />Edit
                        </button>
                        <button type="button" class="binder-row-menu__item binder-row-menu__item--danger" @click="armDelete(`post:${post.id}`); closeMenu()">
                          <Trash2 :size="16" />Delete
                        </button>
                      </div>
                    </div>
                  </header>
                  <p v-if="isPendingDelete(`post:${post.id}`)" class="binder-confirm-hint" @click.stop>
                    <span class="binder-confirm-hint__text">Permanently delete this entry?</span>
                    <button type="button" class="binder-confirm-hint__cancel" @click="cancelPendingDelete">Cancel</button>
                    <button type="button" class="binder-confirm-hint__confirm" @click="deletePost(post)">Delete</button>
                  </p>
                  <div class="binder-post__body" v-html="renderBody(post.body)"></div>
                  <div v-if="post.images?.length" class="binder-post__images">
                    <AssetImage
                      v-for="img in post.images"
                      :key="img.id"
                      :asset-id="img.image_asset_id"
                      class="binder-post__image"
                    />
                  </div>
                </article>
              </div>
              <EmptyState v-if="postsFor(section.id).length === 0">
                No posts in this section yet.
                <template v-if="core.isAdmin"> Add the first one below.</template>
              </EmptyState>
              <AppButton v-if="core.isAdmin" variant="secondary" @click="openAddPost">
                <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add Entry
              </AppButton>
          </div>
        </div>
      </div>
    </div>

    <!-- Section editor -->
    <AppModal :open="showSectionModal" :title="editingSectionId ? 'Edit section' : 'Add a section'" @close="closeSectionModal">
      <p v-if="sectionError" class="binder-error">{{ sectionError }}</p>
      <FormField v-model="sectionTitle" label="Title" placeholder="e.g. Our Values" required />
      <div class="binder-modal-actions">
        <AppButton variant="secondary" @click="closeSectionModal">Cancel</AppButton>
        <AppButton :disabled="sectionSaving" @click="saveSection">{{ sectionSaving ? 'Saving…' : 'Save' }}</AppButton>
      </div>
    </AppModal>

    <!-- Post editor -->
    <AppModal :open="showPostModal" :title="editingPostId ? 'Edit post' : 'Add a post'" @close="closePostModal">
      <p v-if="postError" class="binder-error">{{ postError }}</p>
      <FormField v-model="postTitle" label="Title" placeholder="Post title" required />
      <label class="form-field binder-body-field">
        <span class="form-field__label">Body (markdown: **bold**, *italic*, # heading, - list)</span>
        <textarea v-model="postBody" rows="10" placeholder="Write the post…" />
      </label>

      <div class="binder-images-field">
        <span class="form-field__label">Images</span>
        <div v-if="postImages.length" class="binder-image-thumbs">
          <div v-for="img in postImages" :key="img.id" class="binder-image-thumb">
            <AssetImage :asset-id="img.image_asset_id" class="binder-image-thumb__img" />
            <button type="button" class="binder-image-thumb__remove" title="Remove image" aria-label="Remove image" @click="removeImage(img.id)">
              <X :size="12" />
            </button>
          </div>
        </div>
        <input ref="imageInputEl" type="file" accept="image/*" :disabled="imageUploading" @change="onImageChange" />
        <p v-if="imageUploading" class="binder-image-uploading">Uploading…</p>
      </div>

      <div class="binder-modal-actions">
        <AppButton variant="secondary" @click="closePostModal">Cancel</AppButton>
        <AppButton :disabled="postSaving" @click="savePost()">{{ postSaving ? 'Saving…' : 'Save' }}</AppButton>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.binder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.binder-header__actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.binder-error {
  color: var(--danger);
  font: var(--type-body);
  margin: 0 0 12px;
}

.binder-import-result {
  color: var(--text-muted);
  font: var(--type-label);
  margin: 0 0 12px;
}

.binder-nav {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.binder-section {
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  overflow: hidden;
}

.binder-section__header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font: var(--type-title);
  color: var(--text);
}

/* "Open" state is signaled by three non-color cues together (WCAG AA: never
   color alone) -- the chevron rotates open, the title switches to bolder
   weight, and only then does the accent color reinforce it. */
.binder-section--open .binder-section__header {
  color: var(--accent);
}

.binder-section--open .binder-section__title {
  font-weight: 800;
}

.binder-section__chevron {
  flex: none;
  color: var(--text-muted);
  transition: transform 160ms ease, color 120ms ease;
}

.binder-section--open .binder-section__chevron {
  color: var(--accent);
  transform: rotate(90deg);
}

.binder-section__titlewrap {
  flex: 1;
  /* Unlike the post-header fix below, this row's other children (count
     badge, chevron) are all fixed-size and never wrap -- so instead of a
     large min-width forcing a wrap (which they can't do), this block gets
     a small floor and the title itself ellipsis-truncates (see
     .binder-section__title) as the safety valve on very narrow screens,
     rather than ever overlapping the count/chevron. */
  min-width: 60px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.binder-section__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.binder-section__count {
  flex: none;
  font: var(--type-label);
  color: var(--text-muted);
  background: var(--surface-variant);
  border-radius: 999px;
  min-width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 6px;
}

.binder-section__row-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
}

/* Same treatment as Communication's .comm-icon-btn (36px tap target, 18px
   icon) -- small in the row, still comfortably tappable. */
.comm-icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.comm-icon-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text) 8%, transparent);
  color: var(--text);
}

.comm-icon-btn--danger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}

.comm-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.comm-icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.binder-section__row-actions .comm-icon-btn {
  width: 36px;
  height: 36px;
}

/* Single overflow-menu trigger + dropdown per post row -- see the template
   comment. `position: relative` anchors the absolutely-positioned dropdown
   to this row instead of the page. */
.binder-row-menu {
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 14px 10px;
}

.binder-row-menu__dropdown {
  position: absolute;
  top: calc(100% - 4px);
  right: 14px;
  min-width: 170px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  background: var(--surface);
  border-radius: 14px;
  box-shadow: var(--elevation-3);
  z-index: 5;
}

.binder-row-menu__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 8px 12px;
  border: none;
  border-radius: 10px;
  background: none;
  color: var(--text);
  font: var(--type-body);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  width: 100%;
}

.binder-row-menu__item:hover:not(:disabled) {
  background: var(--surface-variant);
}

.binder-row-menu__item:disabled {
  opacity: 0.4;
  cursor: default;
}

.binder-row-menu__item--danger {
  color: var(--danger);
}

/* Icon-only control: a 44x44px real hit area (WCAG 2.5.5/2.5.8) even though
   the drawn glyph is smaller -- negative margin keeps the visual footprint
   compact, same pattern as ListRow/AppModal's shared icon buttons.
   Borderless, for visual consistency with the rest of the app's icon
   buttons (and so it never intersects a neighboring icon button's
   border). */
.binder-icon-btn {
  flex: none;
  width: 44px;
  height: 44px;
  margin: -8px -6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 10px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  transition: background-color 120ms ease, color 120ms ease;
}

.binder-icon-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text) 6%, transparent);
  color: var(--text);
}

.binder-icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.binder-confirm-hint {
  margin: 0 14px 10px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid var(--danger);
  border-radius: 8px;
  font: var(--type-label);
  color: var(--danger);
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

/* Flex-wrap fix (same reasoning as .binder-post__title above): a real pixel
   min-width, not 0, so this text wraps onto its own line above the fixed-
   width Cancel button on narrow screens instead of the two ever
   overlapping or squeezing indefinitely. */
.binder-confirm-hint__text {
  flex: 1;
  min-width: 160px;
}

.binder-confirm-hint__cancel {
  flex: none;
  border: 1px solid var(--danger);
  background: transparent;
  color: var(--danger);
  border-radius: 999px;
  padding: 4px 12px;
  min-height: 44px;
  font: var(--type-label);
  font-weight: 700;
  cursor: pointer;
}

.binder-confirm-hint__cancel:hover {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

/* Explicit confirm action -- the trash icon lives inside a menu that's
   already closed by this point, so the second step needs its own visible
   button rather than "tap the (hidden) icon again". */
.binder-confirm-hint__confirm {
  flex: none;
  border: 1px solid var(--danger);
  background: var(--danger);
  color: var(--danger-container);
  border-radius: 999px;
  padding: 4px 12px;
  min-height: 44px;
  font: var(--type-label);
  font-weight: 700;
  cursor: pointer;
}

.binder-confirm-hint__confirm:hover {
  background: color-mix(in srgb, var(--danger) 85%, black);
}

.binder-section__body {
  padding: 0 14px 14px;
  border-top: 1px solid var(--border);
  padding-top: 14px;
}

.binder-posts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 12px;
}

.binder-post {
  background: var(--surface-variant);
  border-radius: 12px;
  padding: 14px 16px;
}

/* Tapping a post row opens its edit drawer, same as every other
   module's item row -- admin-only here since post editing itself is
   admin-gated (see the file-level comment). The move/edit/delete
   buttons inside still stop propagation (@click.stop) so they act on
   themselves, not the row-level open. */
.binder-post--tappable {
  cursor: pointer;
}

.binder-post--tappable:hover {
  background: color-mix(in srgb, var(--surface-variant) 80%, var(--text) 6%);
}

.binder-post__header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.binder-post__title {
  /* Flex-wrap fix: a real min-width (not 0) forces the header onto two
     lines at mobile widths instead of squeezing the title against the
     admin-row buttons until they overlap -- min-width: 0 on a flex child
     next to a fixed-width sibling defeats flex-wrap: wrap entirely, since
     the child just keeps shrinking instead of ever triggering the wrap. */
  flex: 1;
  min-width: 180px;
  margin: 0;
  font: var(--type-title);
}

.binder-post__admin-row {
  flex: none;
  padding: 0;
}

.binder-post__body {
  font: var(--type-body);
  color: var(--text);
  margin-top: 6px;
}

.binder-post__body :deep(p) {
  margin: 0 0 8px;
}

.binder-post__body :deep(h4),
.binder-post__body :deep(h5),
.binder-post__body :deep(h6) {
  margin: 12px 0 6px;
}

.binder-post__body :deep(ul) {
  margin: 0 0 8px;
  padding-left: 20px;
}

.binder-post__images {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.binder-post__image {
  width: 96px;
  height: 96px;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.binder-images-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 12px 0;
  font: var(--type-label);
  color: var(--text-muted);
}

.binder-image-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.binder-image-thumb {
  position: relative;
  /* Extra top/right space so the remove button's real 44x44px hit area
     (below) has room to sit inside this wrapper without overlapping the
     neighboring thumbnail. */
  width: 72px;
  height: 72px;
  margin: 10px 10px 0 0;
}

.binder-image-thumb__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--border);
}

/* Icon-only control: keeps its small 20px visual badge (matches the photo
   grid's compact scale) but the real clickable area is 44x44px, centered
   on the badge via negative margins -- same technique as ListRow's shared
   delete button. */
.binder-image-thumb__remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 44px;
  height: 44px;
  margin: -12px -12px 0 0;
  border-radius: 50%;
  background: transparent;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.binder-image-thumb__remove::before {
  content: '';
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--danger);
  position: absolute;
}

.binder-image-thumb__remove svg {
  position: relative;
  color: var(--danger-container);
}

.binder-image-uploading {
  margin: 0;
  font: var(--type-label);
  color: var(--text-muted);
}

.binder-body-field {
  margin: 12px 0;
}

.binder-body-field textarea {
  font: var(--type-body);
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  resize: vertical;
  font-family: inherit;
}

.binder-body-field textarea:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

.binder-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

/* Desktop: tab strip. Headers lay out in a row; only the active section's
   body renders at all (v-if in the template already skips inactive
   bodies -- this media query only needs to handle the header row/border
   reflow from "stacked accordion card" to "tab strip").

   The open section's body can't live inside its own `.binder-section` flex
   item forced to `width: 100%` to span the row -- flex-wrap lays items out
   in DOM order, so any tab *after* the open one would get pushed below the
   now-full-width body instead of staying in the tab row. So
   `.binder-section` itself is made invisible to layout
   (`display: contents`) so its header/admin-row/body children join
   `.binder-nav`'s flex row directly, and the body gets `order: 1` (headers
   default to `order: 0`) and `flex-basis: 100%` so it always sorts to the
   end of the row and
   spans its own full-width line, regardless of which tab is open -- the
   tab strip itself never reorders. */
@media (min-width: 900px) {
  .binder-nav {
    display: flex;
    flex-direction: row;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
    gap: 0;
  }

  .binder-section {
    display: contents;
  }

  .binder-section__header {
    /* Reset the mobile accordion's `width: 100%` (BinderPage.vue:565) --
       now that `.binder-section` is `display: contents`, this header is a
       direct flex item of `.binder-nav` itself, so an unreset 100% would
       resolve against the whole tab strip's width and force every tab onto
       its own row instead of sitting side by side. */
    width: auto;
    padding: 12px 18px;
    font: var(--type-label);
    border-bottom: 2px solid transparent;
    gap: 8px;
  }

  .binder-section__titlewrap {
    min-width: 0;
  }

  /* Tab strip already carries the accent underline (a shape/border cue,
     not color alone) plus the bold-weight title change below -- the mobile
     accordion's chevron-rotation cue is accordion-specific and not needed
     once every tab's body no longer literally opens/closes in place. */
  .binder-section__chevron {
    display: none;
  }

  .binder-section--open .binder-section__header {
    border-bottom-color: var(--accent);
  }

  .binder-section__menu {
    padding: 0 18px 8px;
  }

  .binder-section__body {
    order: 1;
    flex-basis: 100%;
    border-top: 1px solid var(--border);
    padding: 20px 4px;
  }

  /* Same reasoning as .binder-section__body above: .binder-section is
     `display: contents` here, so this hint row (a direct sibling of
     .binder-section__menu, not nested inside .binder-section__body)
     would otherwise join the tab-strip row itself instead of sitting below
     it -- give it the same order/flex-basis treatment so it always renders
     as its own full-width line under the tab strip, regardless of which
     section's delete is pending. */
  .binder-confirm-hint {
    order: 1;
    flex-basis: 100%;
    margin: 0 18px 10px;
  }
}
</style>
