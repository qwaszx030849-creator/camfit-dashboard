const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const watchlistPath = path.join(root, 'data', 'monitoring', 'watchlist.json');
const outputPath = path.join(root, 'data', 'monitoring', 'latest.json');
const maxPerClient = Number(process.env.MONITORING_MAX_PER_CLIENT || 5);

function clean(text) {
  return String(text || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function tag(block, name) {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? clean(match[1]) : '';
}
function classify(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  if (/불친절|별로|실망|최악|환불|취소|민원|컴플레인|냄새|더러|불편|소음/.test(text)) return '주의';
  if (/추천|좋았|만족|깨끗|친절|재방문|힐링|감성|최고|아이|애견/.test(text)) return '긍정';
  return '중립';
}
function naverBlogUrl(client) {
  const keywords = Array.isArray(client.keywords) && client.keywords.length ? client.keywords : [client.name];
  return `https://search.naver.com/search.naver?where=rss&query=${encodeURIComponent(`${keywords.join(' ')} 캠핑장`)}`;
}
function googleNewsUrl(client) {
  const keywords = Array.isArray(client.keywords) && client.keywords.length ? client.keywords : [client.name];
  return `https://news.google.com/rss/search?q=${encodeURIComponent(`${keywords.join(' ')} 캠핑장`)}&hl=ko&gl=KR&ceid=KR:ko`;
}
async function fetchText(url) {
  const res = await fetch(url, {headers: {'User-Agent': 'Mozilla/5.0 CamfitDashboardMonitoring/1.0'}});
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}
function parseRss(xml, client, source) {
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  return blocks.slice(0, maxPerClient).map((block) => {
    const title = tag(block, 'title');
    const summary = tag(block, 'description').slice(0, 260);
    const url = tag(block, 'link');
    const publishedAt = tag(block, 'pubDate');
    return {id: `${client.name}|${source}|${url}`, client: client.name, source, title, url, summary, publishedAt, date: new Date().toISOString().slice(0, 10), sentiment: classify(title, summary), status: 'pending'};
  }).filter((item) => item.title && item.url);
}
async function collectSource(client, source, url) {
  const xml = await fetchText(url);
  return parseRss(xml, client, source);
}
async function main() {
  if (!fs.existsSync(watchlistPath)) {
    fs.mkdirSync(path.dirname(watchlistPath), {recursive: true});
    fs.writeFileSync(watchlistPath, JSON.stringify({clients: []}, null, 2));
  }
  const watchlist = JSON.parse(fs.readFileSync(watchlistPath, 'utf8'));
  const clients = (Array.isArray(watchlist) ? watchlist : watchlist.clients || []).filter((c) => c && c.name && c.active !== false);
  const items = [];
  const failures = [];
  for (const client of clients) {
    const sources = [
      ['네이버 블로그', naverBlogUrl(client)],
      ['Google 뉴스', googleNewsUrl(client)],
    ];
    for (const [source, url] of sources) {
      try {
        const got = await collectSource(client, source, url);
        items.push(...got);
        console.log(`${client.name} / ${source}: ${got.length}`);
      } catch (error) {
        failures.push({client: client.name, source, error: error.message});
        console.warn(`${client.name} / ${source}: ${error.message}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
  fs.writeFileSync(outputPath, JSON.stringify({generatedAt: new Date().toISOString(), watchlistCount: clients.length, count: unique.length, failures, items: unique}, null, 2));
  console.log(`Wrote ${unique.length} items`);
}
main().catch((error) => { console.error(error); process.exit(1); });
