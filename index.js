import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(express.json());

app.get("/", (req, res) => res.send("OK"));

app.post("/preview", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: "Missing url" });

  try {
    const resp = await fetch(url, { headers: { "User-Agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" }});
    const html = await resp.text();
    const $ = cheerio.load(html);

    const title =
      $('meta[property="og:title"]').attr("content") || $("title").text();
    const description =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content");
    const image =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content");

    res.json({
      ok: true,
      title,
      description,
      image_url: image,
      final_url: url
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Preview service running on ${port}`));
