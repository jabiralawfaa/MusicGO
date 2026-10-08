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

  global.MUSICGO_UPLOADS = {
    isLocal: isLocal,
    hydrate: hydrate,
    save: save,
  };
})(window);
