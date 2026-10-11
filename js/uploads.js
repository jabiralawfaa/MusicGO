/* Upload storage — local mode only (file:// or localhost).
   Blobs (audio + thumbnail) and metadata live in IndexedDB; nothing is
   ever sent online. Classic script on purpose: ES modules are blocked on file://. */
(function (global) {
  "use strict";

  var DB_NAME = "musicgo-uploads";
  var DB_VERSION = 1;
  var TRACKS = "tracks";
  var PLISTS = "playlists";
  var dbPromise = null;

  function isLocal() {
    if (global.location.protocol === "file:") return true;
    var h = global.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
  }

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB unavailable"));
        return;
      }
      var req = global.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(TRACKS)) {
          var store = db.createObjectStore(TRACKS, { keyPath: "id" });
          store.createIndex("playlistId", "playlistId", { unique: false });
        }
        if (!db.objectStoreNames.contains(PLISTS)) {
          db.createObjectStore(PLISTS, { keyPath: "id" });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
      req.onerror = function () {
        dbPromise = null;
        reject(req.error || new Error("IndexedDB open failed"));
      };
    });
    return dbPromise;
  }

  function getAll(db, storeName) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(storeName, "readonly");
      var req = tx.objectStore(storeName).getAll();
      req.onsuccess = function () {
        resolve(req.result || []);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function recordToTrack(record) {
    return {
      name: record.title,
      artist: record.artist,
      audio: "",
      custom: true,
      src: global.URL.createObjectURL(record.audioBlob),
      thumb: record.thumbBlob ? global.URL.createObjectURL(record.thumbBlob) : null,
      uploadId: record.id,
      lyrics: record.lyrics || null,
    };
  }

  /* Merge stored playlists + tracks into the in-memory PLAYLISTS array.
     Returns a Promise<number> — how many uploaded tracks were added. */
  function hydrate(playlists) {
    if (!isLocal()) return Promise.resolve(0);
    return openDb()
      .then(function (db) {
        return Promise.all([getAll(db, PLISTS), getAll(db, TRACKS)]);
      })
      .then(function (res) {
        var defs = res[0];
        var records = res[1];
        var byId = {};
        playlists.forEach(function (pl) {
          byId[pl.id] = pl;
        });

        defs.forEach(function (def) {
          if (!byId[def.id]) {
            var pl = { id: def.id, label: def.label, bgVideo: "videos/wallpaper1.mp4", tracks: [] };
            playlists.push(pl);
            byId[pl.id] = pl;
          }
        });

        records.sort(function (a, b) {
          return a.addedAt - b.addedAt;
        });

        var added = 0;
        records.forEach(function (record) {
          var pl = byId[record.playlistId];
          if (!pl) {
            pl = {
              id: record.playlistId,
              label: record.title ? "Uploads" : "Uploads",
              bgVideo: "videos/wallpaper1.mp4",
              tracks: [],
            };
            playlists.push(pl);
            byId[pl.id] = pl;
          }
          pl.tracks.push(recordToTrack(record));
          added++;
        });
        return added;
      });
  }

  /* Persist one uploaded song (+ its playlist def when created).
     entry: { title, artist, playlistId, playlistLabel, isNewPlaylist, audioBlob, thumbBlob, lyrics }
     Returns Promise<record> (record.id / record.title / record.artist / blobs). */
  function save(entry) {
    var record = {
      id: "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      title: entry.title,
      artist: entry.artist,
      playlistId: entry.playlistId,
      audioBlob: entry.audioBlob,
      thumbBlob: entry.thumbBlob || null,
      lyrics: entry.lyrics || null,
      addedAt: Date.now(),
    };

    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var storeNames = entry.isNewPlaylist ? [TRACKS, PLISTS] : [TRACKS];
        var tx = db.transaction(storeNames, "readwrite");
        tx.objectStore(TRACKS).put(record);
        if (entry.isNewPlaylist) {
          tx.objectStore(PLISTS).put({
            id: entry.playlistId,
            label: entry.playlistLabel,
            addedAt: Date.now(),
          });
        }
        tx.oncomplete = function () {
          resolve(record);
        };
        tx.onerror = function () {
          reject(tx.error || new Error("save failed"));
        };
        tx.onabort = function () {
          reject(tx.error || new Error("save aborted"));
        };
      });
    });
  }

  function syncSafe(b0, b1, b2, b3) {
    return ((b0 & 0x7f) << 21) | ((b1 & 0x7f) << 14) | ((b2 & 0x7f) << 7) | (b3 & 0x7f);
  }

  function uint32BE(bytes, at) {
    return (
      (((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>>
        0) ||
      0
    );
  }

  function latin1(bytes, start, end) {
    var s = "";
    for (var i = start; i < end; i++) s += String.fromCharCode(bytes[i] & 0xff);
    return s;
  }

  function parseApic(payload) {
    if (!payload || payload.length < 4) return null;
    var enc = payload[0];
    var i = 1;
    var mimeEnd = -1;
    var limit = Math.min(payload.length, i + 64 + 1);
    var m;
    for (m = i; m < limit; m++) {
      if (payload[m] === 0x00) {
        mimeEnd = m;
        break;
      }
    }
    if (mimeEnd === -1) return null;
    var mime = latin1(payload, i, mimeEnd);
    i = mimeEnd + 1;
    if (i >= payload.length) return null;
    i++; /* picture-type byte */
    if (i > payload.length) return null;
    if (enc === 1 || enc === 2) {
      var j = i;
      var found = -1;
      while (j + 1 < payload.length) {
        if (payload[j] === 0x00 && payload[j + 1] === 0x00 && (j - i) % 2 === 0) {
          found = j;
          break;
        }
        j++;
      }
      if (found === -1) return null;
      i = found + 2;
    } else {
      var k = i;
      while (k < payload.length && payload[k] !== 0x00) k++;
      if (k >= payload.length) return null;
      i = k + 1;
    }
    if (i >= payload.length) return null;
    var imgBytes = payload.subarray(i);
    if (imgBytes.length === 0) return null;
    var outType = mime || "image/jpeg";
    if (outType.indexOf("image/") !== 0) return null;
    try {
      return new Blob([imgBytes], { type: outType });
    } catch (e) {
      return null;
    }
  }

  function parseTag(buf) {
    var bytes = new Uint8Array(buf);
    if (bytes.length < 10) return null;
    if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
    var major = bytes[3];
    if (major !== 3 && major !== 4) return null;
    var flags = bytes[5];
    var tagSize = syncSafe(bytes[6], bytes[7], bytes[8], bytes[9]);
    var tagEnd = 10 + tagSize;
    if (tagEnd > bytes.length) tagEnd = bytes.length;
    if (tagEnd <= 10) return null;
    var body;
    if (flags & 0x80) {
      var tmp = new Uint8Array(tagEnd - 10);
      var w = 0;
      var r = 10;
      while (r < tagEnd) {
        var by = bytes[r];
        tmp[w++] = by;
        if (by === 0xff && r + 1 < tagEnd && bytes[r + 1] === 0x00) r++;
        r++;
      }
      body = tmp.subarray(0, w);
    } else {
      body = bytes.subarray(10, tagEnd);
    }
    var pos = 0;
    if (flags & 0x40) {
      if (body.length < 4) return null;
      var extSize;
      if (major === 4) {
        extSize = syncSafe(body[0], body[1], body[2], body[3]);
      } else {
        extSize = 4 + uint32BE(body, 0);
      }
      pos = extSize;
      if (pos >= body.length) return null;
    }
    var frames = [];
    while (pos + 10 <= body.length) {
      var id = latin1(body, pos, pos + 4);
      var fsize = major === 4 ? syncSafe(body[pos + 4], body[pos + 5], body[pos + 6], body[pos + 7]) : uint32BE(body, pos + 4);
      if (body[pos] === 0 || fsize === 0) break;
      if (pos + 10 + fsize > body.length) break;
      frames.push({ id: id, data: body.subarray(pos + 10, pos + 10 + fsize) });
      pos += 10 + fsize;
    }
    return { major: major, frames: frames };
  }

  function parseCover(buf) {
    var tag = parseTag(buf);
    if (!tag) return null;
    for (var i = 0; i < tag.frames.length; i++) {
      if (tag.frames[i].id === "APIC") {
        var blob = parseApic(tag.frames[i].data);
        if (blob) return blob;
      }
    }
    return null;
  }

  function findTerminator(payload, from, enc) {
    var wide = enc === 1 || enc === 2;
    var j = from;
    if (wide) {
      while (j + 1 < payload.length) {
        if (payload[j] === 0x00 && payload[j + 1] === 0x00 && (j - from) % 2 === 0) return j;
        j++;
      }
      return -1;
    }
    while (j < payload.length) {
      if (payload[j] === 0x00) return j;
      j++;
    }
    return -1;
  }

  var WIN1252_EXTRA = {
    128: 8364, 130: 8218, 131: 402, 132: 8222, 133: 8230, 134: 8224, 135: 8225,
    136: 710, 137: 8240, 138: 352, 139: 8249, 140: 338, 142: 381, 145: 8216,
    146: 8217, 147: 8220, 148: 8221, 149: 8226, 150: 8211, 151: 8212, 152: 732,
    153: 8482, 154: 353, 155: 8250, 156: 339, 158: 382, 159: 376,
  };

  function manualDecode(data, label) {
    var out = "";
    var i, c, c2, c3, c4, v;
    if (label === "utf-16le" || label === "utf-16be") {
      var be = label === "utf-16be";
      i = 0;
      while (i + 1 < data.length) {
        v = be ? (data[i] << 8) | data[i + 1] : data[i] | (data[i + 1] << 8);
        i += 2;
        if (v >= 0xd800 && v <= 0xdbff && i + 1 < data.length) {
          var lo = be ? (data[i] << 8) | data[i + 1] : data[i] | (data[i + 1] << 8);
          if (lo >= 0xdc00 && lo <= 0xdfff) {
            out += String.fromCharCode(v, lo);
            i += 2;
            continue;
          }
        }
        out += String.fromCharCode(v);
      }
      if (i < data.length) out += "�";
      return out;
    }
    if (label === "utf-8") {
      i = 0;
      while (i < data.length) {
        c = data[i++];
        if (c < 0x80) out += String.fromCharCode(c);
        else if (c >= 0xc2 && c <= 0xdf && i < data.length) {
          c2 = data[i];
          if ((c2 & 0xc0) === 0x80) {
            out += String.fromCharCode(((c & 0x1f) << 6) | (c2 & 0x3f));
            i++;
          } else out += "�";
        } else if (c >= 0xe0 && c <= 0xef && i + 1 < data.length) {
          c2 = data[i];
          c3 = data[i + 1];
          if ((c2 & 0xc0) === 0x80 && (c3 & 0xc0) === 0x80) {
            out += String.fromCharCode(((c & 0x0f) << 12) | ((c2 & 0x3f) << 6) | (c3 & 0x3f));
            i += 2;
          } else out += "�";
        } else if (c >= 0xf0 && c <= 0xf4 && i + 2 < data.length) {
          c2 = data[i];
          c3 = data[i + 1];
          c4 = data[i + 2];
          if ((c2 & 0xc0) === 0x80 && (c3 & 0xc0) === 0x80 && (c4 & 0xc0) === 0x80) {
            v = ((c & 0x07) << 18) | ((c2 & 0x3f) << 12) | ((c3 & 0x3f) << 6) | (c4 & 0x3f);
            v -= 0x10000;
            out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
            i += 3;
          } else out += "�";
        } else out += "�";
      }
      return out;
    }
    for (i = 0; i < data.length; i++) {
      c = data[i];
      if (c < 128 || c >= 160) out += String.fromCharCode(c);
      else if (WIN1252_EXTRA[c]) out += String.fromCharCode(WIN1252_EXTRA[c]);
      else out += "�";
    }
    return out;
  }

  function decodeText(bytes, enc) {
    if (!bytes || bytes.length === 0) return "";
    var label;
    var data = bytes;
    if (enc === 3) label = "utf-8";
    else if (enc === 2) label = "utf-16be";
    else if (enc === 1) {
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
        label = "utf-16le";
        data = bytes.subarray(2);
      } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
        label = "utf-16be";
        data = bytes.subarray(2);
      } else label = "utf-16le";
    } else label = "windows-1252";
    if (typeof TextDecoder !== "undefined") {
      try {
        return new TextDecoder(label).decode(data);
      } catch (e) {}
    }
    try {
      return manualDecode(data, label);
    } catch (e) {
      return "";
    }
  }

  function parseUslt(payload) {
    if (!payload || payload.length < 4) return null;
    var enc = payload[0];
    var term = findTerminator(payload, 4, enc);
    if (term === -1) return null;
    var i = term + (enc === 1 || enc === 2 ? 2 : 1);
    if (i > payload.length) return null;
    return decodeText(payload.subarray(i), enc);
  }

  function parseSylt(payload) {
    if (!payload || payload.length < 6) return null;
    var enc = payload[0];
    var tsFormat = payload[4];
    var step = enc === 1 || enc === 2 ? 2 : 1;
    var mult = tsFormat === 1 ? 40 : 1;
    var i = 1 + 3 + 1 + 1;
    var lines = [];
    var total = 0;
    while (i < payload.length) {
      if (lines.length >= 800 || total >= 20000) break;
      var term = findTerminator(payload, i, enc);
      if (term === -1) break;
      var text = decodeText(payload.subarray(i, term), enc);
      i = term + step;
      if (i + 4 > payload.length) break;
      var stamp = uint32BE(payload, i);
      i += 4;
      var clean = text === null || text === undefined ? "" : String(text).replace(/^\uFEFF/, "").trim();
      if (!clean) continue;
      var room = 20000 - total;
      if (room <= 0) break;
      if (clean.length > room) clean = clean.slice(0, room);
      if (!clean) break;
      lines.push({ t: stamp * mult, text: clean });
      total += clean.length;
    }
    if (!lines.length) return null;
    lines.sort(function (a, b) {
      return a.t - b.t;
    });
    return lines;
  }

  function sanitizeLyrics(s) {
    if (s === null || s === undefined) return null;
    var t = String(s).replace(/^\uFEFF/, "").trim();
    t = t.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    t = t.replace(/\n{3,}/g, "\n\n");
    if (t.length > 20000) t = t.slice(0, 20000);
    t = t.trim();
    return t ? t : null;
  }

  function buildLyrics(buf) {
    var tag = parseTag(buf);
    if (!tag) return null;
    var i, k;
    for (i = 0; i < tag.frames.length; i++) {
      if (tag.frames[i].id === "SYLT") {
        var timed = null;
        try {
          timed = parseSylt(tag.frames[i].data);
        } catch (e) {
          timed = null;
        }
        if (timed && timed.length) return { synced: true, lines: timed };
      }
    }
    for (i = 0; i < tag.frames.length; i++) {
      if (tag.frames[i].id === "USLT") {
        var text = null;
        try {
          text = parseUslt(tag.frames[i].data);
        } catch (e) {
          text = null;
        }
        var clean = sanitizeLyrics(text);
        if (clean) {
          var parts = clean.split("\n");
          var lines = [];
          for (k = 0; k < parts.length && k < 800; k++) {
            lines.push({ t: null, text: parts[k] });
          }
          if (lines.length) return { synced: false, lines: lines };
        }
      }
    }
    return null;
  }

  /* Read the first bytes of an MP3 file (shared gate for cover + lyrics).
     Resolves ArrayBuffer, or null when not an MP3 / too small / unreadable. */
  function readHead(file) {
    return new Promise(function (resolve) {
      try {
        if (!file) {
          resolve(null);
          return;
        }
        var name = file.name || "";
        var type = file.type || "";
        if (!(/\.mp3$/i.test(name) || type === "audio/mpeg")) {
          resolve(null);
          return;
        }
        var size = file.size || 0;
        var end = Math.min(size, 10 * 1024 * 1024);
        if (end < 10) {
          resolve(null);
          return;
        }
        var chunk = file.slice(0, end);
        if (chunk.arrayBuffer) {
          chunk.arrayBuffer().then(
            function (ab) {
              resolve(ab);
            },
            function () {
              resolve(null);
            }
          );
        } else {
          var reader = new FileReader();
          reader.onload = function () {
            resolve(reader.result);
          };
          reader.onerror = function () {
            resolve(null);
          };
          reader.readAsArrayBuffer(chunk);
        }
      } catch (e) {
        resolve(null);
      }
    });
  }

  /* Detect embedded ID3v2 cover art (APIC) in an MP3 file.
     Returns Promise<Blob|null> — never rejects. */
  function extractCover(file) {
    return readHead(file).then(function (ab) {
      if (!ab) return null;
      try {
        return parseCover(ab);
      } catch (e) {
        return null;
      }
    });
  }

  /* Detect embedded lyrics (SYLT synced first, else USLT lines) in an MP3.
     Returns Promise<{synced, lines:[{t, text}]}|null> — never rejects. */
  function extractLyrics(file) {
    return readHead(file).then(function (ab) {
      if (!ab) return null;
      try {
        return buildLyrics(ab);
      } catch (e) {
        return null;
      }
    });
  }

  /* Read embedded cover + lyrics in a single pass over the file head.
     Returns Promise<{cover: Blob|null, lyrics: object|null}> — never rejects. */
  function extractMedia(file) {
    return readHead(file).then(function (ab) {
      var out = { cover: null, lyrics: null };
      if (!ab) return out;
      try {
        out.cover = parseCover(ab);
      } catch (e) {
        out.cover = null;
      }
      try {
        out.lyrics = buildLyrics(ab);
      } catch (e) {
        out.lyrics = null;
      }
      return out;
    });
  }

  global.MUSICGO_UPLOADS = {
    isLocal: isLocal,
    hydrate: hydrate,
    save: save,
    extractCover: extractCover,
    extractLyrics: extractLyrics,
    extractMedia: extractMedia,
  };
})(window);
