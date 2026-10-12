import { all, get, insert, patch, remove, removeWhere, blankToNull, requireText } from '../collection'
import { getMember } from '../members'
import { notify } from '../notifications'

const T = 'wishlist_items'

export function listWishlist(doc) {
  // Ordered by purchased (unpurchased first), then sort_order, then
  // creation time.
  return all(doc, T).sort((a, b) => Number(a.purchased) - Number(b.purchased) || a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

export function saveWishlistItem(doc, actor, input) {
  const title = requireText(input.title, 'title is required')
  const priority = blankToNull(input.priority) ?? 'soon'
  if (!input.assigned_member_id) throw new Error('assigned_member_id is required')
  const assignee = input.assigned_member_id
  if (!getMember(doc, assignee)) throw new Error('assigned_member_id must be a real member of this family')
  const message = `You were assigned a wishlist item: "${title}"`

  if (input.id) {
    const prev = get(doc, T, input.id)
    if (!prev) throw new Error('Wishlist item not found')
    doc.transact(() => {
      patch(doc, T, input.id, {
        title,
        priority,
        assigned_member_id: assignee,
        purchased: 'purchased' in input ? Boolean(input.purchased) : prev.purchased,
      })
      if (assignee !== prev.assigned_member_id) notify(doc, actor, { recipientId: assignee, type: 'wishlist_assigned', message, relatedId: input.id })
    })
    return input.id
  }
  let id
  doc.transact(() => {
    id = insert(doc, T, { title, priority, assigned_member_id: assignee, purchased: false, sort_order: 0 })
    notify(doc, actor, { recipientId: assignee, type: 'wishlist_assigned', message, relatedId: id })
  })
  return id
}

export function setWishlistPurchased(doc, id, purchased) {
  patch(doc, T, id, { purchased: Boolean(purchased) })
}

export function clearPurchasedWishlist(doc) {
  return removeWhere(doc, T, (i) => i.purchased)
}

export function deleteWishlistItem(doc, id) {
  remove(doc, T, id)
}
