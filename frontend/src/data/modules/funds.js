import { all, insert } from '../collection'
import { listMembers, getMember, requireAdmin } from '../members'

// A balance is not stored as a mutable number: chore payouts incrementing
// it and the Funds page overwriting it would lose a write when two devices
// do that concurrently. There is no balance field at all: a balance is the
// sum of an append-only transaction log, which merges safely.
const TX = 'fund_transactions'
const MAX_BALANCE = 100000

const cents = (n) => Math.round(n * 100) / 100

export function balances(doc) {
  const totals = new Map()
  for (const tx of all(doc, TX)) totals.set(tx.member_id, (totals.get(tx.member_id) ?? 0) + Number(tx.amount))
  for (const [id, total] of totals) totals.set(id, cents(total))
  return totals
}

export function balanceOf(doc, memberId) {
  return balances(doc).get(memberId) ?? 0
}

export function membersWithBalances(doc) {
  const totals = balances(doc)
  return listMembers(doc).map((m) => ({
    id: m.id,
    name: m.name,
    avatar_color: m.avatar_color,
    avatar_asset_id: m.avatar_asset_id,
    funds_balance: totals.get(m.id) ?? 0,
  }))
}

export function listTransactions(doc, memberId = null) {
  return all(doc, TX)
    .filter((tx) => memberId === null || tx.member_id === memberId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function recordTransaction(doc, { memberId, amount, reason, choreId = null, actorId = null }, id) {
  return insert(doc, TX, { member_id: memberId, amount: cents(amount), reason, chore_id: choreId, created_by_member_id: actorId }, id)
}

// The Funds page's "set balance to X" becomes a delta transaction, exactly
// and is logged as a transaction. Two concurrent adjustments both apply
// (sum of deltas) rather than one silently winning.
export function setBalance(doc, actor, memberId, target) {
  requireAdmin(doc, actor)
  if (!getMember(doc, memberId)) throw new Error('Member not found')
  if (target === '' || target == null || Number.isNaN(Number(target))) throw new Error('funds_balance is required')
  const value = Number(target)
  if (value < 0 || value > MAX_BALANCE) throw new Error('funds_balance out of range')
  const delta = cents(value - balanceOf(doc, memberId))
  if (Math.abs(delta) > 0.0001) recordTransaction(doc, { memberId, amount: delta, reason: 'Manual adjustment', actorId: actor.id })
}
