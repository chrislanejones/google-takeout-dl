/**
 * Google Takeout Auto-Downloader (Rapid Fire Edition)
 *
 * Clicks one button every minute regardless of download progress.
 * Google queues them server-side, so you can trigger them all at once.
 *
 * Usage: node takeout-downloader.mjs
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

const CLICK_INTERVAL = 60_000; // 1 minute between clicks
const MAX_RETRIES = 3;

const PROFILE_DIR = path.join(os.homedir(), '.takeout-chrome-profile');
const DOWNLOAD_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'export'
);
fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomSleep = (min, max) =>
  sleep(Math.floor(Math.random() * (max - min + 1) + min));
const fmtTime = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};
const ts = () => pc.dim(new Date().toLocaleTimeString());
const info = (m) => console.log(pc.cyan('  →') + ' ' + m);
const warn = (m) => console.log(pc.yellow('  ⚠') + ' ' + m);
const err = (m) => console.log(pc.red('  ✗') + ' ' + m);

function ask(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(pc.bold(prompt), (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getCompletedZipFiles() {
  if (!fs.existsSync(DOWNLOAD_DIR)) return [];
  return fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((f) => /^takeout.*\.zip$/i.test(f) && !f.endsWith('.crdownload'))
    .sort();
}

function getInProgressFiles() {
  if (!fs.existsSync(DOWNLOAD_DIR)) return [];
  return fs
    .readdirSync(DOWNLOAD_DIR)
    .filter((f) => f.endsWith('.crdownload'))
    .sort();
}

async function applyDownloadDir(client) {
  try {
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: DOWNLOAD_DIR,
    });
  } catch (e) {
    warn(`Failed to apply download dir: ${e.message}`);
  }
}

async function ensureOnPage(page, takeoutUrl) {
  const currentUrl = page.url();
  if (currentUrl.includes('takeout.google.com/manage')) return false;

  warn(`⚠️  SESSION EXPIRED OR PASSWORD REQUIRED`);
  warn(`You were redirected to: ${currentUrl}`);
  await ask('Complete the login/password prompt in Chrome, then press Enter… ');

  const newUrl = page.url();
  if (!newUrl.includes('takeout.google.com/manage')) {
    info('Re-navigating to Takeout archive…');
    try {
      await page.goto(takeoutUrl, {
        waitUntil: 'networkidle2',
        timeout: 60_000,
      });
    } catch (e) {
      warn(`Navigation failed: ${e.message}`);
    }
  }

  await sleep(4000);
  return true;
}

async function scrollToLoadAll(page) {
  let prev = 0;
  let attempts = 0;

  while (attempts < 50) {
    const h = await page
      .evaluate(() => document.body.scrollHeight)
      .catch(() => prev);
    if (h === prev) break;
    prev = h;
    await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
    await randomSleep(250, 500);
    attempts++;
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await sleep(500);
}

async function getPartRows(page) {
  try {
    return await page.evaluate(() => {
      const rows = [...document.querySelectorAll('li.K6ZZTd')];
      const parts = [];

      for (const row of rows) {
        const titleEl = row.querySelector('.mMsbvc');
        if (!titleEl) continue;

        const title = titleEl.textContent.trim();
        const m = title.match(/^Part\s+(\d+)$/i);
        if (!m) continue;

        const part = parseInt(m[1], 10);
        parts.push(part);
      }

      return parts.sort((a, b) => a - b);
    });
  } catch (e) {
    err(`Failed to get part rows: ${e.message}`);
    return [];
  }
}

async function getTotalParts(page) {
  const parts = await getPartRows(page);
  if (parts.length === 0) return 0;
  return Math.max(...parts);
}

async function clickPartButton(page, partNum) {
  try {
    const buttonInfo = await page.evaluate((targetPart) => {
      const rows = [...document.querySelectorAll('li.K6ZZTd')];

      for (const row of rows) {
        const titleEl = row.querySelector('.mMsbvc');
        if (!titleEl) continue;

        const title = titleEl.textContent.trim();
        if (title.toLowerCase() !== `part ${targetPart}`) continue;

        const btn = row.querySelector('.VfPpkd-LgbsSe');
        const anchor = row.querySelector('a[aria-label*="part"]');

        if (!btn || !anchor) return null;

        return {
          partNum: targetPart,
          ariaLabel: anchor.getAttribute('aria-label') || '',
        };
      }

      return null;
    }, partNum);

    if (!buttonInfo) {
      throw new Error(`Part ${partNum} row not found`);
    }

    const handle = await page.evaluateHandle((targetPart) => {
      const rows = [...document.querySelectorAll('li.K6ZZTd')];

      for (const row of rows) {
        const titleEl = row.querySelector('.mMsbvc');
        if (!titleEl) continue;

        const title = titleEl.textContent.trim();
        if (title.toLowerCase() !== `part ${targetPart}`) continue;

        return row.querySelector('.VfPpkd-LgbsSe');
      }

      return null;
    }, partNum);

    const isNull = await handle.evaluate((el) => el === null).catch(() => true);
    if (isNull) {
      await handle.dispose().catch(() => {});
      throw new Error(`Button disappeared`);
    }

    try {
      await handle.evaluate((el) =>
        el.scrollIntoView({ behavior: 'instant', block: 'center' })
      );
    } catch (e) {
      // Continue anyway
    }

    await randomSleep(500, 1200);

    try {
      await handle.click();
    } catch (e) {
      await handle.dispose().catch(() => {});
      throw new Error(`Click failed: ${e.message}`);
    }

    await handle.dispose().catch(() => {});
    return buttonInfo.ariaLabel;
  } catch (e) {
    throw new Error(`Part ${partNum}: ${e.message}`);
  }
}

function getStatus() {
  const completed = getCompletedZipFiles();
  const inProgress = getInProgressFiles();
  return { completed, inProgress };
}

function displayStatus(currentPart, totalParts, startPart, startTime) {
  const { completed, inProgress } = getStatus();
  const triggered = currentPart - startPart;
  const completedCount = completed.length;
  const inProgressCount = inProgress.length;

  const elapsed = Date.now() - startTime;
  const done = Math.min(completedCount, triggered);
  const avgPerFile = done > 0 ? elapsed / done : 0;
  const remainingClicks = totalParts - currentPart;
  const clickEta = remainingClicks * CLICK_INTERVAL;
  const totalEta = Math.max(avgPerFile * (totalParts - completedCount), clickEta);

  console.log('');
  console.log(pc.dim('  ' + '─'.repeat(72)));
  console.log(
    `  ${ts()} | ${pc.bold(`Part ${currentPart}/${totalParts}`)} triggered | ` +
    `${pc.green(`${completedCount} done`)} | ${pc.cyan(`${inProgressCount} downloading`)} | ` +
    `ETA ${pc.bold(fmtTime(totalEta))}`
  );
  console.log(pc.dim('  ' + '─'.repeat(72)));

  if (inProgressCount > 0) {
    console.log(pc.dim('  In progress:'));
    for (const f of inProgress.slice(0, 3)) {
      console.log(pc.dim(`    • ${f}`));
    }
    if (inProgressCount > 3) {
      console.log(pc.dim(`    … and ${inProgressCount - 3} more`));
    }
  }

  if (completedCount > 0 && completedCount <= 5) {
    console.log(pc.dim('  Completed:'));
    for (const f of completed) {
      console.log(pc.dim(`    ✓ ${f}`));
    }
  }

  console.log('');
}

(async () => {
  console.log('');
  console.log(pc.bold(pc.cyan('  Google Takeout Auto-Downloader')));
  console.log(pc.dim(`  Downloads → ${DOWNLOAD_DIR}`));
  console.log(`  One click every ${fmtTime(CLICK_INTERVAL)}`);
  console.log('');

  let takeoutUrl = await ask('  Paste your Takeout archive URL: ');
  if (!takeoutUrl) {
    console.error(pc.red('  No URL provided.'));
    process.exit(1);
  }
  console.log('');

  const firstRun = !fs.existsSync(PROFILE_DIR);
  if (firstRun) {
    info(
      'First run — Chrome will open. Log in to Google, then come back here and press Enter.\n'
    );
  } else {
    info(`Using saved profile: ${pc.dim(PROFILE_DIR)}\n`);
  }

  const browser = await puppeteerExtra.launch({
    headless: false,
    defaultViewport: null,
    executablePath: '/usr/bin/google-chrome-stable',
    userDataDir: PROFILE_DIR,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--start-maximized',
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await applyDownloadDir(client);

  if (firstRun) {
    await page.goto('https://accounts.google.com', {
      waitUntil: 'networkidle2',
      timeout: 60_000,
    });
    await ask('Press Enter once you are fully logged in to Google… ');
  }

  let totalParts = 0;
  while (totalParts === 0) {
    info('Navigating to Takeout archive…');
    try {
      await page.goto(takeoutUrl, {
        waitUntil: 'networkidle2',
        timeout: 60_000,
      });
    } catch (e) {
      err(`Navigation failed: ${e.message}`);
    }

    await applyDownloadDir(client);
    await ensureOnPage(page, takeoutUrl);

    info('Waiting for page to render…');
    await sleep(4000);

    await scrollToLoadAll(page);

    const parts = await getPartRows(page);
    totalParts = parts.length > 0 ? Math.max(...parts) : 0;

    if (totalParts === 0) {
      warn('No part rows found.');
      const newUrl = await ask(
        '  Paste a different Takeout archive URL (or press Enter to retry): '
      );
      if (newUrl) takeoutUrl = newUrl.trim();
    } else {
      info(`Detected ${totalParts} parts.`);
    }
  }

  const existingZips = getCompletedZipFiles().length;
  let startPart = 1;

  if (existingZips > 0) {
    console.log(`  Found ${pc.bold(existingZips)} zip(s) already in export/.`);
    const suggestion = Math.min(existingZips + 1, totalParts);
    const answer = await ask(
      `  Resume from part #${suggestion} of ${totalParts}? (Enter = confirm, number = override, 1 = start over) `
    );

    if (answer === '') {
      startPart = suggestion;
    } else {
      const parsed = parseInt(answer, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= totalParts) {
        startPart = parsed;
      } else {
        warn('Invalid input — starting from #1.');
      }
    }
  } else {
    const answer = await ask(
      `  Found ${pc.bold(totalParts)} parts. Start from #1? (Enter or type a number) `
    );
    if (answer !== '') {
      const parsed = parseInt(answer, 10);
      if (!isNaN(parsed) && parsed >= 1 && parsed <= totalParts) {
        startPart = parsed;
      }
    }
  }

  console.log('');
  console.log(pc.dim('  ' + '─'.repeat(72)));
  console.log(
    `  Starting at ${pc.bold(`Part ${startPart}`)} of ${totalParts} — one click every ${fmtTime(CLICK_INTERVAL)}`
  );
  console.log(pc.dim('  ' + '─'.repeat(72)));
  console.log('');

  const startTime = Date.now();
  let succeeded = 0;
  let failed = 0;

  for (let currentPart = startPart; currentPart <= totalParts; currentPart++) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const recovered = await ensureOnPage(page, takeoutUrl);
        if (recovered) {
          await scrollToLoadAll(page);
        }

        await applyDownloadDir(client);

        const label = await clickPartButton(page, currentPart);
        console.log(`  ${ts()} ${pc.green('✓')} ${pc.bold(`Part ${currentPart}/${totalParts}`)} triggered`);
        succeeded++;
        break;
      } catch (e) {
        if (attempt === MAX_RETRIES) {
          failed++;
          console.log(
            `  ${ts()} ${pc.red('✗')} ${pc.bold(`Part ${currentPart}/${totalParts}`)} — ${pc.red(e.message)}`
          );
        } else {
          warn(`Attempt ${attempt}/${MAX_RETRIES} failed: ${e.message}`);
          await randomSleep(2000, 4000);
        }
      }
    }

    if (currentPart < totalParts) {
      displayStatus(currentPart, totalParts, startPart, startTime);
      info(`Waiting ${fmtTime(CLICK_INTERVAL)} before next click…`);
      await sleep(CLICK_INTERVAL);
    }
  }

  // Final status
  console.log('');
  console.log(pc.dim('  ' + '─'.repeat(72)));
  const { completed, inProgress } = getStatus();
  console.log(
    `  ${pc.green(pc.bold(`${completed.length} completed`))} | ` +
    `${pc.cyan(pc.bold(`${inProgress.length} still downloading`))}`
  );
  console.log(pc.dim('  ' + '─'.repeat(72)));
  console.log('');

  if (completed.length > 0) {
    console.log(pc.bold('  Completed files:'));
    for (const f of completed) {
      console.log(pc.green(`    ✓ ${f}`));
    }
  }

  if (inProgress.length > 0) {
    console.log('');
    console.log(pc.bold('  Still downloading (Chrome will finish these):'));
    for (const f of inProgress) {
      console.log(pc.cyan(`    ⟳ ${f}`));
    }
  }

  console.log('');
  console.log(
    `  ${pc.bold(`${succeeded}/${totalParts - startPart + 1}`)} triggers successful${failed > 0 ? `, ${failed} failed` : ''}`
  );
  console.log('');

  await browser.close();
})();
