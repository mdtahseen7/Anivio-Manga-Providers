/**
 * MangaBuddy (MangaK) Manga Provider Plugin for Anivio
 *
 * Ported from Saikou (middlegear/Saikou):
 *   app/src/main/java/ani/saikou/parsers/manga/MangaK.kt
 *     (name "MangaBuddy", host https://mangak.io, api https://api.mangak.io)
 *     search:       GET {api}/titles/search?exclude=yaoi&page=1&limit=7&q={query}
 *                   -> data.items[] { id, name, cover, url }
 *     loadChapters: GET {api}/titles/{id}/chapters -> data.chapters[] { url, name, chapter_number }
 *     loadImages:   GET {host}{chapterUrl} -> <script id="__NEXT_DATA__">
 *                   -> props.pageProps.initialChapter.images[]
 *
 * Conforms to Anivio Plugin Guide §11 (manga providers).
 * Pure fetch + JSON/regex (no cheerio needed, QuickJS-compatible).
 */

var HOST = 'https://mangak.io';
var API = 'https://api.mangak.io';
var ANILIST_GQL = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function normTitle(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function scoreTitle(query, candidate) {
    var q = normTitle(query);
    var c = normTitle(candidate);
    if (!q || !c) return 0;
    if (c === q) return 100;
    if (c.indexOf(q) === 0 || q.indexOf(c) === 0) return 85;
    if (c.indexOf(q) !== -1 || q.indexOf(c) !== -1) return 70;
    var qw = q.split(' ');
    var hit = 0;
    for (var i = 0; i < qw.length; i++) {
        if (qw[i].length > 2 && c.indexOf(qw[i]) !== -1) hit++;
    }
    if (qw.length > 0 && hit === qw.length) return 65;
    if (qw.length > 0 && hit > 0) return Math.round((hit / qw.length) * 50);
    return 0;
}

function chapterPageUrl(link) {
    if (!link) return '';
    if (link.indexOf('http') === 0) return link;
    if (link.charAt(0) === '/') return HOST + link;
    return HOST + '/' + link;
}

async function resolveMangaTitle(mangaId, fallbackTitle) {
    if (fallbackTitle && String(fallbackTitle).trim()) return String(fallbackTitle).trim();
    var bare = String(mangaId == null ? '' : mangaId).trim();
    if (!bare || !/^\d+$/.test(bare)) return bare;
    try {
        var query = 'query ($id: Int) { Media (id: $id, type: MANGA) { title { romaji english native } } }';
        var res = await fetch(ANILIST_GQL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': UA },
            body: JSON.stringify({ query: query, variables: { id: parseInt(bare, 10) } })
        });
        if (!res.ok) return bare;
        var data = await res.json();
        if (!data) return bare;
        var t = data && data.data && data.data.Media && data.data.Media.title;
        if (!t) return bare;
        return t.english || t.romaji || t.native || bare;
    } catch (e) {
        return bare;
    }
}

async function getChapters(mangaId, title) {
    try {
        var q = await resolveMangaTitle(mangaId, title);
        if (!q) return [];
        console.log('[mangabuddy] getChapters id=' + mangaId + ' title=' + q);

        var sRes = await fetch(API + '/titles/search?exclude=yaoi&page=1&limit=7&q=' + encodeURIComponent(q), {
            headers: { 'Accept': 'application/json', 'User-Agent': UA, 'Referer': HOST + '/' }
        });
        if (!sRes.ok) {
            console.log('[mangabuddy] search HTTP ' + sRes.status);
            return [];
        }
        var sBody = await sRes.json();
        var items = sBody && sBody.data && sBody.data.items;
        if (!Array.isArray(items) || !items.length) {
            console.log('[mangabuddy] no search results');
            return [];
        }

        var best = items[0];
        var bestScore = -1;
        for (var i = 0; i < items.length; i++) {
            var s = scoreTitle(q, items[i].name || '');
            if (s > bestScore) {
                bestScore = s;
                best = items[i];
            }
        }
        if (!best || !best.id) return [];
        console.log('[mangabuddy] best match: ' + best.name + ' (' + best.id + ')');

        var cRes = await fetch(API + '/titles/' + encodeURIComponent(best.id) + '/chapters', {
            headers: { 'Accept': 'application/json', 'User-Agent': UA, 'Referer': HOST + '/' }
        });
        if (!cRes.ok) return [];
        var cBody = await cRes.json();
        var chapters = cBody && cBody.data && cBody.data.chapters;
        if (!Array.isArray(chapters) || !chapters.length) return [];

        var chapUrlRe = /chapter-([\d.]+)/;
        var tmp = [];
        for (var j = 0; j < chapters.length; j++) {
            var ch = chapters[j];
            if (!ch || !ch.url) continue;
            var num = (ch.chapter_number !== null && ch.chapter_number !== undefined)
                ? parseFloat(ch.chapter_number)
                : NaN;
            if (isNaN(num)) {
                var m = chapUrlRe.exec(String(ch.url));
                num = m ? parseFloat(m[1]) : NaN;
            }
            if (isNaN(num)) continue;
            tmp.push({
                number: num,
                link: String(ch.url),
                name: (typeof ch.name === 'string' && ch.name.trim()) ? ch.name.trim() : undefined
            });
        }
        tmp.sort(function (a, b) { return a.number - b.number; });
        var out = [];
        for (var k = 0; k < tmp.length; k++) {
            var e = { id: tmp[k].link, number: tmp[k].number };
            if (tmp[k].name) e.title = tmp[k].name.slice(0, 120);
            out.push(e);
        }
        console.log('[mangabuddy] returning ' + out.length + ' chapters');
        return out;
    } catch (e) {
        console.error('[mangabuddy] getChapters fatal: ' + (e && e.message));
        return [];
    }
}

async function getChapterImages(chapterId) {
    try {
        var link = String(chapterId == null ? '' : chapterId).trim();
        if (!link) return [];
        var url = chapterPageUrl(link);
        console.log('[mangabuddy] getChapterImages ' + url);
        var res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Referer': HOST + '/' }
        });
        if (!res.ok) return [];
        var html = await res.text();
        if (!html) return [];
        var start = html.indexOf('<script id="__NEXT_DATA__"');
        if (start === -1) return [];
        var tagEnd = html.indexOf('>', start);
        var end = html.indexOf('</script>', tagEnd);
        if (tagEnd === -1 || end === -1) return [];
        var jsonStr = html.substring(tagEnd + 1, end);
        var root = null;
        try {
            root = JSON.parse(jsonStr);
        } catch (e) {
            return [];
        }
        var pageProps = root && root.props && root.props.pageProps;
        var initial = pageProps && pageProps.initialChapter;
        var images = initial && initial.images;
        if (!Array.isArray(images) || !images.length) return [];
        var out = [];
        for (var i = 0; i < images.length; i++) {
            if (!images[i] || String(images[i]).indexOf('http') !== 0) continue;
            out.push({
                url: String(images[i]),
                headers: { Referer: HOST + '/', 'User-Agent': UA }
            });
        }
        return out;
    } catch (e) {
        console.error('[mangabuddy] getChapterImages fatal: ' + (e && e.message));
        return [];
    }
}

module.exports.getChapters = getChapters;
module.exports.getChapterImages = getChapterImages;
globalThis.getChapters = getChapters;
globalThis.getChapterImages = getChapterImages;
