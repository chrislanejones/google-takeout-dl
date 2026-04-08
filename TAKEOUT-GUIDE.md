# Google Takeout Auto-Downloader Guide

Google Takeout gives you 100+ download buttons and a page that times out. This script clicks them automatically, one every 1.5 minutes.

---

## Setup

```bash
pnpm install
```

---

## Getting Your Session Cookies from Chrome DevTools

You need to grab your session cookies from Chrome so the script can log in as you without a browser prompt.

### Step 1 — Open the Takeout archive page

In Chrome on Windows, navigate to your Takeout archive link, e.g.:

```
https://takeout.google.com/manage/archive/bc186e02-b504-4aa5-b1cb-d12bb5f127f7
```

Make sure you are logged in to your Google account.

### Step 2 — Open DevTools and go to the Network tab

Press **F12** to open DevTools, then click the **Network** tab.

### Step 3 — Reload and find the right request

Press **F5** to reload the page while the Network tab is open.

At the top of the Network panel there is a row of filter buttons:

> **All &nbsp;&nbsp; Fetch/XHR &nbsp;&nbsp; Doc &nbsp;&nbsp; CSS &nbsp;&nbsp; JS &nbsp;&nbsp; Font &nbsp;&nbsp; Img &nbsp;&nbsp; Media &nbsp;&nbsp; Manifest &nbsp;&nbsp; Socket &nbsp;&nbsp; Wasm &nbsp;&nbsp; Other**

Click **All** (the first one) so nothing is filtered out, then type `takeout` in the search box to narrow it down.

Click the request that matches your archive URL (e.g. `/manage/archive/bc186e02...`).

### Step 4 — Find the cookie header

In the right panel:
1. Click the **Headers** tab
2. Scroll down to **Request Headers**
3. Find the line that starts with **`cookie:`**
4. Click on it to expand/highlight the full value

### Step 6 — Copy the cookie value

Right-click the `cookie:` line → **Copy value**.

You'll get a long string like:
```
SID=g.a000...; __Secure-1PSID=g.a000...; HSID=A...; SSID=A...; ...
```

### Step 7 — Save to cookies.txt

Paste that entire string into a file called `cookies.txt` in this folder. It should be one long line with no line breaks.

---

## Running the Script

```bash
node takeout-downloader.mjs --cookies cookies.txt
```

The script will:
- Load your cookies and navigate directly to the archive page (no login prompt)
- Find all download buttons on the page
- Click one every **1.5 minutes**
- Print a timestamped line for each download

### Example output

```
Loaded 24 cookies from cookies.txt

Navigating to Google Takeout archive page...
Found 107 download button(s). Clicking one every 1m 30s.

============================================================
[10:32:01] ✓ 1/107 — "Download"
           Next download at 10:33:31 (1m 30s wait)...
[10:33:31] ✓ 2/107 — "Download"
           Next download at 10:35:01 (1m 30s wait)...
...
============================================================

Done! 107 triggered, 0 failed out of 107 total.
```

---

## Other Ways to Run

**Manual login** (no cookies needed — just log in when the browser opens):
```bash
node takeout-downloader.mjs
```

**Reuse your installed Chrome profile** (Linux only):
```bash
node takeout-downloader.mjs --profile
```

---

## Notes

- **Cookies expire** — if the script hits the login page, grab fresh cookies from DevTools and overwrite `cookies.txt`
- Downloads go to your browser's default download folder (on Windows, usually `C:\Users\<you>\Downloads`)
- Don't close the browser while the script is running
- The 1.5 minute delay is intentional — hitting all buttons at once can cause Google to throttle or fail requests
