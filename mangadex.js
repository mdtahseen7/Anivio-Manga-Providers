/**
 * MangaDex Manga Provider Plugin for Anivio
 *
 * Ported from Saikou (middlegear/Saikou):
 *   app/src/main/java/ani/saikou/parsers/manga/MangaDex.kt
 *
 * Conforms to Anivio Plugin Guide §11 (manga providers):
 * - Single self-contained file, no import/export, native async/await (QuickJS)
 * - getChapters(mangaId, title): mangaId is the bare AniList media id ("30013")
 * - getChapterImages(chapterId): chapterId is the exact `id` returned above
 *
 * Strategy: resolve the AniList title via AniList GraphQL (or use the passed
 * title), search MangaDex API, pick the best title match, then page the
 * /feed endpoint for English chapters (same as Saikou).
 */

var MD_API = 'https://api.mangadex.org';
var MD_UPLOADS = 'https://uploads.mangadex.org';
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
    var cw = c.split(' ');
    var hit = 0;
    for (var i = 0; i < qw.length; i++) {
        if (qw[i].length > 2 && c.indexOf(qw[i]) !== -1) hit++;
    }
    if (qw.length > 0 && hit === qw.length) return 65;
    if (qw.length > 0 && hit > 0) return Math.round((hit / qw.length) * 50);
    return 0;
}

function pickTitle(obj) {
    if (!obj || typeof obj !== 'object') return '';
    if (typeof obj.en === 'string' && obj.en.trim()) return obj.en.trim();
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
        var v = obj[keys[i]];
        if (typeof v === 'string' && v.trim()) return v.trim();
    }
    var alt = obj.altTitles || obj.alt_titles;
    if (Array.isArray(alt)) {
        for (var j = 0; j < alt.length; j++) {
            var t = pickTitle(alt[j]);
            if (t) return t;
        }
    }
    return '';
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

async function searchMangaDex(query) {
    var url = MD_API + '/manga?limit=15&title=' + encodeURIComponent(query) + '&order[followedCount]=desc&includes[]=cover_art';
    var res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': UA } });
    if (!res.ok) return [];
    var body = await res.json();
    if (!body || !Array.isArray(body.data)) return [];
    var out = [];
    for (var i = 0; i < body.data.length; i++) {
        var d = body.data[i];
        if (!d || !d.id) continue;
        var title = pickTitle(d.attributes && d.attributes.title);
        if (!title && d.attributes && Array.isArray(d.attributes.altTitles)) {
            for (var k = 0; k < d.attributes.altTitles.length; k++) {
                title = pickTitle(d.attributes.altTitles[k]);
                if (title) break;
            }
        }
        if (!title) continue;
        out.push({ id: String(d.id), title: title });
    }
    return out;
}

function parseChapterNum(v) {
    if (v === null || v === undefined) return null;
    var f = parseFloat(String(v).trim());
    return isNaN(f) ? null : f;
}

async function getChapters(mangaId, title) {
    try {
        var q = await resolveMangaTitle(mangaId, title);
        if (!q) {
            console.log('[mangadex] empty title for id=' + mangaId);
            return [];
        }
        console.log('[mangadex] getChapters id=' + mangaId + ' title=' + q);

        var results = [];
        try {
            results = await searchMangaDex(q);
        } catch (e) {
            console.warn('[mangadex] search failed: ' + (e && e.message));
            return [];
        }
        if (!results.length) {
            console.log('[mangadex] no search results for ' + q);
            return [];
        }

        var best = null;
        var bestScore = -1;
        for (var i = 0; i < results.length; i++) {
            var s = scoreTitle(q, results[i].title);
            if (s > bestScore) {
                bestScore = s;
                best = results[i];
            }
        }
        if (!best) best = results[0];
        console.log('[mangadex] best match: ' + best.title + ' (' + best.id + ') score=' + bestScore);

        // Total count first (mirrors Saikou MangaDex.loadChapters limit=0 call).
        var total = 0;
        try {
            var tRes = await fetch(MD_API + '/manga/' + encodeURIComponent(best.id) + '/feed?limit=0', {
                headers: { 'Accept': 'application/json', 'User-Agent': UA }
            });
            if (tRes.ok) {
                var tBody = await tRes.json();
                if (tBody && typeof tBody.total === 'number') total = tBody.total;
            }
        } catch (e) {}
        if (!total) total = 200;

        var list = [];
        var seen = {};
        var limit = 200;
        var maxPages = 5; // cap at 1000 feed entries to stay inside the 60s budget
        var pages = Math.min(maxPages, Math.ceil(total / limit) || 1);
        for (var p = 0; p < pages; p++) {
            var offset = p * limit;
            var url = MD_API + '/manga/' + encodeURIComponent(best.id) +
                '/feed?limit=' + limit + '&order[volume]=desc&order[chapter]=desc&offset=' + offset;
            try {
                var res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': UA } });
                if (!res.ok) continue;
                var body = await res.json();
                if (!body || !Array.isArray(body.data)) continue;
                for (var j = 0; j < body.data.length; j++) {
                    var ch = body.data[j];
                    if (!ch || !ch.id) continue;
                    var a = ch.attributes || {};
                    if (a.translatedLanguage !== 'en') continue;
                    if (a.externalUrl) continue;
                    if (a.chapter === null || a.chapter === undefined || String(a.chapter).trim() === '') continue;
                    var num = parseChapterNum(a.chapter);
                    if (num === null) continue;
                    var key = String(num);
                    if (seen[key]) continue;
                    seen[key] = true;
                    list.push({
                        id: String(ch.id),
                        number: num,
                        title: (typeof a.title === 'string' && a.title.trim()) ? a.title.trim() : undefined,
                        releaseDate: (typeof a.publishAt === 'string') ? a.publishAt.slice(0, 10) : undefined
                    });
                }
            } catch (e) {
                console.warn('[mangadex] feed page ' + p + ' failed: ' + (e && e.message));
            }
        }

        list.sort(function (a, b) { return a.number - b.number; });
        console.log('[mangadex] returning ' + list.length + ' chapters');
        return list;
    } catch (e) {
        console.error('[mangadex] getChapters fatal: ' + (e && e.message));
        return [];
    }
}

async function getChapterImages(chapterId) {
    try {
        var id = String(chapterId == null ? '' : chapterId).trim();
        if (!id) return [];
        console.log('[mangadex] getChapterImages ' + id);
        var res = await fetch(MD_API + '/at-home/server/' + encodeURIComponent(id), {
            headers: { 'Accept': 'application/json', 'User-Agent': UA }
        });
        if (!res.ok) {
            console.log('[mangadex] at-home returned HTTP ' + res.status);
            return [];
        }
        var body = await res.json();
        if (!body) return [];
        var base = body.baseUrl || MD_UPLOADS;
        var ch = body.chapter || {};
        var hash = ch.hash;
        var files = ch.data || ch.dataSaver || [];
        if (!hash || !Array.isArray(files) || !files.length) return [];
        var out = [];
        for (var i = 0; i < files.length; i++) {
            if (!files[i]) continue;
            out.push({
                url: String(base).replace(/\/+$/, '') + '/data/' + hash + '/' + files[i],
                headers: { Referer: 'https://mangadex.org/', 'User-Agent': UA }
            });
        }
        return out;
    } catch (e) {
        console.error('[mangadex] getChapterImages fatal: ' + (e && e.message));
        return [];
    }
}

module.exports.getChapters = getChapters;
module.exports.getChapterImages = getChapterImages;
globalThis.getChapters = getChapters;
globalThis.getChapterImages = getChapterImages;
