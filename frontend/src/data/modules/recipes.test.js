import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { newFamilyDoc, forkDoc, syncDocs } from '../testing'
import { putAsset, getAsset } from '../assets'
import { listShopping } from './shopping'
import { listRecipes, saveRecipe, deleteRecipe, setRecipePhoto, toggleRecipeInShoppingList } from './recipes'
import { listMeals, saveMeal, deleteMeal } from './meals'

describe('recipes', () => {
  it('saves with cleaned ingredients and replaces them wholesale on edit', () => {
    const { doc, admin } = newFamilyDoc()
    const id = saveRecipe(doc, admin, { title: 'Tacos', servings: '4', prep_minutes: '', ingredients: [{ name: 'Tortillas', quantity: '8' }, { name: ' ' }] })
    expect(listRecipes(doc)[0]).toMatchObject({ title: 'Tacos', servings: 4, prep_minutes: null, created_by_member_id: admin.id, in_shopping_list: false })
    expect(listRecipes(doc)[0].ingredients.map((i) => i.name)).toEqual(['Tortillas'])
    saveRecipe(doc, admin, { id, title: 'Tacos', ingredients: [{ name: 'Beef', quantity: '1', unit: 'lb' }] })
    expect(listRecipes(doc)[0].ingredients.map((i) => i.name)).toEqual(['Beef'])
  })

  it('toggles ingredients into the shopping list and back out', () => {
    const { doc, admin } = newFamilyDoc()
    const id = saveRecipe(doc, admin, { title: 'Tacos', ingredients: [{ name: 'Beef', quantity: '1', unit: 'lb' }, { name: 'Salsa' }] })
    expect(toggleRecipeInShoppingList(doc, id)).toEqual({ added: true, count: 2 })
    expect(listShopping(doc).map((i) => [i.title, i.category, i.recipe_title])).toEqual([
      ['1 lb Beef', 'Recipe: Tacos', 'Tacos'],
      ['Salsa', 'Recipe: Tacos', 'Tacos'],
    ])
    expect(listRecipes(doc)[0].in_shopping_list).toBe(true)
    expect(toggleRecipeInShoppingList(doc, id)).toEqual({ added: false, count: 0 })
    expect(listShopping(doc)).toEqual([])
  })

  // toggleRecipeInShoppingList gives each shopping row a deterministic
  // per-ingredient id (recipe:<recipeId>:<ingredientId>) rather than a
  // random one (insert's default newId()). With random ids, two devices
  // that both toggle-add the same recipe before syncing would each create
  // their own copy of every ingredient -- duplicates once they sync.
  // Deterministic ids make both devices' writes land on the same key.
  it('toggling the same recipe on two unsynced devices does not duplicate shopping rows', () => {
    const { doc: docA, admin } = newFamilyDoc()
    const id = saveRecipe(docA, admin, { title: 'Tacos', ingredients: [{ name: 'Beef', quantity: '1', unit: 'lb' }, { name: 'Salsa' }] })
    const docB = forkDoc(docA)

    toggleRecipeInShoppingList(docA, id)
    toggleRecipeInShoppingList(docB, id)
    syncDocs(docA, docB)

    expect(listShopping(docA).map((i) => i.title).sort()).toEqual(['1 lb Beef', 'Salsa'])
    expect(listShopping(docB).map((i) => i.title).sort()).toEqual(['1 lb Beef', 'Salsa'])
  })

  it('delete cascades to shopping rows, unlinks meals, and frees the photo', () => {
    const { doc, admin } = newFamilyDoc()
    const assets = new Y.Doc()
    const id = saveRecipe(doc, admin, { title: 'Tacos', ingredients: [{ name: 'Salsa' }] })
    const photo = putAsset(assets, new Uint8Array([1]), 'image/jpeg')
    setRecipePhoto(doc, assets, id, photo)
    toggleRecipeInShoppingList(doc, id)
    const meal = saveMeal(doc, admin, { title: 'Taco Tuesday', recipe_id: id })
    deleteRecipe(doc, id, assets)
    expect(listShopping(doc)).toEqual([])
    expect(listMeals(doc).find((m) => m.id === meal)).toMatchObject({ recipe_id: null, recipe_title: null })
    expect(getAsset(assets, photo)).toBe(null)
    expect(() => saveMeal(doc, admin, { title: 'x', recipe_id: 'gone' })).toThrow('Recipe not found')
    deleteMeal(doc, meal)
    expect(listMeals(doc)).toEqual([])
  })
})
