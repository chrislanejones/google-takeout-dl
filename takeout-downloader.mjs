/**
 * Google Takeout Auto-Downloader
 *
 * First run: Chrome opens, you log in to Google, then press Enter in the terminal.
 * Every run after that: already logged in, no manual steps needed.
 *
 * Usage:
 *   node takeout-downloader.mjs
 */

import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import pc from 'picocolors';
import fs from 'fs';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';

puppeteerExtra.use(StealthPlugin());

const DELAY_MS = 90_000; // 1.5 minutes between clicks
let takeoutUrl = '';
const PROFILE_DIR = path.join(os.homedir(), '.takeout-chrome-profile');
const DOWNLOAD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'export');
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
const MAX_CLICK_RETRIES = 3;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fmt(ms) { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; }
function ts() { return pc.dim(new Date().toLocaleTimeString()); }
function info(msg) { console.log(pc.cyan('  →') + ' ' + msg); }
function warn(msg) { console.log(pc.yellow('  ⚠') + ' ' + msg); }

function ask(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(pc.bold(prompt), answer => { rl.close(); resolve(answer.trim()); });
  });
}

function countExistingZips() {
  if (!fs.existsSync(DOWNLOAD_DIR)) return 0;
  return fs.readdirSync(DOWNLOAD_DIR).filter(f => f.match(/^takeout.*\.zip$/i)).length;
}

async function getDownloadHandles(page) {
  const handles = await page.$$('a, button');
  const withNums = (await Promise.all(handles.map(async h => {
    const { ariaLabel, text } = await h.evaluate(el => ({
      ariaLabel: el.getAttribute('aria-label') || '',
      text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' '),
    }));
    const combined = (ariaLabel + ' ' + text).toLowerCase();
    if (!combined.includes('download part')) return null;
    if (combined.includes('summary')) return null;
    const m = combined.match(/(\d+)/);
    return { handle: h, num: m ? parseInt(m[1], 10) : 0 };
  }))).filter(Boolean);
  withNums.sort((a, b) => a.num - b.num);
  return withNums.map(x => x.handle);
}

