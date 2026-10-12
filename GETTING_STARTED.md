# Getting Started with Yggltree

This guide walks you through installing Yggltree on your family's computer,
setting up the family relay, and adding everyone's phones. You don't need to
know how to program. A few steps ask you to type one short command, and the
exact text is always given.

**How it works:** Yggltree runs on one computer in your home, which we call
the **family computer**. Phones and tablets sync through the **family relay**,
a small free service on your own Cloudflare account. The relay only ever holds
your family's data in encrypted form, so phones sync from anywhere: at home, on
mobile data, or away. There are no family accounts, no subscription, and no
company server that can read your data.

> **Reading this on a phone?** Do sections 1 to 5 on your family computer
> first. Then come back to the phone for [section 6](#6-add-phones-and-tablets).

---

## Contents

1. [What you need](#1-what-you-need)
2. [Install on a Mac](#2-install-on-a-mac)
3. [Install on Windows](#3-install-on-windows)
4. [First-run setup](#4-first-run-setup)
5. [Set up the family relay](#5-set-up-the-family-relay)
6. [Add phones and tablets](#6-add-phones-and-tablets)
7. [Keeping it running](#7-keeping-it-running)
8. [Backups](#8-backups)
9. [If a phone is lost or stolen](#9-if-a-phone-is-lost-or-stolen)
10. [Restoring a backup](#10-restoring-a-backup)
11. [Updating Yggltree](#11-updating-family-hub)
12. [Troubleshooting](#12-troubleshooting)
13. [Security notes](#13-security-notes)

---

## 1. What you need

- **A Mac or Windows computer that stays at home.** This is your family
  computer. Yggltree runs on it, and it uploads its changes to the relay
  while it's running.
- **Internet access.** Phones reach the family relay over Wi-Fi or mobile data.
- **A free Cloudflare account**, for the family relay (section 5).
- **Node.js 22.12 or newer.** This is free software that Yggltree runs on.
  Sections 2 and 3 show how to install it.
- Phones and tablets need a current web browser: Safari on iPhone and iPad,
  Chrome on Android. There's no app store download.

---

## 2. Install on a Mac

**Step 1: Install Node.js.**

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version
   for macOS (the `.pkg` installer).
2. Open the downloaded file and click through the installer with the
   default options.

**Step 2: Download Yggltree.**

1. Go to [github.com/cored3sign/family-hub-local](https://github.com/cored3sign/family-hub-local).
2. Click the green **Code** button, then **Download ZIP**.
3. Open your **Downloads** folder. If the ZIP wasn't unzipped
   automatically, double-click it. You'll get a folder named something like
   `family-hub-local-main`.
4. Move that folder into your **Documents** folder.

**Step 3: Start Yggltree.**

1. Open the folder and double-click **Start Yggltree** (the file named
   `Start Yggltree.command`).
2. **The first time,** your Mac may refuse to open it because it was
   downloaded from the internet. If that happens:
   - Hold **Control** and click the file (or right-click it), choose
     **Open**, then click **Open** again.
   - On newer versions of macOS there may be no **Open** button. In that
     case, click **Done**. Then open **System Settings → Privacy &
     Security**, scroll down, and click **Open Anyway** next to the message
     about "Start Yggltree". Then double-click **Start Yggltree** again
     and choose **Open**.
3. A Terminal window opens. The very first start installs what Yggltree
   needs and builds the app. This takes a few minutes and needs the
   internet. Later starts are much faster.

**Prefer typing a command?** Open the **Terminal** app. Type `cd` followed by
a space, then drag your Yggltree folder onto the Terminal window and press
**Return**. Then type this and press **Return**:

```sh
npm start
```

When Yggltree is ready, the window shows something like this, and your web
browser opens Yggltree by itself:

```
Yggltree is running.
  On this computer:  http://localhost:8787
  Phones sync through the family relay: see Settings → Family relay.
  Data folder:       /Users/you/Library/Application Support/Family Hub
  Keep this window open. Press Ctrl+C or close it to stop Yggltree.
```

Continue with [section 4](#4-first-run-setup).

---

## 3. Install on Windows

**Step 1: Install Node.js.**

1. Go to [nodejs.org](https://nodejs.org) and download the **LTS** version
   for Windows (the `.msi` installer).
2. Run it and keep all the default options. You don't need the optional
   "Tools for Native Modules".

**Step 2: Download Yggltree.**

1. Go to [github.com/cored3sign/family-hub-local](https://github.com/cored3sign/family-hub-local).
2. Click the green **Code** button, then **Download ZIP**.
3. In your **Downloads** folder, right-click the ZIP and choose **Extract
   All…**, then **Extract**. You'll get a folder named something like
   `family-hub-local-main`. Move it somewhere permanent, such as
   **Documents**.
4. **Don't run Yggltree from inside the ZIP.** Windows lets you open a
   ZIP like a folder, but Yggltree won't work from there. Always use the
   extracted folder.

**Step 3: Start Yggltree.**

1. Open the extracted folder and double-click **Start Yggltree** (the
   file named `Start Yggltree.bat`).
2. If Windows shows **"Windows protected your PC"**, click **More info**,
   then **Run anyway**.
3. A black Command Prompt window opens. The very first start installs what
   Yggltree needs and builds the app. This takes a few minutes and needs
   the internet. Later starts are much faster.

**Prefer typing a command?** Open the extracted folder in File Explorer,
click the address bar at the top, type `cmd` and press **Enter**. In the
window that opens, type this and press **Enter**:

```sh
npm start
```

When Yggltree is ready, the window shows a summary like the Mac example
above, with **Data folder** under `C:\Users\you\AppData\Roaming\Family Hub`,
and your web browser opens Yggltree by itself.

---

## 4. First-run setup

Setup happens **only on the family computer**. Phones and tablets join later
(section 6).

Your browser opens **http://localhost:8787** and shows **Set up your family
hub**. If it didn't open, type that address into your browser yourself. Always
use **http://localhost:8787** on the family computer.

You have two choices:

- **Start fresh:** enter your **Family name** and **Your name**, then
  click **Create family**. You become the family's first admin.
- **Restore a backup:** if you already have a Yggltree backup file
  (a file ending in `.fhub.json`), click **Restore from a backup file
  instead**. Choose the file, type `REPLACE` in the box, and click
  **Restore**.

**Add your family members next.** Open the menu behind your picture in the
top corner, choose **Settings**, and add each person under **Family
members**. Each phone then picks who's using it from this list. There are
no passwords or email invites.

---

## 5. Set up the family relay

The relay is a small free service on your own Cloudflare account. It keeps your
family's data in encrypted form, so every phone can sync with the others.
Set it up once.

**Step 1: Create a free Cloudflare account** at [cloudflare.com](https://cloudflare.com),
and confirm your email address.

**Step 2: Deploy the relay.** Open the [relay setup guide](relay/README.md) and
click **Deploy to Cloudflare**. Follow Cloudflare's steps. When it's done,
Cloudflare shows the relay's address. It ends in `.workers.dev`. Keep it.

**Step 3: Connect the family computer.** In Yggltree on the family computer,
open **Settings → Family relay**, paste the address into **Relay address**, and
click **Start the family relay**. Yggltree then sends your family's data to
the relay, and the QR code for phones appears on the same screen.

The free plan's limits are in the [relay setup guide](relay/README.md#limits-on-the-free-plan).

---

## 6. Add phones and tablets

Each phone joins once. The family computer shows what it needs.

**On the family computer:** open **Settings → Family relay**. The QR code and
the family link are shown there. Only admins can see them.

**On the phone:**

1. Scan the QR code on the family computer with the phone's Camera app. It
   opens the family relay address in Safari (iPhone) or Chrome (Android).
2. **iPhone:** the page says **Step 1 of 2**. Tap **Share**, choose **Add to
   Home Screen**, and tap **Add**. **Android:** tap the **⋮** menu, then **Add to
   Home screen**.
3. Open **Yggltree** from its new icon, tap **Scan the family QR code**, allow
   the camera, and scan the code on the family computer again.
   - **iPhone:** this second scan is needed once. iPhone keeps the icon's data
     apart from Safari, and notifications only work from the icon.
   - To use Yggltree in Safari only, tap **Use in Safari instead** on the
     Step 1 page.

**Notifications (optional):** In the Home Screen app, open **Settings →
Notifications on this phone**, then tap **Turn on notifications**. On iPhone,
this only works from the Home Screen app. The notification says only that
something changed, and tapping it opens the app.

**Changes made with no connection** stay on the phone and sync the next time
it can reach the relay.

---

## 7. Keeping it running

- **Keep your Yggltree window open** while you use the family computer.
  Closing it, or pressing **Ctrl+C** in it, stops Yggltree on that computer.
  Phones keep syncing with each other through the relay, but the family
  computer's own changes only reach the relay while Yggltree runs.
- **Don't let the family computer sleep** while you want its changes to go out.
  - **Mac:** in **System Settings**, open **Energy** (or **Battery → Options**
    on a laptop). Turn on **Prevent automatic sleeping when the display is off**,
    or **Wake for network access**. The exact names vary between macOS versions.
  - **Windows:** **Settings → System → Power** (or **Power & battery**). Set
    **Sleep** to **Never** while plugged in.
- **Start it automatically when you log in (optional):**
  - **Mac:** open **System Settings → General → Login Items**. Under
    **Open at Login**, click **+** and choose `Start Yggltree.command` in
    your Yggltree folder.
  - **Windows:** press **Windows key + R**, type `shell:startup` and press
    **Enter**. Right-click the **Start Yggltree** file, choose **Create
    shortcut**, and move the shortcut into the folder that opened.

  Each time Yggltree starts, it also opens your browser.

Starting Yggltree twice is harmless. The second window says **Yggltree
is already running at http://localhost:8787** and opens the browser there.

---

## 8. Backups

Yggltree keeps your data in three kinds of places: on every device, in the
family computer's **data folder**, and in any backup files you make. Make
backups anyway.

- **Download a backup from the app:** an admin opens **Settings → Data
  export & import → Download full backup**. This saves one `.fhub.json` file
  with everything, photos included. Keep a copy somewhere safe, such as a USB
  stick or cloud drive.
- **Automatic daily backups:** while Yggltree runs, it saves a backup once
  a day if anything changed. It keeps the newest 14. They are in the
  `backups` folder inside the data folder, named like
  `family-hub-2026-10-08.fhub.json`.
- **Copy the whole data folder:** stop Yggltree first, then copy the folder
  somewhere safe. The **Data folder** line in your Yggltree window shows where
  it is. By default it's:
  - **Mac:** `~/Library/Application Support/Family Hub`. In Finder, choose
    **Go → Go to Folder…** and paste that path.
  - **Windows:** `%APPDATA%\Family Hub`. Paste that into File Explorer's
    address bar.

The data folder is kept separate from your Yggltree program folder, so
updating or re-downloading Yggltree never touches it.

---

## 9. If a phone is lost or stolen

Today you can't remove one phone from the family from the family computer. What
you can do:

If you can still reach the phone, open **Settings → Family relay** on it and
tap **Turn off the relay on this device**. Then it stops syncing and sending
notifications. Its copy of the family's data stays on it.

A lost phone keeps the family link it already has, so it can still read the
family's data and any new data it can reach through the relay. Removing one
phone for good needs a family key change, which Yggltree doesn't have yet.

---

## 10. Restoring a backup

Restoring replaces **all** of your family's data **on the family computer**
with the backup's contents.

- **Only on the family computer.** Other devices show **Restore from the
  family computer** instead of a restore button.
- An admin goes to **Settings → Data export & import → Restore from backup…**.
  Choose the `.fhub.json` file (an automatic one from the `backups` folder works
  too), type `REPLACE`, and click **Replace all data**.
- Close any other Yggltree tabs on the family computer first. If another tab
  or browser on the family computer was open, it shows **Not syncing** with
  "Your Yggltree was restored or reset. Reload this page." Reload it.
- **Phones that already joined keep their own copy.** A restore on the family
  computer hasn't been tested with phones on the relay yet, so check the phones
  after a restore.
- If you're setting up a new family computer, restore from the first-run setup
  page instead ([section 4](#4-first-run-setup)).

---

## 11. Updating Yggltree

1. **Stop Yggltree:** close its window, or press **Ctrl+C** in it.
2. **Get the new version:**
   - **If you downloaded a ZIP,** download a new one ([section 2](#2-install-on-a-mac)
     or [section 3](#3-install-on-windows), step 2). Replace your old Family
     Hub folder with the new one.
   - **If you used `git clone`,** run `git pull` in the folder.
3. **Start it again** the same way as before. The first start after an update
   installs and builds again, which takes a few minutes.

Your family's data lives in the data folder, not the program folder, so it
stays put. Phones keep their family and don't need to join again.

> If you set up automatic start ([section 7](#7-keeping-it-running)), point it
> at the new folder if its location changed.

---

## 12. Troubleshooting

| Problem | What to do |
| --- | --- |
| The window says **Yggltree needs Node.js 22.12 or newer** | Install the LTS version from [nodejs.org](https://nodejs.org) ([section 2](#2-install-on-a-mac) or [section 3](#3-install-on-windows)), then start Yggltree again. |
| The first start stops with **Installing failed** | Check the internet connection, then start Yggltree again. |
| The window says **Port 8787 is being used by another program** | Close the other program and start Yggltree again. Or start on another port, for example `npm start -- --port 8788`, then open `http://localhost:8788`. |
| The window says **Another program appears to be using Yggltree's data folder** | Usually left over after a crash. If Yggltree really isn't running, delete the `hub.lock` file the message names and start again. |
| The family computer shows **Yggltree isn't running** | Start Yggltree ([section 2](#2-install-on-a-mac) or [section 3](#3-install-on-windows)), then reload the page. |
| **Relay address** says it must start with `https://` | Paste the whole address Cloudflare gave you, starting with `https://`. |
| There's no QR code in **Settings → Family relay** | Only admins see it. Ask an admin to open the page on the family computer. |
| Scanning the QR code doesn't work | Make sure you allowed the camera when the phone asked. Or tap **Or paste the family link** and paste the link from the family computer. |
| The phone shows **Join your family** after you've joined | Scan the family QR code again from **Settings → Family relay**. |
| The phone shows **Not syncing** | Check the phone has a connection (Wi-Fi or mobile data). Open the icon again. If it still says **Not syncing**, scan the family QR code again. |
| A device shows **Your Yggltree was restored or reset. Reload this page.** | Reload the page on the family computer ([section 10](#10-restoring-a-backup)). |
| A notification never arrives | Turn notifications on from the Home Screen app ([section 6](#6-add-phones-and-tablets)). On iPhone, notifications only work from the Home Screen app. |

---

## 13. Security notes

- **The relay only ever sees encrypted data.** It can see when devices connect,
  but it can't read your family's data. The key to read it lives on your phones
  and computer, and in the family link.
- **The family link is a key.** Anyone with the link can join your family, so
  don't post a photo of the QR code or the link. Keep it private, like a house
  key.
- **Backups aren't encrypted.** A `.fhub.json` backup and the data folder hold
  your family's data in readable form. Keep them private.
- **Paired devices keep a full copy** of your family's data, including photos.
- **Admin is a convenience, not a password.** Only admins see the family relay
  settings. Lock the family computer when you step away from it.
