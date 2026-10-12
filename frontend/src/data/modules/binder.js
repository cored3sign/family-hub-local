import { all, get, insert, patch, remove, nextSortOrder, requireText } from '../collection'
import { requireAdmin } from '../members'
import { removeAsset } from '../assets'
import { parseFrontmatter, stripHintFields, derivePostTitle, resolveImportSection } from '../markdown'

const SECTIONS = 'binder_sections'
const POSTS = 'binder_posts'
const IMAGES = 'binder_post_images'
export const MAX_MARKDOWN_IMPORT_FILES = 200
export const MAX_MARKDOWN_IMPORT_BYTES = 1_000_000

const bySortOrder = (a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at)

export function listSections(doc) {
  const posts = all(doc, POSTS)
  return all(doc, SECTIONS)
    .map((s) => ({ ...s, post_count: posts.filter((p) => p.section_id === s.id).length }))
    .sort(bySortOrder)
}

export function saveSection(doc, actor, input) {
  requireAdmin(doc, actor)
  const title = requireText(input.title, 'title is required')
  if (input.id) {
    const prev = get(doc, SECTIONS, input.id)
    if (!prev) throw new Error('Section not found')
    const isWellbeing = 'is_wellbeing' in input ? Boolean(input.is_wellbeing) : prev.is_wellbeing
    patch(doc, SECTIONS, input.id, { title, is_wellbeing: isWellbeing })
    return input.id
  }
  return insert(doc, SECTIONS, { title, is_wellbeing: Boolean(input.is_wellbeing), sort_order: nextSortOrder(doc, SECTIONS) })
}

export function deleteSection(doc, actor, id) {
  requireAdmin(doc, actor)
  if (all(doc, POSTS).some((p) => p.section_id === id)) throw new Error('This section still has posts -- move or delete them first')
  if (!remove(doc, SECTIONS, id)) throw new Error('Section not found')
}

export function reorderSections(doc, actor, ids) {
  requireAdmin(doc, actor)
  doc.transact(() => ids.forEach((id, index) => patch(doc, SECTIONS, id, { sort_order: index })))
}

export function listPosts(doc, sectionId) {
  const images = all(doc, IMAGES)
  return all(doc, POSTS)
    .filter((p) => p.section_id === sectionId)
    .map((p) => ({ ...p, images: images.filter((i) => i.post_id === p.id).sort(bySortOrder) }))
    .sort(bySortOrder)
}

export function savePost(doc, actor, input) {
  requireAdmin(doc, actor)
  const title = requireText(input.title, 'title is required')
  const body = input.body == null ? '' : String(input.body)
  if (input.id) {
    const prev = get(doc, POSTS, input.id)
    if (!prev) throw new Error('Post not found')
    const sectionId = input.section_id || prev.section_id
    if (sectionId !== prev.section_id && !get(doc, SECTIONS, sectionId)) throw new Error('Section not found')
    patch(doc, POSTS, input.id, { title, body: 'body' in input ? body : prev.body, section_id: sectionId })
    return input.id
  }
  if (!input.section_id || !get(doc, SECTIONS, input.section_id)) throw new Error('Section not found')
  return insert(doc, POSTS, {
    section_id: input.section_id,
    title,
    body,
    vault_path: null,
    sort_order: nextSortOrder(doc, POSTS, (p) => p.section_id === input.section_id),
    created_by_member_id: actor.id,
  })
}

export function deletePost(doc, actor, id, assets = null) {
  requireAdmin(doc, actor)
  if (!get(doc, POSTS, id)) throw new Error('Post not found')
  const images = all(doc, IMAGES).filter((i) => i.post_id === id)
  doc.transact(() => {
    images.forEach((i) => remove(doc, IMAGES, i.id))
    remove(doc, POSTS, id)
  })
  if (assets) images.forEach((i) => removeAsset(assets, i.image_asset_id))
}

export function reorderPosts(doc, actor, sectionId, ids) {
  requireAdmin(doc, actor)
  doc.transact(() => {
    ids.forEach((id, index) => {
      if (get(doc, POSTS, id)?.section_id === sectionId) patch(doc, POSTS, id, { sort_order: index })
    })
  })
}

export function addPostImage(doc, actor, postId, assetId) {
  requireAdmin(doc, actor)
  if (!get(doc, POSTS, postId)) throw new Error('Post not found')
  return insert(doc, IMAGES, { post_id: postId, image_asset_id: assetId, sort_order: nextSortOrder(doc, IMAGES, (i) => i.post_id === postId) })
}

export function deletePostImage(doc, actor, id, assets = null) {
  requireAdmin(doc, actor)
  const image = get(doc, IMAGES, id)
  if (!image) throw new Error('Image not found')
  remove(doc, IMAGES, id)
  if (assets) removeAsset(assets, image.image_asset_id)
}

function upsertSection(doc, title, isWellbeing) {
  const existing = all(doc, SECTIONS).find((s) => s.title === title)
  if (existing) {
    patch(doc, SECTIONS, existing.id, { is_wellbeing: isWellbeing })
    return existing.id
  }
  return insert(doc, SECTIONS, { title, is_wellbeing: isWellbeing, sort_order: nextSortOrder(doc, SECTIONS) })
}

// Re-importing the same filename updates that post (an upsert keyed on vault_path).
function upsertPost(doc, sectionId, vaultPath, title, body) {
  const existing = all(doc, POSTS).find((p) => p.vault_path === vaultPath)
  if (existing) {
    patch(doc, POSTS, existing.id, { title, body, section_id: sectionId })
    return existing.id
  }
  return insert(doc, POSTS, {
    section_id: sectionId,
    title,
    body,
    vault_path: vaultPath,
    sort_order: nextSortOrder(doc, POSTS, (p) => p.section_id === sectionId),
    created_by_member_id: null,
  })
}

export function importMarkdownFiles(doc, actor, files) {
  requireAdmin(doc, actor)
  if (!files.length) throw new Error('Choose at least one .md file')
  if (files.length > MAX_MARKDOWN_IMPORT_FILES) throw new Error(`Import at most ${MAX_MARKDOWN_IMPORT_FILES} files at a time`)
  let imported = 0
  let skipped = 0
  const sections = new Set()
  doc.transact(() => {
    for (const file of files) {
      const name = String(file.name ?? '').split('/').pop()
      if (!name.toLowerCase().endsWith('.md') || file.size > MAX_MARKDOWN_IMPORT_BYTES) {
        skipped++
        continue
      }
      const parsed = parseFrontmatter(String(file.text ?? ''))
      const frontmatter = stripHintFields(parsed.frontmatter)
      if (['index', 'system'].includes(frontmatter.type)) {
        skipped++
        continue
      }
      const target = resolveImportSection(frontmatter)
      const sectionId = upsertSection(doc, target.section, target.is_wellbeing)
      upsertPost(doc, sectionId, name, derivePostTitle(frontmatter, name), parsed.body.trim())
      sections.add(target.section)
      imported++
    }
  })
  return { imported, skipped, sections: sections.size }
}
