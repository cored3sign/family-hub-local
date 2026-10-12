import { describe, it, expect } from 'vitest'
import { newFamilyDoc, forkDoc, syncDocs } from '../testing'
import { balanceOf, setBalance, membersWithBalances, listTransactions } from './funds'
import { listBudgets, createBudget, updateBudget, deleteBudget } from './budgets'

describe('funds', () => {
  it('balance is the sum of the transaction log; manual set records a delta', () => {
    const { doc, admin, kid } = newFamilyDoc()
    setBalance(doc, admin, kid.id, 12.5)
    setBalance(doc, admin, kid.id, 10)
    expect(balanceOf(doc, kid.id)).toBe(10)
    expect(listTransactions(doc, kid.id).map((t) => t.amount).sort()).toEqual([-2.5, 12.5])
    expect(membersWithBalances(doc).find((m) => m.id === kid.id).funds_balance).toBe(10)
    expect(() => setBalance(doc, kid, kid.id, 99)).toThrow('Only an admin can do that')
    expect(() => setBalance(doc, admin, kid.id, -1)).toThrow('funds_balance out of range')
  })

  it('concurrent manual adjustments both apply (no lost update)', () => {
    const { doc: a, admin, kid } = newFamilyDoc()
    const b = forkDoc(a)
    setBalance(a, admin, kid.id, 5)
    setBalance(b, admin, kid.id, 3)
    syncDocs(a, b)
    expect(balanceOf(a, kid.id)).toBe(8)
  })
})

describe('budgets', () => {
  it('admin CRUD with validation and append ordering', () => {
    const { doc, admin, kid } = newFamilyDoc()
    const rent = createBudget(doc, admin, { name: 'Rent', monthly_amount: '1200' })
    createBudget(doc, admin, { name: 'Food', monthly_amount: 400 })
    updateBudget(doc, admin, { id: rent, name: 'Rent', monthly_amount: 1250 })
    expect(listBudgets(doc).map((b) => [b.name, b.monthly_amount])).toEqual([['Rent', 1250], ['Food', 400]])
    expect(() => createBudget(doc, admin, { name: 'x', monthly_amount: 'abc' })).toThrow('monthly_amount is required')
    expect(() => createBudget(doc, kid, { name: 'x', monthly_amount: 1 })).toThrow('Only an admin can do that')
    deleteBudget(doc, admin, rent)
    expect(listBudgets(doc)).toHaveLength(1)
  })
})
