import { all, insert, patch, remove, table, blankToNull, requireText } from '../collection'

const T = 'shopping_items'

export function listShopping(doc) {
  const recipes = table(doc, 'recipes')
  return all(doc, T)
    .map((item) => ({
      ...item,
      recipe_title: item.recipe_id ? (recipes.get(item.recipe_id)?.get('title') ?? 'Deleted recipe') : null,
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export function saveShoppingItem(doc, { id, title, category, store, completed }) {
  const fields = { title: requireText(title, 'title is required'), category: blankToNull(category), store: blankToNull(store) }
  if (id) {
    if (!patch(doc, T, id, { ...fields, completed: Boolean(completed) })) throw new Error('Item not found')
    return id
  }
  return insert(doc, T, { ...fields, list_type: 'essential', completed: false, sort_order: 0, recipe_id: null })
}

export function setShoppingCompleted(doc, id, completed) {
  patch(doc, T, id, { completed: Boolean(completed) })
}

export function deleteShoppingItem(doc, id) {
  remove(doc, T, id)
}

export function deleteShoppingItems(doc, ids) {
  doc.transact(() => ids.forEach((id) => remove(doc, T, id)))
}
