/**
 * MangaTaro Manga Provider Plugin for Anivio
 *
 * Conforms to Anivio Plugin Guide §11 (manga providers):
 * - Single self-contained file, no import/export, native async/await (QuickJS).
 * - getChapters(mangaId, title): mangaId is the bare AniList media id ("30013") or "anilist:30013".
 * - getChapterImages(chapterId): chapterId is the exact `id` returned above.
 *
 * Direct REST API:
 *   search:   GET https://mangataro.org/auth/search?q={query}
 *   chapters: GET https://mangataro.org/auth/manga-chapters?manga_id={id}&offset={off}&limit=500&order=asc&_t={token}&_ts={ts}
 *   images:   GET https://mangataro.org/auth/chapter-content?chapter_id={chapterId}
 */

var HOST = 'https://mangataro.org';
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

// Pure JS MD5 implementation for QuickJS environment
function md5(string) {
    function rotateLeft(lValue, iShiftBits) {
        return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
    }
    function addUnsigned(lX, lY) {
        var lX4, lY4, lX8, lY8, lResult;
        lX8 = (lX & 0x80000000);
        lY8 = (lY & 0x80000000);
        lX4 = (lX & 0x40000000);
        lY4 = (lY & 0x40000000);
        lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
        if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
        if (lX4 | lY4) {
            if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
            else return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
        } else return (lResult ^ lX8 ^ lY8);
    }
    function F(x, y, z) { return (x & y) | ((~x) & z); }
    function G(x, y, z) { return (x & z) | (y & (~z)); }
    function H(x, y, z) { return (x ^ y ^ z); }
    function I(x, y, z) { return (y ^ (x | (~z))); }
    function FF(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(F(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }
    function GG(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(G(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }
    function HH(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(H(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }
    function II(a, b, c, d, x, s, ac) {
        a = addUnsigned(a, addUnsigned(addUnsigned(I(b, c, d), x), ac));
        return addUnsigned(rotateLeft(a, s), b);
    }
    function convertToWordArray(string) {
        var lWordCount;
        var lMessageLength = string.length;
        var lNumberOfWords_temp1 = lMessageLength + 8;
        var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
        var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
        var lWordArray = Array(lNumberOfWords - 1);
        var lBytePosition = 0;
        var lByteCount = 0;
        while (lByteCount < lMessageLength) {
            lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
            lByteCount++;
        }
        lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
        lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
        lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
        return lWordArray;
    }
    function wordToHex(lValue) {
        var WordToHexValue = '', WordToHexValue_temp = '', lByte, lCount;
        for (lCount = 0; lCount <= 3; lCount++) {
            lByte = (lValue >>> (lCount * 8)) & 255;
            WordToHexValue_temp = '0' + lByte.toString(16);
            WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
        }
        return WordToHexValue;
    }
    var x = convertToWordArray(string);
    var a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
    var S11 = 7, S12 = 12, S13 = 17, S14 = 22;
    var S21 = 5, S22 = 9, S23 = 14, S24 = 20;
    var S31 = 4, S32 = 11, S33 = 16, S34 = 23;
    var S41 = 6, S42 = 10, S43 = 15, S44 = 21;
    for (var k = 0; k < x.length; k += 16) {
        var AA = a, BB = b, CC = c, DD = d;
        a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
        d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
        b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
        d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
        c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
        b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
        d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
        c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
        b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
        d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
        b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
        a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
        d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
        b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
        d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
        b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
        d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
        b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
        d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
        b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
        a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
        d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
        b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
        d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
        b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
        d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
        c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
        b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
        d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
        b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
        a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
        d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
        c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
        b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
        d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
        c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
        b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
        d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
        c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
        b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
        d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
        b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
        a = addUnsigned(a, AA);
        b = addUnsigned(b, BB);
        c = addUnsigned(c, CC);
        d = addUnsigned(d, DD);
    }
    return (wordToHex(a) + wordToHex(b) + wordToHex(c) + wordToHex(d)).toLowerCase();
}

function generateToken() {
    var timestamp = Math.floor(Date.now() / 1000);
    var hour = new Date().toISOString().slice(0, 13).replace(/[-T:]/g, '');
    var secret = 'mng_ch_' + hour;
    var hash = md5(timestamp + secret).substring(0, 16);
    return { token: hash, timestamp: timestamp };
}

async function resolveMangaTitle(mangaId, fallbackTitle) {
    if (fallbackTitle && String(fallbackTitle).trim()) return String(fallbackTitle).trim();
    var bare = String(mangaId == null ? '' : mangaId).trim();
    if (bare.indexOf('anilist:') === 0) bare = bare.slice(8);
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
        console.log('[mangataro] getChapters id=' + mangaId + ' title=' + q);

        var sRes = await fetch(HOST + '/auth/search?q=' + encodeURIComponent(q), {
            headers: {
                'User-Agent': UA,
                'Referer': HOST + '/',
                'Accept': 'application/json'
            }
        });
        if (!sRes.ok) {
            console.log('[mangataro] search HTTP ' + sRes.status);
            return [];
        }
        var sData = await sRes.json();
        var results = sData && sData.results;
        if (!Array.isArray(results) || !results.length) {
            console.log('[mangataro] no search results');
            return [];
        }

        var best = results[0];
        var bestScore = -1;
        for (var i = 0; i < results.length; i++) {
            var item = results[i];
            var s = scoreTitle(q, item.title || '');
            if (s > bestScore) {
                bestScore = s;
                best = item;
            }
            if (Array.isArray(item.alt_titles)) {
                for (var a = 0; a < item.alt_titles.length; a++) {
                    var as = scoreTitle(q, item.alt_titles[a]);
                    if (as > bestScore) {
                        bestScore = as;
                        best = item;
                    }
                }
            }
        }

        if (!best || !best.id) return [];
        console.log('[mangataro] best match: ' + best.title + ' (id=' + best.id + ') score=' + bestScore);

        var allChapters = [];
        var offset = 0;
        var limit = 500;
        var maxPages = 6; // up to 3000 chapters
        var hasMore = true;

        for (var p = 0; p < maxPages && hasMore; p++) {
            var tok = generateToken();
            var cUrl = HOST + '/auth/manga-chapters?manga_id=' + encodeURIComponent(best.id) +
                '&offset=' + offset + '&limit=' + limit + '&order=asc&_t=' + tok.token + '&_ts=' + tok.timestamp;
            
            var cRes = await fetch(cUrl, {
                headers: {
                    'User-Agent': UA,
                    'Referer': best.permalink || (HOST + '/manga/' + (best.slug || '')),
                    'Accept': 'application/json'
                }
            });
            if (!cRes.ok) {
                console.log('[mangataro] chapters HTTP ' + cRes.status + ' at offset ' + offset);
                break;
            }
            var cData = await cRes.json();
            if (!cData || !cData.success || !Array.isArray(cData.chapters) || !cData.chapters.length) {
                break;
            }

            for (var j = 0; j < cData.chapters.length; j++) {
                var ch = cData.chapters[j];
                if (!ch || !ch.id) continue;
                var num = parseFloat(ch.chapter);
                var numVal = isNaN(num) ? (allChapters.length + 1) : num;
                var titleText = 'Chapter ' + ch.chapter;
                if (ch.title && String(ch.title).trim()) {
                    titleText += ': ' + String(ch.title).trim();
                }
                allChapters.push({
                    id: String(ch.id),
                    number: numVal,
                    title: titleText.slice(0, 120)
                });
            }

            hasMore = !!cData.has_more;
            offset += cData.chapters.length;
        }

        allChapters.sort(function(a, b) { return a.number - b.number; });
        console.log('[mangataro] returning ' + allChapters.length + ' chapters');
        return allChapters;
    } catch (e) {
        console.error('[mangataro] getChapters fatal: ' + (e && e.message));
        return [];
    }
}

async function getChapterImages(chapterId) {
    try {
        var cid = String(chapterId == null ? '' : chapterId).trim();
        if (!cid) return [];
        console.log('[mangataro] getChapterImages id=' + cid);

        var res = await fetch(HOST + '/auth/chapter-content?chapter_id=' + encodeURIComponent(cid), {
            headers: {
                'User-Agent': UA,
                'Referer': HOST + '/',
                'Accept': 'application/json'
            }
        });
        if (!res.ok) {
            console.log('[mangataro] chapter-content HTTP ' + res.status);
            return [];
        }
        var data = await res.json();
        if (!data || !data.success || !Array.isArray(data.images) || !data.images.length) {
            return [];
        }

        var out = [];
        for (var i = 0; i < data.images.length; i++) {
            var url = data.images[i];
            if (!url || typeof url !== 'string') continue;
            out.push({
                url: url.trim(),
                headers: {
                    'Referer': HOST + '/',
                    'User-Agent': UA
                }
            });
        }
        return out;
    } catch (e) {
        console.error('[mangataro] getChapterImages fatal: ' + (e && e.message));
        return [];
    }
}

module.exports.getChapters = getChapters;
module.exports.getChapterImages = getChapterImages;
globalThis.getChapters = getChapters;
globalThis.getChapterImages = getChapterImages;
