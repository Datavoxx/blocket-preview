// index.js
const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json());

// healthcheck (så Render ser att appen lever)
app.get("/", (_req, res) => res.send("OK"));

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

    // --- Försök 1: regexa bilder ur __NEXT_DATA__ ---
    const nextData = await page.evaluate(
      () => document.getElementById("__NEXT_DATA__")?.textContent || null
    );
    if (nextData) {
      try {
        // regexa ut blocketcdn-bilder
        const re =
          /https?:\/\/[^\s"\\]+blocketcdn\.se[^\s"\\]+\.(?:jpg|jpeg|png)/gi;
        const matches = nextData.match(re);
        if (matches && matches.length) {
          const seen = new Set();
          for (const m of matches) {
            const u = m.split("\\u002F").join("/"); // av-escapa \u002F
            if (seen.has(u)) continue;
            seen.add(u);
            imageUrl = u;
            break;
          }
        }
        // försök få mer exakt titel
        const data = JSON.parse(nextData);
        const ad =
          data?.props?.pageProps?.ad ||
          data?.props?.pageProps?.vehicle ||
          data?.props?.pageProps ||
          {};
        title = ad?.subject || ad?.title || title || null;
      } catch {}
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

      const candidates = (urls || [])
        .filter((u) => /blocketcdn\.se/i.test(u))
        .filter((u) => /\.(jpg|jpeg|png)(\?|$)/i.test(u))
        .filter(
          (u) => !/static\/images\/blocketLogotype\.png/i.test(u) // hoppa över loggan
        );

      const scored = candidates
        .map((u) => {
          let score = 0;
          const m = u.match(/(\d{3,4})w/); // t.ex. 1200w
          if (m) score += parseInt(m[1], 10);
          if (/full|large|original/i.test(u)) score += 2000;
          return { u, score };
        })
        .sort((a, b) => b.score - a.score);

      if (scored.length) imageUrl = scored[0].u;
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
