const express = require("express");
const path = require("path");
const { Readable } = require("stream");

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

    const contentType = response.headers.get("content-type") || "";
    const isBinary = /^(video\/|audio\/|application\/octet-stream|application\/mp4|binary\/)/i.test(contentType);

    if (isBinary) {
      if (!response.ok) {
        const error = new Error(`Upstream API returned ${response.status}`);
        error.status = 502;
        throw error;
      }
      try { await response.body?.cancel(); } catch {}
      return {
        _isDirectFile: true,
        _contentType: contentType,
        _url: url
      };
    }

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

    // 1. Direct File Stream (Facebook/YouTube)
    if (data && data._isDirectFile) {
      const ext = platform === "spotify" ? "mp3" : "mp4";
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(data._url)}&name=${encodeURIComponent(platform + "-file." + ext)}`;
      return res.json({
        ok: true,
        platform,
        result: { download_url: proxyUrl, type: data._contentType }
      });
    }

    // 2. Spotify JSON (May image, name, artist, at download)
    if (platform === "spotify" && data && data.download) {
      const fullAudioUrl = data.download.startsWith("http") ? data.download : `${API_BASE}${data.download}`;
      
      // Dynamic na filename base sa kanta
      const safeTitle = (data.name || "spotify-audio").replace(/[^a-z0-9]/gi, '_');
      const finalFilename = `${safeTitle}.mp3`;

      return res.json({
        ok: true,
        platform,
        result: {
          title: data.name || "Unknown Title",
          artist: data.artist || "Unknown Artist",
          album: data.album || "",
          cover: data.image || null,
          download_url: `/api/proxy?url=${encodeURIComponent(fullAudioUrl)}&name=${encodeURIComponent(finalFilename)}`
        }
      });
    }

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

// BINAGO: May tamang headers para hindi mag-fail sa Spotify CDN
app.get("/api/proxy", async (req, res) => {
  const targetUrl = req.query.url;
  const filename = typeof req.query.name === "string" ? req.query.name : "download.mp3";

  if (typeof targetUrl !== "string" || !isHttpUrl(targetUrl)) {
    return res.status(400).json({ error: "Invalid URL." });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    // Dinagdag ang User-Agent at Referer para iwas-block
    const upstream = await fetch(targetUrl, { 
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://open.spotify.com/"
      }
    });
    
    clearTimeout(timeout);

    if (!upstream.ok || !upstream.body) {
      console.error(`Proxy error: Upstream returned ${upstream.status}`);
      return res.status(upstream.status || 502).json({ error: "Upstream failed to fetch the file." });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    
    // Check kung nagbalik ng JSON imbes na audio (meaning error sa API)
    if (contentType.includes("application/json")) {
       const errText = await upstream.text();
       console.error("Proxy received JSON instead of file:", errText);
       return res.status(502).json({ error: "The API returned an error instead of the file. Link might be expired or blocked." });
    }

    const contentLength = upstream.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/"/g, "")}"`);
    if (contentLength) res.setHeader("Content-Length", contentLength);

    Readable.fromWeb(upstream.body).pipe(res).on("error", (err) => {
      console.error("Proxy stream error:", err.message);
      if (!res.headersSent) res.status(502).end();
      else res.end();
    });
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(502).json({ error: "Proxy failed to fetch the file." });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`MediaDown running on port ${PORT}`);
});
