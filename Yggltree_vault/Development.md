---
title: Development
tags: [development, testing, frontend, hub]
updated: 2026-10-08
---

# Development

How to run, test, build, and extend Yggltree (v2). For what the
code is doing conceptually, see [[Architecture]] and [[Data-Model]].

## Running

Node.js **22.12 or newer** is required (Vite 8 needs it, and the tests use
Node's global `WebSocket`). The repo is an npm workspace (`frontend`,
`hub`) with one root `package-lock.json`; always install from the root.

**As a family would (one command):**

```sh
npm start
```

`scripts/start.cjs` checks the Node version, runs `npm ci` if
`node_modules` is missing or older than the lockfile, rebuilds
`frontend/dist` if any frontend source changed (it keeps a
`frontend/dist/.source-stamp`), then runs the hub on port 8787 and opens
`http://localhost:8787`. Extra flags pass through to `hub/src/cli.js`:

```sh
npm start -- --port 8788 --data /tmp/fh-test --no-open
```

| Flag | Meaning |
| --- | --- |
| `--port <n>` | listen port (default 8787; `0` picks a free one) |
| `--data <dir>` | data folder (else `FAMILY_HUB_DATA`, else the platform default) |
| `--dist <dir>` | built frontend (default `frontend/dist`) |
| `--no-open` | don't open a browser (also `FAMILY_HUB_NO_OPEN=1`) |

`npm run hub` runs the hub directly, without the install/build steps.

**For frontend development (hot reload):** two terminals at the repo root.

```sh
npm install
npm run dev:hub          # hub on 8787, data in .hub-dev/, no browser
npm run dev -w frontend  # Vite on 5173, proxies /api and /sync to 8787
```

Open `http://localhost:5173`. A loopback hostname makes the page the hub
machine, and the Vite proxy keeps the browser's `Host` header so the hub's
admin guard still accepts it. Requests that reach Vite from another
machine (`vite --host`) are tagged with `X-Forwarded-For`, so the hub
refuses them admin access, the same as through any other proxy. To test a
phone against the dev setup, join it to the family relay the way a real phone
does (`relay/README.md`).
`.hub-dev/` is git-ignored.

## Testing

```sh
npm test                 # both workspaces
npm test -w frontend     # frontend only
npm test -w hub          # hub only
```

Both run `vitest run` in the `node` environment.

**Frontend** (`frontend/src/**/*.test.js`): mostly `src/data/**`, pure JS
over Yjs docs with no DOM, plus the pure helpers behind the sync UI
(`lib/guard.js`, `lib/devices.js`, `lib/syncIndicator.js`,
`stores/sync.js`, ...). IndexedDB is stubbed via `fake-indexeddb/auto`, so
persistence round-trips (`family.test.js`) and the wipe tests run without
a real browser. `data/sync/connection.test.js` is an integration test: it
starts a real in-process hub and connects simulated devices to it.

Most test files pair one-to-one with a data file
(`collection.test.js`, `schema.test.js`, `modules/chores.test.js`, ...).
`src/data/testing.js` has the shared helpers:

- `forkDoc(doc)` — clones a doc's current state into a new independent
  `Y.Doc`, simulating a second device starting from the same point.
- `syncDocs(a, b)` — a hand-rolled two-way update exchange, so data-module
  tests can assert on what two devices see after they "sync" without a
  hub.
- `newFamilyDoc()` — a ready-made family (`Test Family`, admin `Pat
  Parent`, a second member `Kit Kid`) for tests that don't care about setup
  itself.

Concurrent-edit behavior is tested directly with this pair: a test forks a
doc, makes conflicting or complementary edits on each fork, calls
`syncDocs()`, and asserts both sides converge to the expected merged state.

**Hub** (`hub/test/*.test.js`): the admin guard, persistence (including
torn-log recovery), `hub.json` and the lock, static serving, sync auth and close codes,
restore, backups, the CLI and `scripts/start.cjs`. Integration tests start
an in-process hub with
`startHub({ port: 0, host: '127.0.0.1', dataDir: <tmp> })` (see
`hub/test/helpers.js`).

