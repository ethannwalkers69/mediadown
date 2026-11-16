# MediaDown

A responsive Facebook, YouTube and Spotify downloader interface built with HTML, CSS, JavaScript and a small Express backend.

## API mapping

- Facebook: `GET /fbdl?url=...`
- YouTube: `GET /mp3juice/api?download=...&type=mp4&quality=...`
- Spotify: `GET /spotifydl?url=...`

The API base URL is configured in `server.js` as the Railway API supplied for this project.

## Run locally

Requirements: Node.js 20+

```bash
npm install
npm start
```

Open `http://localhost:3000`.

## Deploy to Render

1. Upload this project to a GitHub repository.
2. In Render, choose **New → Web Service** and connect the repository.
3. Render should detect `render.yaml`. If configuring manually:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
4. Deploy. Render supplies the `PORT` environment variable automatically.

## Important notes

- The external API response format has not been documented or verified in this project. The UI attempts to find common download URL fields and displays the raw JSON response if it cannot recognize one.
- The YouTube endpoint is assumed to be the supplied MP3Juice API with `type=mp4`.
- The backend validates the submitted URL's platform and only calls the three fixed API endpoints. Do not expose private API credentials in frontend code.
- External API uptime, response format, quality options, and download availability are controlled by the API provider.
- Use this service only for content you own or have permission to download, and follow applicable platform terms and copyright law.
