<script setup>
// Funds: each member's balance, on its own page/route. Chore completion
// pays into the same balances. Tapping a card opens a drawer to edit and
// save that member's balance (setBalance).
import { ref, computed } from 'vue'
import { Coins, Wallet, Plus } from 'lucide-vue-next'
import { firstName } from '../lib/names'
import { useCoreStore } from '../stores/core'
import { useFamily, useLive } from '../data/vue'
import { membersWithBalances, setBalance } from '../data/modules/funds'
import { listBudgets, createBudget, updateBudget, deleteBudget } from '../data/modules/budgets'

const core = useCoreStore()
const { doc, actor } = useFamily()
// setBalance has no per-member ownership model -- it's a shared household
// ledger, same admin-only assumption as Settings' other family-wide
// fields -- so the edit affordance is gated the same way (core.isAdmin),
// matching the requireAdmin() check in the data layer. Without this, a
// member would see a working-looking edit drawer that the data layer
// would reject.
const canEdit = computed(() => core.isAdmin)

const members = useLive(membersWithBalances)

const showEditModal = ref(false)
const editingMember = ref(null)
const editingBalance = ref('')
const saving = ref(false)
const balanceError = ref('')

// Household budgets: family-wide MONTHLY budget categories, explicitly NOT
// tied to any individual member's balance above (a separate, family-wide
// planning concept). Same view-all/admin-edits-only gating as the balance
// cards (canEdit above), just a second section on this same page.
const budgetItems = useLive(listBudgets)
const totalMonthlyBudget = computed(() =>
  budgetItems.value.reduce((sum, b) => sum + Number(b.monthly_amount), 0)
)

const showBudgetModal = ref(false)
const budgetModalMode = ref('new') // 'new' | 'edit'
const editingBudgetId = ref(null)
const budgetName = ref('')
const budgetAmount = ref('')
const budgetSaving = ref(false)
const budgetError = ref('')

function openNewBudget() {
  if (!canEdit.value) return
  budgetModalMode.value = 'new'
  editingBudgetId.value = null
  budgetName.value = ''
  budgetAmount.value = ''
  budgetError.value = ''
  showBudgetModal.value = true
}

function openEditBudget(item) {
  if (!canEdit.value) return
  budgetModalMode.value = 'edit'
  editingBudgetId.value = item.id
  budgetName.value = item.name
  budgetAmount.value = Number(item.monthly_amount).toFixed(2)
  budgetError.value = ''
  showBudgetModal.value = true
}

function closeBudgetModal() {
  showBudgetModal.value = false
}

// A thrown validation/permission error (e.g. the data layer's requireAdmin
// check) is shown to the person, not just swallowed by resetting
// budgetSaving.
function saveBudget() {
  if (!budgetName.value.trim() || budgetSaving.value) return
  budgetSaving.value = true
  budgetError.value = ''
  try {
    const payload = { name: budgetName.value.trim(), monthly_amount: Number(budgetAmount.value) || 0 }
    if (budgetModalMode.value === 'edit') {
      updateBudget(doc, actor(), { id: editingBudgetId.value, ...payload })
    } else {
      createBudget(doc, actor(), payload)
    }
    showBudgetModal.value = false
  } catch (e) {
    budgetError.value = e.message
  } finally {
    budgetSaving.value = false
  }
}

function removeBudget(id) {
  deleteBudget(doc, actor(), id)
}

function openEdit(member) {
  if (!canEdit.value) return
  editingMember.value = member
  editingBalance.value = member.funds_balance.toFixed(2)
  balanceError.value = ''
  showEditModal.value = true
}

function closeEdit() {
  showEditModal.value = false
  editingMember.value = null
}

