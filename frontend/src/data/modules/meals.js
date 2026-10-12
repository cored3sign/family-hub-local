import { all, get, insert, patch, remove, table, blankToNull, requireText, byText } from '../collection'

const T = 'meal_library'

export function listMeals(doc) {
  const recipes = table(doc, 'recipes')
  return all(doc, T)
    .map((m) => ({ ...m, recipe_title: m.recipe_id ? (recipes.get(m.recipe_id)?.get('title') ?? null) : null }))
    .sort((a, b) => byText(a.title, b.title))
}

export function saveMeal(doc, actor, input) {
  const title = requireText(input.title, 'title is required')
  const recipeId = input.recipe_id || null
  if (recipeId && !get(doc, 'recipes', recipeId)) throw new Error('Recipe not found')
  const fields = { title, notes: blankToNull(input.notes), recipe_id: recipeId }
  if (input.id) {
    if (!patch(doc, T, input.id, fields)) throw new Error('Meal not found')
    return input.id
  }
  return insert(doc, T, { ...fields, created_by_member_id: actor.id })
}

export function deleteMeal(doc, id) {
  if (!remove(doc, T, id)) throw new Error('Meal not found')
}
