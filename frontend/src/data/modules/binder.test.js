import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { newFamilyDoc } from '../testing'
import { putAsset, getAsset } from '../assets'
import {
  listSections, saveSection, deleteSection, reorderSections,
  listPosts, savePost, deletePost, reorderPosts, addPostImage, deletePostImage, importMarkdownFiles,
} from './binder'

describe('binder', () => {
  it('admin-only sections and posts with ordering and counts', () => {
    const { doc, admin, kid } = newFamilyDoc()
    expect(() => saveSection(doc, kid, { title: 'x' })).toThrow('Only an admin can do that')
    const a = saveSection(doc, admin, { title: 'House rules' })
    const b = saveSection(doc, admin, { title: 'Wellbeing', is_wellbeing: true })
    reorderSections(doc, admin, [b, a])
    expect(listSections(doc).map((s) => s.title)).toEqual(['Wellbeing', 'House rules'])
    const p1 = savePost(doc, admin, { section_id: a, title: 'Bedtime', body: '8pm' })
    const p2 = savePost(doc, admin, { section_id: a, title: 'Screens' })
    reorderPosts(doc, admin, a, [p2, p1])
    expect(listPosts(doc, a).map((p) => p.title)).toEqual(['Screens', 'Bedtime'])
    expect(listSections(doc).find((s) => s.id === a).post_count).toBe(2)
    expect(() => deleteSection(doc, admin, a)).toThrow('This section still has posts -- move or delete them first')
    savePost(doc, admin, { id: p1, title: 'Bedtime', section_id: b })
    expect(listPosts(doc, b).map((p) => p.title)).toEqual(['Bedtime'])
  })

  it('renaming a section without is_wellbeing keeps its existing flag', () => {
    const { doc, admin } = newFamilyDoc()
    const w = saveSection(doc, admin, { title: 'Wellbeing', is_wellbeing: true })
    saveSection(doc, admin, { id: w, title: 'Wellbeing renamed' })
    const section = listSections(doc).find((s) => s.id === w)
    expect(section.title).toBe('Wellbeing renamed')
    expect(section.is_wellbeing).toBe(true)
  })

  it('images are ordered and freed with their post', () => {
    const { doc, admin } = newFamilyDoc()
    const assets = new Y.Doc()
    const s = saveSection(doc, admin, { title: 'S' })
    const post = savePost(doc, admin, { section_id: s, title: 'P' })
    const a1 = putAsset(assets, new Uint8Array([1]), 'image/jpeg')
    const a2 = putAsset(assets, new Uint8Array([2]), 'image/jpeg')
    const img1 = addPostImage(doc, admin, post, a1)
    addPostImage(doc, admin, post, a2)
    expect(listPosts(doc, s)[0].images.map((i) => i.image_asset_id)).toEqual([a1, a2])
    deletePostImage(doc, admin, img1, assets)
    expect(getAsset(assets, a1)).toBe(null)
    deletePost(doc, admin, post, assets)
    expect(getAsset(assets, a2)).toBe(null)
    expect(doc.getMap('binder_post_images').size).toBe(0)
  })

  it('imports markdown: routes by type, upserts by filename, skips index/system and non-.md', () => {
    const { doc, admin } = newFamilyDoc()
    const files = [
      { name: 'honesty.md', text: '---\ntype: family_value\nvalue: Honesty\n---\nTell the truth.', size: 40 },
      { name: 'calm.md', text: '---\ntype: wellbeing_resource\n---\nBreathe.', size: 30 },
      { name: 'index.md', text: '---\ntype: index\n---\n', size: 20 },
      { name: 'photo.png', text: '', size: 10 },
    ]
    expect(importMarkdownFiles(doc, admin, files)).toEqual({ imported: 2, skipped: 2, sections: 2 })
    importMarkdownFiles(doc, admin, [{ name: 'honesty.md', text: '---\ntype: family_value\nvalue: Honesty\n---\nAlways.', size: 30 }])
    const culture = listSections(doc).find((s) => s.title === 'Family Culture')
    expect(listPosts(doc, culture.id).map((p) => [p.title, p.body])).toEqual([['Honesty', 'Always.']])
    expect(listSections(doc).find((s) => s.title === 'Wellbeing').is_wellbeing).toBe(true)
  })
})
