import { onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'

// Pages mark each row with data-item-id. A link such as /todos?item=<id> (a notification's target, or a phone's
// notification tap) asks the page to show that row: it scrolls into view and flashes once, so the person can see
// what changed without hunting for it.
export function highlightItem(id) {
  if (!id) return
  const row = document.querySelector(`[data-item-id="${CSS.escape(String(id))}"]`)
  if (!row) return
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  row.classList.add('item-highlight')
  setTimeout(() => row.classList.remove('item-highlight'), 2400)
}

// Call once from a page's setup. A timeout (rather than nextTick) lets the page finish any tab switch first.
export function useItemHighlight() {
  const route = useRoute()
  onMounted(() => setTimeout(() => highlightItem(route.query.item), 0))
  watch(
    () => route.query.item,
    (id) => setTimeout(() => highlightItem(id), 0),
  )
}
