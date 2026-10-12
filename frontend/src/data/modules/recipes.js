import { all, get, insert, patch, remove, removeWhere, blankToNull, requireText, toIntOrNull, byText } from '../collection'
import { newId } from '../ids'
import { removeAsset } from '../assets'

const T = 'recipes'
const SHOPPING = 'shopping_items'

// Ingredients are one plain array value (last-writer-wins): the editor always
// replaces the whole list.
function normalizeIngredients(list) {
  return (Array.isArray(list) ? list : [])
    .map((ing) => ({ name: String(ing?.name ?? '').trim(), quantity: blankToNull(ing?.quantity), unit: blankToNull(ing?.unit) }))
    .filter((ing) => ing.name !== '')
    .map((ing, index) => ({ id: newId(), ...ing, sort_order: index }))
}

export function listRecipes(doc) {
  const inList = new Set(all(doc, SHOPPING).map((i) => i.recipe_id).filter(Boolean))
  return all(doc, T)
    .map((r) => ({ ...r, ingredients: r.ingredients ?? [], in_shopping_list: inList.has(r.id) }))
    .sort((a, b) => byText(a.title, b.title))
}

export function getRecipe(doc, id) {
  return listRecipes(doc).find((r) => r.id === id) ?? null
}

export function saveRecipe(doc, actor, input) {
  const fields = {
    title: requireText(input.title, 'title is required'),
    instructions: blankToNull(input.instructions),
    servings: toIntOrNull(input.servings),
    prep_minutes: toIntOrNull(input.prep_minutes),
    ingredients: normalizeIngredients(input.ingredients),
  }
  if (input.id) {
    if (!patch(doc, T, input.id, fields)) throw new Error('Recipe not found')
    return input.id
  }
  return insert(doc, T, { ...fields, photo_asset_id: null, created_by_member_id: actor.id })
}

export function deleteRecipe(doc, id, assets = null) {
  const recipe = get(doc, T, id)
  if (!recipe) throw new Error('Recipe not found')
  doc.transact(() => {
    removeWhere(doc, SHOPPING, (i) => i.recipe_id === id)
    for (const meal of all(doc, 'meal_library')) if (meal.recipe_id === id) patch(doc, 'meal_library', meal.id, { recipe_id: null })
    remove(doc, T, id)
  })
  if (assets && recipe.photo_asset_id) removeAsset(assets, recipe.photo_asset_id)
}

export function setRecipePhoto(doc, assets, id, assetId) {
  const recipe = get(doc, T, id)
  if (!recipe) throw new Error('Recipe not found')
  patch(doc, T, id, { photo_asset_id: assetId })
  if (recipe.photo_asset_id && recipe.photo_asset_id !== assetId) removeAsset(assets, recipe.photo_asset_id)
}

// Toggle: first call adds one shopping row per ingredient (tagged with
// recipe_id so ShoppingPage groups them), second call removes them all.
//
// Each inserted row uses a deterministic id
// (`recipe:<recipeId>:<ingredientId>`, insert's 4th arg) instead of a random
// one -- two devices that both toggle-add the same recipe before syncing
// write the same keys instead of each creating their own duplicate copy.
export function toggleRecipeInShoppingList(doc, id) {
  const recipe = get(doc, T, id)
  if (!recipe) throw new Error('Recipe not found')
  if (all(doc, SHOPPING).some((i) => i.recipe_id === id)) {
    removeWhere(doc, SHOPPING, (i) => i.recipe_id === id)
    return { added: false, count: 0 }
  }
  const rows = (recipe.ingredients ?? [])
    .map((ing) => ({
      ingredientId: ing.id,
      title: [ing.quantity, ing.unit, ing.name].filter((p) => p != null && p !== '').join(' ').trim(),
    }))
    .filter((row) => row.title)
  doc.transact(() => {
    for (const row of rows) {
      insert(
        doc,
        SHOPPING,
        { title: row.title, category: `Recipe: ${recipe.title}`, store: null, list_type: 'essential', completed: false, sort_order: 0, recipe_id: id },
        `recipe:${id}:${row.ingredientId}`
      )
    }
  })
  return { added: rows.length > 0, count: rows.length }
}
