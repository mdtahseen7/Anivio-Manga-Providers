/**
 * WeebCentral Manga Provider Plugin for Anivio
 *
 * Ported from Saikou (middlegear/Saikou):
 *   app/src/main/java/ani/saikou/parsers/manga/WeebCentral.kt
 *     search:       POST {host}/search/simple?location=main (HX headers, text={query})
 *                   -> a[href*=/series/] (div.flex-1 title, img cover, link after /series/)
 *     loadChapters: GET {host}/series/{mangaId}/full-chapter-list -> a[href*=/chapters/] (reversed)
 *     loadImages:   GET {host}/chapters/{chapterId}/images?is_prev=False&current_page=1&reading_style=long_strip
 *                   -> img,source (src|data-src|data-original|srcset, jpg|png|webp|jpeg)
 *
 * Conforms to Anivio Plugin Guide §11 (manga providers).
 * fetch body is string-only in QuickJS, so the POST sends a urlencoded form body.
 */

var HOST = 'https://weebcentral.com';
var ANILIST_GQL = 'https://graphql.anilist.co';
var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0';

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
        console.log('[weebcentral] getChapters id=' + mangaId + ' title=' + q);

        var sRes = await fetch(HOST + '/search/simple?location=main', {
            method: 'POST',
            headers: {
                'User-Agent': UA,
                'Accept': '*/*',
                'Content-Type': 'application/x-www-form-urlencoded',
                'HX-Request': 'true',
                'HX-Trigger': 'quick-search-input',
                'HX-Trigger-Name': 'text',
                'HX-Target': 'quick-search-result',
                'HX-Current-URL': HOST + '/'
            },
            body: 'text=' + encodeURIComponent(q)
        });
        if (!sRes.ok) {
            console.log('[weebcentral] search HTTP ' + sRes.status);
            return [];
        }
        var sHtml = await sRes.text();
        if (!sHtml) return [];
        var $ = cheerioOf(sHtml);

        var candidates = [];
        $('a[href*="/series/"]').each(function (i, el) {
            var href = $(el).attr('href') || '';
            if (!href) return;
            var name = '';
            try {
                var t = $(el).find('div.flex-1').first().text();
                if (t) name = String(t).replace(/\s+/g, ' ').trim();
            } catch (e) {}
            if (!name) {
                try { name = $(el).text().replace(/\s+/g, ' ').trim().split('  ')[0].trim(); } catch (e2) {}
            }
            var slug = href.split('/series/')[1] || '';
            slug = slug.split('?')[0].split('#')[0];
            if (slug && name) candidates.push({ title: name, slug: slug });
        });
        if (!candidates.length) {
            console.log('[weebcentral] no search results');
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
        var mangaSlug = String(best.slug).split('/')[0];
        console.log('[weebcentral] best match: ' + best.title + ' -> ' + mangaSlug);

        var cRes = await fetch(HOST + '/series/' + encodeURIComponent(mangaSlug) + '/full-chapter-list', {
            headers: {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Referer': HOST + '/series/' + encodeURIComponent(mangaSlug)
            }
        });
        if (!cRes.ok) {
            console.log('[weebcentral] chapter list HTTP ' + cRes.status);
            return [];
        }
        var cHtml = await cRes.text();
        if (!cHtml) return [];
        var $$ = cheerioOf(cHtml);

        var chapRe = /chapter\s*([\d.]+)/i;
        var numRe = /[\d.]+/;
        var seen = {};
        var collected = [];
        $$('a[href*="/chapters/"]').each(function (i, el) {
            var href = $(el).attr('href') || '';
            if (!href) return;
            var cid = href.split('/chapters/')[1] || '';
            cid = cid.split('?')[0].split('#')[0].trim();
            if (!cid || seen[cid]) return;
            seen[cid] = true;
            var text = '';
            try { text = $(el).text().replace(/\s+/g, ' ').trim(); } catch (e) {}
            var m = chapRe.exec(text);
            var numStr = m ? m[1] : (numRe.exec(text) ? numRe.exec(text)[0] : cid);
            var num = parseFloat(numStr);
            var entry = { id: cid };
            entry.number = isNaN(num) ? parseFloat(collected.length + 1) : num;
            if (text) entry.title = text.slice(0, 120);
            collected.push(entry);
        });
        collected.reverse();
        collected.sort(function (a, b) { return a.number - b.number; });
        console.log('[weebcentral] returning ' + collected.length + ' chapters');
        return collected;
    } catch (e) {
        console.error('[weebcentral] getChapters fatal: ' + (e && e.message));
        return [];
    }
}

async function getChapterImages(chapterId) {
    try {
        var cid = String(chapterId == null ? '' : chapterId).trim();
        if (!cid) return [];
        // chapterId is stored bare; accept a full URL too.
        if (cid.indexOf('/chapters/') !== -1) {
            cid = cid.split('/chapters/')[1].split('?')[0].split('#')[0].trim();
        }
        var url = HOST + '/chapters/' + encodeURIComponent(cid) + '/images?is_prev=False&current_page=1&reading_style=long_strip';
        console.log('[weebcentral] getChapterImages ' + cid);
        var res = await fetch(url, {
            headers: { 'User-Agent': UA, 'Accept': '*/*', 'Referer': HOST + '/' }
        });
        if (!res.ok) return [];
        var html = await res.text();
        if (!html) return [];
        var $ = cheerioOf(html);
        var out = [];
        $('img, source').each(function (i, el) {
            var raw = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-original') || '';
            if (!raw) {
                try {
                    var ss = $(el).attr('srcset') || '';
                    if (ss) raw = ss.split(' ')[0].split(',')[0];
                } catch (e) {}
            }
            raw = String(raw).replace(/&amp;/g, '&').trim();
            if (!raw || raw.indexOf('http') !== 0) return;
            if (!/\.(jpg|jpeg|png|webp)/i.test(raw)) return;
            out.push({ url: raw, headers: { Referer: HOST + '/', 'User-Agent': UA } });
        });
        return out;
    } catch (e) {
        console.error('[weebcentral] getChapterImages fatal: ' + (e && e.message));
        return [];
    }
}

module.exports.getChapters = getChapters;
module.exports.getChapterImages = getChapterImages;
globalThis.getChapters = getChapters;
globalThis.getChapterImages = getChapterImages;
