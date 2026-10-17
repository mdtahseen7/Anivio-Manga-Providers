# Anivio Manga Plugins

Manga reader providers for the **Anivio** app, ported from
[Saikou](https://github.com/middlegear/Saikou) (`app/.../parsers/manga/`) and
conforming to §11 of the [Anivio Plugin Guide](https://github.com/mdtahseen7/Anivio/blob/main/plugins/PLUGIN_GUIDE.md).

All plugins run inside Anivio's **QuickJS** runtime (single-file, native
`async`/`await`, `fetch` + `cheerio` only, no build step).

## Providers

| Provider | File | Source in Saikou | How it works |
|---|---|---|---|
| **MangaDex** | `mangadex.js` | `MangaDex.kt` | Official API: title search → `/feed` (English) → `/at-home/server` images |
| **MangaPill** | `mangapill.js` | `MangaPill.kt` | `quick-search` → `#chapters > div > a` → `img.js-page` |
| **MangaRead** | `mangaread.js` | `MangaRead.kt` | WP search → `page-content-listing` chapters → `reading-content` images |
| **WeebCentral** | `weebcentral.js` | `WeebCentral.kt` | HX search POST → `full-chapter-list` → `/images` endpoint |
| **MangaBuddy** | `mangabuddy.js` | `MangaK.kt` | `api.mangak.io` JSON search/chapters → `__NEXT_DATA__` images |
| **MangaTaro** | `mangataro.js` | Custom | Direct REST API: `/auth/search` → token-hashed `/auth/manga-chapters` → `/auth/chapter-content` WebP images |

## Setup

Host this repo (GitHub Pages, Cloudflare Pages, or any static server) and add
the manifest URL in Anivio (**Settings → Content & Discovery → Plugins**):

```
https://raw.githubusercontent.com/mdtahseen7/Anivio-Manga-Providers/main/manifest.json
```

For local testing over your network:

```bash
npx --yes serve -l 3000
# add http://<YOUR_LOCAL_IP>:3000/manifest.json
```
