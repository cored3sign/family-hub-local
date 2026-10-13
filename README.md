<p align="center"><img src="docs/img/yggltree-logo.svg" width="480" alt="Yggltree" /></p>

# Yggltree

Product page: https://cored3sign.github.io/yggltree/

Yggltree is a free, open-source family organizer you run yourself. Your family's
calendar, lists and chores live on **your family's own computer and phones**, with
no company in the middle.

## Why Yggltree

Most family apps run on someone else's cloud, in a format only they can use, and
they're paid for with a subscription or with your data. Yggltree is built the
other way round:

- **Your data, your control.** It lives on your family's computer and phones.
  Back it up, open the folder, and take it with you.
- **Nobody in the middle.** No account with us, no ads, no tracking, nothing
  sold. We run no servers, so we never see your data.
- **Room for what matters.** A calendar, a shopping list and a chore chart should
  help a family spend time together, not become another feed.
- **Software you own.** Free and open source under the MIT License. Read it,
  change it, and share it.

## Who touches your data

- **Your devices:** everything.
- **Your relay, on your own Cloudflare account:** scrambled copies only, and it
  sees when devices connect. Cloudflare hosts it but can't read the content.
- **Phone push services** (Apple, Google, Mozilla, Microsoft): an encrypted
  "something changed" ping, with no content.
- **Open Library**, only if you look up a book by its ISBN: the ISBN is sent, and
  the cover loads from it.
- **The Yggltree maintainers:** nothing. There are no servers and no analytics.

Phones join by **scanning a QR code**, and they sync from anywhere. There's no
family account to create and no subscription.

> **On a phone right now?** Set up Yggltree on your family computer first,
> then set up the family relay. The full walkthrough is in
> [`GETTING_STARTED.md`](GETTING_STARTED.md).

## What's in it

Shared calendar, to-dos, shopping lists, chores and allowance funds, meal
planning and recipes, goals, wishlists, family messages and check-ins, a
book library, and a family binder. It all lives in one app that works
offline and syncs when it can.

## Quick start

You need a Mac or Windows computer that stays at home, a free
[Cloudflare](https://cloudflare.com) account for the family relay, and
[Node.js](https://nodejs.org) **22.12 or newer** (install the LTS version).

1. **Install Node.js** from [nodejs.org](https://nodejs.org) (the LTS
   installer).
2. **Get Yggltree:** on GitHub, click **Code → Download ZIP** and unzip it.
   Or clone it:

   ```sh
   git clone https://github.com/cored3sign/yggltree.git
   ```
3. **Start it:** double-click **Start Yggltree** in the folder
   (`Start Yggltree.command` on a Mac, `Start Yggltree.bat` on
   Windows), or run this in the folder:

   ```sh
   npm start
   ```

   The first start installs and builds the app, which takes a few minutes.
   Keep the window open while your family uses Yggltree.
4. **Open [http://localhost:8787](http://localhost:8787)** on that computer
   (it usually opens by itself) and set up your family.
5. **Set up the family relay:** in **Settings → Family relay**, connect your
   Cloudflare account and name your relay. Yggltree creates it on your account.
   [`relay/README.md`](relay/README.md) explains the steps.
6. **Add phones:** on each phone, open the relay address, add it to the Home
   Screen, and scan the family QR code shown in **Settings → Family relay**.

Your family's data is stored in a data folder outside the program folder
(on a Mac, `~/Library/Application Support/Yggltree`; on Windows,
`%APPDATA%\Yggltree`), so updating Yggltree never touches it. The first time you start Yggltree, it moves an existing data folder from its old "Family Hub" name, so your data comes with you.

**➡️ See [`GETTING_STARTED.md`](GETTING_STARTED.md)** for the step-by-step
guide: installing on Mac and Windows, the family relay, adding phones, keeping
it running, backups, and troubleshooting.

## How it works

Each device keeps a full copy of the family's data in its browser and edits
it locally, so nothing waits on the network. Devices merge their changes using
[Yjs](https://docs.yjs.dev/) CRDTs.

- **The family relay** is a small service on your own Cloudflare account. It
  holds your family's data encrypted, so phones sync with each other from
  anywhere. The relay can't read the data. See [`relay/README.md`](relay/README.md).
- **The family computer** runs a small local server (one Node.js process) that
  serves the app and keeps the family's data on that computer. It listens on
  this computer only.
- Phones join with a QR code from **Settings → Family relay**. No passwords.
- Phones open the app over HTTPS from the relay, so they open without a
  connection once they've been opened. Changes made without a connection sync
  when the phone reaches the relay again.
- The family computer keeps automatic daily backups, and admins can download a
  full backup any time.

Developer and design notes live in the [`Yggltree_vault/`](Yggltree_vault/Home.md)
folder, an Obsidian vault that also reads fine on GitHub.

## Roadmap

- **A hub on a cloud account you control**, for families without an always-on
  computer.
- **Removing one lost phone** from the family, which needs a family key change.
- **A desktop app wrapper** (Tauri or Electron), so the hub runs without a
  terminal window.
- **Store apps for phones** (Capacitor), for a full offline app that works
  away from home.

See [`Yggltree_vault/Roadmap-and-Known-Issues.md`](Yggltree_vault/Roadmap-and-Known-Issues.md)
for details and known limits.

## License

MIT. See [LICENSE](LICENSE).

## License and names

Yggltree is free software released under the [MIT License](LICENSE).
Copyright (c) 2026 Yggltree contributors.

The software is provided "as is", without warranty of any kind. See the license for the full terms.

"Yggltree" and the Yggltree logo are the names of this project. The MIT License covers the code and documentation; it does not give rights to the names or the logo. If you fork or redistribute Yggltree, please use a different name and logo for your version.

The typeface on the product page, Inter, is licensed under the SIL Open Font License; see [docs/fonts/OFL-inter.txt](docs/fonts/OFL-inter.txt).
