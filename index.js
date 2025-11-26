// index.js
const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

// enkel healthcheck
app.get("/", (_req, res) => res.send("OK"));

// Hjälpfunktion: välj bästa bild-URL
function pickBestImage(urls = []) {
  const candidates = (urls || [])
    .filter((u) => typeof u === "string")
    // av-escapa ev. \u002F
    .map((u) => u.split("\\u002F").join("/"))
    // bara blocketcdn + bildformat
    .filter((u) => /blocketcdn\.se/i.test(u))
    .filter((u) => /\.(jpg|jpeg|png)(\?|$)/i.test(u))
    // filtrera bort loggor
    .filter(
      (u) =>
        !/static\/images\/blocketLogotype\.png/i.test(u) &&
        !/logo|logotype/i.test(u) &&
        !/dealer|handlare|firma/i.test(u)
    );

  const scored = candidates
    .map((u) => {
      let score = 0;

      // fånga t.ex. 1200w
      const widthMatch = u.match(/(\d{3,4})w/);
      if (widthMatch) score += parseInt(widthMatch[1], 10);

      // fånga t.ex. 800x600
      const sizeMatch = u.match(/(\d{2,4})x(\d{2,4})/);
      if (sizeMatch) {
        const w = parseInt(sizeMatch[1], 10);
        const h = parseInt(sizeMatch[2], 10);
        const pixels = w * h;
        score += Math.min(pixels / 100, 5000);
      }

      // prioritera stora/original
      if (/full|large|original/i.test(u)) score += 2000;
      // nedprioritera thumbnails
      if (/thumb|small|mini/i.test(u)) score -= 2000;

      return { u, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.length ? scored[0].u : null;
}

app.post("/preview", async (req, res) => {
  const url = req.body && req.body.url;
  if (!url) return res.status(400).json({ ok: false, error: "missing url" });

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    });
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      locale: "sv-SE",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    // vänta in antingen __NEXT_DATA__ eller första bild
    await Promise.race([
      page.waitForSelector("#__NEXT_DATA__", { timeout: 5000 }).catch(() => {}),
      page.waitForSelector("img", { timeout: 5000 }).catch(() => {}),
    ]);

    let title = await page.title();
    let imageUrl = null;

    // --- Försök 1: läs strukturerad data ur __NEXT_DATA__ ---
    const nextData = await page.evaluate(
      () => document.getElementById("__NEXT_DATA__")?.textContent || null
    );
    if (nextData) {
      try {
        const data = JSON.parse(nextData);
        const pageProps = data?.props?.pageProps || {};
        const ad =
          pageProps.ad ||
          pageProps.vehicle ||
          pageProps.adData ||
          pageProps.listing ||
          pageProps;

        // sätt titel så bra som möjligt
        title = ad?.subject || ad?.title || title || null;

        // samla potentiella bildfält
        const structuredUrls = [];

        const pushUrl = (u) => {
          if (u && typeof u === "string") structuredUrls.push(u);
        };

        const pushFromArray = (arr) => {
          if (!Array.isArray(arr)) return;
          for (const item of arr) {
            if (!item) continue;
            if (typeof item === "string") {
              pushUrl(item);
            } else if (typeof item === "object") {
              pushUrl(item.url || item.src || item.href);
            }
          }
        };

        // vanliga fält på annonser
        pushFromArray(ad.images);
        pushFromArray(ad.imageUrls);
        pushFromArray(ad.gallery);
        pushFromArray(ad.media);

        if (!imageUrl && structuredUrls.length) {
          imageUrl = pickBestImage(structuredUrls);
        }

        // fallback: regexa bilder ur hela nextData om vi fortfarande saknar bild
        if (!imageUrl) {
          const re =
            /https?:\/\/[^\s"\\]+blocketcdn\.se[^\s"\\]+\.(?:jpg|jpeg|png)/gi;
          const matches = nextData.match(re) || [];
          imageUrl = pickBestImage(matches);
        }
      } catch {
        // ignorerar JSON-fel, går vidare till DOM-fallback
      }
    }

    // --- Försök 2: DOM-fallback ---
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

      imageUrl = pickBestImage(urls);
    }

    await browser.close();

    return res.json({
      ok: true,
      title: title || null,
      image_url: imageUrl || null,
      final_url: url,
    });
  } catch (e) {
    if (browser) try { await browser.close(); } catch {}
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "render failed" });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("listening on " + port));
