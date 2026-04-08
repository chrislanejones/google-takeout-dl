# Google Takeout Auto-Downloader

Google Takeout can produce 100+ download buttons for a single export. This script automates clicking them, one every 1.5 minutes, so you don't have to babysit the page for hours.

## How it works

- Opens Chrome with a persistent profile so you only log in once
- Navigates to your Takeout archive page
- Scrolls to load all download buttons, then clicks them in order
- Saves files to an `export/` folder in the project directory
- Recovers from session timeouts and page reloads automatically
- On subsequent runs, prompts you to resume where you left off

## Requirements

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/)
- `google-chrome-stable` installed at `/usr/bin/google-chrome-stable` (Linux)

## Setup

```bash
git clone <this-repo>
cd google-photos
pnpm install
```

Open `takeout-downloader.mjs` and set `TAKEOUT_URL` to your Takeout archive link:

```js
const TAKEOUT_URL = 'https://takeout.google.com/manage/archive/YOUR-ARCHIVE-ID';
```

You can find this URL by going to [takeout.google.com](https://takeout.google.com), navigating to an existing export, and copying the URL from the address bar.

## Usage

```bash
node takeout-downloader.mjs
```

**First run:** Chrome opens and navigates to Google's login page. Sign in, then switch back to the terminal and press Enter. Your session is saved to `~/.takeout-chrome-profile` and reused on every subsequent run.

**Subsequent runs:** Chrome opens, goes straight to the archive, and starts downloading. You'll be prompted to confirm the starting button (useful for resuming after an interruption).

### Example output

```
  Google Takeout Auto-Downloader
  Downloads → /home/you/google-photos/export

  → Using saved profile: ~/.takeout-chrome-profile
  → Navigating to Takeout archive...
  → Scrolling to load all buttons...

  Export 1: 107 parts (1–107) ✓

  Found 23 zip(s) already in export/.
  Resume from button #24 of 107? (Enter to confirm, number to override, 1 to start over)

  ────────────────────────────────────────────────────────
  Starting at #24 of 107 — one click every 1m 30s
  ────────────────────────────────────────────────────────

  10:32:01 ✓ 24/107 — Download part 24 of 107
             next at 10:33:31 (1m 30s wait)...
  10:33:31 ✓ 25/107 — Download part 25 of 107
  ...

  ────────────────────────────────────────────────────────
  Done — 84 triggered, 0 failed out of 84 attempted.
  ────────────────────────────────────────────────────────
```

## Notes

- Don't close Chrome while the script is running
- If the script hits a login page mid-run, it will pause and ask you to log back in
- The 1.5-minute delay between clicks is intentional — triggering all downloads at once can cause Google to throttle or silently drop requests
- Downloaded files land in `export/` inside the project directory; the folder is created automatically