async function scrollToLoadAll(page) {
  info('Scrolling to load all buttons...');
  let lastHeight = 0;
  while (true) {
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    if (scrollHeight === lastHeight) break;
    lastHeight = scrollHeight;
    await page.evaluate(() => window.scrollBy(0, 800));
    await sleep(400);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
}

function reportMissingFiles() {
  if (!fs.existsSync(DOWNLOAD_DIR)) return;
  const files = fs.readdirSync(DOWNLOAD_DIR).filter(f => /^takeout.*\.zip$/i.test(f));
  const byExport = {};
  for (const f of files) {
    const m = f.match(/takeout-.*?-(\d+)-(\d+)\.zip/i);
    if (m) {
      const expN = parseInt(m[1], 10), partN = parseInt(m[2], 10);
      if (!byExport[expN]) byExport[expN] = [];
      byExport[expN].push(partN);
    }
  }
  const exportNums = Object.keys(byExport).map(Number).sort((a, b) => a - b);
  if (exportNums.length === 0) return;
  console.log('\n' + pc.bold('Downloaded files:'));
  for (const expN of exportNums) {
    const parts = byExport[expN].sort((a, b) => a - b);
    const min = parts[0], max = parts[parts.length - 1];
    const missing = [];
    for (let i = min; i <= max; i++) {
      if (!parts.includes(i)) missing.push(i);
    }
    if (missing.length) {
      console.log(pc.yellow(`  Export ${expN}: ${parts.length} parts (${min}–${max}), missing: [${missing.join(', ')}]`));
    } else {
      console.log(pc.green(`  Export ${expN}: ${parts.length} parts (${min}–${max}) ✓`));
    }
  }
  console.log('');
}

async function ensureOnTakeoutPage(page) {
  if (!page.url().includes('takeout.google.com/manage')) {
    warn(`Session expired — landed on: ${page.url()}`);
    await ask('Log back in to Google, then press Enter to continue... ');
    if (!page.url().includes('takeout.google.com/manage')) {
      info('Re-navigating to Takeout archive...');
      await page.goto(takeoutUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
    }
    await sleep(4000);
    return true;
  }
  return false;
}

async function ensureButtonsLoaded(page, index) {
  await ensureOnTakeoutPage(page);
  await scrollToLoadAll(page);
  let buttons = await getDownloadHandles(page);

  if (buttons.length === 0) {
    warn('No buttons found — reloading archive page...');
    await page.goto(takeoutUrl, { waitUntil: 'networkidle2', timeout: 60_000 });
    await ensureOnTakeoutPage(page);
    await sleep(4000);
    await scrollToLoadAll(page);
    buttons = await getDownloadHandles(page);
  }

  if (index >= buttons.length) {
    throw new Error(`button ${index + 1} not found (only ${buttons.length} on page after reload)`);
  }
  return buttons;
}

async function clickWithRetry(page, index, total) {
  for (let attempt = 1; attempt <= MAX_CLICK_RETRIES; attempt++) {
    const freshButtons = await ensureButtonsLoaded(page, index);
    const btn = freshButtons[index];
    const label = await btn.evaluate(el => (el.innerText || el.textContent).trim().replace(/\s+/g, ' '));

    try {
      await btn.scrollIntoView();
      await sleep(500);
      await btn.click();
      await sleep(3000);
      const recovered = await ensureOnTakeoutPage(page);
      if (recovered && attempt < MAX_CLICK_RETRIES) {
        info(`Session restored — retrying click (attempt ${attempt + 1}/${MAX_CLICK_RETRIES})...`);
        continue;
      }
      return label;
    } catch (err) {
      if (attempt === MAX_CLICK_RETRIES) throw err;
      warn(`Click attempt ${attempt}/${MAX_CLICK_RETRIES} failed: ${err.message} — retrying...`);
      await sleep(2000);
    }
  }
}

// ── Banner ───────────────────────────────────────────────────────────────────

console.log('');
console.log(pc.bold(pc.cyan('  Google Takeout Auto-Downloader')));
console.log(pc.dim(`  Downloads → ${DOWNLOAD_DIR}`));
console.log('');

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  takeoutUrl = await ask('  Paste your Takeout archive URL: ');
  if (!takeoutUrl) { console.error(pc.red('  No URL provided.')); process.exit(1); }
  console.log('');

  const firstRun = !fs.existsSync(PROFILE_DIR);
  if (firstRun) {
    info('First run — Chrome will open. Log in to Google, then come back here and press Enter.\n');
  } else {
    info(`Using saved profile: ${pc.dim(PROFILE_DIR)}\n`);
  }

  const browser = await puppeteerExtra.launch({
    headless: false,
    defaultViewport: null,
    executablePath: '/usr/bin/google-chrome-stable',
    userDataDir: PROFILE_DIR,
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOAD_DIR });

  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
  );

  if (firstRun) {
    await page.goto('https://accounts.google.com', { waitUntil: 'networkidle2', timeout: 60_000 });
    await ask('Press Enter once you are fully logged in to Google... ');
  }

  let buttons = [];
  let total = 0;

  while (total === 0) {
    info('Navigating to Takeout archive...');
    await page.goto(takeoutUrl, { waitUntil: 'networkidle2', timeout: 60_000 });

    if (!page.url().includes('takeout.google.com/manage')) {
      warn(`Landed on: ${page.url()}`);
      await ask('Not on the archive page — log in if needed, then press Enter... ');
    }

    info('Waiting for page to fully render...');
    await sleep(4000);

    await scrollToLoadAll(page);
    buttons = await getDownloadHandles(page);
    total = buttons.length;

    if (total === 0) {
      warn('No download buttons found on: ' + page.url());
      const newUrl = await ask('  Paste a different Takeout archive URL (or press Enter to retry same): ');
      if (newUrl) takeoutUrl = newUrl.trim();
    }
  }

  reportMissingFiles();

  // ── Resume prompt ──────────────────────────────────────────────────────────

  const existingZips = countExistingZips();
  let startIndex = 0;

  if (existingZips > 0) {
    console.log(`  Found ${pc.bold(existingZips)} zip(s) already in export/.`);
    const suggestion = Math.min(existingZips, total - 1);
    const answer = await ask(
      `  Resume from button #${suggestion + 1} of ${total}? (Enter to confirm, number to override, 1 to start over) `
    );
    if (answer === '') {
      startIndex = suggestion;
    } else {
      const parsed = parseInt(answer, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= total) {
        startIndex = parsed - 1;
      } else {
        warn('Invalid input — starting from the beginning.');
      }
    }
  } else {
    const answer = await ask(
      `  Found ${pc.bold(total)} download button(s). Start from #1? (Enter to confirm, or type a number) `
    );
    if (answer !== '') {
      const parsed = parseInt(answer, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= total) {
        startIndex = parsed - 1;
      }
    }
  }

  console.log('');
  console.log(pc.dim('  ' + '─'.repeat(56)));
  console.log(`  Starting at ${pc.bold('#' + (startIndex + 1))} of ${total} — one click every ${pc.bold(fmt(DELAY_MS))}`);
  console.log(pc.dim('  ' + '─'.repeat(56)));
  console.log('');

  let succeeded = 0;
  let failed = 0;

  for (let i = startIndex; i < total; i++) {
    try {
      const label = await clickWithRetry(page, i, total);
      succeeded++;
      console.log(`  ${ts()} ${pc.green('✓')} ${pc.bold(`${i + 1}/${total}`)} — ${label}`);
    } catch (err) {
      failed++;
      console.log(`  ${ts()} ${pc.red('✗')} ${pc.bold(`${i + 1}/${total}`)} — ${pc.red(err.message)}`);
    }

    if (i < total - 1) {
      const nextAt = new Date(Date.now() + DELAY_MS).toLocaleTimeString();
      console.log(pc.dim(`           next at ${nextAt} (${fmt(DELAY_MS)} wait)...`));
      await sleep(DELAY_MS);
    }
  }

  console.log('');
  console.log(pc.dim('  ' + '─'.repeat(56)));
  const attempted = total - startIndex;
  console.log(
    `  Done — ${pc.green(pc.bold(succeeded + ' triggered'))}, ` +
    (failed > 0 ? pc.red(pc.bold(failed + ' failed')) : pc.dim('0 failed')) +
    ` out of ${attempted} attempted.`
  );
  console.log(pc.dim('  ' + '─'.repeat(56)));
  console.log('');
})();
