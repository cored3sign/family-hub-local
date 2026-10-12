import { describe, it, expect } from 'vitest'
import { newFamilyDoc } from '../testing'
import { listNotifications } from '../notifications'
import { listWishlist, saveWishlistItem, setWishlistPurchased, clearPurchasedWishlist, deleteWishlistItem } from './wishlist'

describe('wishlist', () => {
  it('requires a real assignee, notifies, purchases and clears', () => {
    const { doc, admin, kid } = newFamilyDoc()
    expect(() => saveWishlistItem(doc, admin, { title: 'Bike' })).toThrow('assigned_member_id is required')
    expect(() => saveWishlistItem(doc, admin, { title: 'Bike', assigned_member_id: 'ghost' })).toThrow('assigned_member_id must be a real member of this family')
    const bike = saveWishlistItem(doc, admin, { title: 'Bike', assigned_member_id: kid.id })
    const kite = saveWishlistItem(doc, admin, { title: 'Kite', assigned_member_id: kid.id, priority: 'someday' })
    expect(listWishlist(doc).find((i) => i.id === bike)).toMatchObject({ priority: 'soon', purchased: false })
    expect(listNotifications(doc, kid.id)).toHaveLength(2)
    setWishlistPurchased(doc, bike, true)
    expect(listWishlist(doc).map((i) => i.title)).toEqual(['Kite', 'Bike'])
    expect(clearPurchasedWishlist(doc)).toBe(1)
    deleteWishlistItem(doc, kite)
    expect(listWishlist(doc)).toEqual([])
  })
})
