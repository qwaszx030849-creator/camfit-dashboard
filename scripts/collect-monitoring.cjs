const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const watchlistPath = path.join(root, 'data', 'monitoring', 'watchlist.json');
const outputPath = path.join(root, 'data', 'monitoring', 'latest.json');
const maxPerClient = Number(process.env.MONITORING_MAX_PER_CLIENT || 5);
const requestDelayMs = Number(process.env.MONITORING_REQUEST_DELAY_MS || 1800);
const enabledSourceKeys = String(process.env.MONITORING_SOURCES || 'google')
  .split(',')
  .map((source) => source.trim().toLowerCase())
  .filter(Boolean);
const oneYearMs = 365 * 24 * 60 * 60 * 1000;

function clean(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? clean(match[1]) : '';
}

function compact(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, '');
}

function isRecentEnough(publishedAt) {
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return true;
  return date.getTime() >= Date.now() - oneYearMs;
}

function classify(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  if (/불친절|별로|실망|최악|환불|취소|민원|컴플레인|냄새|더러|불편|소음|폭행|추행|침입|화재|사고/.test(text)) return '주의';
  if (/추천|좋았|만족|깨끗|친절|재방문|힐링|감성|최고|아이|애견|인기|선정/.test(text)) return '긍정';
  return '중립';
}

function clientKeywords(client) {
  return Array.isArray(client.keywords) && client.keywords.length ? client.keywords : [client.name];
}

function queryText(client) {
  return `"${clientKeywords(client)[0]}"`;
}

function naverBlogUrl(client) {
  return `https://search.naver.com/search.naver?where=rss&query=${encodeURIComponent(queryText(client))}`;
}

function googleNewsUrl(client) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(queryText(client))}&hl=ko&gl=KR&ceid=KR:ko`;
}

async function fetchText(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 CamfitDashboardMonitoring/1.0',
          Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(requestDelayMs * attempt);
    }
  }
  throw lastError;
}

function isRelevant(item, client) {
  const text = compact(`${item.title} ${item.summary}`);
  return clientKeywords(client).some((keyword) => text.includes(compact(keyword)));
}

function parseRss(xml, client, source) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, maxPerClient * 3).map((block) => {
    const title = tag(block, 'title');
    const summary = tag(block, 'description').slice(0, 260);
    const url = tag(block, 'link');
    const publishedAt = tag(block, 'pubDate');
    return {
      id: `${client.name}|${source}|${url}`,
      client: client.name,
      source,
      title,
      url,
      summary,
      publishedAt,
      date: new Date().toISOString().slice(0, 10),
      sentiment: classify(title, summary),
      status: 'pending',
    };
  }).filter((item) => item.title && item.url && isRecentEnough(item.publishedAt) && isRelevant(item, client)).slice(0, maxPerClient);
}

async function collectSource(client, source, url) {
  const xml = await fetchText(url);
  return parseRss(xml, client, source);
}

function sourceEntries(client) {
  const entries = {
    naver: ['네이버 블로그', naverBlogUrl(client)],
    google: ['Google 뉴스', googleNewsUrl(client)],
  };
  return enabledSourceKeys.map((key) => entries[key]).filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!fs.existsSync(watchlistPath)) {
    fs.mkdirSync(path.dirname(watchlistPath), { recursive: true });
    fs.writeFileSync(watchlistPath, JSON.stringify({ clients: [] }, null, 2));
  }
  const watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
  const clients = (Array.isArray(watchlist) ? watchlist : watchlist.clients || []).filter((client) => client && client.name && client.active !== false);
  const items = [];
  const failures = [];
  for (const client of clients) {
    const sources = sourceEntries(client);
    for (const [source, url] of sources) {
      try {
        const collected = await collectSource(client, source, url);
        items.push(...collected);
        console.log(`${client.name} / ${source}: ${collected.length}`);
      } catch (error) {
        failures.push({ client: client.name, source, error: error.message || String(error) });
        console.warn(`${client.name} / ${source}: ${error.message}`);
      }
      await sleep(requestDelayMs);
    }
  }
  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
  fs.writeFileSync(outputPath, JSON.stringify({ generatedAt: new Date().toISOString(), watchlistCount: clients.length, count: unique.length, failures, items: unique }, null, 2));
  console.log(`Wrote ${unique.length} items`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});





