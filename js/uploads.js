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
     entry: { title, artist, playlistId, playlistLabel, isNewPlaylist, audioBlob, thumbBlob }
     Returns Promise<record> (record.id / record.title / record.artist / blobs). */
  function save(entry) {
    var record = {
      id: "t-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      title: entry.title,
      artist: entry.artist,
      playlistId: entry.playlistId,
      audioBlob: entry.audioBlob,
      thumbBlob: entry.thumbBlob || null,
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

  function parseCover(buf) {
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
    while (pos + 10 <= body.length) {
      var id = latin1(body, pos, pos + 4);
      var fsize = major === 4 ? syncSafe(body[pos + 4], body[pos + 5], body[pos + 6], body[pos + 7]) : uint32BE(body, pos + 4);
      if (body[pos] === 0 || fsize === 0) break;
      if (pos + 10 + fsize > body.length) break;
      if (id === "APIC") {
        var blob = parseApic(body.subarray(pos + 10, pos + 10 + fsize));
        if (blob) return blob;
      }
      pos += 10 + fsize;
    }
    return null;
  }

  /* Detect embedded ID3v2 cover art (APIC) in an MP3 file.
     Returns Promise<Blob|null> — never rejects. */
  function extractCover(file) {
    return new Promise(function (resolve) {
      function done(value) {
        resolve(value);
      }
      try {
        if (!file) {
          done(null);
          return;
        }
        var name = file.name || "";
        var type = file.type || "";
        var isMp3 = /\.mp3$/i.test(name) || type === "audio/mpeg";
        if (!isMp3) {
          done(null);
          return;
        }
        var size = file.size || 0;
        var end = Math.min(size, 10 * 1024 * 1024);
        if (end < 10) {
          done(null);
          return;
        }
        var chunk = file.slice(0, end);
        if (chunk.arrayBuffer) {
          chunk.arrayBuffer().then(
            function (ab) {
              try {
                done(parseCover(ab));
              } catch (e) {
                done(null);
              }
            },
            function () {
              done(null);
            }
          );
        } else {
          var reader = new FileReader();
          reader.onload = function () {
            try {
              done(parseCover(reader.result));
            } catch (e) {
              done(null);
            }
          };
          reader.onerror = function () {
            done(null);
          };
          reader.readAsArrayBuffer(chunk);
        }
      } catch (e) {
        resolve(null);
      }
    });
  }

  global.MUSICGO_UPLOADS = {
    isLocal: isLocal,
    hydrate: hydrate,
    save: save,
    extractCover: extractCover,
  };
})(window);
