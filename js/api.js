/*
 * js/api.js — connects the static front-end to the PHP API.
 *
 * The bundle was written to run entirely from a bundled js/data.js. This layer
 * keeps that working while preferring live data when a backend is reachable:
 *
 *   1. It probes GET {base}/health with a short timeout.
 *   2. On success it fetches {base}/catalog — the full published dataset in the
 *      exact window.TP_DATA shape — and replaces window.TP_DATA before app.js
 *      consumes it.
 *   3. On any failure (no backend, offline, GitHub Pages, timeout) it leaves the
 *      bundled data untouched and reports itself unavailable. The site never
 *      breaks; it simply runs from the static snapshot.
 *
 * window.TP_API.settled flips true once the decision is made — success or
 * fallback — and app.js waits for it so live data wins the race when it exists.
 *
 * Configuration: window.TP_CONFIG.apiBase (set by js/config.js), or
 * window.TP_API_BASE, or same-origin "/api" by default.
 */
(function () {
  if (window.TP_API) return;

  var cfg = window.TP_CONFIG || {};
  var raw =
    cfg.apiBase != null ? cfg.apiBase :
    window.TP_API_BASE != null ? window.TP_API_BASE :
    "";
  var base = String(raw).replace(/\/+$/, "");
  if (!base && window.location.protocol !== "file:") {
    base = (window.TP_BASE || "") + "/api";
  }

  var TIMEOUT_MS = 4000;

  var api = {
    base: base,
    available: false,
    settled: false,
    catalog: null,
    reason: null,
  };
  window.TP_API = api;

  var resolveReady;
  api.ready = function () {
    if (api.settled) return Promise.resolve(api);
    if (!api._ready) {
      api._ready = new Promise(function (res) { resolveReady = res; });
    }
    return api._ready;
  };
  function settle() {
    api.settled = true;
    if (resolveReady) resolveReady(api);
  }

  function fetchJSON(path) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    return fetch(base + path, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "same-origin",
      signal: ctrl ? ctrl.signal : undefined,
    }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  function validCatalog(c) {
    return c && Array.isArray(c.listings);
  }

  fetchJSON("/health")
    .then(function (h) {
      if (!h || h.status !== "ok") throw new Error("unhealthy");
      return fetchJSON("/catalog");
    })
    .then(function (catalog) {
      if (!validCatalog(catalog)) throw new Error("bad catalog");
      api.catalog = catalog;
      api.available = true;
      /* Only replace the bundle when the API actually has rows, so a wiped or
       * empty database does not blank out a working static site. */
      if (catalog.listings.length > 0) {
        window.TP_DATA = catalog;
      }
      settle();
    })
    .catch(function (err) {
      api.reason = err && err.message ? err.message : String(err);
      settle();
    });
})();
