// index.js
const express = require("express");
const cors = require("cors");
const { chromium } = require("playwright");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => res.send("OK"));

app.post("/preview", async (req, res) => {
  const url = (req.body && req.body.url) || req.query.url;
  const force = (req.body && req.body.force_browser) || req.query.force_browser === "true";
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

    await Promise.race([
      page.waitForSelector("#__NEXT_DATA__", { timeout: 5000 }).catch(() => {}),
      page.waitForSelector("img", { timeout: 5000 }).catch(() => {})
    ]);

    let title = await page.title();
    let imageUrl = null;

    // 1) __NEXT_DATA__ → regexa alla blocketcdn-bilder, välj “störst”
    const nextData = await page.evaluate(() => document.getElementById("__NEXT_DATA__")?.textContent || null);
    if (nextData) {
      const re = /https?:\/\/[^\s"\\]+blocketcdn\.se[^\s"\\]+\.(?:jpg|jpeg|png)/gi;
      const matches = nextData.match(re) || [];
      const uniq = [...new Set(matches.map(m => m.split("\\u002F").join("/")))];
      // välj “störst”: prioritera full|large|original och 1200w/1600w etc
      const scored = uniq.map(u => {
        let s = 0;
        const m = u.match(/(\d{3,4})w/);
        if (m) s += parseInt(m[1], 10);
        if (/full|large|original/i.test(u)) s += 2000;
        return { u, s };
      }).sort((a, b) => b.s - a.s);
      if (scored.length) imageUrl = scored[0].u;

      // bättre titel om möjligt
      try {
        const data = JSON.parse(nextData);
        const ad = data?.props?.pageProps?.ad || data?.props?.pageProps?.vehicle || data?.props?.pageProps || {};
        title = ad?.subject || ad?.title || title || null;
      } catch {}
    }

    // 2) Fallback DOM – filtrera bort loggan
    if (force || !imageUrl) {
      const urls = await page.evaluate(() => {
        const set = new Set();
        document.querySelectorAll("img").forEach((img) => {
          if (img.src) set.add(img.src);
          if (img.srcset) img.srcset.split(",").forEach(p => set.add(p.trim().split(" ")[0]));
        });
        return Array.from(set);
      });

      const cands = (urls || [])
        .filter(u => /blocketcdn\.se/i.test(u))
        .filter(u => /\.(jpg|jpeg|png)(\?|$)/i.test(u))
        .filter(u => !/static\/images\/blocketLogotype\.png/i.test(u));

      const picked = cands.sort((a, b) => {
        // grov “störst först”
        const aw = +(a.match(/(\d{3,4})w/)?.[1] || 0);
        const bw = +(b.match(/(\d{3,4})w/)?.[1] || 0);
        if (bw !== aw) return bw - aw;
        return /full|large|original/i.test(b) - /full|large|original/i.test(a);
      })[0];

      if (picked) imageUrl = picked;
    }

    await browser.close();
    return res.json({ ok: true, title: title || null, image_url: imageUrl || null, final_url: url });
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    return res.status(500).json({ ok: false, error: e?.message || "render failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Preview service running on", PORT));
