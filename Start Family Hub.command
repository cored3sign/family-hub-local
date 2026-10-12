#!/bin/bash
# Double-click to start Family Hub on this Mac. Keep the window open while
# your family uses it; press Ctrl+C or close the window to stop it.
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "Family Hub needs Node.js 22.12 or newer. Download the LTS installer from https://nodejs.org, install it, then double-click Start Family Hub again."
  exit 1
fi
npm start
