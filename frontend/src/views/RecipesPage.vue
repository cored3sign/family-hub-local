<script setup>
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  BookOpen, UtensilsCrossed, ChefHat, Clock, Users, Check, ShoppingCart, X, Plus, Pencil,
} from 'lucide-vue-next'
import { useFamily, useLive } from '../data/vue'
import { putImageFile } from '../data/assets'
import AssetImage from '../components/AssetImage.vue'
import { listRecipes, saveRecipe as saveRecipeRecord, deleteRecipe as deleteRecipeRecord, setRecipePhoto, toggleRecipeInShoppingList } from '../data/modules/recipes'
import { listMeals, saveMeal, deleteMeal } from '../data/modules/meals'

const route = useRoute()
const router = useRouter()
const { doc, assets, actor } = useFamily()

// Recipe box + Meal Library, the same two-tab page shape
// CommunicationPage.vue uses for a module with more than one distinct
// concept living on one page.
const tab = ref('recipes') // recipes | meal-library

// --- Recipe box state ---
const recipes = useLive(listRecipes)
const showRecipeModal = ref(false)
const editingRecipeId = ref(null)
const recipeForm = ref(blankRecipeForm())
const recipeSaving = ref(false)
const recipeError = ref('')
const photoUploading = ref(false)
const photoInputEl = ref(null)
// Adding to the shopping list is a per-recipe toggle (see recipes.js's
// toggleRecipeInShoppingList), not a one-shot fire-and-forget action -- this
// tracks only the in-flight request per recipe id; the actual added/not-added
// state itself lives on each recipe object as `in_shopping_list`, straight off
// listRecipes' own live computed, so it survives a reload and never lies
// about what tapping the button will do next.
const shoppingActionRecipeId = ref(null)

function blankRecipeForm() {
  return {
    title: '',
    servings: '',
    prep_minutes: '',
    instructions: '',
    ingredients: [{ name: '', quantity: '', unit: '' }],
    photo_asset_id: null,
  }
}

// --- Meal library state ---
const mealIdeas = useLive(listMeals)
const newMealTitle = ref('')
const newMealNotes = ref('')
const newMealRecipeId = ref('')
const editingMealId = ref(null)
const editMealTitle = ref('')
const editMealNotes = ref('')
const editMealRecipeId = ref('')

// --- Recipe box actions ---

function openAddRecipe() {
  editingRecipeId.value = null
  recipeForm.value = blankRecipeForm()
  recipeError.value = ''
  showRecipeModal.value = true
}

function openEditRecipe(recipe) {
  editingRecipeId.value = recipe.id
  recipeForm.value = {
    title: recipe.title,
    servings: recipe.servings ?? '',
    prep_minutes: recipe.prep_minutes ?? '',
    instructions: recipe.instructions ?? '',
    ingredients: recipe.ingredients?.length
      ? recipe.ingredients.map((i) => ({ name: i.name, quantity: i.quantity ?? '', unit: i.unit ?? '' }))
      : [{ name: '', quantity: '', unit: '' }],
    photo_asset_id: recipe.photo_asset_id ?? null,
  }
  recipeError.value = ''
  showRecipeModal.value = true
}

function closeRecipeModal() {
  showRecipeModal.value = false
}

function addIngredientRow() {
  recipeForm.value.ingredients.push({ name: '', quantity: '', unit: '' })
}

function removeIngredientRow(index) {
  recipeForm.value.ingredients.splice(index, 1)
  if (recipeForm.value.ingredients.length === 0) {
    addIngredientRow()
  }
}

// Propagates a newly-created recipe's id back into editingRecipeId.value
// -- onPhotoChange's own draft-auto-save call relies on that id being set
// afterward, so attaching a photo while creating a brand-new recipe works.
// Also accepts `keepModalOpen` so that draft-save-for-a-photo
// call (from onPhotoChange, still mid-edit) doesn't close the modal out
// from under the user the way a normal explicit Save does.
function saveRecipe({ keepModalOpen = false } = {}) {
  if (!recipeForm.value.title.trim()) {
    recipeError.value = 'A title is required.'
    return
  }
  recipeSaving.value = true
  recipeError.value = ''
  try {
    const payload = {
      id: editingRecipeId.value ?? undefined,
      title: recipeForm.value.title,
      servings: recipeForm.value.servings,
      prep_minutes: recipeForm.value.prep_minutes,
      instructions: recipeForm.value.instructions,
      ingredients: recipeForm.value.ingredients.filter((i) => i.name.trim() !== ''),
    }
    const id = saveRecipeRecord(doc, actor(), payload)
    editingRecipeId.value = id
    if (!keepModalOpen) {
      showRecipeModal.value = false
    }
  } catch (e) {
    recipeError.value = e.message
  } finally {
    recipeSaving.value = false
  }
}

