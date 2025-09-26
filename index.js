// index.js
const express = require('express');
const resp = await fetch(url);
const { JSDOM } = require('jsdom');

// Playwright är valfritt men bra när og:image kräver render
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

app.get('/', (_req, res) => res.send('OK'));

async function extractOg(html, finalUrl) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const pick = (sel) => doc.querySelector(sel)?.getAttribute('content')?.trim() || null;

  // Försök JSON-LD först (vissa sidor lägger image där)
  let imageFromJsonLd = null;
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    try {
      const data = JSON.parse(s.textContent.trim());
      const obj = Array.isArray(data) ? data[0] : data;
      if (!imageFromJsonLd && obj?.image) {
        if (typeof obj.image === 'string') imageFromJsonLd = obj.image;
        else if (Array.isArray(obj.image)) imageFromJsonLd = obj.image[0];
        else if (obj.image?.url) imageFromJsonLd = obj.image.url;
      }
    } catch {}
  });

  const title =
    pick('meta[property="og:title"]') ||
    pick('meta[name="twitter:title"]') ||
    doc.querySelector('title')?.textContent?.trim() || null;

  const description =
    pick('meta[property="og:description"]') ||
    pick('meta[name="description"]') ||
    pick('meta[name="twitter:description"]') ||
    null;

  const image =
    imageFromJsonLd ||
    pick('meta[property="og:image"]') ||
    pick('meta[name="twitter:image"]') ||
    null;

  return {
    ok: true,
    title,
    description,
    image_url: image,
    final_url: finalUrl
  };
}

async function fetchWithBrowser(url) {
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const ctx = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
    });
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const html = await page.content();
    const finalUrl = resp?.url() || url;
    await ctx.close();
    return { html, finalUrl };
  } finally {
    await browser.close();
  }
}

async function fetchWithHttp(url) {
  const resp = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      accept: 'text/html,application/xhtml+xml'
    },
    redirect: 'follow'
  });
  const html = await resp.text();
  const finalUrl = resp.url || url;
  return { html, finalUrl };
}

async function handlePreview(req, res) {
  try {
    const { url, force_browser } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'Missing url' });

    // 1) Försök vanlig fetch först (snabbast)
    let { html, finalUrl } = await fetchWithHttp(url);
    let og = await extractOg(html, finalUrl);

    // 2) Om ingen bild hittas eller force_browser=true → Playwright
    if (force_browser || !og.image_url) {
      const b = await fetchWithBrowser(url);
      og = await extractOg(b.html, b.finalUrl);
    }

    return res.json(og);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || 'failed' });
  }
}

// Stöd båda vägarna
app.post('/api/url-preview', handlePreview);
app.post('/url-preview', handlePreview);

// 405 för GET på dessa
app.get(['/api/url-preview', '/url-preview'], (_req, res) =>
  res.status(405).json({ ok: false, error: 'Use POST' })
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('listening on ' + port));
