import { all, get, insert, patch, remove, nextSortOrder, requireText } from '../collection'
import { requireAdmin } from '../members'

const T = 'budget_items'
const MAX_AMOUNT = 100000

function validAmount(value) {
  if (value === '' || value == null || Number.isNaN(Number(value))) throw new Error('monthly_amount is required')
  const amount = Number(value)
  if (amount < 0 || amount > MAX_AMOUNT) throw new Error('monthly_amount out of range')
  return amount
}

export function listBudgets(doc) {
  return all(doc, T).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export function createBudget(doc, actor, { name, monthly_amount }) {
  requireAdmin(doc, actor)
  const cleanName = requireText(name, 'name is required')
  const amount = validAmount(monthly_amount)
  return insert(doc, T, { name: cleanName, monthly_amount: amount, sort_order: nextSortOrder(doc, T) })
}

export function updateBudget(doc, actor, { id, name, monthly_amount }) {
  requireAdmin(doc, actor)
  const cleanName = requireText(name, 'name is required')
  const amount = validAmount(monthly_amount)
  if (!get(doc, T, id)) throw new Error('Budget item not found')
  patch(doc, T, id, { name: cleanName, monthly_amount: amount })
}

export function deleteBudget(doc, actor, id) {
  requireAdmin(doc, actor)
  remove(doc, T, id)
}