function deleteRecipe(id) {
  deleteRecipeRecord(doc, id, assets)
}

// Recipe photo, client-resized/capped before upload -- same
// canvas-resize pattern SettingsPage.vue uses for avatars,
// but preserving aspect ratio (fit-within, not cover-cropped to a square --
// a plated dish photo shouldn't be force-cropped square) and a larger max
// dimension since this is a content photo, not a small avatar.
const PHOTO_MAX_DIM = 1024

function resizePhotoToBlob(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, PHOTO_MAX_DIM / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(objectUrl)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85)
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Could not read image file'))
    }
    img.src = objectUrl
  })
}

async function onPhotoChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  recipeError.value = ''
  if (!file.type.startsWith('image/')) {
    recipeError.value = 'Please choose an image file.'
    return
  }
  // A photo can only attach to a recipe that already has an id -- save the
  // recipe first (as a draft with whatever's filled in) if this is a
  // still-unsaved new recipe, mirroring "you need a row before you can
  // attach a file to it."
  if (!editingRecipeId.value) {
    if (!recipeForm.value.title.trim()) {
      recipeError.value = 'Add a title before attaching a photo.'
      if (photoInputEl.value) photoInputEl.value.value = ''
      return
    }
    saveRecipe({ keepModalOpen: true })
    if (!editingRecipeId.value) return // saveRecipe failed, recipeError already set
  }
  photoUploading.value = true
  try {
    const resizedBlob = await resizePhotoToBlob(file)
    const resizedFile = new File([resizedBlob], 'recipe.jpg', { type: 'image/jpeg' })
    const photoId = await putImageFile(assets, resizedFile)
    setRecipePhoto(doc, assets, editingRecipeId.value, photoId)
    recipeForm.value.photo_asset_id = photoId
  } catch (err) {
    recipeError.value = err.message || 'Upload failed.'
  } finally {
    photoUploading.value = false
    if (photoInputEl.value) photoInputEl.value.value = ''
  }
}

// One action, a toggle -- first tap tags
// this recipe's ingredients into shopping_items (recipe_id set), second tap
// removes them again (see recipes.js's toggleRecipeInShoppingList). Nothing
// to reload afterward: `in_shopping_list` comes straight off listRecipes'
// live computed, so it reflects the new state the instant the toggle lands.
function toggleShoppingList(recipe) {
  shoppingActionRecipeId.value = recipe.id
  try {
    toggleRecipeInShoppingList(doc, recipe.id)
  } finally {
    shoppingActionRecipeId.value = null
  }
}

// ShoppingPage.vue's "Recipe ingredients" section links a recipe's
// name back here via ?open=<id> (no separate recipe-detail route exists --
// RecipesPage already models "which recipe is open" as in-page modal state,
// so this reuses that instead of inventing a new route). Vue Router reuses
// this component instance across a query-only navigation (no full
// remount), so both the initial call and this watcher call the same opener.
function openFromQuery() {
  const id = route.query.open
  if (!id) return
  const recipe = recipes.value.find((r) => r.id === id)
  if (recipe) {
    openEditRecipe(recipe)
    // Consume the query param so it doesn't re-trigger the modal (e.g. if
    // the member closes it and later navigates within Recipes again).
    router.replace({ path: '/recipes' })
  }
}

openFromQuery()

watch(() => route.query.open, () => {
  openFromQuery()
})

// --- Meal library actions ---

function addMealIdea() {
  if (!newMealTitle.value.trim()) return
  saveMeal(doc, actor(), {
    title: newMealTitle.value,
    notes: newMealNotes.value,
    recipe_id: newMealRecipeId.value || null,
  })
  newMealTitle.value = ''
  newMealNotes.value = ''
  newMealRecipeId.value = ''
}

