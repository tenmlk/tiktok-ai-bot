// Username availability checker — uses Z.ai page_reader (works on GitHub Actions via ZAI_CONFIG secret)
//
// Username rules (compatible with TikTok / Snapchat / Instagram):
//   - First char MUST be a letter
//   - Last char MUST be a letter or digit (never '.', '_', '-')
//   - No two consecutive symbol chars ('..', '__', '--', '._', '-_', etc.)
//   - Allowed: [a-z] [0-9] . _ -
//   - Length range: 2..15

let ZAI;
try {
  ZAI = require('z-ai-web-dev-sdk').default;
} catch (e) {
  console.error('z-ai-web-dev-sdk not installed');
  ZAI = null;
}
const fs = require('fs');
const path = require('path');

let zaiInstance = null;
async function getZai() {
  if (!ZAI) throw new Error('z-ai-web-dev-sdk missing');
  if (zaiInstance) return zaiInstance;

  // On GitHub Actions, write config from env var ZAI_CONFIG (JSON string)
  if (process.env.ZAI_CONFIG && !fs.existsSync('/etc/.z-ai-config')) {
    const configPaths = [
      path.join(process.cwd(), '.z-ai-config'),
      path.join(require('os').homedir(), '.z-ai-config'),
    ];
    for (const p of configPaths) {
      try {
        fs.writeFileSync(p, process.env.ZAI_CONFIG);
        console.log('[zai] wrote config to', p);
        break;
      } catch (e) { /* ignore */ }
    }
  }

  zaiInstance = await ZAI.create();
  return zaiInstance;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const INTER_REQUEST_MS = 2200;
let _chain = Promise.resolve();
function serialize(task) {
  const next = _chain.then(() => task());
  _chain = next.then(() => sleep(INTER_REQUEST_MS), () => sleep(INTER_REQUEST_MS));
  return next;
}

async function fetchViaZai(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await serialize(async () => {
        const zai = await getZai();
        return zai.functions.invoke('page_reader', { url });
      });
      if (r && r.code === 200 && r.data) {
        return {
          code: 200,
          title: r.data.title || '',
          description: r.data.description || '',
          html: r.data.html || '',
        };
      }
      return null;
    } catch (e) {
      const msg = String(e.message || e);
      if (msg.includes('429') || msg.toLowerCase().includes('too many requests')) {
        const wait = 15000 * (attempt + 1);
        console.log(`  [zai] 429, waiting ${wait / 1000}s...`);
        await sleep(wait);
        continue;
      }
      if (attempt < 2) {
        await sleep(2000);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function checkTikTok(username) {
  const r = await fetchViaZai(`https://www.tiktok.com/@${username}`);
  if (!r) return { available: null, source: 'zai-error' };
  const desc = r.description || '';
  const title = r.title || '';
  // TikTok: "Couldn't find this account" => available
  if (desc.toLowerCase().includes('couldn\'t find this account') ||
      title.toLowerCase().includes('couldn\'t find this account')) {
    return { available: true, source: 'zai-notfound' };
  }
  // Taken: description contains "@username on TikTok"
  if (desc.includes(`@${username}`) && desc.toLowerCase().includes('on tiktok')) {
    return { available: false, source: 'zai-desc' };
  }
  // Empty description + empty title => likely available
  if (desc.trim() === '' && title.trim() === '') {
    return { available: true, source: 'zai-empty' };
  }
  // Anything else => taken
  return { available: false, source: 'zai-other' };
}

async function checkSnapchat(username) {
  const r = await fetchViaZai(`https://www.snapchat.com/add/${username}`);
  if (!r) return { available: null, source: 'zai-error' };
  if (r.description && r.description.toLowerCase().includes('is on snapchat')) {
    return { available: false, source: 'zai-desc' };
  }
  if (r.title && r.title.toLowerCase().includes('page not found')) {
    return { available: true, source: 'zai-title' };
  }
  if (!r.description || r.description.trim() === '') {
    return { available: true, source: 'zai-empty' };
  }
  return { available: false, source: 'zai-other' };
}

async function checkInstagram(username) {
  const r = await fetchViaZai(`https://www.picnob.com/profile/${username}/`);
  if (!r) return { available: null, source: 'zai-error' };
  if (r.title && r.title.toLowerCase().includes('page not found')) {
    return { available: true, source: 'zai-picnob' };
  }
  if (r.title && r.title.toLowerCase().includes(username.toLowerCase())) {
    return { available: false, source: 'zai-picnob' };
  }
  // Try title containing "Instagram" + username (taken)
  if (r.description && r.description.toLowerCase().includes(username.toLowerCase())) {
    return { available: false, source: 'zai-desc' };
  }
  return { available: null, source: 'zai-ambiguous' };
}

// Fast check: Snapchat first (cheap). If taken, skip TikTok+IG.
async function checkFast(username, opts = {}) {
  const verbose = opts.verbose;
  if (verbose) console.log(`  [${username}] snap...`);
  const sc = await checkSnapchat(username);
  if (sc.available === false) {
    if (verbose) console.log(`  [${username}] snap=TAKEN, skipping rest`);
    return { username, tiktok: { available: null }, snapchat: sc, instagram: { available: null }, __skipped: true };
  }
  if (verbose) console.log(`  [${username}] snap=${sc.available}, checking tt+ig...`);
  const [tt, ig] = await Promise.all([checkTikTok(username), checkInstagram(username)]);
  return { username, tiktok: tt, snapchat: sc, instagram: ig };
}

// ─── Random generator by length ───────────────────────────────────────────
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '._-';
const ALNUM = LETTERS + DIGITS;
const ALL_MID = ALNUM + SYMBOLS;

function isValidUsername(u) {
  if (!u) return false;
  if (u.length < 2 || u.length > 15) return false;
  if (!/^[a-z]/.test(u)) return false;
  if (!/[a-z0-9]$/.test(u)) return false;
  if (!/^[a-z0-9._-]+$/.test(u)) return false;
  if (/[\._\-]{2,}/.test(u)) return false;
  return true;
}

function randomFrom(str) {
  return str[Math.floor(Math.random() * str.length)];
}

function generateOne(length) {
  let u = randomFrom(LETTERS);
  for (let i = 1; i < length; i++) {
    const lastChar = u[u.length - 1];
    const pool = SYMBOLS.includes(lastChar) ? ALNUM : ALL_MID;
    u += randomFrom(pool);
  }
  if (SYMBOLS.includes(u[u.length - 1])) {
    u = u.slice(0, -1) + randomFrom(ALNUM);
  }
  return u;
}

function generateByLength(length, count) {
  if (length < 2 || length > 15) return [];
  const out = new Set();
  let attempts = 0;
  const maxAttempts = count * 50;
  while (out.size < count && attempts < maxAttempts) {
    attempts++;
    const u = generateOne(length);
    if (isValidUsername(u)) out.add(u);
  }
  return [...out];
}

// ─── Find available usernames of a given length ──────────────────────────
async function findAvailableByLength(length, targetCount, opts = {}, onAvailable) {
  const batchSize = Math.max(targetCount * 3, 30);
  const candidates = generateByLength(length, batchSize);
  if (opts.verbose) console.log(`Generated ${candidates.length} candidates (len=${length}): ${candidates.slice(0, 10).join(', ')}${candidates.length > 10 ? '...' : ''}`);

  const found = [];
  let taken = 0;
  let checked = 0;
  const t0 = Date.now();
  const TIME_BUDGET_MS = (opts.timeBudgetSec || 240) * 1000;

  for (const u of candidates) {
    if (found.length >= targetCount) break;
    if (Date.now() - t0 > TIME_BUDGET_MS) {
      if (opts.verbose) console.log(`  [time-budget] hit ${TIME_BUDGET_MS / 1000}s, stopping early (found ${found.length}/${targetCount})`);
      break;
    }
    const r = await checkFast(u, opts);
    checked++;
    const platforms = ['tiktok', 'snapchat', 'instagram'];
    const availOn = platforms.filter((p) => r[p].available === true);
    const takenOn = platforms.filter((p) => r[p].available === false);

    if (opts.verbose) {
      console.log(`  ${u}: avail=[${availOn.join(',')}] taken=[${takenOn.join(',')}] ${r.__skipped ? '(skipped)' : ''}`);
    }

    if (availOn.length >= 1 && takenOn.length === 0) {
      const item = { username: u, availableOn: availOn };
      found.push(item);
      if (onAvailable) await onAvailable(item);
    } else if (takenOn.length > 0) {
      taken++;
    }
    await sleep(150);
  }

  return { found, takenCount: taken, checkedCount: checked, candidatesTotal: candidates.length };
}

async function checkAllPlatforms(username) {
  const tt = await checkTikTok(username);
  const sc = await checkSnapchat(username);
  const ig = await checkInstagram(username);
  return { username, tiktok: tt, snapchat: sc, instagram: ig };
}

module.exports = {
  checkAllPlatforms,
  checkTikTok,
  checkSnapchat,
  checkInstagram,
  checkFast,
  generateByLength,
  isValidUsername,
  findAvailableByLength,
};
