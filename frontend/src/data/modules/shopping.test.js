import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from '../testing'
import { insert, remove } from '../collection'
import { listShopping, saveShoppingItem, setShoppingCompleted, deleteShoppingItem, deleteShoppingItems } from './shopping'

describe('shopping', () => {
  it('adds, edits, completes and deletes items', () => {
    const { doc } = newFamilyDoc()
    const id = saveShoppingItem(doc, { title: ' Milk ', category: '', store: 'Costco' })
    expect(listShopping(doc)[0]).toMatchObject({ id, title: 'Milk', category: null, store: 'Costco', completed: false, recipe_id: null, recipe_title: null })
    saveShoppingItem(doc, { id, title: 'Oat milk', category: 'Dairy', store: 'Costco', completed: false })
    setShoppingCompleted(doc, id, true)
    expect(listShopping(doc)[0]).toMatchObject({ title: 'Oat milk', category: 'Dairy', completed: true })
    expect(() => saveShoppingItem(doc, { title: '  ' })).toThrow('title is required')
    const other = saveShoppingItem(doc, { title: 'Eggs' })
    deleteShoppingItems(doc, [id])
    deleteShoppingItem(doc, other)
    expect(listShopping(doc)).toEqual([])
  })

  it('a toggle on one device does not undo a rename on another', () => {
    const { doc: a } = newFamilyDoc()
    const id = saveShoppingItem(a, { title: 'Milk' })
    const b = forkDoc(a)
    saveShoppingItem(a, { id, title: 'Oat milk', completed: false })
    setShoppingCompleted(b, id, true)
    syncDocs(a, b)
    expect(listShopping(b)[0]).toMatchObject({ title: 'Oat milk', completed: true })
  })

  it('labels items whose recipe was deleted elsewhere', () => {
    const { doc } = newFamilyDoc()
    insert(doc, 'recipes', { title: 'Tacos', ingredients: [] }, 'r1')
    insert(doc, 'shopping_items', { title: 'Tortillas', completed: false, sort_order: 0, recipe_id: 'r1' })
    expect(listShopping(doc)[0].recipe_title).toBe('Tacos')
    remove(doc, 'recipes', 'r1')
    expect(listShopping(doc)[0].recipe_title).toBe('Deleted recipe')
  })
})