function startEditMeal(meal) {
  editingMealId.value = meal.id
  editMealTitle.value = meal.title
  editMealNotes.value = meal.notes ?? ''
  editMealRecipeId.value = meal.recipe_id ?? ''
}

function cancelEditMeal() {
  editingMealId.value = null
}

function saveEditMeal() {
  if (!editMealTitle.value.trim()) return
  saveMeal(doc, actor(), {
    id: editingMealId.value,
    title: editMealTitle.value,
    notes: editMealNotes.value,
    recipe_id: editMealRecipeId.value || null,
  })
  editingMealId.value = null
}

function deleteMealIdea(id) {
  deleteMeal(doc, id)
}
</script>

<template>
  <div class="module-page recipes-page">
    <h2>Cook</h2>

    <div class="recipes-tabs">
      <button type="button" class="recipes-tab" :class="{ active: tab === 'recipes' }" @click="tab = 'recipes'">
        <BookOpen :size="16" />
        Recipe Box
      </button>
      <button
        type="button"
        class="recipes-tab"
        :class="{ active: tab === 'meal-library' }"
        @click="tab = 'meal-library'"
      >
        <UtensilsCrossed :size="16" />
        Meal Library
      </button>
    </div>

    <!-- Recipe box -->
    <section v-if="tab === 'recipes'" class="recipes-section">
      <AppButton variant="primary" @click="openAddRecipe">
        <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add a recipe
      </AppButton>

      <ul class="module-list recipe-list">
        <ListRow v-for="r in recipes" :key="r.id" deletable class="recipe-list-row" @delete="deleteRecipe(r.id)">
          <div class="recipe-row">
            <AssetImage v-if="r.photo_asset_id" :asset-id="r.photo_asset_id" class="recipe-thumb" />
            <div class="recipe-thumb recipe-thumb--placeholder" v-else>
              <ChefHat :size="22" />
            </div>
            <div class="recipe-row__body" @click="openEditRecipe(r)">
              <strong>{{ r.title }}</strong>
              <div class="recipe-row__meta">
                <AppTag v-if="r.servings"><Users :size="12" />{{ r.servings }} servings</AppTag>
                <AppTag v-if="r.prep_minutes"><Clock :size="12" />{{ r.prep_minutes }} min</AppTag>
                <AppTag>{{ r.ingredients?.length || 0 }} ingredients</AppTag>
              </div>
            </div>
            <button
              type="button"
              class="recipe-row__shop-btn"
              :class="{ 'recipe-row__shop-btn--added': r.in_shopping_list }"
              :disabled="shoppingActionRecipeId === r.id || !r.ingredients?.length"
              :aria-pressed="r.in_shopping_list"
              @click="toggleShoppingList(r)"
            >
              <Check v-if="r.in_shopping_list" :size="16" />
              <ShoppingCart v-else :size="16" />
              {{
                shoppingActionRecipeId === r.id
                  ? (r.in_shopping_list ? 'Removing…' : 'Adding…')
                  : r.in_shopping_list
                    ? 'Remove from shopping list'
                    : 'Add to shopping list'
              }}
            </button>
          </div>
        </ListRow>
      </ul>
      <EmptyState v-if="recipes.length === 0" illustration="recipes">No recipes yet. Add your first one!</EmptyState>
    </section>

    <!-- Meal library -->
    <section v-else class="recipes-section">
      <AddRow button-label="Add" @submit="addMealIdea">
        <FormField v-model="newMealTitle" placeholder="Meal idea (e.g. Taco night)…" />
        <select v-model="newMealRecipeId">
          <option value="">No linked recipe</option>
          <option v-for="r in recipes" :key="r.id" :value="r.id">{{ r.title }}</option>
        </select>
        <FormField v-model="newMealNotes" placeholder="Notes (optional)" />
      </AddRow>

      <ul class="module-list">
        <ListRow v-for="m in mealIdeas" :key="m.id" deletable @delete="deleteMealIdea(m.id)">
          <template v-if="editingMealId === m.id">
            <div class="meal-edit-form">
              <FormField v-model="editMealTitle" placeholder="Title" />
              <select v-model="editMealRecipeId">
                <option value="">No linked recipe</option>
                <option v-for="r in recipes" :key="r.id" :value="r.id">{{ r.title }}</option>
              </select>
              <FormField v-model="editMealNotes" placeholder="Notes (optional)" />
              <div class="meal-edit-actions">
                <AppButton variant="primary" @click="saveEditMeal">Save</AppButton>
                <AppButton variant="ghost" @click="cancelEditMeal">Cancel</AppButton>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="meal-row" @click="startEditMeal(m)">
              <div class="meal-row__icon-tile">
                <UtensilsCrossed :size="18" />
              </div>
              <div class="meal-row__body">
                <strong>{{ m.title }}</strong>
                <div class="meal-row__meta">
                  <AppTag v-if="m.recipe_title"><BookOpen :size="12" />{{ m.recipe_title }}</AppTag>
                  <span v-if="m.notes" class="meal-row__notes">{{ m.notes }}</span>
                </div>
              </div>
              <Pencil :size="15" class="meal-row__edit-hint" />
            </div>
          </template>
        </ListRow>
      </ul>
      <EmptyState v-if="mealIdeas.length === 0">
        No meal ideas yet. Add one above — it doesn't need a full recipe.
      </EmptyState>
    </section>

    <!-- Recipe add/edit modal -->
    <AppModal :open="showRecipeModal" :title="editingRecipeId ? 'Edit recipe' : 'Add a recipe'" @close="closeRecipeModal">
      <div class="recipe-form">
        <div class="recipe-photo-field">
          <AssetImage v-if="recipeForm.photo_asset_id" :asset-id="recipeForm.photo_asset_id" class="recipe-photo-preview" />
          <div class="recipe-photo-preview recipe-photo-preview--placeholder" v-else>
            <ChefHat :size="28" />
          </div>
          <div>
            <input
              ref="photoInputEl"
              type="file"
              accept="image/*"
              :disabled="photoUploading"
              @change="onPhotoChange"
            />
            <p v-if="photoUploading" class="recipe-form__hint">Uploading…</p>
          </div>
        </div>

        <FormField v-model="recipeForm.title" label="Title" placeholder="e.g. Weeknight Chili" required />

        <div class="recipe-form__row">
          <FormField v-model="recipeForm.servings" label="Servings" type="number" min="1" placeholder="4" />
          <FormField v-model="recipeForm.prep_minutes" label="Prep time (min)" type="number" min="0" placeholder="30" />
        </div>

        <div class="recipe-form__ingredients">
          <span class="form-field__label">Ingredients</span>
          <div v-for="(ing, i) in recipeForm.ingredients" :key="i" class="ingredient-row">
            <FormField v-model="ing.quantity" placeholder="Qty" />
            <FormField v-model="ing.unit" placeholder="Unit" />
            <FormField v-model="ing.name" placeholder="Ingredient" />
            <button
              type="button"
              class="ingredient-row__remove"
              aria-label="Remove ingredient"
              @click="removeIngredientRow(i)"
            >
              <X :size="16" />
            </button>
          </div>
          <AppButton variant="ghost" @click="addIngredientRow">
            <Plus :size="14" style="vertical-align: -2px; margin-right: 4px" />Add ingredient
          </AppButton>
        </div>

        <label class="form-field">
          <span class="form-field__label">Instructions</span>
          <textarea v-model="recipeForm.instructions" rows="5" placeholder="Step-by-step instructions…"></textarea>
        </label>

        <p v-if="recipeError" class="error">{{ recipeError }}</p>

        <div class="recipe-form__actions">
          <AppButton variant="primary" :disabled="recipeSaving" @click="saveRecipe()">
            {{ recipeSaving ? 'Saving…' : 'Save recipe' }}
          </AppButton>
          <AppButton variant="ghost" @click="closeRecipeModal">Cancel</AppButton>
        </div>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.recipes-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.recipes-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font: var(--type-label);
  padding: 8px 16px;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: 20px;
  background: var(--surface);
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, border-color 120ms ease;
}

