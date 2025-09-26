// index.js
const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

// enkel hälsa
app.get("/", (_req, res) => res.send("OK"));

app.post("/preview", async (req, res) => {
  const url = req.body && req.body.url;
  if (!url) return res.status(400).json({ ok: false, error: "missing url" });

  let browser;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"], headless: true });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      locale: "sv-SE"
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // 1) Läs Next.js __NEXT_DATA__
    const nextData = await page.evaluate(() => {
      const el = document.getElementById("__NEXT_DATA__");
      return el ? el.textContent : null;
    });

    let title = null;
    let imageUrl = null;

    try {
      if (nextData) {
        const data = JSON.parse(nextData);

        // Blocket lägger lite olika – prova flera vägar
        const ad =
          data?.props?.pageProps?.ad ||
          data?.props?.pageProps?.vehicle ||
          data?.props?.pageProps ||
          {};

        title = ad?.subject || ad?.title || null;

        const candidates =
          ad?.images ||                 // vissa annonser
          ad?.media?.images ||          // andra
          ad?.gallery ||                // ibland "gallery"
          [];

        const grab = (v) =>
          typeof v === "string" ? v : (v && typeof v.url === "string" ? v.url : null);

        for (const im of candidates) {
          const p = grab(im);
          if (p && /blocketcdn\.se\/.*\.(jpg|jpeg|png)/i.test(p)) {
            imageUrl = p;
            break;
          }
        }
      }
    } catch (_) {}

    // 2) Fallback – kolla DOM efter <img> + srcset
    if (!imageUrl) {
      const urls = await page.evaluate(() => {
        const set = new Set();
        document.querySelectorAll("img").forEach((img) => {
          if (img.src) set.add(img.src);
          if (img.srcset) {
            img.srcset.split(",").forEach((part) => {
              const u = part.trim().split(" ")[0];
              if (u) set.add(u);
            });
          }
        });
        return Array.from(set);
      });
      const cand = (urls || []).find((u) =>
        /blocketcdn\.se\/.*\.(jpg|jpeg|png)/i.test(u)
      );
      if (cand) imageUrl = cand;
    }

    if (!title) title = await page.title();

    await browser.close();

    return res.json({
      ok: true,
      title: title || null,
      image_url: imageUrl || null, // ← detta ska nu vara bilbilden från Blocket CDN
      final_url: url
    });
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    return res.status(500).json({ ok: false, error: e?.message || "render failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Preview service running on", PORT));
