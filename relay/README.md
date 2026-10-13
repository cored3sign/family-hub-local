# Family relay

The family relay is a small free service on your own Cloudflare account. Phones use it to
sync the family's data when they can't reach each other directly, on any network. It also
serves your Yggltree app.

What the relay can see: the encrypted data, and when devices connect. It can't read the data.
Each family's data is encrypted on the phones with a key that never leaves the phones.

## Set up (one time, for a family)

1. Create a free Cloudflare account at cloudflare.com and confirm your email address.
2. Click **Deploy to Cloudflare** below and follow the steps. It creates the relay on your
   account. Cloudflare then shows the relay's address, which ends in `.workers.dev`.
3. On the family computer, open Yggltree, go to **Settings → Family relay**, paste that
   address into **Relay address**, and click **Start the family relay**.
4. Each phone joins with the family QR code shown on that same screen. See
   GETTING_STARTED.md, section 6.

**Name your relay.** The name becomes the start of its address, so a relay named
`smith-family-relay` on an account whose subdomain is `smith` has the address
`smith-family-relay.smith.workers.dev`. Pick a name your family will recognise.
If the Deploy button doesn't ask for a name, deploy from the command line with
your own name instead (after `npx wrangler login`, if you haven't logged in yet):

    cd relay
    npm run build:app
    npx wrangler deploy --name smith-family-relay

A relay's name can't be changed once it's deployed. To rename it, deploy a new
relay and paste its address into **Settings → Family relay**. Then each phone scans
the new QR code.

Keep the address. You'll need it again if the browser's data on the family computer
is cleared, or after a restore (GETTING_STARTED.md, section 10).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cored3sign/yggltree/tree/main/relay)

The family link carries the family's key. Keep it private, like a house key. Anyone who has the
link can join your family.

## Limits on the free plan

- 100,000 requests a day, which a family won't come close to.
- 5 GB of storage for the whole account. Photos use most of it, so the relay keeps them in a
  separate place with a large free allowance.
- When a limit is reached, sync waits until the next day. Nothing is charged.

## For developers

    npm install                      # from the repository root, then here
    npm run build:app                # builds the app into public/
    npx wrangler dev --local         # runs the relay on your computer (needs .dev.vars)
    RELAY_EXTERNAL=1 node test/run.mjs

`.dev.vars` holds `TEST_DUMP_TOKEN` for the test suite. It is never committed, and a real
deployment doesn't have it, so the test route is off there.