.recipes-tab:hover {
  background: color-mix(in srgb, var(--text) 6%, transparent);
}

/* Active tab: background/color shift is reinforced by a solid border, so
   the state doesn't rely on color alone. */
.recipes-tab.active {
  background: var(--accent-container);
  color: var(--on-accent-container);
  border-color: var(--accent);
  font-weight: 700;
}

.recipes-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* .recipe-row's own width: 100% would force .list-row__main (its
   parent, a sibling of the trash-can button) to full row width too, leaving
   .list-row (flex-wrap: wrap) nowhere to put the trash can but a line of
   its own beneath the full-width "Add to shopping list" pill. Scoping
   .list-row__main to flex: 1 + min-width: 0 (same fix Goals/Todos use for
   this exact footgun) lets it share the row with the trash can
   instead of claiming all of it; the shop-list pill still wraps onto its
   own full-width line below the thumb+title+trash row, which is the
   intended mobile layout. */
.recipe-list-row :deep(.list-row__main) {
  flex: 1;
  min-width: 0;
}

.recipe-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  width: 100%;
}

.recipe-thumb {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  object-fit: cover;
  flex-shrink: 0;
}

.recipe-thumb--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--tile-recipe-start), var(--tile-recipe-end));
  color: var(--accent-contrast);
}

