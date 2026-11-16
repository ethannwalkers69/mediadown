const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

const API_BASE = "https://betadash-api-swordslush-production.up.railway.app";

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isAllowedPlatform(rawUrl, platform) {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    const rules = {
      facebook: ["facebook.com", "fb.watch", "m.facebook.com", "web.facebook.com"],
      youtube: ["youtube.com", "youtu.be", "m.youtube.com", "music.youtube.com"],
      spotify: ["spotify.com", "open.spotify.com"]
    };
    return (rules[platform] || []).some(domain => host === domain || host.endsWith("." + domain));
  } catch {
    return false;
  }
}

async function fetchApi(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Accept": "application/json, text/plain, */*" },
      signal: controller.signal
    });
    const bodyText = await response.text();
    let data;
    try { data = JSON.parse(bodyText); }
    catch { data = { raw: bodyText }; }

    if (!response.ok) {
      const message = data?.message || data?.error || `Upstream API returned ${response.status}`;
      const error = new Error(message);
      error.status = 502;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "MediaDown", timestamp: new Date().toISOString() });
});

app.post("/api/download/:platform", async (req, res) => {
  const platform = String(req.params.platform || "").toLowerCase();
  const { url, quality = "auto" } = req.body || {};

  if (!["facebook", "youtube", "spotify"].includes(platform)) {
    return res.status(404).json({ error: "Unsupported platform." });
  }
  if (typeof url !== "string" || !isHttpUrl(url)) {
    return res.status(400).json({ error: "Please enter a valid http or https URL." });
  }
  if (!isAllowedPlatform(url, platform)) {
    return res.status(400).json({ error: `Please enter a valid ${platform} link.` });
  }

  try {
    let endpoint;
    if (platform === "facebook") {
      endpoint = `${API_BASE}/fbdl?url=${encodeURIComponent(url)}`;
    } else if (platform === "youtube") {
      const selectedQuality = ["auto", "360p", "480p", "720p", "1080p"].includes(quality) ? quality : "auto";
      endpoint = `${API_BASE}/mp3juice/api?download=${encodeURIComponent(url)}&type=mp4&quality=${encodeURIComponent(selectedQuality === "auto" ? "" : selectedQuality)}`;
    } else {
      endpoint = `${API_BASE}/spotifydl?url=${encodeURIComponent(url)}`;
    }

    const data = await fetchApi(endpoint);
    res.json({ ok: true, platform, result: data });
  } catch (error) {
    console.error(`[${platform}]`, error.message);
    res.status(error.status || 502).json({
      error: error.name === "AbortError"
        ? "The downloader API took too long to respond. Please try again."
        : (error.message || "The downloader API is temporarily unavailable.")
    });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MediaDown running on port ${PORT}`);
});