// Same as saveBudget above: a thrown error (e.g. the data layer's
// admin-only check) is shown to the person, not just swallowed by
// resetting `saving`.
function saveBalance() {
  if (!editingMember.value || saving.value) return
  saving.value = true
  balanceError.value = ''
  try {
    setBalance(doc, actor(), editingMember.value.id, Number(editingBalance.value) || 0)
    showEditModal.value = false
  } catch (e) {
    balanceError.value = e.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="module-page">
    <h2>Funds</h2>

    <p v-if="!canEdit" class="funds-readonly-note">Ask a family admin to update balances.</p>
    <ul class="balances">
      <li v-for="m in members" :key="m.id">
        <component
          :is="canEdit ? 'button' : 'div'"
          type="button"
          class="balance-card"
          :class="{ 'balance-card--readonly': !canEdit }"
          @click="canEdit && openEdit(m)"
        >
          <div class="balance-card__icon-tile">
            <Coins :size="20" />
          </div>
          <span class="balance-card__name">{{ firstName(m.name) }}</span>
          <AppTag class="balance-card__amount">${{ m.funds_balance.toFixed(2) }}</AppTag>
        </component>
      </li>
    </ul>

    <AppModal :open="showEditModal" :title="editingMember ? `${firstName(editingMember.name)}'s balance` : ''" @close="closeEdit">
      <div class="funds-form">
        <FormField v-model="editingBalance" label="$ balance" type="number" step="0.01" min="0" placeholder="0.00" />
        <p v-if="balanceError" class="error">{{ balanceError }}</p>
        <div class="funds-form__actions">
          <AppButton type="button" variant="primary" :disabled="saving" @click="saveBalance">
            {{ saving ? 'Saving…' : 'Save balance' }}
          </AppButton>
          <AppButton type="button" variant="ghost" @click="closeEdit">Cancel</AppButton>
        </div>
      </div>
    </AppModal>

    <h2 class="budgets-heading">Household budgets</h2>

    <p v-if="!canEdit" class="funds-readonly-note">Ask a family admin to add or change budget categories.</p>

    <AppButton v-if="canEdit" type="button" variant="primary" class="budget-new-btn" @click="openNewBudget">
      <Plus :size="16" style="vertical-align: -3px; margin-right: 4px" />Add budget category
    </AppButton>

    <EmptyState v-if="budgetItems.length === 0" illustration="funds">No budget categories yet.</EmptyState>
    <template v-else>
      <ul class="module-list budgets-list">
        <ListRow v-for="b in budgetItems" :key="b.id" :deletable="canEdit" class="budget-row" @delete="removeBudget(b.id)">
          <component
            :is="canEdit ? 'button' : 'div'"
            type="button"
            class="budget-row__body"
            :class="{ 'budget-row__body--readonly': !canEdit }"
            @click="canEdit && openEditBudget(b)"
          >
            <div class="balance-card__icon-tile">
              <Wallet :size="20" />
            </div>
            <span class="balance-card__name">{{ b.name }}</span>
            <AppTag class="balance-card__amount">${{ Number(b.monthly_amount).toFixed(2) }}/mo</AppTag>
          </component>
        </ListRow>
      </ul>

      <div v-if="budgetItems.length" class="budgets-total">
        <span>Total budgeted</span>
        <strong>${{ totalMonthlyBudget.toFixed(2) }}/mo</strong>
      </div>
    </template>

    <AppModal
      :open="showBudgetModal"
      :title="budgetModalMode === 'new' ? 'Add budget category' : 'Edit budget category'"
      @close="closeBudgetModal"
    >
      <div class="funds-form">
        <FormField v-model="budgetName" label="Category name" placeholder="e.g. Groceries" required />
        <FormField v-model="budgetAmount" label="$ per month" type="number" step="0.01" min="0" placeholder="0.00" />
        <p v-if="budgetError" class="error">{{ budgetError }}</p>
        <div class="funds-form__actions">
          <AppButton type="button" variant="primary" :disabled="budgetSaving || !budgetName.trim()" @click="saveBudget">
            {{ budgetSaving ? 'Saving…' : 'Save category' }}
          </AppButton>
          <AppButton type="button" variant="ghost" @click="closeBudgetModal">Cancel</AppButton>
        </div>
      </div>
    </AppModal>
  </div>
</template>

<style scoped>
.balances {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.balance-card {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface);
  border: none;
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  padding: 12px 14px;
  cursor: pointer;
  text-align: left;
  transition: box-shadow 120ms ease;
}

.balance-card:hover {
  box-shadow: var(--elevation-2);
}

.balance-card--readonly {
  cursor: default;
}

.balance-card--readonly:hover {
  box-shadow: var(--elevation-1);
}

.funds-readonly-note {
  color: var(--text-muted);
  font: var(--type-body);
  margin: 0 0 12px;
}

.balance-card__icon-tile {
  flex: none;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--accent-soft), var(--accent));
  color: var(--accent-contrast);
}

.balance-card__name {
  flex: 1;
  font: var(--type-title);
  color: var(--text);
}

.balance-card__amount {
  font-weight: 700;
}

.funds-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.funds-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.budgets-heading {
  margin-top: 28px;
}

.budget-new-btn {
  margin-bottom: 16px;
}

.budgets-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Same flex-basis footgun already documented/fixed for Goals/To-Do/Recipes/
   Library: .list-row__main has no explicit flex-basis, so a long budget
   category name would otherwise size the line-fitting pass to its own
   max-content width and push ListRow's trash-can button onto its own line. */
.budget-row :deep(.list-row__main) {
  flex: 1;
  min-width: 0;
  flex-wrap: nowrap;
}

/* Reuses .balance-card's own icon-tile/name/amount classes above so a budget
   row reads as the same visual language as the balance cards it sits below
   -- only the outer wrapper differs
   (ListRow's trash-can affordance for admins vs. balance-card's plain
   button/div toggle) since a budget row needs a delete control the balance
   cards never do. */
.budget-row__body {
  flex: 1;
  min-width: 0;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-align: left;
  color: inherit;
  font: inherit;
}

.budget-row__body--readonly {
  cursor: default;
}

.budgets-total {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  padding: 12px 14px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--elevation-1);
  font: var(--type-title);
  color: var(--text);
}
</style>