.recipe-row__body {
  flex: 1;
  min-width: 180px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.recipe-row__body strong {
  font: var(--type-title);
  color: var(--text);
}

.recipe-row__meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.recipe-row__meta :deep(.app-tag) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* Icon-only would fail the 44px touch-target minimum; this control always
   carries a text label (Add to shopping list / Adding… / Remove from
   shopping list / Removing…) so its comfortable padding is enough, and the
   toggled-on state changes shape, icon and text together rather than only
   recoloring. */
.recipe-row__shop-btn {
  flex: 1 1 100%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 44px;
  padding: 10px 16px;
  font: var(--type-label);
  border-radius: 20px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
}

@media (min-width: 480px) {
  .recipe-row__shop-btn {
    flex: 0 0 auto;
    justify-content: flex-start;
  }
}

.recipe-row__shop-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.recipe-row__shop-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.recipe-row__shop-btn--added {
  border-color: transparent;
  background: var(--accent-container);
  color: var(--on-accent-container);
  font-weight: 700;
}

.meal-row {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  width: 100%;
}

.meal-row__icon-tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--complement-mid), var(--complement));
  color: var(--accent-contrast);
}

.meal-row__body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meal-row__body strong {
  font: var(--type-title);
  color: var(--text);
}

.meal-row__meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.meal-row__meta :deep(.app-tag) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.meal-row__notes {
  color: var(--text-muted);
  font: var(--type-label);
}

.meal-row__edit-hint {
  flex: none;
  color: var(--text-muted);
}

.meal-edit-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

.meal-edit-actions {
  display: flex;
  gap: 8px;
}

.recipe-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.recipe-photo-field {
  display: flex;
  align-items: center;
  gap: 12px;
}

.recipe-photo-preview {
  width: 72px;
  height: 72px;
  border-radius: 16px;
  object-fit: cover;
  flex-shrink: 0;
}

.recipe-photo-preview--placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--tile-recipe-start), var(--tile-recipe-end));
  color: var(--accent-contrast);
}

.recipe-form__hint {
  color: var(--text-muted);
  font: var(--type-label);
  margin: 4px 0 0;
}

.recipe-form__row {
  display: flex;
  gap: 12px;
}

.recipe-form__row .form-field {
  flex: 1;
  min-width: 0;
}

.recipe-form__ingredients {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ingredient-row {
  display: grid;
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 0.8fr) minmax(0, 1.5fr) auto;
  gap: 6px;
  align-items: center;
}

.ingredient-row .form-field input {
  padding-left: 8px;
  padding-right: 8px;
}

/* Icon-only control: explicit 44x44 hit area with a negative margin so the
   visible glyph/hover circle can stay small while the tappable area still
   meets the WCAG 2.5.5/2.5.8 minimum. */
.ingredient-row__remove {
  width: 44px;
  height: 44px;
  margin: -10px -10px -10px -2px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 50%;
  color: var(--text-muted);
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.ingredient-row__remove:hover {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
}

.recipe-form textarea {
  font: var(--type-body);
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  resize: vertical;
}

.recipe-form__actions {
  display: flex;
  gap: 8px;
}
</style>
