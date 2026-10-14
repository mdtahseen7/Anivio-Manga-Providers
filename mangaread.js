/**
 * MangaRead Manga Provider Plugin for Anivio
 *
 * Ported from Saikou (middlegear/Saikou):
 *   app/src/main/java/ani/saikou/parsers/manga/MangaRead.kt
 *     search:       GET {host}/?s={query}&post_type=wp-manga -> div.c-tabs-item a[title]+img[data-src]
 *     loadChapters: GET {mangaLink} -> div.page-content-listing.single-page ul li a (reversed)
 *     loadImages:   GET {chapterLink} -> div.reading-content img.wp-manga-chapter-img (src)
 *
 * Conforms to Anivio Plugin Guide §11 (manga providers).
 * Uses only fetch + cheerio (QuickJS-compatible, no Node APIs).
 */

var HOST = 'https://mangaread.org';
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

function abs(url) {
    if (!url) return '';
    if (url.indexOf('http') === 0) return url;
    if (url.indexOf('//') === 0) return 'https:' + url;
    if (url.charAt(0) === '/') return HOST + url;
    return HOST + '/' + url;
}

function cheerioOf(html) {
    var mod = null;
    try {
        if (typeof require !== 'undefined') mod = require('cheerio');
    } catch (e) {}
    if (!mod && typeof cheerio !== 'undefined') mod = cheerio;
    return mod.load(html);
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
        console.log('[mangaread] getChapters id=' + mangaId + ' title=' + q);

        var sRes = await fetch(HOST + '/?s=' + encodeURIComponent(q) + '&post_type=wp-manga', {
            headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Referer': HOST + '/' }
        });
        if (!sRes.ok) {
            console.log('[mangaread] search HTTP ' + sRes.status);
            return [];
        }
        var sHtml = await sRes.text();
        if (!sHtml) return [];
        var $ = cheerioOf(sHtml);

        // Saikou: div.c-tabs-item > div > div > div > a + paired img.
        var candidates = [];
        $('div.c-tabs-item a').each(function (i, el) {
            var href = $(el).attr('href') || '';
            var name = $(el).attr('title') || $(el).text().trim().split('\n')[0].trim();
            if (!href || !name) return;
            if (href.indexOf('/manga/') === -1 && href.indexOf('/manhwa/') === -1 && href.indexOf('/manhua/') === -1) return;
            candidates.push({ title: String(name).trim(), link: abs(href) });
        });
        if (!candidates.length) {
            console.log('[mangaread] no search results');
            return [];
        }

        var best = candidates[0];
        var bestScore = -1;
        for (var i = 0; i < candidates.length; i++) {
            var s = scoreTitle(q, candidates[i].title);
            if (s > bestScore) {
                bestScore = s;
                best = candidates[i];
            }
        }
        console.log('[mangaread] best match: ' + best.title + ' -> ' + best.link);

        var mRes = await fetch(best.link, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Referer': HOST + '/' }
        });
        if (!mRes.ok) return [];
        var mHtml = await mRes.text();
        if (!mHtml) return [];
        var $$ = cheerioOf(mHtml);

        var anchors = $$('div.page-content-listing.single-page div ul li a');
        if (!anchors || anchors.length === 0) anchors = $$('.page-content-listing a');
        if (!anchors || anchors.length === 0) anchors = $$('ul.main.version-chap li a');
        var chapRe = /chapter\s*([\d.]+)/i;
        var out = [];
        var total = anchors.length;
        for (var k = total - 1; k >= 0; k--) {
            var el = null;
            try { el = anchors.eq(k); } catch (e) { continue; }
            var href = '';
            var text = '';
            try {
                href = el.attr('href') || '';
                text = el.text().replace(/\s+/g, ' ').trim();
            } catch (e2) { continue; }
            if (!href) continue;
            var m = chapRe.exec(text);
            var num = m ? parseFloat(m[1]) : NaN;
            var entry = { id: abs(href) };
            entry.number = isNaN(num) ? parseFloat(out.length + 1) : num;
            if (text) entry.title = text.slice(0, 120);
            out.push(entry);
        }
        out.sort(function (a, b) { return a.number - b.number; });
        console.log('[mangaread] returning ' + out.length + ' chapters');
        return out;
    } catch (e) {
        console.error('[mangaread] getChapters fatal: ' + (e && e.message));
        return [];
    }
}

async function getChapterImages(chapterId) {
    try {
        var url = String(chapterId == null ? '' : chapterId).trim();
        if (!url) return [];
        if (url.indexOf('http') !== 0) url = abs(url);
        console.log('[mangaread] getChapterImages ' + url);
        var res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*', 'Referer': HOST + '/' }
        });
        if (!res.ok) return [];
        var html = await res.text();
        if (!html) return [];
        var $ = cheerioOf(html);
        var out = [];
        $('div.reading-content img.wp-manga-chapter-img').each(function (i, el) {
            var src = $(el).attr('src') || $(el).attr('data-src') || '';
            src = String(src).trim().replace(/&amp;/g, '&');
            if (!src) return;
            out.push({ url: abs(src), headers: { Referer: url, 'User-Agent': UA } });
        });
        if (!out.length) {
            $('div.reading-content img').each(function (i, el) {
                var src = $(el).attr('src') || $(el).attr('data-src') || '';
                src = String(src).trim().replace(/&amp;/g, '&');
                if (!src || src.indexOf('http') !== 0) return;
                if (!/\.(jpg|jpeg|png|webp|gif)/i.test(src)) return;
                out.push({ url: src, headers: { Referer: url, 'User-Agent': UA } });
            });
        }
        return out;
    } catch (e) {
        console.error('[mangaread] getChapterImages fatal: ' + (e && e.message));
        return [];
    }
}

module.exports.getChapters = getChapters;
module.exports.getChapterImages = getChapterImages;
globalThis.getChapters = getChapters;
globalThis.getChapterImages = getChapterImages;