> **Every test `WebsocketProvider` must set `disableBc: true`.**
> Otherwise y-websocket's BroadcastChannel (a global in Node) syncs
> same-process "devices" with each other *without* the hub, and a test of
> a broken hub passes anyway. `hub/test/helpers.js` and the frontend's
> `connectFamily(..., { disableBc: true })` calls in tests do this; the
> app itself leaves it off.

## Building

```sh
npm run build            # = npm run build -w frontend
```

Standard Vite production build into `frontend/dist`, which the hub
serves. `npm start` rebuilds automatically when sources change.
`npm run preview -w frontend` serves a build on its own, without the hub
(so with no sync).

## How to add a module

Follow the same two patterns every existing module already uses:

**1. The data module** (`src/data/modules/<name>.js`) — plain functions
over `collection.js`'s helpers, one file per module:

- List functions (`listThings(doc)`) read with `all()`/`get()`, sort, and
  return plain objects.
- Write functions (`saveThing(doc, actor, input)`) validate input first
  (throwing `Error` with a user-facing message), then call
  `insert()`/`patch()`/`remove()`, wrapping multi-record writes in
  `doc.transact()`.
- If two devices could cause the same side effect concurrently, give it a
  deterministic id (see [[Data-Model#The CRDT rules (from the spec's Global
  Constraints)]]).
- Write `src/data/modules/<name>.test.js` alongside it, following an
  existing module's test file as a template — cover the validation errors,
  a concurrent-edit scenario via `forkDoc`/`syncDocs` if the module has any
  multi-field records, and a persistence-shaped happy path.

**2. The page** (`src/views/<Name>Page.vue`) — follow the same pattern:

```js
// Before (legacy, do not write new code like this):
import { api } from '../lib/api'
const items = ref([])
async function load() { items.value = await api.thingList() }
onMounted(load)

// After:
import { useFamily, useLive } from '../data/vue'
import { listThings, saveThing } from '../data/modules/things'
const { doc, actor } = useFamily()
const items = useLive(listThings)   // re-evaluates after every Yjs transaction
function save(input) { saveThing(doc, actor(), input) }
```

Rules that keep a new page consistent with the rest of the app:

1. No `load()`/`onMounted(load)` — `useLive()` keeps the list current.
2. No `loading` ref or `v-if="loading"` branch — local reads are
   synchronous.
3. Keep existing `try/catch` around write calls; data functions throw
   plain `Error`s with display-ready messages.
4. A list bound to `vuedraggable` needs a writable local copy
   (`watch(live, (v) => { local.value = v.map(x => ({...x})) }, { immediate: true })`);
   call the module's reorder function on drag end.
5. Images go through `assetUrl(id)` from `data/assets.js`, never a URL
   field.
6. After converting a page: `grep -n "lib/api\|api\." src/views/<Page>.vue`
   must print nothing, `npm run build` must succeed, and `npm test` must
   pass.
7. Register the module in `src/addons/registry.js` (route, lazy
   `component()` import, icon) so it appears in the nav and the `/modules`
   catalog.

## Id rules

**Ids are UUID strings end to end** (`crypto.randomUUID()`, from
`data/ids.js`). This is a correctness rule, not a style preference: Vue's
`v-model.number`, bare `Number()`, and `parseInt()` all turn a UUID that
happens to start with digits (e.g. `"3f2a..."`) into a small integer,
silently corrupting the id. When touching a page:

- Never bind an id with `v-model.number` or a `<select>`'s numeric
  coercion.
- Never wrap an id or an id route param in `Number(...)` or `parseInt(...)`.
- `grep -rn "v-model.number" src/views src/components` — for every hit,
  confirm the bound value is a quantity (servings, quantity, reward
  amount), never an id.

Booleans are real booleans end to end too — `true`/`false`, never `0`/`1`
or `"1"`. Replace any `=== 1`/`== 1`/`!!Number(x)` check left over from the
PHP/SQLite era with plain truthiness when you touch that line.

## Browser checks

Automated tests cover the data layer, the hub and the sync logic. Checks in a
real browser (layout, the install flow on phones, the join screens) are done
by hand for now. There is no committed end-to-end script yet.

## Related notes

- [[Architecture]] — the system this code implements
- [[Data-Model]] — the CRDT rules every data module follows
- [[Roadmap-and-Known-Issues]] — what's left, including testing gaps
