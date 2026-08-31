#!/usr/bin/env node
// scrape.js — Watch Affinity Inventory Tracker
// Fetches in-stock watches from /api/public-inventory (Supabase backend)

const https = require('https');
const fs    = require('fs');

const API_URL      = 'https://www.watch-affinity.com/api/public-inventory';
const HISTORY_FILE = 'history.json';
const LATEST_FILE  = 'latest.json';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'WatchAffinityTracker/1.0' } }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function formatPrice(cents) {
  const n = parseInt(cents || '0');
  if (!n) return '';
  return '$' + n.toLocaleString('en-US');
}

function buildProduct(api) {
  const m = api.metadata || {};
  return {
    id:              api.id,
    sku:             api.sku || '',
    name:            `${api.brand || ''} ${api.model || ''}`.trim(),
    brand:           api.brand || '',
    model:           api.model || '',
    referenceNumber: api.reference || m.ref || '',
    condition:       api.condition || m.condition || '',
    caseMaterial:    m.caseMaterial || '',
    caseSize:        m.caseSize || '',
    dialColor:       m.dialColor || '',
    movement:        m.movement || '',
    bracelet:        m.braceletType || '',
    complication:    m.complication || '',
    box:             m.box ? 'Yes' : 'No',
    papers:          m.papers ? 'Yes' : 'No',
    warrantyCard:    m.warrantyCard || '',
    year:            m.year || '',
    price:           formatPrice(api.price),
    priceRaw:        api.price || 0,
    stockStatus:     'In Stock',
    inStock:         true,
    categories:      api.brand || '',
    url:             m.portalId ? `https://www.watch-affinity.com/watch?id=${m.portalId}` : '',
    image:           (api.images && api.images[0]) || '',
    images:          api.images || [],
    addedAt:         api.added_at || '',
  };
}

async function main() {
  // ET timestamp
  const nowUtc = new Date();
  const etStr = nowUtc.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const [datePart, timePart] = etStr.replace(',', '').trim().split(' ');
  const [mo, da, yr] = datePart.split('/');
  const timestamp = `${yr}-${mo}-${da} ${timePart} ET`;

  console.log('Watch Affinity — Inventory Snapshot');
  console.log('Timestamp :', timestamp);

  // Load existing history from disk
  let history = {};
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      console.log('History snapshots loaded:', Object.keys(history).length);
    } catch (e) { console.log('Could not parse history:', e.message); }
  }

  // Fetch current inventory
  console.log('Fetching /api/public-inventory...');
  const raw = await fetchJson(API_URL);

  if (!Array.isArray(raw)) {
    throw new Error('API did not return an array — got ' + typeof raw);
  }

  console.log(`API returned ${raw.length} total items`);

  // Jewelry / non-watch keywords to exclude
  const JEWELRY_RE = /\b(ring|earring|necklace|bracelet|pendant|chain|bangle|brooch|cufflink|anklet|charm)\b/i;

  // Filter for in-stock watches only (exclude jewelry & non-watch items)
  const inStock = raw.filter(item => {
    const status = (item.status || '').toLowerCase();
    if (status !== 'available') return false;

    // Exclude jewelry based on brand, model, or reference
    const haystack = \`\${item.brand || ''} \${item.model || ''} \${item.reference || ''}\`;
    if (JEWELRY_RE.test(haystack)) {
      console.log(\`  Excluded (jewelry): \${item.brand} \${item.model} [\${item.sku}]\`);
      return false;
    }
    return true;
  });

  console.log(`In Stock (Available): ${inStock.length} watches`);

  // Build current snapshot
  const snapshot = {};
  for (const item of inStock) {
    const product = buildProduct(item);
    snapshot[product.id] = product;
  }

  // Build slim snapshot for history.json (only fields needed for comparison)
  const HIST_KEEP = new Set([
    'id', 'sku', 'name', 'brand', 'model', 'referenceNumber', 'price', 'priceRaw',
    'stockStatus', 'inStock', 'categories', 'url', 'condition', 'caseSize',
    'dialColor', 'year', 'caseMaterial', 'movement'
  ]);
  const slimForHistory = {};
  for (const [id, item] of Object.entries(snapshot)) {
    slimForHistory[id] = Object.fromEntries(
      Object.entries(item).filter(([k]) => HIST_KEEP.has(k))
    );
  }

  // Add to history and trim
  history[timestamp] = slimForHistory;
  const hkeys = Object.keys(history).sort();
  if (hkeys.length > 20) {
    hkeys.slice(0, hkeys.length - 20).forEach(k => delete history[k]);
  }

  // Save history.json
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history));
  const finalKeys = Object.keys(history).sort();
  console.log(`history.json: ${finalKeys.length} snapshots, ${Object.keys(slimForHistory).length} watches in latest`);

  // Save latest.json — full product data for current snapshot
  const latestOut = {};
  latestOut[timestamp] = snapshot;
  fs.writeFileSync(LATEST_FILE, JSON.stringify(latestOut));
  console.log(`latest.json: 1 snapshot, ${Object.keys(snapshot).length} watches, ~${Math.round(JSON.stringify(latestOut).length / 1024)}KB`);

  // Files are committed via git in the workflow
  console.log('Files saved to disk — workflow will git-commit them');
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
