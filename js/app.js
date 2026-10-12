(function () {
  if (window.__tpAppStarted) return;
  window.__tpAppStarted = true;
  const elt = (t) => (t instanceof Element ? t : t.parentElement);
  let started = false;

  function boot() {
    if (started) return;
    const data = window.TP_DATA;
    const auth = window.TP_AUTH;
    const domReady = document.readyState !== "loading";
    /* When js/api.js is present it probes the backend and may replace
     * window.TP_DATA with live data; wait for that decision — success or
     * fallback — so the API wins the race when it is reachable. The module
     * always settles (its own fetch timeout guarantees it), so this never
     * stalls the boot. */
    const api = window.TP_API;
    const apiSettled = !api || api.settled;
    if (!data || !auth || !domReady || !apiSettled) {
      if (!domReady) document.addEventListener("DOMContentLoaded", boot);
      const iv = window.setInterval(function () {
        boot();
        if (started) window.clearInterval(iv);
      }, 60);
      const dropError = () => {
        if (started) return;
        const root = document.getElementById("listings");
        if (root)
          root.innerHTML =
            '<div class="data-error" role="alert"><strong>Site scripts did not load</strong> — js/data.js or js/auth.js did not run. Refresh to retry.</div>';
      };
      window.setTimeout(dropError, api ? 9000 : 5000);
      return;
    }
    started = true;

    const R = window.TP_ROUTER;
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
    const PAGE_SIZE = data.pageSize || 28;

    /* Results-per-page preference, tunable from the Options menu on the
     * results toolbar (persisted in localStorage). */
    const PAGE_SIZE_CHOICES = [12, 28, 56];
    let RESULTS_PER_PAGE = (() => {
      try {
        const v = parseInt(window.localStorage.getItem("tp.resultsPerPage") || "", 10);
        if (PAGE_SIZE_CHOICES.indexOf(v) !== -1) return v;
      } catch (e) {}
      return PAGE_SIZE;
    })();

    /* ---------- watch list (localStorage; no backend yet) ---------- */
    function readWatchList() {
      try {
        return JSON.parse(window.localStorage.getItem("tp.watchlist") || "[]");
      } catch (e) {
        return [];
      }
    }
    function writeWatchList(list) {
      try {
        window.localStorage.setItem("tp.watchlist", JSON.stringify(list));
      } catch (e) {}
    }
    function hasWatch(id) {
      return readWatchList().indexOf(Number(id)) !== -1;
    }
    function addWatch(id) {
      const l = readWatchList();
      if (l.indexOf(Number(id)) === -1) {
        l.push(Number(id));
        writeWatchList(l);
      }
    }
    function removeWatch(id) {
      writeWatchList(readWatchList().filter((x) => x !== Number(id)));
    }
    function countWatch() {
      return readWatchList().length;
    }
    function watchListing(id) {
      return data.listings.find((L) => Number(L.id) === Number(id)) || null;
    }

    /* ---------- toast ------------- */
    let _toastTimer = null;
    function toast(msg) {
      let t = $(".toast");
      if (!t) {
        t = document.createElement("div");
        t.className = "toast";
        t.setAttribute("role", "status");
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.classList.add("show");
      clearTimeout(_toastTimer);
      _toastTimer = setTimeout(() => t.classList.remove("show"), 3000);
    }

    /* ---------- share ------------ */
    function shareCurrent(listingOrState) {
      const detail = listingOrState || currentListing;
      let title = "TruckPaper.com";
      let href = window.location.pathname + window.location.search;
      if (detail && detail.id != null) {
        title = detail.title;
        href = detailHref(detail);
      } else {
        const h1 = $("h1");
        if (h1 && h1.textContent) title = h1.textContent;
      }
      const url = window.location.origin + href;
      /* Guarantee called from every path so the button never stays silent. */
      const copyFallback = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          let done = false;
          const settled = () => {
            done = true;
            clearTimeout(shareTimeout);
          };
          navigator.clipboard
            .writeText(url)
            .then(() => { settled(); toast("Link copied to clipboard"); })
            .catch(() => { settled(); toast(url); });
          /* Some browsers hang the clipboard promise without permissions —
           * fall back to showing the link rather than leaving the button quiet. */
          const shareTimeout = setTimeout(() => { if (!done) toast(url); }, 400);
        } else {
          toast(url);
        }
      };
      if (navigator.share) {
        let shared = false;
        const shareTimeout = setTimeout(() => {
          if (!shared) copyFallback();
        }, 600);
        navigator
          .share({ title, text: title, url })
          .then(() => {
            shared = true;
            clearTimeout(shareTimeout);
            toast("Link shared");
          })
          .catch(() => {
            shared = true;
            clearTimeout(shareTimeout);
            copyFallback();
          });
      } else {
        copyFallback();
      }
    }

    function toggleWatch(id, menuBtn) {
      const nid = Number(id);
      if (hasWatch(nid)) {
        removeWatch(nid);
        toast("Removed from your watch list");
      } else {
        addWatch(nid);
        toast("Added to your watch list");
      }
      syncWatchIcons(nid);
      const mb = menuBtn && (menuBtn.closest ? menuBtn.closest("[data-opt=watch]") : menuBtn);
      if (mb) {
        mb.textContent = hasWatch(nid) ? "Remove from Watch List" : "Add to Watch List";
      }
    }
    function syncWatchIcons(id) {
      $$(`.image-watchlist[data-listing-id="${Number(id)}"]`).forEach((el) => {
        const w = hasWatch(Number(id));
        el.dataset.action = w ? "remove" : "add";
        el.classList.toggle("added", w);
        el.setAttribute("aria-label", w ? "Remove from Watch List" : "Add to Watch List");
        const icon = el.querySelector("i");
        if (icon) icon.className = w ? "fas fa-heart" : "far fa-heart";
      });
    }

    /* ---------- geolocation / closest-first ---------- */
    const STATE_CENTROIDS = {
      Alabama: [32.8, -86.8], Alaska: [63.9, -152.3], Arizona: [33.4, -111.9],
      Arkansas: [34.7, -92.4], California: [36.1, -119.5], Colorado: [39.0, -105.5],
      Connecticut: [41.6, -72.7], Delaware: [39.0, -75.5], "District of Columbia": [38.9, -77.0],
      Florida: [28.1, -81.6], Georgia: [32.8, -83.4], Hawaii: [19.6, -155.5],
      Idaho: [44.1, -114.8], Illinois: [39.8, -89.5], Indiana: [40.0, -86.2],
      Iowa: [42.0, -93.4], Kansas: [38.5, -98.3], Kentucky: [37.5, -85.3],
      Louisiana: [31.1, -92.0], Maine: [44.5, -69.4], Maryland: [39.3, -76.6],
      Massachusetts: [42.3, -71.9], Michigan: [44.3, -84.9], Minnesota: [46.4, -94.3],
      Mississippi: [32.7, -89.6], Missouri: [38.5, -92.4], Montana: [47.0, -109.6],
      Nebraska: [41.5, -99.8], Nevada: [39.3, -116.6], "New Hampshire": [43.7, -71.6],
      "New Jersey": [40.1, -74.7], "New Mexico": [34.4, -106.1], "New York": [42.8, -75.9],
      "North Carolina": [35.6, -79.3], "North Dakota": [47.5, -100.6], Ohio: [40.3, -82.8],
      Oklahoma: [35.6, -97.4], Oregon: [43.9, -120.5], Pennsylvania: [40.9, -77.8],
      "Rhode Island": [41.7, -71.6], "South Carolina": [33.9, -81.0],
      "South Dakota": [44.3, -100.2], Tennessee: [35.7, -86.5], Texas: [31.5, -99.6],
      Utah: [39.3, -111.7], Vermont: [44.0, -72.7], Virginia: [37.4, -78.7],
      Washington: [47.3, -120.7], "West Virginia": [38.6, -80.6], Wisconsin: [44.5, -89.4],
      Wyoming: [43.0, -107.5],
    };
    function stateCentroid(state) {
      if (!state) return null;
      const s = STATE_CENTROIDS[state];
      if (s) return s;
      const fuzzy = Object.keys(STATE_CENTROIDS).find((k) => String(state).toUpperCase().indexOf(k.toUpperCase()) !== -1 || k.toUpperCase().indexOf(String(state).toUpperCase()) !== -1);
      return fuzzy ? STATE_CENTROIDS[fuzzy] : null;
    }
    function haversineKm(a, b) {
      const R = 6371;
      const dLat = ((b[0] - a[0]) * Math.PI) / 180;
      const dLng = ((b[1] - a[1]) * Math.PI) / 180;
      const lat1 = (a[0] * Math.PI) / 180;
      const lat2 = (b[0] * Math.PI) / 180;
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    }
    let closestFirst = { on: false, coords: null };
    function geoSort(items) {
      if (!closestFirst.on || !closestFirst.coords) return items;
      const c = closestFirst.coords;
      return items
        .map((L) => {
          const g = stateCentroid(L.state) || stateCentroid((L.location || "").split(",")[1]);
          return { L, d: g ? haversineKm([c.latitude, c.longitude], g) : Infinity };
        })
        .sort((a, b) => a.d - b.d)
        .map((x) => x.L);
    }
    function setClosest(active) {
      closestFirst.on = !!active;
      const t = $("#show-closest-first-toggle");
      if (t) t.checked = closestFirst.on;
      const label = $(".closest");
      if (label) label.classList.toggle("active", closestFirst.on);
      if (currentState.view === "list") {
        setState({}, { replace: true }); /* re-render via route change */
      }
    }
    function toggleClosest() {
      if (closestFirst.on) {
        setClosest(false);
        return;
      }
      if (!navigator.geolocation) {
        toast("Geolocation is not supported in this browser.");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          closestFirst.coords = pos.coords;
          setClosest(true);
          toast("Sorted by proximity to your location");
        },
        () => {
          toast("Location access was not granted, so closest-first is unavailable.");
          setClosest(false);
        },
        { timeout: 8000 }
      );
    }

    /* ---------- generic modal ---------- */
    function openModal(html) {
      closeModal();
      const m = document.createElement("div");
      m.className = "tp-modal";
      m.setAttribute("role", "dialog");
      m.setAttribute("aria-modal", "true");
      m.innerHTML = `<div class="tp-modal-backdrop" data-tp-close></div>
        <div class="tp-modal-box">
          <button type="button" class="tp-modal-close" data-tp-close aria-label="Close">×</button>
          ${html}
        </div>`;
      document.body.appendChild(m);
      document.body.classList.add("modal-open");
      const first = m.querySelector("button:not([data-tp-close]), input, a");
      if (first) first.focus();
      return m;
    }
    function closeModal() {
      const m = $(".tp-modal");
      if (m) m.remove();
      document.body.classList.remove("modal-open");
    }

    function formatMoney(n) {
      return Number(n || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }

    function esc(s) {
      return String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    /* ---------- listing image base ----------
     * Listing photos are stored in the database as site-relative paths
     * ("assets/img/<id>/<n>.jpg") so the dataset stays portable: the same rows
     * work when the images sit on the same origin, and when they are served
     * from object storage such as Cloudflare R2. Only the base changes.
     *
     * Paths that are already absolute are left alone — a handful of listings
     * reference upstream originals on media.sandhills.com, and prefixing those
     * would corrupt them.
     *
     * window.TP_IMAGE_BASE is written at build time from TP_IMAGE_BASE (see
     * docker/render-config.sh). When it is unset, images resolve relative to
     * the page, which is the correct local behaviour. */
    const IMAGE_BASE = String(window.TP_IMAGE_BASE || "").replace(/\/+$/, "");

    function imgUrl(src) {
      const s = String(src ?? "");
      if (!s) return "";
      if (/^(https?:)?\/\//i.test(s) || s.startsWith("data:")) return s;
      if (s.startsWith("/")) return IMAGE_BASE + s;
      return IMAGE_BASE ? IMAGE_BASE + "/" + s : s;
    }

    /* RFC 2606 reserves .example/.test/.invalid/.localhost, so any seller link
     * built on one is a dead link by construction. Rendering it as an anchor
     * hands the user a 404 for the one thing they clicked: the seller. Return
     * the URL only when it can actually resolve, and the seller name prints as
     * plain text otherwise. A belt-and-braces guard — the data is already
     * cleaned at the source (scripts/backfill_contacts.php). */
    function sellerSite(url) {
      const raw = String(url ?? "").trim();
      if (!raw) return "";
      const m = raw.match(/^[a-z][a-z0-9+.-]*:\/\//i);
      if (!m) return "";
      const host = raw
        .slice(m[0].length)
        .split(/[/?#]/)[0]
        .toLowerCase()
        .replace(/^www\./, "");
      if (!host || !host.includes(".")) return "";
      const tld = host.slice(host.lastIndexOf("."));
      if ([".example", ".test", ".invalid", ".localhost"].includes(tld)) return "";
      return raw;
    }

    /* ---------- slug <-> canonical name maps (from data) ---------- */
    const catBySlug = {};
    const cats = data.categories || [];
    cats.forEach((c) => (catBySlug[R.slugify(c.name)] = c.name));
    const makes = (data.listings.map((L) => L.manufacturer).filter(Boolean));
    const makeBySlug = {};
    [...new Set(makes)].forEach((m) => (makeBySlug[R.slugify(m)] = m));
    const modelBySlug = {};
    data.listings.forEach((L) => {
      if (!L.model) return;
      modelBySlug[R.slugify(L.model)] = String(L.model).toUpperCase();
    });

    /* ---------- route parsing ---------- */
    const STATIC_VIEWS = new Set([
      "sell", "financing", "advertising", "dealers", "watch-list", "values",
      "shipping", "market-reports", "hosted-websites", "want-to-buy",
      "email-signup", "brands", "legal", "returns", "subscriptions", "alerts",
      "dealer-portal", "sitemap",
    ]);

    /* Virtual (zero-inventory) categories — Dismantled / Components / Parts
     * are real TruckPaper scopes this dataset doesn't yet carry. They keep
     * their own honest URLs and empty-state rendering. */
    const VIRTUAL_CATS = {
      "components": "Truck & Trailer Components",
      "truck-and-trailer-components": "Truck & Trailer Components",
      "dismantled-trucks-and-trailers": "Dismantled Trucks & Trailers",
      "parts": "Parts",
    };

    /* Present-metric: generator that walks listings and reports how many
     * non-empty values each spec key (and a few top-level fields) has. Used to
     * decide which faceted/range filters are backed by real data. */
    function specPresence() {
      const counts = {};
      const values = {};
      const bump = (k, v) => {
        counts[k] = (counts[k] || 0) + 1;
        if (!values[k]) values[k] = {};
        values[k][String(v)] = (values[k][String(v)] || 0) + 1;
      };
      data.listings.forEach((L) => {
        Object.keys(L.specs || {}).forEach((k) => {
          const v = L.specs[k];
          if (v != null && String(v).trim() !== "") bump(k, v);
        });
        ["vin", "price", "saleType"].forEach((top) => {
          if (L[top] != null && String(L[top]).trim() !== "") bump(top, L[top]);
        });
      });
      return { counts, values };
    }
    const SPEC_PRESENCE = specPresence();
    const numVal = (v) => {
      if (v == null) return null;
      const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
      return Number.isFinite(n) && String(v).trim() !== "" ? n : null;
    };

    function parseState() {
      const { segs, params } = R.parse();
      const st = {
        view: "list",
        id: null,
        category: null,
        make: null,
        model: null,
        keyword: null,
        condition: null,
        year: null,
        state: null,
        dealer: null,
        specs: {},
        ranges: {},
        pmin: null,
        pmax: null,
        sort: null,
        mode: null,
        page: 1,
      };

      if (segs[0] === "listing") {
        st.view = "detail";
        st.id = Number(segs[1]);
        /* A bad/typo'd id (non-numeric, zero, negative, missing) must still
         * render the honest "listing not found" page, not fall back to the
         * full inventory list. renderDetail handles a null id. */
        if (!Number.isFinite(st.id) || st.id <= 0) st.id = null;
        return st;
      }

      if (segs[0] === "login" || segs[0] === "register" || segs[0] === "forgot-password" || segs[0] === "reset-password") {
        st.view = segs[0] === "forgot-password" ? "forgot" : segs[0] === "reset-password" ? "reset" : segs[0];
        st.params = params;
        st.token = params.get("token") || null;
        return st;
      }

      if (segs.length === 1 && STATIC_VIEWS.has(segs[0])) {
        st.view = segs[0];
        return st;
      }

      const rest = segs.filter((s) => s !== "trucks" && s !== "search");
      const cat = rest[0] && catBySlug[rest[0]];
      const virtual = rest[0] && VIRTUAL_CATS[rest[0]];
      if (!cat && virtual) st.category = virtual;
      const make = rest[cat ? 1 : 0] && makeBySlug[rest[cat ? 1 : 0]];
      const model = rest[cat ? 2 : 1] && modelBySlug[rest[cat ? 2 : 1]];
      if (cat) st.category = cat;
      if (make) st.make = make;
      else if (rest.length === 1 && !cat && !virtual && rest[0] !== "listing")
        st.make = R.slugToUpper(rest[0]);
      if (model) st.model = model;
      else if (rest.length >= (cat ? 3 : 2) && !model) {
        const raw = rest[cat ? 2 : 1];
        if (raw) st.model = R.slugToUpper(raw);
      }

      const catQ = params.get("category");
      if (catQ && catBySlug[catQ]) st.category = catBySlug[catQ];
      const makeQ = params.get("make");
      if (makeQ && makeBySlug[makeQ]) st.make = makeBySlug[makeQ];
      const modelQ = params.get("model");
      if (modelQ && modelBySlug[modelQ]) st.model = modelBySlug[modelQ];

      st.keyword = params.get("q") || params.get("keyword") || params.get("search") || null;
      st.condition = params.get("condition") || null;
      st.year = params.get("year") || null;
      st.state = params.get("state") || null;
      st.dealer = params.get("dealer") || null;
      const pmin = params.get("pmin");
      st.pmin = pmin !== null && pmin !== "" ? numVal(pmin) : null;
      const pmax = params.get("pmax");
      st.pmax = pmax !== null && pmax !== "" ? numVal(pmax) : null;
      // Generic spec facets: sp_<key>=value
      params.forEach((v, k) => {
        if (k.indexOf("sp_") === 0) st.specs[k.slice(3)] = v;
      });
      // Generic numeric ranges: r_<key>=min..max
      params.forEach((v, k) => {
        if (k.indexOf("r_") === 0 && v.indexOf("..") !== -1) {
          const [a, b] = v.split("..");
          st.ranges[k.slice(2)] = {
            min: a !== "" ? numVal(a) : null,
            max: b !== "" ? numVal(b) : null,
          };
        }
      });
      st.sort = params.get("sort") || null;
      const mode = params.get("mode");
      st.mode = mode === "rent" ? "rent" : null;
      st.page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
      return st;
    }

    /* ---------- filtering ---------- */
    function getFiltered(st) {
      let items = data.listings.slice();
      if (st.category)
        items = items.filter((L) => L.category === st.category);
      if (st.make) {
        const m = String(st.make).toUpperCase();
        items = items.filter((L) => (L.manufacturer || "").toUpperCase() === m);
      }
      if (st.model) {
        const m = String(st.model).toUpperCase();
        /* Family URLs like /trucks/freightliner/cascadia resolve to a model
         * prefix rather than an exact model ("CASCADIA 116", "CASCADIA 125",
         * ...). Exact match is tried first so every full-model URL keeps its
         * current precise behaviour; the prefix branch only ever rescues
         * family URLs that would otherwise match nothing. */
        const exact = items.some((L) => (L.model || "").toUpperCase() === m);
        items = exact
          ? items.filter((L) => (L.model || "").toUpperCase() === m)
          : items.filter((L) => (L.model || "").toUpperCase().startsWith(m));
      }
      if (st.condition)
        items = items.filter((L) => (L.condition || "").toLowerCase() === String(st.condition).toLowerCase());
      if (st.year) items = items.filter((L) => String(L.year || "") === String(st.year));
      if (st.state)
        items = items.filter((L) => (L.state || "").toLowerCase() === String(st.state).toLowerCase());
      if (st.dealer)
        items = items.filter((L) =>
          (L.dealer || "").toLowerCase() === String(st.dealer).toLowerCase());
      if (st.mode === "rent")
        items = items.filter((L) => L.saleType === "rent");
      else
        items = items.filter((L) => L.saleType !== "rent");
      if (st.pmin != null)
        items = items.filter((L) => (L.price || 0) >= st.pmin);
      if (st.pmax != null)
        items = items.filter((L) => (L.price || 0) <= st.pmax && L.price > 0);
      Object.keys(st.specs).forEach((k) => {
        const want = String(st.specs[k]).toLowerCase();
        items = items.filter((L) => {
          const raw = (L.specs && L.specs[k]) || L[k];
          return raw != null && String(raw).toLowerCase() === want;
        });
      });
      Object.keys(st.ranges).forEach((k) => {
        const r = st.ranges[k];
        if (r.min == null && r.max == null) return;
        items = items.filter((L) => {
          const n = numVal((L.specs && L.specs[k]) || L[k]);
          if (n == null) return false;
          if (r.min != null && n < r.min) return false;
          if (r.max != null && n > r.max) return false;
          return true;
        });
      });
      if (st.keyword) {
        const k = String(st.keyword).toLowerCase();
        items = items.filter((L) =>
          [L.title, L.description, L.dealer, L.vin, L.location, L.model, L.manufacturer]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().indexOf(k) !== -1)
        );
      }
      return items;
    }

    function sortItems(items, st) {
      const mode = st.sort || "Featured Listings";
      const arr = items.slice();
      if (mode === "Price: Low to High") arr.sort((a, b) => (a.price || Infinity) - (b.price || Infinity));
      else if (mode === "Price: High to Low") arr.sort((a, b) => (b.price || 0) - (a.price || 0));
      else if (mode === "Year: Newest") arr.sort((a, b) => Number(b.year) - Number(a.year));
      else if (mode === "Year: Oldest") arr.sort((a, b) => Number(a.year) - Number(b.year));
      else if (mode === "Recently Updated") arr.sort((a, b) => (b.updated || "").localeCompare(a.updated || ""));
      return arr;
    }

    /* ---------- state -> URL ---------- */
    let currentState = parseState();

    function setState(patch, opts) {
      opts = opts || {};
      const next = { ...currentState, ...patch };
      R.navigate(R.urlFor(next), { replace: !!opts.replace, scrollTop: !!opts.scrollTop });
    }

    /* ---------- static shell builders ---------- */
    function renderChips() {
      const chips = $("#category-chips");
      if (!chips) return;
      const active = currentState.category || "Sleeper Trucks";
      chips.innerHTML =
        cats
          .map(
            (c) =>
              `<a class="chip${active === c.name ? " active" : ""}" data-route href="${esc(
                R.urlFor({ category: c.name })
              )}">${esc(c.name)}</a>`
          )
          .join("") +
        `<a class="chip" data-route href="${esc(
          R.urlFor({ category: "Dismantled Trucks & Trailers", view: "list" })
        )}">Dismantled Trucks &amp; Trailers</a>` +
        `<a class="chip" data-route href="${esc(
          R.urlFor({ category: "Truck & Trailer Components", view: "list" })
        )}">Components</a>` +
        `<a type="button" class="chip view-all-cats" href="#">View All Categories</a>`;
    }

    function renderCatPanel() {
      const catList = $("#category-menu-links");
      if (!catList) return;
      catList.innerHTML =
        cats
          .map(
            (c) =>
              `<a class="cat-col-links" data-route href="${esc(
                R.urlFor({ category: c.name })
              )}">${esc(c.name)}</a>`
          )
          .join("") +
        `<a class="cat-col-links" data-route href="${esc(
          R.urlFor({ category: "Truck & Trailer Components" })
        )}">Truck &amp; Trailer Components</a>
         <a class="cat-col-links" data-route href="${esc(
           R.urlFor({ category: "Dismantled Trucks & Trailers" })
         )}">Dismantled Trucks &amp; Trailers</a>
         <a class="cat-col-links" data-route href="${esc(
           R.urlFor({ category: "Parts" })
         )}">Parts</a>`;
    }

    const DATA_FILTERS = {
      Manufacturer: { key: "make", opts: () => [...new Set(makes)] },
      Model: { key: "model", opts: () => [...new Set(data.listings.map((L) => L.model).filter(Boolean))] },
      Year: {
        key: "year",
        opts: () => [...new Set(data.listings.map((L) => String(L.year)).filter(Boolean))].sort((a, b) => Number(b) - Number(a)),
      },
      Condition: { key: "condition", opts: () => [...new Set(data.listings.map((L) => L.condition).filter(Boolean))] },
      State: { key: "state", opts: () => [...new Set(data.listings.map((L) => L.state).filter(Boolean))].sort() },
    };

    /* Facet (exact-value) filters backed by real spec data. A key whose
     * presence is zero falls through to the "no data yet" note instead. */
    const FACET_FILTERS = {
      "Gross Vehicle Weight Rating": "Gross Vehicle Weight Rating",
      "Engine Manufacturer": "Engine Manufacturer",
      "Transmission": "Transmission",
      "Transmission Manufacturer": "Transmission Manufacturer",
      "Transmission Type": "Transmission Type",
      "Number of Speeds": "Number of Speeds",
      "Fuel Type": "Fuel Type",
      "Sleeper Type": "Sleeper Type",
      "Sleeper Size": "Sleeper Size",
      "Suspension": "Suspension",
      "Drive": "Drive",
      "DOT": "DOT",
      "Cab Style": "Cab Style",
      "Auxiliary Power Unit (APU)": "Auxiliary Power Unit (APU)",
      "Glider Kit": "Glider Kit",
      "Number of Rear Axles": "Number of Rear Axles",
      "Front Axle Weight": "Front Axle Weight",
      "Rear Axle Weight": "Rear Axle Weight",
      "Gross Vehicle Weight": "Gross Vehicle Weight",
      "Color": "Color",
      "Engine Model": "Engine Model",
    };

    /* Numeric range filters keyed to a spec key (or top-level field like
     * price). Bounds are computed from the real data. */
    const RANGE_FILTERS = {
      Price: { key: "price", unit: "$", singular: "$" },
      Mileage: { key: "Mileage", unit: "mi", singular: "mi" },
      Horsepower: { key: "Horsepower", unit: "HP", singular: "HP" },
      Hours: { key: "Hours", unit: "hrs", singular: "hr" },
      Quantity: { key: "Quantity", unit: "", singular: "" },
      Wheelbase: { key: "Wheelbase", unit: "in", singular: "in" },
    };

    const NO_DATA_FILTERS = new Set(["Stock #", "Country", "Certified"]);

    function facetOptions(key) {
      const groups = SPEC_PRESENCE.values[key] || {};
      return Object.keys(groups)
        .sort((a, b) => groups[b] - groups[a] || String(a).localeCompare(String(b)))
        .map((v) => ({ v, c: groups[v] }));
    }

    function rangeBounds(key) {
      let min = null, max = null, n = 0;
      data.listings.forEach((L) => {
        const raw = key === "price" ? L.price : (L.specs && L.specs[key]);
        const v = numVal(raw);
        if (v == null) return;
        n++;
        if (min == null || v < min) min = v;
        if (max == null || v > max) max = v;
      });
      return { min, max, n };
    }

    /* Whether a given sidebar filter currently holds a user selection. Drives
     * the "- Applied" tags live, instead of whatever was baked into data.filters
     * at generation time. */
    function isFilterLiveApplied(clean) {
      if (clean === "Category") return currentState.category != null;
      if (clean === "Listing Type and Auction Results") return currentState.mode === "rent";
      if (clean === "Search Results By Date") return currentState.sort === "Recently Updated";
      if (clean === "VIN #") return !!(currentState.specs && currentState.specs["VIN"]);
      if (clean in DATA_FILTERS) return currentState[DATA_FILTERS[clean].key] != null;
      if (clean in RANGE_FILTERS) {
        const r = currentState.ranges && currentState.ranges[RANGE_FILTERS[clean].key];
        return !!(r && (r.min != null || r.max != null));
      }
      if (clean in FACET_FILTERS) {
        const k = FACET_FILTERS[clean];
        return !!(currentState.specs && currentState.specs[k] != null);
      }
      return false;
    }

    function renderFilters() {
      const filterList = $("#filter-list");
      if (!filterList) return;

      /* Re-render on every route change, but keep panels the user has open. */
      const oldOpen = new Set(
        Array.from($$("button.filter-toggle", filterList))
          .filter((b) => b.getAttribute("aria-expanded") === "true")
          .map((b) => b.dataset.target)
      );

      const specoptById = {}; // filter name -> {key, opts}

      filterList.innerHTML = data.filters
        .map((name, i) => {
          const applied = isFilterLiveApplied(name.replace(" - Applied", ""));
          const id = `filter-${i}`;
          const clean = name.replace(" - Applied", "");
          const label = `${esc(clean)}${applied ? ' <span class="applied-tag">- Applied</span>' : ""}`;

          /* Category — applied chip, removable by checkbox toggle. */
          if (clean === "Category") {
            const cat = currentState.category || "Sleeper Trucks";
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${label}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}">
                <label><input type="checkbox" data-fkey="category" data-fvalue="${esc(
                  cat
                )}" checked /> ${esc(cat)}</label>
              </div>
            </li>`;
          }

          /* Listing type toggle (For Sale / Rent or Lease) — group feeds the
           * "mode" state exactly like the top Results bar toggle. */
          if (clean === "Listing Type and Auction Results") {
            const mode = currentState.mode;
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${esc(clean)}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}">
                <label><input type="checkbox" data-fkey="mode-sale" ${mode ? "" : "checked"} /> For Sale</label>
                <label><input type="checkbox" data-fkey="mode-rent" ${mode === "rent" ? "checked" : ""} /> Rent or Lease</label>
              </div>
            </li>`;
          }

          /* Sorting by recency = "Search Results By Date". */
          if (clean === "Search Results By Date") {
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${esc(clean)}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}">
                <label><input type="checkbox" data-fkey="sort" data-fvalue="Recently Updated" ${
                  currentState.sort === "Recently Updated" ? "checked" : ""
                } /> Recently Updated</label>
              </div>
            </li>`;
          }

          /* Existing category/make/year/condition/state filters. */
          if (clean in DATA_FILTERS) {
            const def = DATA_FILTERS[clean];
            const key = def.key;
            const opts = def.opts();
            const cur = currentState[key];
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${label}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}">
                ${opts
                  .map((o) => {
                    const checked =
                      cur != null && String(cur).toLowerCase() === String(o).toLowerCase();
                    return `<label><input type="checkbox" data-fkey="${esc(key)}" data-fvalue="${esc(
                      o
                    )}" ${checked ? "checked" : ""} /> ${esc(o)}</label>`;
                  })
                  .join("")}
              </div>
            </li>`;
          }

          /* VIN — free-text exact search (too many distinct values for a list). */
          if (clean === "VIN #") {
            const cur = currentState.specs["VIN"] || "";
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${label}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}">
                <label>Enter VIN
                  <input type="text" class="vin-text" value="${esc(
                    cur
                  )}" placeholder="e.g. 1XKZDP9X5LJ401714" style="width:100%;margin-top:4px;padding:6px;border:1px solid #ddd" />
                </label>
                <div style="font-size:11px;color:#666;margin-top:4px">Matches the full or partial VIN.</div>
              </div>
            </li>`;
          }

          /* Numeric ranges backed by real spec values. */
          if (clean in RANGE_FILTERS) {
            const def = RANGE_FILTERS[clean];
            const b = rangeBounds(def.key);
            const cur = (currentState.ranges && currentState.ranges[def.key]) || {};
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${label}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}" data-range="${esc(def.key)}" data-unit="${esc(
                def.unit
              )}" data-singular="${esc(def.singular)}">
                ${
                  b.n
                    ? `<label>Min <input type="number" class="range-min" value="${
                        cur.min != null ? cur.min : ""
                      }" min="${b.min}" max="${b.max}" placeholder="${b.min.toLocaleString()}" style="width:110px;margin-left:6px" /></label>
                       <label>Max <input type="number" class="range-max" value="${
                         cur.max != null ? cur.max : ""
                       }" min="${b.min}" max="${b.max}" placeholder="${b.max.toLocaleString()}" style="width:110px;margin-left:6px" /></label>`
                    : `<div style="font-size:12px;color:#888;padding:4px 0">No ${esc(clean).toLowerCase()} data in the current inventory.</div>`
                }
              </div>
            </li>`;
          }

          /* Exact-value facets from spec data. */
          if (clean in FACET_FILTERS) {
            const key = FACET_FILTERS[clean];
            const opts = facetOptions(key);
            specoptById[clean] = { key, opts };
            const cur = currentState.specs[key];
            const appliedTag =
              cur != null ? ` <span class="applied-tag">- Applied</span>` : "";
            if (!opts.length) {
              return `<li>
                <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                  <span>${esc(clean)}</span><span class="chev"></span>
                </button>
                <div class="filter-panel" id="${id}">
                  <div style="font-size:12px;color:#888;padding:4px 0">No ${esc(
                    clean
                  ).toLowerCase()} data in the current inventory.</div>
                </div>
              </li>`;
            }
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${esc(clean)}${appliedTag}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}" data-facet="${esc(key)}">
                ${
                  opts.length > 40
                    ? `<input type="text" class="facet-lookup" placeholder="Filter…" style="width:100%;padding:6px;border:1px solid #ddd;margin-bottom:6px" />`
                    : ""
                }
                <div class="facet-list">
                  ${opts
                    .map(
                      (o) =>
                        `<label><input type="checkbox" data-fkey="spec" data-facetkey="${esc(
                          key
                        )}" data-fvalue="${esc(o.v)}" ${
                          cur != null && String(cur).toLowerCase() === String(o.v).toLowerCase()
                            ? "checked"
                            : ""
                        } /> ${esc(o.v)} <span class="facet-count">(${o.c})</span></label>`
                    )
                    .join("")}
                </div>
              </div>
            </li>`;
          }

          /* Filters with no backing data — honest no-data note. */
          if (NO_DATA_FILTERS.has(clean) || clean === "Cab Style" || clean === "Glider Kit") {
            return `<li>
              <button type="button" class="filter-toggle" aria-expanded="false" data-target="${id}">
                <span>${esc(clean)}</span><span class="chev"></span>
              </button>
              <div class="filter-panel" id="${id}">
                <div style="font-size:12px;color:#888;padding:4px 0">No ${esc(
                  clean
                ).toLowerCase()} data in the current inventory yet.</div>
              </div>
            </li>`;
          }

          return "";
        })
        .join("") +
        `<li style="padding:10px 12px;font-size:12px;color:#666;background:#fafafa"><strong>Additional Filters</strong></li>
         <li>
           <button type="button" class="filter-toggle" aria-expanded="false" data-target="filter-dealer">
             <span>Dealer${currentState.dealer ? ' <span class="applied-tag">- Applied</span>' : ""}</span><span class="chev"></span>
           </button>
           <div class="filter-panel" id="filter-dealer">
             <input type="text" class="facet-lookup" placeholder="Filter dealer…" style="width:100%;padding:6px;border:1px solid #ddd;margin-bottom:6px" />
             <div class="facet-list">
               ${dealersWithCounts()
                 .slice(0, 40)
                 .map(
                   (d) =>
                     `<label><input type="checkbox" data-fkey="dealer" data-fvalue="${esc(
                       d.name
                     )}" ${
                       currentState.dealer &&
                       String(currentState.dealer).toLowerCase() === String(d.name).toLowerCase()
                         ? "checked"
                         : ""
                     } /> ${esc(d.name)} <span class="facet-count">(${d.c})</span></label>`
                 )
                 .join("")}
               ${
                 dealersWithCounts().length > 40
                   ? '<div class="facet-more" style="font-size:11px;color:#888;padding:6px 2px">Type above to find more dealers.</div>'
                   : ""
               }
             </div>
           </div>
         </li>`;

      /* Restore any panels the user had expanded before this re-render. */
      if (oldOpen.size) {
        $$("button.filter-toggle", filterList).forEach((b) => {
          if (oldOpen.has(b.dataset.target)) {
            const panel = document.getElementById(b.dataset.target);
            if (panel) panel.classList.add("open");
            b.classList.add("open");
            b.setAttribute("aria-expanded", "true");
          }
        });
      }

      const applyCheckboxChange = (e, x) => {
        const key = x.fkey;
        if (key === "mode-sale" || key === "mode-rent") {
          const rentOn = e.target.checked && key === "mode-rent";
          setState({ mode: rentOn ? "rent" : null, page: 1 });
          return;
        }
        if (key === "spec") {
          const specs = { ...(currentState.specs || {}) };
          if (e.target.checked) specs[x.facetkey] = x.fvalue;
          else delete specs[x.facetkey];
          setState({ specs, page: 1 });
          return;
        }
        if (key === "dealer") {
          setState({ dealer: e.target.checked ? x.fvalue : null, page: 1 });
          return;
        }
        const chosen = e.target.checked ? x.fvalue : null;
        setState({ [key]: chosen, page: 1 });
      };

      filterList.addEventListener("click", (e) => {
        const btn = e.target.closest(".filter-toggle");
        if (btn) {
          const panel = document.getElementById(btn.dataset.target);
          const open = panel.classList.toggle("open");
          btn.classList.toggle("open", open);
          btn.setAttribute("aria-expanded", open ? "true" : "false");
          return;
        }
        const viewAll = e.target.closest(".view-all-cats");
        if (viewAll) {
          e.preventDefault();
          const catBtn = document.querySelector(".cat-nav .more-btn");
          if (catBtn && catBtn.nextElementSibling) {
            const open = catBtn.classList.toggle("open");
            catBtn.nextElementSibling.classList.toggle("open", open);
            catBtn.nextElementSibling.setAttribute("aria-hidden", open ? "false" : "true");
          }
        }
      });
      filterList.addEventListener("change", (e) => {
        const x = e.target && e.target.dataset;
        if (x && (e.target.type === "checkbox")) {
          applyCheckboxChange(e, x);
          return;
        }
        if (e.target.classList.contains("range-min") || e.target.classList.contains("range-max")) {
          const panel = e.target.closest("[data-range]");
          const key = panel.dataset.range;
          const ranges = { ...(currentState.ranges || {}) };
          const cur = { ...(ranges[key] || {}) };
          const minInput = panel.querySelector(".range-min");
          const maxInput = panel.querySelector(".range-max");
          cur.min = minInput && minInput.value !== "" ? numVal(minInput.value) : null;
          cur.max = maxInput && maxInput.value !== "" ? numVal(maxInput.value) : null;
          if (cur.min == null && cur.max == null) delete ranges[key];
          else ranges[key] = cur;
          setState({ ranges, page: 1 });
          return;
        }
        if (e.target.classList.contains("vin-text")) {
          const specs = { ...(currentState.specs || {}) };
          if (e.target.value.trim()) specs["VIN"] = e.target.value.trim();
          else delete specs["VIN"];
          setState({ specs, page: 1 });
        }
      });
      filterList.addEventListener("input", (e) => {
        const box = e.target.closest(".facet-lookup");
        if (!box) return;
        const list = box.parentElement.querySelector(".facet-list");
        if (!list) return;
        const q = box.value.toLowerCase();
        list.querySelectorAll("label").forEach((l) => {
          l.style.display = l.textContent.toLowerCase().indexOf(q) !== -1 ? "" : "none";
        });
      });
    }

    function dealersWithCounts() {
      const m = {};
      data.listings.forEach((L) => {
        if (!L.dealer) return;
        m[L.dealer] = (m[L.dealer] || 0) + 1;
      });
      return Object.keys(m)
        .map((name) => ({ name, c: m[name] }))
        .sort((a, b) => b.c - a.c);
    }

    function renderBlogSide() {
      const blog = $("#blog-side");
      if (!blog) return;
      data.blogs.forEach((b) => {
        const a = document.createElement("a");
        a.href = "https://www.truckpaper.com/blog/";
        a.target = "_blank";
        a.rel = "noopener";
        a.innerHTML = `${esc(b.title)}<span class="date">${esc(b.date)}</span>`;
        blog.appendChild(a);
      });
    }

    /* ---------- card renderers (unchanged visuals, internal URLs) ---------- */
    function leftFlavorHtml(L) {
      if (L.isAT) return `<span class="left-flavor at">Online Auction</span>`;
      if (L.isEF) return `<span class="left-flavor ef">On-Site Auction</span>`;
      if (L.isFeatured || L.badge === "Featured Listing")
        return `<span class="left-flavor feat">Featured Listing</span>`;
      if (L.badge) return `<span class="left-flavor feat">${esc(L.badge)}</span>`;
      return "";
    }

    function lotHtml(L) {
      if (L.lotNumber == null || L.lotNumber === "") return "";
      const at = !!L.isAT;
      const bg = at ? "#b12a1c" : "#ffcc01";
      const img = at ? "assets/at-icon-white.png" : "assets/ef-icon.png";
      const alt = at ? "Auction Time Logo" : "Equipment Facts Logo";
      const live = at ? `<span style="color:#fff">Live</span>` : "";
      const mr = at ? ' style="margin-right: 5px;"' : ' style="margin-right:"';
      return `<div class="lot-number">
        <span>Lot # ${esc(L.lotNumber)}</span>
        <div class="live-tile" style="margin-left:5px;background-color:${bg}">
          <img alt="${alt}"${mr} src="${img}">${live}
        </div>
      </div>`;
    }

    function detailHref(L) {
      return R.urlFor({ view: "detail", id: L.id });
    }

    function titleHtml(L) {
      return `<div class="list-listing-title">
        ${lotHtml(L)}
        <div class="listing-title">
          <h2 class="listing-portion-title" title="${esc(L.title)}">
            <a data-route href="${esc(detailHref(L))}" class="list-listing-title-link">${esc(
              L.title
            )} <p class="listing-category">${esc(L.category)}</p></a>
          </h2>
        </div>
      </div>
      <div class="options-popper-container">
        <div class="options-popper-div">
          <button type="button" class="options-popper-btn" aria-label="Options" style="padding:0;font-size:11px;margin-top:0">
            <i class="fa-solid fa-gear"></i><strong>Options</strong>
          </button>
        </div>
      </div>`;
    }

    function imageHtml(L) {
      const imgs = (L.images || []).slice(0, 6);
      if (!imgs.length) return "";
      const hasMany = imgs.length > 1;
      const slide = (src, i, ghost) =>
        `<div class="slick-slide${ghost ? " slick-viewall" : ""}">
          <img class="listing-main-img${ghost ? " ghost" : ""}" src="${esc(
          imgUrl(src)
        )}" alt="${esc(L.alt || L.title)}" loading="${i ? "lazy" : "eager"}" referrerpolicy="no-referrer" />
        </div>`;
      let viewSlide = "";
      const last = imgs[imgs.length - 1];
      viewSlide = `<div class="slick-slide slick-viewall">
        <span class="contain" style="max-width:100%">
          <div class="view-all" tabindex="-1" role="link" data-href="${esc(
            detailHref(L)
          )}" aria-label="${esc(L.title)} ${esc(L.category)}">See All ${L.imageCount || 0} Photos</div>
        </span>
        <img class="listing-main-img ghost" src="${esc(imgUrl(last))}" alt="" />
      </div>`;
      const allSlides = imgs
        .slice(0, hasMany ? imgs.length - 1 : 1)
        .map((s, i) => slide(s, i, false))
        .join("") + viewSlide;
      const dots = imgs
        .map(
          (_, i) =>
`<li class="${i === 0 ? "slick-active" : ""}" data-slide="${i}"><div><i role="button" tabindex="0" aria-label="Go to photo ${i + 1}" class="${
                i === 0 ? "fas" : "far"
              } fa-circle"></i></div></li>`
        )
        .join("");
      return `<div class="listing-image">
        <div class="listing-image-container">
          <span class="top-banner">
            ${leftFlavorHtml(L)}
            <span class="right-flavor">
              <span role="button" tabindex="0" aria-label="${hasWatch(L.id) ? "Remove from Watch List" : "Add to Watch List"}" class="image-watchlist watchlist-ad${hasWatch(L.id) ? " added" : ""}" data-listing-id="${L.id}" data-action="${hasWatch(L.id) ? "remove" : "add"}"><i class="${hasWatch(L.id) ? "fas" : "far"} fa-heart"></i></span>
            </span>
          </span>
          <a data-route href="${esc(detailHref(L))}" aria-label="View Details For ${esc(L.title)}">
            <div class="slick-slider">
              <i class="fas fa-chevron-left arrow arrow-left" role="button" tabindex="0" aria-label="Previous photo"></i>
              <div class="slick-list">
                <div class="slick-track">${allSlides}</div>
              </div>
              <i class="fas fa-chevron-right arrow arrow-right" role="button" tabindex="0" aria-label="Next photo"></i>
              <div class="slick-dots"><ul>${dots}</ul></div>
            </div>
          </a>
        </div>
      </div>`;
    }

    function priceHtml(L) {
      const isAuc = L.isAT || L.isEF;
      if (isAuc) {
        return `<div class="price-contain">
          <div>
            <div class="retail-price-container">
              <div>
                <strong>
                  <span class="spec-label">Current Bid:</span>
                  <span class="auction-price">${esc(L.currency || "USD")} $${formatMoney(
                    L.currentBid || 0
                  )}</span>
                  <br>
                  <span class="quantity-label"> </span>
                </strong>
              </div>
            </div>
          </div>
        </div>
        <div class="below-price-container"></div>`;
      }
      return `<div class="price-contain">
        <div>
          <div class="retail-price-container">
            <span class="price">${esc(L.priceLabel || "USD $" + formatMoney(L.price))}</span>
          </div>
        </div>
      </div>
      <div class="below-price-container">
        ${
          L.payment
            ? `<div class="payments-as-low-as-link">
                <a href="${esc(R.urlFor({ view: "financing" }))}" rel="nofollow" class="payments-as-low-as-route" aria-label="Payments as low as ${esc(
                L.currency || "USD"
              )} $${formatMoney(L.payment)}">Payments as low as ${esc(
                L.currency || "USD"
              )} $${formatMoney(L.payment)}*<i class="fas fa-external-link-alt" aria-hidden="true"></i></a>
              </div>`
            : ""
        }
      </div>`;
    }

    function widgetsHtml(L) {
      const financing = L.currency === "USD";
      return `<div class="widget-container">
        <div class="listing-widgets listing-widgets-undefined">
          ${
            financing
              ? `<div class="financing listing-widget__financing Currency">
                  <a class="listing-widget__link" href="${esc(
                    R.urlFor({ view: "financing" })
                  )}" data-route rel="nofollow" aria-label="*Apply for Financing">
                    <span class="listing-widget__text">*Apply for Financing</span>
                  </a>
                </div>`
              : ""
          }
          <div class="shipping listing-widget__shipping">
            <a class="listing-widget__link" href="https://www.fr8star.com/" target="_blank" rel="noopener nofollow noopener" aria-label="Get Shipping Quotes">
              <span class="listing-widget__text">Get Shipping Quotes</span>
            </a>
          </div>
        </div>
      </div>`;
    }

    function timeRemainingHtml(L) {
      const raw = (L.timeRemaining || "").trim();
      if (!raw) return "";
      const parts = raw.match(/(\d+)\s*([A-Za-z]+)/g) || [];
      if (!parts.length) return esc(raw);
      return parts
        .map((p) => {
          const m = p.match(/(\d+)\s*([A-Za-z]+)/);
          if (!m) return esc(p);
          const cap = m[2] ? m[2].charAt(0).toUpperCase() + m[2].slice(1) : "";
          return `<strong>${m[1]}</strong><span> ${cap}</span>`;
        })
        .join(" ");
    }

    function auctionContentHtml(L) {
      if (L.isAT) {
        return `<div class="listing-content">
          <span class="spec-value"><span>No Buyer's Premium</span></span>
          <div>
            <span class="spec-label"><span>Number of Bids</span>: </span>
            <span class="spec-value">${esc(L.bidCount ?? "")}</span>
          </div>
          ${
            L.timeRemaining
              ? `<div>
                  <span class="spec-label opens"><span>Time Remaining</span>:</span>
                  <span class="spec-value">${timeRemainingHtml(L)}</span>
                </div>`
              : ""
          }
        </div>`;
      }
      if (L.isEF) {
        return `<div class="listing-content">
          <span class="spec-value red-text buyers-premium-link" role="button" tabindex="0">
            <strong><span>View Buyer's Premium</span></strong>
          </span>
          <div>
            <span class="spec-label date">Auction Date:</span>
            <span class="spec-value">${esc(L.auctionDate || L.auctionDateLabel || "")}</span>
          </div>
        </div>`;
      }
      return "";
    }

    function specsContainerHtml(L) {
      const entries = Object.entries(L.specs || {});
      if (!entries.length) return "";
      const split = L.isEF ? 1 : 2;
      const visible = entries.slice(0, split);
      const hidden = entries.slice(split);
      const specRow = ([k, v]) =>
        `<div class="list-spec"><div class="spec"><span class="spec-label">${esc(
          k
        )}:&nbsp;</span><span class="spec-value">${esc(v)}</span></div></div>`;
      const hiddenRows = hidden
        .map(([k, v]) => (k === "Updated" ? "<br>" : "") + specRow([k, v]))
        .join("");
      return `<div class="specs-container">
        ${visible.map(specRow).join("")}
        ${
          hidden.length
            ? `<div class="specs-button" role="button" tabindex="0" aria-label="Show Specs"><i class="fas fa-angle-down"></i></div>
               <span class="hidden">${hiddenRows}</span>`
            : ""
        }
        <div class="machine-location"><strong><span>Location</span>:</strong><span>&nbsp;</span>${esc(
          L.location || ""
        )}</div>
      </div>`;
    }

    function contactHtml(L) {
      const tel = (L.phone || "").replace(/[^\d+]/g, "");
      /* Per-listing seller email when the listing carries one; the scraped rows
       * have no email field, so they keep the site-level support inbox. */
      const sellerMail = L.email || "c9919145@gmail.com";
      return `<div class="contact-container">
        <div class="shared count-2">
          <a class="email" href="mailto:${esc(sellerMail)}" title="Email the seller about this listing">
            <i class="fas fa-envelope"></i> <span>Email Seller</span>
          </a>
          ${
            L.phone
              ? `<div class="dealer-data">
                  <i class="fas fa-phone-alt"></i>&nbsp;<a href="tel:${esc(
                    tel
                  )}" data-phonetype="Retail Phone" class="phone-link"><strong>${esc(
                  L.phone
                )}</strong></a>
                </div>`
              : ""
          }
        </div>
        <div class="seller">
          <span>Seller</span>: ${
            sellerSite(L.website)
              ? `<a href="${esc(L.website)}" target="_blank" rel="noopener" aria-label="${esc(
                  L.dealer
                )} (Opens in a new tab)">${esc(L.dealer)}</a>`
              : `<!-- -->${esc(L.dealer || "")}`
          }
        </div>
      </div>`;
    }

    function viewDetailsHtml(L) {
      const isAuc = L.isAT || L.isEF;
      return `<span>
        <a data-route class="view-listing-details-link des-view-listingDetails template-branded-button" href="${esc(
          detailHref(L)
        )}" aria-label="View Details For ${esc(L.title)}">${isAuc ? '<i class="fas fa-search-plus" aria-hidden="true"></i>' : ""}View Details</a>
      </span>`;
    }

    function adSlotHtml(name) {
      return `<div class="banner-ad-container ad-slot" data-slot="${name}">
        <div class="DoubleClick_${name}">
          <span class="ad-label">Advertisement</span>
          <div class="ad-ph">300 x 250</div>
        </div>
      </div>`;
    }

    function currencyBannerHtml() {
      return `<div class="currency-banner currency-banner-list">
        <div class="currency-text currency-estimate-not-completed currency-background">
          <div class="currency-text">Buy what you want <span>with</span>
            <img src="assets/currency-white.png" alt="Currency Finance Logo">
          </div>
          <div class="currency-image currency-image-list"></div>
          <div class="currency-apply currency-apply-list">
            <p role="button" tabindex="0" class="currency-btn gtm-loan-approval-estimate-banner-get-loan-amount">Check buying power</p>
          </div>
        </div>
      </div>`;
    }

    function cardHtml(L, index, isPageOne) {
      const inserted =
        isPageOne ? (index === 3 ? currencyBannerHtml() : "") + (index === 7 ? adSlotHtml("Listings_Bottom") : "") : "";

      return `${inserted}<div class="list-listing-card-wrapper">
        <div id="${L.id}" class="ListingParentElement">
          <div class="listing-card-grid listing-data-selector" data-listing-id="${L.id}">
            <div class="extra-space">
              ${titleHtml(L)}
              ${imageHtml(L)}
              ${priceHtml(L)}
              ${widgetsHtml(L)}
              ${viewDetailsHtml(L)}
              ${auctionContentHtml(L)}
            </div>
            ${specsContainerHtml(L)}
            ${contactHtml(L)}
          </div>
        </div>
      </div>`;
    }

    /* ---------- breadcrumbs ---------- */
    function setBreadcrumb(crumbs) {
      const box = $(".breadcrumb-links");
      if (!box) return;
      box.innerHTML = crumbs
        .map((c, i) => {
          const last = i === crumbs.length - 1;
          if (last) return `<span class="bc-current">${esc(c.label)}</span>`;
          return `<a data-route href="${esc(c.url)}">${esc(c.label)}</a>`;
        })
        .join(" <span class=\"bc-sep\">&gt;</span> ");
    }

    function stateBreadcrumbs(st, detailTitle) {
      const crumbs = [{ label: "TRUCKS FOR SALE", url: "/" }];
      if (st.view === "detail") {
        const L = currentListing;
        if (L && L.category) crumbs.push({ label: String(L.category).toUpperCase(), url: R.urlFor({ category: L.category }) });
        if (L && L.manufacturer) crumbs.push({ label: L.manufacturer.toUpperCase(), url: R.urlFor({ make: L.manufacturer }) });
        crumbs.push({ label: detailTitle || L.title, url: null });
        return crumbs;
      }
      if (st.category) crumbs.push({ label: st.category.toUpperCase(), url: R.urlFor({ category: st.category }) });
      if (st.make) crumbs.push({ label: st.make.toUpperCase(), url: R.urlFor({ category: st.category, make: st.make }) });
      if (st.model) crumbs.push({ label: st.model.toUpperCase(), url: R.urlFor({ category: st.category, make: st.make, model: st.model }) });
      if (crumbs.length === 1) {
        if (st.keyword || st.condition || st.year || st.state || st.mode === "rent")
          crumbs.push({ label: "SEARCH RESULTS", url: null });
        else crumbs.push({ label: "SLEEPER TRUCKS", url: null });
      }
      return crumbs;
    }

    /* ---------- page chrome updates ---------- */
    function setHeadline(st, itemCount, totalLabel) {
      const h1 = $("h1");
      const topCount = $("#results-count-top");
      const sub = $("#results-count");
      let title;
      if (st.view === "detail") {
        title = currentListing ? currentListing.title : "Listing";
      } else if (st.category && st.make && st.model) {
        title = `${st.make} ${st.model} ${st.category} For Sale`;
      } else if (st.category && st.make) {
        title = `${st.make} ${st.category} For Sale`;
      } else if (st.make && st.model) {
        title = `${st.make} ${st.model} For Sale`;
      } else if (st.make) {
        title = st.dealer ? `${st.dealer} - ${st.make} For Sale` : `${st.make} Trucks For Sale`;
      } else if (st.category) {
        title = st.dealer ? `${st.dealer} - ${st.category} For Sale` : `${st.category} For Sale`;
      } else if (st.dealer) {
        title = `${st.dealer} For Sale`;
      } else if (st.keyword) {
        title = `Results for "${st.keyword}"`;
      } else {
        title = "Sleeper Trucks For Sale";
      }
      if (h1) h1.textContent = title;
      document.title = `${title} | TruckPaper.com`;

      if (st.view === "detail") {
        if (topCount) topCount.style.display = "none";
        if (sub) sub.textContent = "";
        return;
      }
      if (topCount) topCount.style.display = "";
      const range =
        itemCount === 0
          ? "0"
          : `${(st.page - 1) * RESULTS_PER_PAGE + 1} - ${Math.min(st.page * RESULTS_PER_PAGE, itemCount)}`;
      const label = `${range} of ${totalLabel} Listings`;
      if (topCount) topCount.textContent = label;
      if (sub) sub.textContent = label;
    }

    function renderAppliedFilters(st) {
      const box = $(".applied");
      if (!box) return;
      const chips = [];
      if (st.category) chips.push({ label: st.category, clear: () => setState({ category: null, make: null, model: null, page: 1 }) });
      else if (st.view === "list") chips.push({ label: "Sleeper Trucks", clear: () => setState({}) });
      if (st.make) chips.push({ label: st.make, clear: () => setState({ make: null, model: null, page: 1 }) });
      if (st.model) chips.push({ label: st.model, clear: () => setState({ model: null, page: 1 }) });
      if (st.year) chips.push({ label: st.year, clear: () => setState({ year: null }) });
      if (st.condition) chips.push({ label: st.condition, clear: () => setState({ condition: null }) });
      if (st.state) chips.push({ label: st.state, clear: () => setState({ state: null }) });
      if (st.dealer) chips.push({ label: `Dealer: ${st.dealer}`, clear: () => setState({ dealer: null, page: 1 }) });
      Object.keys(st.specs || {}).forEach((k) => {
        const key = k;
        chips.push({
          label: `${k}: ${st.specs[k]}`,
          clear: () => {
            const specs = { ...(currentState.specs || {}) };
            delete specs[key];
            setState({ specs, page: 1 });
          },
        });
      });
      Object.keys(st.ranges || {}).forEach((rkey) => {
        const key = rkey;
        const r = st.ranges[key];
        const parts = [];
        if (r && r.min != null) parts.push(`from ${r.min}`);
        if (r && r.max != null) parts.push(`to ${r.max}`);
        chips.push({
          label: `${key} ${parts.join(" ")}`,
          clear: () => {
            const ranges = { ...(currentState.ranges || {}) };
            delete ranges[key];
            setState({ ranges, page: 1 });
          },
        });
      });
      if (st.pmin != null || st.pmax != null) {
        const parts = [];
        if (st.pmin != null) parts.push(`$${st.pmin}`);
        if (st.pmax != null) parts.push(`$${st.pmax}`);
        chips.push({ label: `Price ${parts.join(" – ")}`, clear: () => setState({ pmin: null, pmax: null, page: 1 }) });
      }
      if (st.keyword) chips.push({ label: `"${st.keyword}"`, clear: () => setState({ keyword: null, page: 1 }) });

      const inner = $(".applied-label", box);
      if (inner) inner.textContent = "Applied Filters";
      const keep = $(".view-all-selected", box);
      box.innerHTML = "";
      if (inner) box.appendChild(inner);
      chips.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "applied-chip";
        b.innerHTML = `${esc(c.label)} <span class="x">×</span>`;
        b.addEventListener("click", (e) => {
          e.preventDefault();
          c.clear();
        });
        box.appendChild(b);
      });
      if (!keep) {
        const d = document.createElement("div");
        d.style.marginTop = "8px";
        d.innerHTML =
          '<button type="button" class="view-all-selected linklike open-applied-modal">View All Selected Options</button>';
        box.appendChild(d);
      }
    }

    /* ---------- pagination ---------- */
    function renderPagination(st, itemCount) {
      const nav = $(".pagination");
      if (!nav) return;
      if (st.view === "detail" || itemCount === 0) {
        nav.innerHTML = "";
        return;
      }
      const totalPages = Math.max(1, Math.ceil(itemCount / RESULTS_PER_PAGE));
      const p = Math.min(st.page, totalPages);
      const btnUrl = (pg) => R.urlFor({ ...st, page: pg });
      const mk = (label, pg, cls, opts) => {
        if (opts && opts.disabled)
          return `<button type="button" class="${cls}" disabled>${label}</button>`;
        return `<a data-route class="${cls}" href="${esc(btnUrl(pg))}">${label}</a>`;
      };
      let nums = [];
      if (totalPages <= 7) {
        nums = Array.from({ length: totalPages }, (_, i) => i + 1);
      } else {
        nums = [1];
        if (p > 3) nums.push("…");
        const start = Math.max(2, p - 1);
        const end = Math.min(totalPages - 1, p + 1);
        for (let i = start; i <= end; i++) nums.push(i);
        if (p < totalPages - 2) nums.push("…");
        nums.push(totalPages);
      }
      nav.innerHTML =
        mk("‹  ‹", 1, "prev", { disabled: p <= 1 }) +
        mk("‹ Prev", p - 1, "prev", { disabled: p <= 1 }) +
        nums
          .map((n) =>
            n === "…"
              ? `<span class="pg-ellipsis">…</span>`
              : n === p
              ? `<button type="button" class="active">${n}</button>`
              : mk("" + n, n, "")
          )
          .join("") +
        mk("Next ›", p + 1, "next", { disabled: p >= totalPages }) +
        mk("›  ›", totalPages, "next", { disabled: p >= totalPages });
    }

    function syncFilterStates() {
      $$('#filter-list input[data-fkey]').forEach((el) => {
        const key = el.dataset.fkey;
        if (key === "mode-sale") {
          el.checked = currentState.mode !== "rent";
          return;
        }
        if (key === "mode-rent") {
          el.checked = currentState.mode === "rent";
          return;
        }
        if (key === "dealer") {
          el.checked =
            currentState.dealer != null &&
            String(currentState.dealer).toLowerCase() === String(el.dataset.fvalue).toLowerCase();
          return;
        }
        if (key === "spec") {
          el.checked =
            (currentState.specs || {})[el.dataset.facetkey] != null &&
            String((currentState.specs || {})[el.dataset.facetkey]).toLowerCase() ===
              String(el.dataset.fvalue).toLowerCase();
          return;
        }
        el.checked =
          currentState[key] != null &&
          String(currentState[key]).toLowerCase() === String(el.dataset.fvalue).toLowerCase();
      });
      $$('#filter-list input[type="number"].range-min').forEach((el) => {
        const key = el.closest("[data-range]") && el.closest("[data-range]").dataset.range;
        const r = key && (currentState.ranges || {})[key];
        el.value = r && r.min != null ? r.min : "";
      });
      $$('#filter-list input[type="number"].range-max').forEach((el) => {
        const key = el.closest("[data-range]") && el.closest("[data-range]").dataset.range;
        const r = key && (currentState.ranges || {})[key];
        el.value = r && r.max != null ? r.max : "";
      });
      $$('#filter-list input.vin-text').forEach((el) => {
        el.value = (currentState.specs && currentState.specs["VIN"]) || "";
      });
    }

    /* ---------- view: list ---------- */
    const TAB_CATS = {
      trucks: null,
      dismantled: "Dismantled Trucks & Trailers",
      components: "Truck & Trailer Components",
      parts: "Parts",
    };

    /* Highlight the search-bar tab whose inventory scope matches the current
     * category state ("Trucks & Trailers" when no category is active). */
    function syncSearchTabs() {
      const cat = currentState.category;
      $$(".search-tabs button").forEach((b) => {
        const tabCat = TAB_CATS[b.dataset.tab];
        b.classList.toggle("active", (tabCat == null && !cat) || (tabCat && cat && String(tabCat).toLowerCase() === String(cat).toLowerCase()));
      });
    }

    function renderList(st) {
      currentListing = null; /* leaving detail — share on a list/static view must not leak the last listing */
      const items = closestFirst.on ? geoSort(sortItems(getFiltered(st), st)) : sortItems(getFiltered(st), st);
      const total = items.length;
      /* "For Sale" (the default) excludes rentals, so the headline count must
       * reflect the actual rendered set — never the all-types totalCount. */
      const totalLabel = total.toLocaleString("en-US");
      const totalPages = Math.max(1, Math.ceil(total / RESULTS_PER_PAGE));
      const page = Math.min(st.page, totalPages);
      const pageItems = items.slice((page - 1) * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE);

      document.body.classList.add("route-list");
      document.body.classList.remove("route-detail", "route-static");
      const toolbar = $(".results-toolbar");
      const ad = $(".top-banner-ad-container");
      const pag = $(".pagination");
      const about = $(".about-section");
      const teaser = $(".about-teaser");
      if (toolbar) toolbar.style.display = "";
      if (ad) ad.style.display = "";
      if (about) about.style.display = "";
      if (teaser) teaser.style.display = "";
      const ctrlBar = $("#nav-control-bar");
      if (ctrlBar) ctrlBar.style.display = "";
      const topCount = $("#results-count-top");
      if (topCount) topCount.style.display = "";

      setHeadline({ ...st, page }, total, totalLabel);
      setBreadcrumb(stateBreadcrumbs(st));
      renderAppliedFilters(st);
      renderChips();
      syncFilterStates();
      renderPagination(st, total);
      syncSearchTabs();

      const sortSel = $("#sort");
      if (sortSel) sortSel.value = st.sort || "Featured Listings";
      const rent = $("#rental-toggle");
      const sale = $("#sale-toggle");
      if (rent) rent.classList.toggle("active", st.mode === "rent");
      if (sale) sale.classList.toggle("active", st.mode !== "rent");
      const kw = $("#keywords");
      if (kw) kw.value = st.keyword || "";

      const root = $("#listings");
      if (root) {
        if (!pageItems.length) {
          root.innerHTML = noResultsHtml(st);
        } else {
          root.innerHTML = pageItems.map((L, i) => cardHtml(L, i, page === 1)).join("");
        }
      }

      const aboutSrc = items.find((L) => L.images && L.images[0] && !(L.isAT || L.isEF));
      const img = $("#about-img");
      if (aboutSrc && img) {
        img.style.display = "";
        img.src = aboutSrc.images[0];
        img.referrerPolicy = "no-referrer";
        img.onerror = () => (img.style.display = "none");
      } else if (img) {
        img.style.display = "none";
      }

      /* hide pagination when there is genuinely only one page */
      if (pag) {
        pag.style.display = total > 0 && totalPages > 1 ? "" : "none";
      }
      setupInteractions();
    }

    function noResultsHtml(st) {
      const bits = [];
      if (st.category) bits.push(st.category);
      if (st.make) bits.push(st.make);
      if (st.model) bits.push(st.model);
      if (st.keyword) bits.push(`"${st.keyword}"`);
      if (st.year) bits.push(st.year);
      if (st.condition) bits.push(st.condition);
      if (st.state) bits.push(st.state);
      if (st.dealer) bits.push(st.dealer);
      if (st.mode === "rent") bits.push("Rental");
      Object.keys(st.specs || {}).forEach((k) => bits.push(`${k}: ${st.specs[k]}`));
      Object.keys(st.ranges || {}).forEach((k) => {
        const r = st.ranges[k];
        const parts = [];
        if (r && r.min != null) parts.push("from " + r.min);
        if (r && r.max != null) parts.push("to " + r.max);
        bits.push(`${k} ${parts.join(" ")}`);
      });
      if (st.pmin != null || st.pmax != null) bits.push(`Price ${st.pmin != null ? "$" + st.pmin : ""} – ${st.pmax != null ? "$" + st.pmax : ""}`);
      const where = bits.length ? ` for <strong>${esc(bits.join(" / "))}</strong>` : "";
      const savvy =
        (st.category && (st.category === "Truck & Trailer Components" || st.category === "Dismantled Trucks & Trailers" || st.category === "Parts"))
          ? `<p class="no-results-note">This market vertical isn't in the local dataset yet. When real data is added it will appear here automatically.</p>`
          : "";
      return `<div class="no-results" role="status">
        <h2>No listings found${where}</h2>
        <p>Try removing some filters, or <a data-route href="/truckpaper/">browse all trucks</a>.</p>
        ${savvy}
      </div>`;
    }

    /* ================= info & tools pages ================= */
    function staticPageTitle(st) {
      const m = {
        sell: ["Sell Your Equipment", "Sell Your Equipment | TruckPaper.com"],
        financing: ["Financing", "Financing | TruckPaper.com"],
        advertising: ["Advertising", "Advertising | TruckPaper.com"],
        dealers: ["Find Dealers", "Find A Dealer | TruckPaper.com"],
        "watch-list": ["My Watch List", "Watch List | TruckPaper.com"],
        values: ["Values & Hi/Lo/Avg", "Truck Values | TruckPaper.com"],
        shipping: ["Shipping", "FR8Star Shipping | TruckPaper.com"],
        "market-reports": ["Market Reports", "Market Reports | TruckPaper.com"],
        "hosted-websites": ["Hosted Websites", "Hosted Websites | TruckPaper.com"],
        "want-to-buy": ["Post A Free Want To Buy", "Want To Buy | TruckPaper.com"],
        "email-signup": ["Email Signup", "Email Signup | TruckPaper.com"],
        brands: ["Global Brands & Sister Sites", "Global Brands | TruckPaper.com"],
        legal: ["Legal Notices", "Legal | TruckPaper.com"],
        returns: ["Returns and Refunds", "Returns and Refunds | TruckPaper.com"],
        subscriptions: ["Subscriptions", "Subscriptions | TruckPaper.com"],
        alerts: ["Email Alerts", "Alerts | TruckPaper.com"],
        "dealer-portal": ["Dealer Portal", "Dealer Portal | TruckPaper.com"],
        sitemap: ["Sitemap", "Sitemap | TruckPaper.com"],
      };
      return m[st.view] || ["TruckPaper.com", "TruckPaper.com"];
    }

    function staticCrumbs(st) {
      const label = staticPageTitle(st)[0];
      return [
        { label: "TRUCKS FOR SALE", url: "/" },
        { label: String(label).toUpperCase(), url: null },
      ];
    }

    function pricedStats(listings) {
      const priced = listings.filter((L) => L.price > 0);
      const nums = priced.map((L) => L.price).sort((a, b) => a - b);
      const sum = nums.reduce((a, b) => a + b, 0);
      const median = nums.length ? nums[Math.floor(nums.length / 2)] : null;
      return {
        priced,
        avg: nums.length ? Math.round(sum / nums.length) : null,
        min: nums.length ? nums[0] : null,
        max: nums.length ? nums[nums.length - 1] : null,
        median,
        count: nums.length,
      };
    }

    function dealersPageHtml() {
      const byDealer = {};
      data.listings.forEach((L) => {
        if (!L.dealer) return;
        (byDealer[L.dealer] = byDealer[L.dealer] || { count: 0, states: new Set() });
        byDealer[L.dealer].count++;
        if (L.state) byDealer[L.dealer].states.add(L.state);
      });
      const rows = Object.keys(byDealer)
        .map((name) => ({
          name,
          count: byDealer[name].count,
          states: [...byDealer[name].states].sort(),
        }))
        .sort((a, b) => b.count - a.count);
      return `<div class="info-page">
        <p class="info-lead">
          ${rows.length} dealerships are represented in the TruckPaper.com demo inventory. Select one to browse its trucks,
          or type to narrow the list. Each inventory is driven by the real listing data.
        </p>
        <div class="dealer-search-row">
          <input type="text" data-dealer-search placeholder="Filter dealers by name or state…" />
        </div>
        <div class="dealer-grid" data-dealer-list>
          ${rows
            .map(
              (d) => `<div class="dealer-tile" data-name="${esc(d.name.toLowerCase())}" data-states="${esc(
                d.states.join(" ").toLowerCase()
              )}">
                <div class="dealer-tile-head">
                  <strong>${esc(d.name)}</strong>
                  <span class="dealer-count">${d.count} ${d.count === 1 ? "listing" : "listings"}</span>
                </div>
                <div class="dealer-tile-states">${esc(d.states.join(", ") || "—")}</div>
                <a class="template-branded-button view-listing-details-link" data-route href="${esc(
                  R.urlFor({ dealer: d.name })
                )}">View Inventory</a>
              </div>`
            )
            .join("")}
        </div>
      </div>`;
    }

    function valuesPageHtml() {
      const makes = {};
      data.listings.forEach((L) => {
        if (!L.manufacturer) return;
        (makes[L.manufacturer] = makes[L.manufacturer] || []).push(L);
      });
      const rows = Object.keys(makes)
        .sort()
        .map((m) => {
          const s = pricedStats(makes[m]);
          return { m, total: makes[m].length, ...s };
        });
      const overall = pricedStats(data.listings);
      const rowTpl = (label, s) => `<tr>
          <td>${esc(label)}</td>
          <td>${s.total}</td>
          <td>${s.count}</td>
          <td>${s.min != null ? formatMoney(s.min) : "—"}</td>
          <td>${s.max != null ? formatMoney(s.max) : "—"}</td>
          <td>${s.avg != null ? formatMoney(s.avg) : "—"}</td>
          <td>${s.median != null ? formatMoney(s.median) : "—"}</td>
        </tr>`;
      return `<div class="info-page">
        <p class="info-lead">
          High / Low / Average values are computed from the <em>priced</em> listings in the live dataset
          (listings marked "Call for price" are excluded). Values update automatically as inventory changes.
        </p>
        <table class="values-table" role="table" aria-label="Truck values by manufacturer">
          <thead><tr><th>Manufacturer</th><th>Listings</th><th>Priced</th><th>Low</th><th>High</th><th>Average</th><th>Median</th></tr></thead>
          <tbody>${rowTpl("All Manufacturers", overall)}${rows
        .map((r) => rowTpl(r.m, r))
        .join("")}</tbody>
        </table>
        <p class="info-note">
          For used-equipment market intelligence beyond this demo, visit the
          <a href="https://vip.truckpaper.com" target="_blank" rel="noopener">Value Insight Portal</a>.
        </p>
      </div>`;
    }

    function watchListPageHtml() {
      const ids = readWatchList();
      const items = ids.map(watchListing).filter(Boolean);
      if (!items.length) {
        return `<div class="info-page">
          <h2>Your watch list is empty</h2>
          <p>Tap the heart on any truck card (or on a listing's photo) to save it here. Saved items are stored in
          this browser until a member account backend is connected.</p>
          <a class="template-branded-button view-listing-details-link" data-route href="/truckpaper/">Browse Trucks</a>
        </div>`;
      }
      return `<div class="info-page">
        <p class="info-lead">${items.length} ${items.length === 1 ? "item" : "items"} saved. <button type="button" class="linklike clear-watchlist">Clear Watch List</button></p>
        <div class="watch-list-grid">
          ${items.map((L) => cardHtml(L, 0, false)).join("")}
        </div>
      </div>`;
    }

    function marketReportsPageHtml() {
      const total = data.listings.length;
      const priced = pricedStats(data.listings);
      const states = {};
      const conditions = {};
      data.listings.forEach((L) => {
        if (L.state) states[L.state] = (states[L.state] || 0) + 1;
        if (L.condition) conditions[L.condition] = (conditions[L.condition] || 0) + 1;
      });
      const topStates = Object.keys(states).sort((a, b) => states[b] - states[a]).slice(0, 10);
      const byMake = {};
      data.listings.forEach((L) => {
        if (L.manufacturer && L.price > 0) (byMake[L.manufacturer] = byMake[L.manufacturer] || []).push(L.price);
      });
      const makeRows = Object.keys(byMake)
        .map((m) => {
          const nums = byMake[m];
          const sum = nums.reduce((a, b) => a + b, 0);
          return { m, n: nums.length, avg: Math.round(sum / nums.length) };
        })
        .sort((a, b) => b.n - a.n)
        .slice(0, 10);
      const day = data.listings.filter((L) => (L.category || "").includes("Day Cab")).length;
      return `<div class="info-page">
        <p class="info-lead">
          This market snapshot is computed live from the TruckPaper.com demo inventory — no data is fabricated.
          (The public TruckPaper.com reference lists 13,652 total units; the local dataset currently carries
          <strong>${total}</strong> listings.)
        </p>
        <div class="stat-grid">
          <div class="stat-tile"><span class="stat-num">${total}</span><span class="stat-label">Listings</span></div>
          <div class="stat-tile"><span class="stat-num">${total - day}</span><span class="stat-label">Sleeper Trucks</span></div>
          <div class="stat-tile"><span class="stat-num">${day}</span><span class="stat-label">Day Cab Trucks</span></div>
          <div class="stat-tile"><span class="stat-num">${priced.count}</span><span class="stat-label">With a Listed Price</span></div>
          <div class="stat-tile"><span class="stat-num">${priced.avg != null ? formatMoney(priced.avg) : "—"}</span><span class="stat-label">Avg. Price (priced units)</span></div>
          <div class="stat-tile"><span class="stat-num">${Object.keys(states).length}</span><span class="stat-label">States Represented</span></div>
          <div class="stat-tile"><span class="stat-num">${Object.keys(conditions).length}</span><span class="stat-label">Conditions</span></div>
          <div class="stat-tile"><span class="stat-num">${countWatch()}</span><span class="stat-label">Items on Your Watch List</span></div>
        </div>
        <div class="two-col">
          <div class="panel">
            <h3>Average Price by Manufacturer</h3>
            <table class="values-table"><thead><tr><th>Manufacturer</th><th>Units</th><th>Avg. Price</th></tr></thead>
            <tbody>${makeRows
              .map((r) => `<tr><td>${esc(r.m)}</td><td>${r.n}</td><td>${formatMoney(r.avg)}</td></tr>`)
              .join("")}</tbody></table>
          </div>
          <div class="panel">
            <h3>Top States by Inventory</h3>
            <table class="values-table"><thead><tr><th>State</th><th>Listings</th></tr></thead>
            <tbody>${topStates
              .map((s) => `<tr><td>${esc(s)}</td><td>${states[s]}</td></tr>`)
              .join("")}</tbody></table>
          </div>
        </div>
      </div>`;
    }

    function sitemapHtml() {
      const makeLinks = [...new Set(data.listings.map((L) => L.manufacturer).filter(Boolean))]
        .sort()
        .map((m) => `<a data-route href="${esc(R.urlFor({ make: m }))}">${esc(m)}</a>`)
        .join(" ");
      const catLinks = cats
        .map((c) => `<a data-route href="${esc(R.urlFor({ category: c.name }))}">${esc(c.name)}</a>`)
        .join(" ");
      const pages = [
        ["/", "Sleeper Trucks For Sale"],
        ["/values", "Values & Hi/Lo/Avg"],
        ["/dealers", "Find Dealers"],
        ["/watch-list", "Watch List"],
        ["/alerts", "Email Alerts"],
        ["/sell", "Sell Your Equipment"],
        ["/financing", "Financing"],
        ["/shipping", "Shipping (FR8Star)"],
        ["/market-reports", "Market Reports"],
        ["/hosted-websites", "Hosted Websites"],
        ["/want-to-buy", "Post A Free Want To Buy"],
        ["/email-signup", "Email Signup"],
        ["/advertising", "Advertising"],
        ["/brands", "Global Brands"],
        ["/subscriptions", "Subscriptions"],
        ["/dealer-portal", "Dealer Portal"],
        ["/returns", "Returns and Refunds"],
        ["/legal", "Legal Notices"],
        ["/login", "Member Login"],
        ["/register", "Create Account"],
      ];
      const pageLinks = pages.map(([u, t]) => `<a data-route href="${u}">${t}</a>`).join(" ");
      return `<div class="info-page">
        <h2>Popular Pages</h2>
        <p class="sitemap-links">${pageLinks}</p>
        <h2>Categories</h2>
        <p class="sitemap-links">${catLinks}</p>
        <h2>Manufacturers</h2>
        <p class="sitemap-links">${makeLinks}</p>
      </div>`;
    }

    function brandsPageHtml() {
      const brands = [
        ["Truck Paper", "https://www.truckpaper.com", "Commercial trucks, trailers and parts"],
        ["Machinery Trader", "https://www.machinerytrader.com", "Construction and other heavy equipment"],
        ["Tractor House", "https://www.tractorhouse.com", "Farm and agricultural equipment"],
        ["AuctionTime", "https://www.auctiontime.com", "Online-only equipment auctions"],
        ["Equipment Facts", "https://www.equipmentfacts.com", "Live farm and construction auctions"],
        ["Rental Yard", "https://www.rentalyard.com", "Tools and equipment for rent"],
        ["Crane Trader", "https://www.cranetrader.com", "Cranes, trailers and rigging"],
        ["Lifts Today", "https://www.liftstoday.com", "Forklifts and lifting equipment"],
        ["MDTrader", "https://www.mdtrader.com", "Trucks and trailers in the mid-Atlantic region"],
        ["MarketBook", "https://www.marketbook.ca", "Used farm equipment in Canada"],
        ["Truck World", "https://www.truckworld.com.au", "Trucks and machinery in Australia"],
        ["Controller", "https://www.thecontroller.com", "Sandhills' on-the-radio brand"],
        ["ForestryTrader", "https://www.forestrytrader.com", "Logging and timber equipment"],
        ["Currency", "https://www.gocurrency.com", "Financing for commercial equipment"],
      ];
      return `<div class="info-page">
        <p class="info-lead">Sandhills Global's marketplace family. Each link opens the corresponding brand site in a new tab.</p>
        <div class="brand-grid">
          ${brands
            .map(
              ([name, url, desc]) => `<a class="brand-tile" href="${esc(url)}" target="_blank" rel="noopener">
                <strong>${esc(name)}</strong><span>${esc(desc)}</span>
              </a>`
            )
            .join("")}
        </div>
      </div>`;
    }

    function sellPageHtml() {
      return `<div class="info-page">
        <h2>List your equipment on TruckPaper.com</h2>
        <ol class="info-steps">
          <li>Create your listing at the real TruckPaper listing form.</li>
          <li>Add photos, specs, and your asking price — high quality photos sell faster.</li>
          <li>Publish and manage it any time through the Dealer Portal.</li>
        </ol>
        <div class="info-cta-row">
          <a class="template-branded-button view-listing-details-link" href="https://www.truckpaper.com/listinginput" target="_blank" rel="noopener">Start A Listing</a>
          <a class="template-branded-button-view" data-route href="/truckpaper/dealer-portal">Dealer Portal</a>
        </div>
        <p class="info-note">Questions? <a href="mailto:c9919145@gmail.com">Email the demo support inbox</a>.</p>
      </div>`;
    }

    function financingPageHtml() {
      return `<div class="info-page">
        <h2>Commercial equipment financing</h2>
        <p>Financing on TruckPaper.com is provided by <strong>Currency</strong> — Express Tech-Financing, LLC.
        Monthly payment estimates shown on listings assume a secured commercial-use loan for highly qualified applicants.</p>
        <ul class="info-list">
          <li>Check your buying power and apply online at Currency.</li>
          <li>Loan inquiries are subject to credit approval and state restrictions.</li>
          <li>TruckPaper does not store or forward your financial details from this demo.</li>
        </ul>
        <div class="info-cta-row">
          <a class="template-branded-button view-listing-details-link" href="https://www.gocurrency.com/" target="_blank" rel="noopener">Apply for Financing</a>
        </div>
        <p class="info-note">State licenses and disclosures: see the <a data-route href="/truckpaper/legal#licenses">Legal Notices</a> page.</p>
      </div>`;
    }

    function shippingPageHtml() {
      return `<div class="info-page">
        <h2>FR8Star shipping quotes</h2>
        <p>Get freight quotes for your truck or trailer through TruckPaper's freight partner, <strong>FR8Star</strong>.</p>
        <ul class="info-list">
          <li>Compare carriers with transparent pricing.</li>
          <li>Quote, book, and track shipments in one place.</li>
        </ul>
        <div class="info-cta-row">
          <a class="template-branded-button view-listing-details-link" href="https://www.fr8star.com/" target="_blank" rel="noopener">Get Shipping Quotes</a>
        </div>
      </div>`;
    }

    function advertisingPageHtml() {
      return `<div class="info-page">
        <h2>Advertise on TruckPaper.com</h2>
        <p>Reach buyers across commercial trucks, trailers, and parts with Sandhills' print and digital advertising.</p>
        <ul class="info-list">
          <li>Targeted placement across TruckPaper.com and mobile.</li>
          <li>Featured listings and category sponsorship.</li>
          <li>Hosted dealer websites with inventory feeds.</li>
        </ul>
        <div class="info-cta-row">
          <a class="template-branded-button view-listing-details-link" href="http://truckpaper.com/info/advertising" target="_blank" rel="noopener">Advertising Details</a>
        </div>
        <p class="info-note">Call <strong>800-247-4868</strong> or <a href="mailto:c9919145@gmail.com">email</a> to talk to a representative.</p>
      </div>`;
    }

    function hostedWebsitesPageHtml() {
      return `<div class="info-page">
        <h2>Sandhills hosted dealer websites</h2>
        <p>Let Sandhills build and host a modern, inventory-driven website for your dealership — synced with the listings you publish on TruckPaper.com.</p>
        <ul class="info-list">
          <li>Inventory feeds and search on your own domain.</li>
          <li>Mobile-ready, SEO-friendly design.</li>
          <li>Sell online with eCommerce built in.</li>
        </ul>
        <div class="info-cta-row">
          <a class="template-branded-button view-listing-details-link" href="https://www.truckpaper.com/blog/" target="_blank" rel="noopener">See How It Works</a>
        </div>
        <p class="info-note">Sales: <strong>800-247-4868</strong> · <a href="mailto:c9919145@gmail.com">Email Us</a></p>
      </div>`;
    }

    function dealerPortalPageHtml() {
      return `<div class="info-page" data-seller-portal>
        <h2>Dealer Portal</h2>
        <p class="info-note">Loading the Dealer Portal…</p>
      </div>`;
    }

    function subscriptionsPageHtml() {
      return `<div class="info-page">
        <h2>Subscriptions</h2>
        <p>Subscribe to the TruckPaper.com print magazine and email product updates (currently served as a demo newsletter until a mailing platform is connected).</p>
        <div class="info-cta-row">
          <a class="template-branded-button-view" data-route href="/truckpaper/email-signup">Email Signup</a>
          <a class="template-branded-button-view" data-route href="/truckpaper/alerts">Set Up Alerts</a>
        </div>
        <p class="info-note">Questions? <a href="mailto:c9919145@gmail.com">Contact Us</a></p>
      </div>`;
    }

    function wantToBuyPageHtml() {
      return `<div class="info-page">
        <h2>Post A Free Want To Buy</h2>
        <p>Describe the truck you need and it's sent straight to dealers. Submitting opens your email app addressed to the
        demo support inbox with the details prefilled.</p>
        <form class="tp-form" data-wtb-form novalidate>
          <div class="tp-form-row">
            <label>Item you need <input type="text" name="item" required placeholder="e.g. 2019 Freightliner Cascadia, 72-in sleeper" /></label>
            <label>Your name <input type="text" name="name" required /></label>
          </div>
          <div class="tp-form-row">
            <label>Email <input type="email" name="email" required /></label>
            <label>Phone (optional) <input type="tel" name="phone" /></label>
          </div>
          <label>Notes <textarea name="notes" rows="3" placeholder="More details…"></textarea></label>
          <p class="tp-form-err" role="alert" hidden></p>
          <div class="tp-form-actions">
            <button type="submit" class="template-branded-button-view">Post Want To Buy</button>
          </div>
          <p class="tp-form-ok" role="status" aria-live="polite" hidden></p>
        </form>
      </div>`;
    }

    function emailSignupPageHtml() {
      return `<div class="info-page">
        <h2>Dealer News Email Signup</h2>
        <p>Product news, tips, and market info for dealers — delivered to your inbox. Addresses are saved locally in this demo
        until a real mailing-list API is connected.</p>
        <form class="tp-form" data-email-form novalidate>
          <label>Email address <input type="email" name="email" required placeholder="you@dealership.com" /></label>
          <p class="tp-form-err" role="alert" hidden></p>
          <div class="tp-form-actions"><button type="submit" class="template-branded-button-view">Sign Me Up</button></div>
          <p class="tp-form-ok" role="status" aria-live="polite" hidden></p>
        </form>
      </div>`;
    }

    function alertsPageHtml() {
      return `<div class="info-page">
        <h2>Saved Searches &amp; Alerts</h2>
        <p>Get an email when new trucks match a search you care about. Alerts are stored in this browser for the demo;
        they will be sent by the future member-account backend.</p>
        <form class="tp-form" data-alert-form novalidate>
          <div class="tp-form-row">
            <label>Email <input type="email" name="email" required placeholder="you@example.com" /></label>
            <label>Save this search (keywords or quick find code) <input type="text" name="search" required placeholder="e.g. Kenworth W900 sleeper" /></label>
          </div>
          <label>Frequency
            <select name="frequency">
              <option>Daily</option><option>Weekly</option><option>As new listings arrive</option>
            </select>
          </label>
          <p class="tp-form-err" role="alert" hidden></p>
          <div class="tp-form-actions"><button type="submit" class="template-branded-button-view">Create Alert</button></div>
          <p class="tp-form-ok" role="status" aria-live="polite" hidden></p>
        </form>
      </div>`;
    }

    function returnsPageHtml() {
      return `<div class="info-page">
        <h2>Returns and Refunds</h2>
        <p>TruckPaper.com is an advertising marketplace — sellers, not TruckPaper, handle returns and refunds for the
        equipment they sell. If you need help resolving a purchase, contact the seller directly (their phone and email are
        on the listing) or <a href="mailto:c9919145@gmail.com">email our support</a> and we'll connect you.</p>
        <p>This demo holds no order or payment data, so there are no purchase transactions to return or refund here.</p>
      </div>`;
    }

    function legalPageHtml() {
      return `<div class="info-page legal-page">
        <h2 id="notices">Legal Notices &amp; Accessibility</h2>
        <p>TruckPaper.com and the TruckPaper logo are trademarks of Sandhills Global, Inc. Reproduction of listings or
        content without expressed written consent is forbidden. We strive to make our site accessible to all users, in
        line with the Web Content Accessibility Guidelines.</p>
        <h2 id="privacy">Privacy Policy</h2>
        <p>In this demo, nothing is sent to any server: watch list, saved searches, alerts, email signups, and results-per-page
        preferences are stored only in your browser (localStorage). When a real account backend is connected, only the data
        you explicitly provide will be shared, and this policy will be updated accordingly.</p>
        <h2 id="ca-privacy">California Privacy Policy and Rights</h2>
        <p>Because this demo does not collect, sell, or share personal information, California residents' rights under the
        CCPA/CPRA (access, deletion, correction, and opt-out of sale/sharing) are trivially satisfied. For the production
        TruckPaper service, contact Sandhills Global at 913-489-7118.</p>
        <h2 id="choices">Your Privacy Choices</h2>
        <p>To opt out of any future data sharing for the demo, <a href="mailto:c9919145@gmail.com">email our privacy inbox</a>.</p>
        <h2 id="licenses">Financing Licenses &amp; Disclosures</h2>
        <p>Financing provided or arranged by Express Tech-Financing, LLC dba Currency pursuant to California Finance Lender
        License #60DBO54873. NMLS ID: 1857954. This is a loan solicitation only; equal opportunity lender. Consumer financing
        not available to residents of Nevada. State licenses and disclosures are maintained at
        <a href="https://www.gocurrency.com/" target="_blank" rel="noopener">gocurrency.com</a>.</p>
      </div>`;
    }

    function renderStatic(st) {
      document.body.classList.remove("route-list", "route-detail", "route-auth");
      document.body.classList.add("route-static");
      const ids = ["#results-count-top", ".results-toolbar", ".top-banner-ad-container", ".pagination", ".about-section", ".about-teaser", "#nav-control-bar"];
      ids.forEach((sel) => {
        const el = $(sel);
        if (el) el.style.display = "none";
      });
      const info = staticPageTitle(st);
      const h1 = $("h1");
      if (h1) h1.textContent = info[0];
      document.title = info[1];
      setBreadcrumb(staticCrumbs(st));
      const root = $("#listings");
      if (!root) return;
      const html =
        st.view === "dealers" ? dealersPageHtml()
        : st.view === "values" ? valuesPageHtml()
        : st.view === "watch-list" ? watchListPageHtml()
        : st.view === "market-reports" ? marketReportsPageHtml()
        : st.view === "sitemap" ? sitemapHtml()
        : st.view === "brands" ? brandsPageHtml()
        : st.view === "sell" ? sellPageHtml()
        : st.view === "financing" ? financingPageHtml()
        : st.view === "shipping" ? shippingPageHtml()
        : st.view === "advertising" ? advertisingPageHtml()
        : st.view === "hosted-websites" ? hostedWebsitesPageHtml()
        : st.view === "dealer-portal" ? dealerPortalPageHtml()
        : st.view === "subscriptions" ? subscriptionsPageHtml()
        : st.view === "want-to-buy" ? wantToBuyPageHtml()
        : st.view === "email-signup" ? emailSignupPageHtml()
        : st.view === "alerts" ? alertsPageHtml()
        : st.view === "returns" ? returnsPageHtml()
        : st.view === "legal" ? legalPageHtml()
        : `<div class="info-page"><h2>${esc(info[0])}</h2></div>`;
      root.innerHTML = html;
      bindStaticPage(root, st);
      setupInteractions();
      if (st.view === "dealer-portal" && window.TP_SELLER_PORTAL) {
        window.TP_SELLER_PORTAL.mount(root.querySelector("[data-seller-portal]"));
      }
      if (window.location.hash) {
        const target = document.getElementById(window.location.hash.slice(1));
        if (target) {
          setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
        }
      }
    }

    function bindStaticPage(root, st) {
      const dealerSearch = root.querySelector("[data-dealer-search]");
      if (dealerSearch) {
        const list = root.querySelector("[data-dealer-list]");
        dealerSearch.addEventListener("input", () => {
          const q = dealerSearch.value.toLowerCase();
          list.querySelectorAll(".dealer-tile").forEach((t) => {
            t.style.display = t.dataset.name.indexOf(q) !== -1 || t.dataset.states.indexOf(q) !== -1 ? "" : "none";
          });
        });
      }
      const tpForm = (form, validate, save, okMsg) => {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          const err = form.querySelector(".tp-form-err");
          const ok = form.querySelector(".tp-form-ok");
          const all = {};
          form.querySelectorAll("input, select, textarea").forEach((el) => (all[el.name] = el.value.trim()));
          const problem = validate(all);
          if (err) {
            err.textContent = problem || "";
            err.hidden = !problem;
          }
          if (problem) return;
          save(all);
          if (ok) {
            ok.textContent = okMsg || "Saved.";
            ok.hidden = false;
          }
          form.querySelectorAll("button[type=submit]").forEach((b) => (b.disabled = true));
        });
      };
      const emailForm = root.querySelector("[data-email-form]");
      if (emailForm) {
        tpForm(
          emailForm,
          (a) => (auth.isValidEmail(a.email) ? "" : "Please enter a valid email address."),
          (a) => {
            try { window.localStorage.setItem("tp.emailSub", a.email); } catch (x) {}
          },
          "You're subscribed. (Saved locally for the demo until a newsletter API is connected.)"
        );
      }
      const alertForm = root.querySelector("[data-alert-form]");
      if (alertForm) {
        tpForm(
          alertForm,
          (a) => (auth.isValidEmail(a.email) ? (a.search ? "" : "Describe the search you want alerted about.") : "Please enter a valid email address."),
          (a) => {
            try {
              const list = JSON.parse(window.localStorage.getItem("tp.alerts") || "[]");
              list.push({ email: a.email, search: a.search, frequency: a.frequency, at: new Date().toISOString() });
              window.localStorage.setItem("tp.alerts", JSON.stringify(list));
            } catch (x) {}
          },
          "Alert created. You'll be emailed when matching trucks arrive (backend pending)."
        );
      }
      const wtbForm = root.querySelector("[data-wtb-form]");
      if (wtbForm) {
        wtbForm.addEventListener("submit", (e) => {
          e.preventDefault();
          const err = wtbForm.querySelector(".tp-form-err");
          const ok = wtbForm.querySelector(".tp-form-ok");
          const all = {};
          wtbForm.querySelectorAll("input, textarea").forEach((el) => (all[el.name] = el.value.trim()));
          const problem = !all.item ? "Describe the item you need." : !all.name ? "Please enter your name." : !auth.isValidEmail(all.email) ? "Please enter a valid email address." : "";
          if (err) { err.textContent = problem || ""; err.hidden = !problem; }
          if (problem) return;
          const subject = `Want To Buy: ${all.item}`;
          const body = `Item: ${all.item}\nName: ${all.name}\nEmail: ${all.email}\nPhone: ${all.phone || "—"}\nNotes: ${all.notes || "—"}`;
          try {
            window.location.href = `mailto:c9919145@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
          } catch (x) {}
          if (ok) { ok.textContent = "Opening your email app with the request prefilled…"; ok.hidden = false; }
          wtbForm.querySelectorAll("button[type=submit]").forEach((b) => (b.disabled = true));
        });
      }
      const clearWatch = root.querySelector(".clear-watchlist");
      if (clearWatch) {
        clearWatch.addEventListener("click", () => {
          writeWatchList([]);
          renderStatic(currentState);
          toast("Watch list cleared");
        });
      }
    }

    /* ---------- view: detail ---------- */
    function renderDetail(st) {
      currentListing = data.listings.find((L) => Number(L.id) === Number(st.id)) || null;
      document.body.classList.add("route-detail");
      document.body.classList.remove("route-list", "route-static");
      const toolbar = $(".results-toolbar");
      const ad = $(".top-banner-ad-container");
      const pag = $(".pagination");
      const about = $(".about-section");
      const teaser = $(".about-teaser");
      if (toolbar) toolbar.style.display = "none";
      if (ad) ad.style.display = "none";
      if (pag) pag.innerHTML = "";
      if (about) about.style.display = "none";
      if (teaser) teaser.style.display = "none";
      renderAppliedFilters(st);

      const root = $("#listings");
      if (!currentListing) {
        setHeadline(st, 0, "0");
        setBreadcrumb([
          { label: "TRUCKS FOR SALE", url: "/" },
          { label: "LISTING NOT FOUND", url: null },
        ]);
        if (root)
          root.innerHTML = `<div class="not-found" role="alert">
            <h2>We could not find that listing.</h2>
            <p>The listing may have sold or the link is invalid.</p>
            <p><a data-route href="/truckpaper/">Back to all trucks</a></p>
          </div>`;
        setupInteractions();
        return;
      }

      const L = currentListing;
      setHeadline(st, 0, "");
      setBreadcrumb(stateBreadcrumbs(st, L.title));
      document.title = `${L.title} | TruckPaper.com`;
      const imgs = L.images || [];
      const specs = Object.entries(L.specs || {});
      const thumbs = imgs
        .map(
          (src, i) =>
            `<img data-dsrc="${esc(imgUrl(src))}" class="${i === 0 ? "detail-thumb active" : "detail-thumb"}" src="${esc(
              imgUrl(src)
            )}" alt="${esc(L.alt || L.title)} photo ${i + 1}" loading="lazy" referrerpolicy="no-referrer" />`
        )
        .join("");
      root.innerHTML = `
        <div class="detail-page" itemscope itemtype="https://schema.org/Product">
          <div class="detail-hero">
            <div class="detail-gallery">
              <div class="detail-main-wrap">
                <img id="detail-main-img" class="detail-main-img" src="${esc(
                  imgUrl(imgs[0] || "")
                )}" alt="${esc(L.alt || L.title)}" referrerpolicy="no-referrer" />
                <span class="top-banner">
                  ${leftFlavorHtml(L)}
                  <span class="right-flavor">
                    <span role="button" tabindex="0" aria-label="${hasWatch(L.id) ? "Remove from Watch List" : "Add to Watch List"}" class="image-watchlist watchlist-ad${hasWatch(L.id) ? " added" : ""}" data-listing-id="${L.id}" data-action="${hasWatch(L.id) ? "remove" : "add"}"><i class="${hasWatch(L.id) ? "fas" : "far"} fa-heart"></i></span>
                  </span>
                </span>
              </div>
              <div class="detail-thumbs">${thumbs}</div>
              <div class="detail-photo-count"><i class="fas fa-camera"></i> ${L.imageCount || imgs.length} Photos</div>
            </div>
            <div class="detail-info">
              <div class="list-listing-title">
                ${lotHtml(L)}
                <h1 class="detail-title">${esc(L.title)}</h1>
                <p class="listing-category">${esc(L.category)}</p>
              </div>
              ${priceHtml(L)}
              ${widgetsHtml(L)}
              ${auctionContentHtml(L)}
              <div class="detail-meta">
                <div><span class="spec-label">Dealer:</span> <span class="spec-value">${
                  L.dealer
                    ? `<a data-route href="${esc(R.urlFor({ dealer: L.dealer }))}">${esc(L.dealer)}</a>`
                    : ""
                }</span></div>
                <div><span class="spec-label">Location:</span> <span class="spec-value">${esc(
                  L.location || ""
                )}</span></div>
                ${L.vin ? `<div><span class="spec-label">VIN:</span> <span class="spec-value">${esc(L.vin)}</span></div>` : ""}
                ${L.lotNumber ? `<div><span class="spec-label">Lot #:</span> <span class="spec-value">${esc(L.lotNumber)}</span></div>` : ""}
                <div><span class="spec-label">Condition:</span> <span class="spec-value">${esc(L.condition || "")}</span></div>
                <div><span class="spec-label">Updated:</span> <span class="spec-value">${esc(L.updated || "")}</span></div>
              </div>
              <div class="detail-actions">
                <a data-route class="view-listing-details-link template-branded-button" href="${esc(
                  R.urlFor({ category: L.category })
                )}">View More ${esc(L.category)}</a>
                <a data-route class="detail-back" href="/truckpaper/">‹ Back to results</a>
                <button type="button" class="template-branded-button-view detail-share" data-detail-listing-id="${L.id}">Share</button>
                ${
                  L.location
                    ? `<a class="template-branded-button-view detail-map" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                        L.location
                      )}" target="_blank" rel="noopener">Map / Directions</a>`
                    : ""
                }
              </div>
            </div>
          </div>
          <div class="detail-body">
            <div class="detail-specs">
              <h2>Specifications</h2>
              ${specs.length ? `<table>
                ${specs
                  .map(
                    ([k, v]) =>
                      `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`
                  )
                  .join("")}
              </table>` : "<p>No specifications listed.</p>"}
            </div>
            <div class="detail-desc">
              <h2>Description</h2>
              <p>${esc(L.description || "No description provided.")}</p>
            </div>
            ${contactHtml(L)}
          </div>
        </div>`;

      setupInteractions();
    }

    function setupInteractions() {
      const root = $("#listings");
      if (!root || root.dataset.behaviors) return;
      root.dataset.behaviors = "1";

      /* watch list heart — real persistence */
      root.addEventListener("click", (e) => {
        const wl = e.target.closest(".image-watchlist");
        if (!wl) return;
        e.preventDefault();
        toggleWatch(wl.dataset.listingId, wl.closest(".listing-card-grid"));
      });

      /* detail page share button */
      root.addEventListener("click", (e) => {
        const btn = e.target.closest(".detail-share");
        if (!btn) return;
        e.preventDefault();
        const id = btn.dataset.detailListingId;
        const L = id != null ? watchListing(Number(id)) : currentListing;
        shareCurrent(L);
      });

      /* view all overlay - go to detail */
      root.addEventListener("click", (e) => {
        const va = e.target.closest(".view-all");
        if (!va) return;
        e.preventDefault();
        e.stopPropagation();
        const href = va.dataset.href;
        if (href) R.navigate(href, { scrollTop: true });
      });

      /* carousel arrows + dots stop the image link */
      root.addEventListener("click", (e) => {
        const arrow = e.target.closest(".arrow");
        const dot = e.target.closest(".slick-dots [data-slide]");
        if (arrow || dot) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
      /* keyboard activation for the carousel arrows/dots (role=button) */
      root.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const target = elt(e.target);
        const card = target.closest(".listing-card-grid");
        if (!card) return;
        const arrow = target.closest(".arrow");
        const dot = target.closest(".slick-dots li[data-slide]");
        if (!arrow && !dot) return;
        e.preventDefault();
        e.stopPropagation();
        const track = $(".slick-track", card);
        const slides = $$(".slick-slide", track);
        if (!slides.length) return;
        const idx = $$(".slick-slide", track).findIndex((s) => s.classList.contains("slick-active"));
        const current = idx === -1 ? 0 : idx;
        if (dot) goto(card, Number(dot.dataset.slide));
        else if (arrow.classList.contains("arrow-left")) goto(card, current - 1);
        else goto(card, current + 1);
      });
      root.addEventListener("click", (e) => {
        const card = elt(e.target).closest(".listing-card-grid");
        if (!card) return;
        const track = $(".slick-track", card);
        const slides = $$(".slick-slide", track);
        if (!slides.length) return;
        const idx = $$(".slick-slide", track).findIndex((s) => s.classList.contains("slick-active"));
        const current = idx === -1 ? 0 : idx;
        if (e.target.closest(".arrow-left")) goto(card, current - 1);
        else if (e.target.closest(".arrow-right")) goto(card, current + 1);
        else if (e.target.closest(".slick-dots li[data-slide]")) {
          const d = e.target.closest(".slick-dots li[data-slide]");
          goto(card, Number(d.dataset.slide));
        }
      });

      /* specs show/hide */
      root.addEventListener("click", (e) => {
        const btn = elt(e.target).closest(".specs-button");
        if (!btn) return;
        const card = btn.closest(".listing-card-grid");
        const hidden = $(".hidden", card);
        if (!hidden) return;
        const isOpen = !hidden.classList.contains("open");
        hidden.classList.toggle("open", isOpen);
        hidden.style.display = isOpen ? "block" : "none";
        btn.classList.toggle("open", isOpen);
        btn.setAttribute("aria-label", isOpen ? "Hide Specs" : "Show Specs");
        const icon = btn.querySelector("i");
        if (icon) icon.classList.toggle("fa-chevron-up", isOpen);
      });

      /* options popper — real action menu (mail, watch, share, financing) */
      root.addEventListener("click", (e) => {
        const btn = elt(e.target).closest(".options-popper-btn");
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const card = btn.closest(".listing-card-grid");
        if (!card) return;
        const id = card.dataset.listingId || (btn.closest("[data-listing-id]") || {}).dataset.listingId;
        const old = card.querySelector(".options-menu");
        if (old) {
          old.remove();
          return;
        }
        const L = id != null ? watchListing(Number(id)) : null;
        const watched = hasWatch(Number(id));
        const menu = document.createElement("div");
        menu.className = "options-menu";
        menu.setAttribute("role", "menu");
        menu.innerHTML = `
          <a role="menuitem" href="mailto:c9919145@gmail.com?subject=${encodeURIComponent(
            L ? L.title : "Listing inquiry"
          )}">Email Seller</a>
          <button type="button" role="menuitem" data-opt="watch">${watched ? "Remove from Watch List" : "Add to Watch List"}</button>
          <button type="button" role="menuitem" data-opt="share">Share This Listing</button>
          <a role="menuitem" data-route href="/truckpaper/financing">Apply for Financing</a>`;
        menu.addEventListener("click", (ev) => {
          const o = ev.target.closest("[data-opt]");
          if (o && o.dataset.opt === "watch") toggleWatch(Number(id), o);
          else if (o && o.dataset.opt === "share") shareCurrent(L);
          else if (o) return;
          const a = ev.target.closest("a[data-route]");
          if (!a) menu.remove();
        });
        card.appendChild(menu);
      });

      /* gallery thumbs on detail */
      const mainImg = $("#detail-main-img");
      if (mainImg) {
        root.addEventListener("click", (e) => {
          const th = e.target.closest(".detail-thumb");
          if (!th) return;
          mainImg.src = th.dataset.dsrc;
          root.querySelectorAll(".detail-thumb").forEach((t) => t.classList.toggle("active", t === th));
        });
      }
    }

    function goto(card, index) {
      const track = $(".slick-track", card);
      const slides = $$(".slick-slide", track);
      if (!track || !slides.length) return;
      index = Math.max(0, Math.min(index, slides.length - 1));
      track.style.transform = `translateX(-${index * 100}%)`;
      $$(".slick-slide", track).forEach((s, i) => {
        s.classList.toggle("slick-active", i === index);
        s.classList.toggle("slick-current", i === index);
      });
      $$(".slick-dots li", card).forEach((d, i) => {
        d.classList.toggle("slick-active", i === index);
        const icon = d.querySelector("i");
        if (icon) icon.className = i === index ? "fas fa-circle" : "far fa-circle";
      });
    }

    /* ---------- routing dispatcher ---------- */
    /* Single funnel for every navigation (boot, link click, back/forward).
     * The static info/marketing pages and auth pages are real views with
     * their own renderers and must not fall through to the truck list. */
    function renderCurrent(st) {
      document.body.classList.remove("route-list", "route-detail", "route-auth", "route-static");
      renderFilters();
      if (st.view === "detail") renderDetail(st);
      else if (isAuthView(st.view)) renderAuth(st);
      else if (STATIC_VIEWS.has(st.view)) renderStatic(st);
      else renderList(st);
    }

    /* ---------- global behaviors ---------- */
    function bindGlobal() {
      R.onRouteChange(() => {
        currentState = parseState();
        const root = $("#listings");
        if (root) {
          delete root.dataset.behaviors;
          root.innerHTML = "";
        }
        renderCurrent(currentState);
        renderAuthBar();
      });

      /* data-route navigation */
      document.addEventListener("click", (e) => {
        const a = elt(e.target).closest("a[data-route]");
        if (!a) return;
        if (e.target.closest(".arrow") || e.target.closest(".slick-dots") || e.target.closest(".image-watchlist"))
          return;
        e.preventDefault();
        const url = R.withBase(a.getAttribute("href"));
        if (a.getAttribute("target") === "_blank") window.open(url, "_blank", "noopener");
        else R.navigate(url, { scrollTop: true });
      });

      /* no top-jump for decorative placeholder links */
      document.addEventListener("click", (e) => {
        const a = elt(e.target).closest('a[href="#"]');
        if (a) e.preventDefault();
      });

      /* Mobile nav drawer. Off-canvas panel with a backdrop; closes on link
         tap, backdrop tap, Escape, or any route change. */
      const navPanel = $("#mobile-nav");
      const navBackdrop = $("#mobile-nav-backdrop");
      const navBtn = $("#mobile-nav-btn");
      if (navPanel && navBackdrop && navBtn) {
        const navCloseBtn = $("#mobile-nav-close");
        let navOpen = false;

        const setNav = (open) => {
          navOpen = open;
          navPanel.classList.toggle("open", open);
          navBackdrop.classList.toggle("open", open);
          document.body.classList.toggle("nav-open", open);
          navBtn.setAttribute("aria-expanded", open ? "true" : "false");
          navBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
          /* The panel is display:flex for the slide animation, so [hidden]
             can't be used for off-screen state. Inert-ish: drop it from the
             a11y tree and the tab order while closed. */
          navPanel.setAttribute("aria-hidden", open ? "false" : "true");
          if (open) {
            navPanel.removeAttribute("inert");
            navCloseBtn?.focus();
          } else {
            navPanel.setAttribute("inert", "");
            navBtn.focus();
          }
        };

        navBtn.addEventListener("click", () => setNav(!navOpen));
        navCloseBtn?.addEventListener("click", () => setNav(false));
        navBackdrop.addEventListener("click", () => setNav(false));
        navPanel.addEventListener("click", (e) => {
          if (elt(e.target).closest("a")) setNav(false);
        });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape" && navOpen) setNav(false);
        });
        /* Reset when the viewport grows past the drawer breakpoint. */
        const wide = window.matchMedia("(min-width: 981px)");
        const onWide = (e) => { if (e.matches) setNav(false); };
        if (wide.addEventListener) wide.addEventListener("change", onWide);
        else wide.addListener(onWide);
        setNav(false);
      }

      /* cat panel toggle */
      const catBtn = $(".cat-categories-btn");
      const catPanel = $("#cat-panel");
      if (catBtn && catPanel) {
        const toggle = (open) => {
          const next = typeof open === "boolean" ? open : catPanel.hidden;
          catPanel.hidden = !next;
          catBtn.setAttribute("aria-expanded", next ? "true" : "false");
          catBtn.classList.toggle("open", next);
        };
        catBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggle();
        });
        document.addEventListener("click", (e) => {
          if (!catPanel.hidden && !elt(e.target).closest(".cat-panel")) toggle(false);
        });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape") toggle(false);
        });
      }

      /* search boxes */
      const doKeyword = (kw, reset) => {
        kw = String(kw || "").trim();
        if (!kw) return;
        if (reset) {
          setState({
            keyword: kw, page: 1,
            category: null, make: null, model: null, condition: null, year: null,
            state: null, mode: null, dealer: null, specs: null, ranges: null,
            pmin: null, pmax: null,
          });
        } else {
          setState({ keyword: kw, page: 1 });
        }
        const q = $("#q");
        if (q) q.value = kw;
        const kwEl = $("#keywords");
        if (kwEl) kwEl.value = kw;
      };
      const bindSearch = (inputSel, btnSel, reset) => {
        const input = $(inputSel);
        const btn = $(btnSel);
        const fire = () => doKeyword((input && input.value) || "", reset);
        if (btn) btn.addEventListener("click", fire);
        if (input)
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              fire();
            }
          });
      };
      bindSearch("#q", ".search-btn", true);
      bindSearch("#keywords", ".kw-row button", false);

      /* Search tabs -> the tab selects which inventory scope is searched.
       * "Trucks & Trailers" is the default; the other scopes map to the
       * retail/virtual categories the site defines. TAB_CATS and
       * syncSearchTabs() live in the outer scope so renderList can use them. */
      $$(".search-tabs button").forEach((btn) => {
        btn.addEventListener("click", () => {
          const cat = TAB_CATS[btn.dataset.tab];
          setState({ category: cat ?? null, make: null, model: null, page: 1 });
        });
      });

      $(".print-this")?.addEventListener("click", (e) => {
        e.preventDefault();
        window.print();
      });

      /* type toggles -> mode */
      $("#rental-toggle")?.addEventListener("click", () => setState({ mode: "rent", page: 1 }));
      $("#sale-toggle")?.addEventListener("click", () => setState({ mode: null, page: 1 }));

      /* sort -> sort */
      $("#sort")?.addEventListener("change", (e) => setState({ sort: e.target.value }));

      /* Options gear -> real listing-view options panel */
      $(".options-modal-btn")?.addEventListener("click", (e) => {
        e.preventDefault();
        const st = currentState;
        const sortOpts = ["Featured Listings", "Price: Low to High", "Price: High to Low", "Year: Newest", "Year: Oldest", "Recently Updated"];
        openModal(`<div class="tp-form options-view">
          <h3>Listing View Options</h3>
          <label class="tp-select-label" for="opt-sort">Sort Results
            <select id="opt-sort">
              ${sortOpts.map((o) => `<option ${st.sort === o ? "selected" : ""}>${o}</option>`).join("")}
            </select>
          </label>
          <div class="tp-form-row">
            <label class="auth-check"><input type="radio" name="opt-mode" value="sale" ${st.mode !== "rent" ? "checked" : ""} /> For Sale</label>
            <label class="auth-check"><input type="radio" name="opt-mode" value="rent" ${st.mode === "rent" ? "checked" : ""} /> Rent or Lease</label>
          </div>
          <label class="auth-check" for="opt-closest"><input type="checkbox" id="opt-closest" ${closestFirst.on ? "checked" : ""} /> Show Closest First</label>
          <div class="tp-form-actions">
            <button type="button" class="template-branded-button-view" data-opt="apply">Apply Options</button>
            <button type="button" class="template-branded-button" data-tp-close>Cancel</button>
          </div>
        </div>`).addEventListener("click", (ev) => {
          if (!ev.target.closest("[data-opt=apply]")) return;
          const m = $(".tp-modal");
          const patch = { sort: (m.querySelector("#opt-sort") || {}).value || st.sort, page: 1 };
          const mode = (m.querySelector("input[name=opt-mode]:checked") || {}).value;
          patch.mode = mode === "rent" ? "rent" : null;
          const closeBox = m.querySelector("#opt-closest");
          if (closeBox) setClosest(closeBox.checked);
          setState(patch);
          if (m) closeModal();
        });
      });

      $(".collapse-caret")?.addEventListener("click", () => {
        const bar = $("#nav-control-bar");
        const collapsed = bar.classList.toggle("collapsed");
        const caret = $("#nav-control-bar .collapse-caret i");
        if (caret) caret.className = collapsed ? "fas fa-caret-up" : "fas fa-caret-down";
        bar.style.display = collapsed ? "none" : "flex";
      });

      ["#mobile-filter", ".bar-filter"].forEach((sel) => {
        $(sel)?.addEventListener("click", () => {
          $("#filters")?.classList.toggle("open-mobile");
        });
      });

      $(".clear")?.addEventListener("click", () => resetAllState());

      /* --- modal plumbing (openModal/closeModal are shared by many views) --- */
      document.addEventListener("click", (e) => {
        if (e.target.closest("[data-tp-close]")) closeModal();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeModal();
      });

      /* "View All Selected Options" -> modal of every applied filter */
      const appliedFiltersContent = buildAppliedFiltersContent;
      document.addEventListener("click", (e) => {
        const openApplied = e.target.closest(".open-applied-modal");
        if (!openApplied) return;
        e.preventDefault();
        const content = appliedFiltersContent(currentState);
        const m = openModal(`<div class="tp-form">
          <h3>All selected filters</h3>
          ${content.html}
          <div class="tp-form-actions">
            <button type="button" class="template-branded-button-view" data-tp-close>Done</button>
            <button type="button" class="template-branded-button" data-opt="clear-all">Clear All</button>
          </div>
        </div>`);
        m.addEventListener("click", (ev) => {
          const rm = ev.target.closest("[data-opt=remove]");
          const li = rm && rm.closest("li[data-i]");
          if (li) {
            const c = content.chips[Number(li.dataset.i)];
            if (c) c.remove();
          } else if (ev.target.closest("[data-opt=clear-all]")) {
            content.clear();
          }
        });
      });

      /* Save This Search -> persist the current state in this browser */
      $("#save-search")?.addEventListener("click", () => {
        const key = "tp.savedSearches";
        let list = [];
        try {
          list = JSON.parse(localStorage.getItem(key) || "[]");
        } catch (e) {}
        const title =
          currentState.category || currentState.make || currentState.keyword
            ? [currentState.category, currentState.make, currentState.model]
                .filter(Boolean)
                .join(" ") || currentState.keyword
            : "All Trucks";
        list.unshift({ title, url: R.urlFor(currentState), at: new Date().toISOString() });
        try {
          localStorage.setItem(key, JSON.stringify(list.slice(0, 20)));
        } catch (e) {}
        toast("Search saved to this browser.");
        const btn = $("#save-search");
        if (btn) btn.textContent = "Search Saved";
        setTimeout(() => {
          if (btn) btn.textContent = "Save This Search";
        }, 2200);
      });

      /* Quick Search -> modal with the common find fields (drives real state) */
      $("#quick-search")?.addEventListener("click", () => {
        const makesOpts = makes.slice().sort((a, b) => a.localeCompare(b));
        const statesOpts = [...new Set(data.listings.map((L) => L.state).filter(Boolean))].sort();
        openModal(`<div class="tp-form">
          <h3>Quick Search</h3>
          <label class="tp-select-label">Keyword
            <input type="text" name="q" value="${esc(currentState.keyword || "")}" placeholder="e.g. Kenworth W900" />
          </label>
          <label class="tp-select-label">Manufacturer
            <select name="make"><option value="">Any</option>${makesOpts.map((m) => `<option value="${esc(m)}" ${currentState.make === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select>
          </label>
          <label class="tp-select-label">State
            <select name="state"><option value="">Any</option>${statesOpts.map((s) => `<option value="${esc(s)}" ${currentState.state === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
          </label>
          <p class="tp-form-err" role="alert" hidden></p>
          <div class="tp-form-actions">
            <button type="button" class="template-branded-button-view" data-opt="quick-apply">Search</button>
            <button type="button" class="template-branded-button" data-tp-close>Cancel</button>
          </div>
        </div>`).addEventListener("click", (ev) => {
          if (!ev.target.closest("[data-opt=quick-apply]")) return;
          const m = $(".tp-modal");
          const val = (name) => {
            const el = m ? m.querySelector(`[name="${name}"]`) : null;
            return el ? el.value.trim() : "";
          };
          const keyword = val("q");
          const make = val("make");
          const state = val("state");
          if (!keyword && !make && !state) {
            const err = m && m.querySelector(".tp-form-err");
            if (err) err.textContent = "Enter a keyword, manufacturer, or state.";
            if (err) err.hidden = false;
            return;
          }
          setState({ keyword: keyword || null, make: make || null, state: state || null, page: 1 }, { scrollTop: true });
          closeModal();
        });
      });

      /* Share This -> share the current page/listing */
      $("#share")?.addEventListener("click", (e) => {
        e.preventDefault();
        shareCurrent(currentState.view === "detail" ? currentListing : null);
      });

      /* Closest-first toggle (finally wired to real geolocation state) */
      $("#show-closest-first-toggle")?.addEventListener("change", (e) => {
        if (e.target.checked) toggleClosest();
        else setClosest(false);
      });

      /* Financing "check buying power" banner -> real financing page */
      document.addEventListener("click", (e) => {
        const cur = e.target.closest(".currency-btn");
        if (cur) {
          e.preventDefault();
          R.navigate("/financing", { scrollTop: true });
          return;
        }
        const bp = e.target.closest(".buyers-premium-link");
        if (bp) {
          e.preventDefault();
          openModal(`<div class="tp-form">
            <h3>Buyer's Premium</h3>
            <p>This is an Equipment Facts auction listing. The buyer's premium percentage is set by the auction
            company and appears on the final invoice; see the full auction details on
            <a href="https://www.equipmentfacts.com" target="_blank" rel="noopener">EquipmentFacts.com</a>.</p>
            <div class="tp-form-actions"><button type="button" class="template-branded-button-view" data-tp-close>Close</button></div>
          </div>`);
        }
      });

      /* Language button -> honest language menu */
      $(".lang-btn")?.addEventListener("click", (e) => {
        e.preventDefault();
        openModal(`<div class="tp-form">
          <h3>Language</h3>
          <p><strong>English</strong> is the only language currently available on this site.</p>
          <p class="info-note">Other languages will follow once the full site is localized.</p>
          <div class="tp-form-actions"><button type="button" class="template-branded-button-view" data-tp-close>Close</button></div>
        </div>`);
      });

      /* "More" menu under the category nav -> links not shown inline */
      const moreBtn = $(".cat-nav .more-btn");
      const moreMenu = document.createElement("div");
      moreMenu.className = "more-menu";
      moreMenu.hidden = true;
      moreMenu.innerHTML = [
        ["/financing", "Financing"],
        ["/shipping", "Shipping"],
        ["/values", "Values & Hi/Lo/Avg"],
        ["/watch-list", "Watch List"],
        ["/alerts", "Alerts"],
        ["/sell", "Sell Your Equipment"],
        ["/brands", "Global Brands"],
        ["/legal", "Legal Notices"],
        ["/sitemap", "Sitemap"],
      ]
        .map(([u, t]) => `<a data-route href="${u}">${t}</a>`)
        .join("");
      if (moreMenu.innerHTML) document.body.appendChild(moreMenu);
      const toggleMore = (open) => {
        if (!moreBtn) return;
        const next = typeof open === "boolean" ? open : moreMenu.hidden;
        moreMenu.hidden = !next;
        moreBtn.setAttribute("aria-expanded", next ? "true" : "false");
        if (next) {
          const r = moreBtn.getBoundingClientRect();
          Object.assign(moreMenu.style, { position: "fixed", top: `${r.bottom + 6}px`, left: `${Math.max(8, r.left)}px` });
        }
      };
      if (moreBtn) {
        moreBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleMore();
        });
      }
      document.addEventListener("click", (e) => {
        if (!moreMenu.hidden && !e.target.closest(".more-menu") && !e.target.closest(".cat-nav .more-btn")) toggleMore(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && !moreMenu.hidden) toggleMore(false);
      });
      /* "View All Categories" chip -> same menu */
      document.addEventListener("click", (e) => {
        const va = e.target.closest(".view-all-cats");
        if (va) {
          e.preventDefault();
          if (moreBtn) toggleMore();
          else openModal(`<div class="tp-form"><p>All categories are shown in the strip above.</p><div class="tp-form-actions"><button type="button" class="template-branded-button-view" data-tp-close>Close</button></div></div>`);
        }
      });

      /* Signed-in account bar (top util bar) */
      renderAuthBar();
    }

    /* Build the "applied filters" list shared by the sidebar chip and the
     * "View All Selected Options" modal. Returns { html, chips, clear }. */
    function buildAppliedFiltersContent(st) {
      const chips = [];
      const add = (label, remove) => chips.push({ label, remove });
      if (st.category) add(st.category, () => setState({ category: null, make: null, model: null, page: 1 }));
      else if (st.view === "list") add("Sleeper Trucks", () => setState({}));
      if (st.make) add(st.make, () => setState({ make: null, model: null, page: 1 }));
      if (st.model) add(st.model, () => setState({ model: null, page: 1 }));
      if (st.year) add(st.year, () => setState({ year: null }));
      if (st.condition) add(st.condition, () => setState({ condition: null }));
      if (st.state) add(st.state, () => setState({ state: null }));
      if (st.dealer) add(`Dealer: ${st.dealer}`, () => setState({ dealer: null, page: 1 }));
      Object.keys(st.specs || {}).forEach((k) => {
        add(`${k}: ${st.specs[k]}`, () => {
          const specs = { ...(currentState.specs || {}) };
          delete specs[k];
          setState({ specs, page: 1 });
        });
      });
      Object.keys(st.ranges || {}).forEach((rkey) => {
        const r = st.ranges[rkey];
        const parts = [];
        if (r && r.min != null) parts.push(`from ${r.min}`);
        if (r && r.max != null) parts.push(`to ${r.max}`);
        add(`${rkey} ${parts.join(" ")}`, () => {
          const ranges = { ...(currentState.ranges || {}) };
          delete ranges[rkey];
          setState({ ranges, page: 1 });
        });
      });
      if (st.pmin != null || st.pmax != null) {
        const parts = [];
        if (st.pmin != null) parts.push(`$${st.pmin}`);
        if (st.pmax != null) parts.push(`$${st.pmax}`);
        add(`Price ${parts.join(" – ")}`, () => setState({ pmin: null, pmax: null, page: 1 }));
      }
      if (st.keyword) add(`"${st.keyword}"`, () => setState({ keyword: null, page: 1 }));
      const html = !chips.length
        ? `<p>No filters are applied — showing the full inventory.</p>`
        : `<ul class="facet-list">${chips
            .map((c, i) => `<li data-i="${i}">${esc(c.label)} <button type="button" class="linklike" data-opt="remove">Remove</button></li>`)
            .join("")}</ul>`;
      return {
        html,
        chips,
        clear: resetAllState,
      };
    }

    /* Blank every search dimension — the sidebar "Clear All", the applied-
     * filters modal "Clear All", and per-chip clears share the same reset so
     * none of them can silently ignore dealer/specs/ranges/price/mode. */
    function resetAllState() {
      setState({
        category: null, make: null, model: null, keyword: null, condition: null,
        year: null, state: null, dealer: null, specs: null, ranges: null,
        pmin: null, pmax: null, page: 1,
      });
    }

    /* Signed-in state in the top util bar: swap Login/Register for an account
     * menu backed by the real customer session (tp_session cookie). */
    function renderAuthBar() {
      const loginLink = $("#login-link");
      const registerLink = $("#register-link");
      const bar = $("#account-bar");
      if (!bar) return;
      const signedIn = auth.isAuthenticated();
      if (loginLink) loginLink.hidden = signedIn;
      if (registerLink) registerLink.hidden = signedIn;
      bar.hidden = !signedIn;
      if (bar.dataset.wired) return;
      bar.dataset.wired = "1";
      const btn = bar.querySelector(".account-btn");
      if (!btn) return;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = btn.getAttribute("aria-expanded") === "true";
        closeAccountMenu();
        if (open) return;
        const menu = document.createElement("div");
        menu.className = "options-menu account-menu";
        menu.innerHTML = `
          <a data-route href="/truckpaper/watch-list">My Watch List</a>
          <a data-route href="/truckpaper/alerts">Email Alerts</a>
          <a data-route href="/truckpaper/dealer-portal">Dealer Portal</a>
          <button type="button" data-opt="signout">Sign Out</button>`;
        bar.appendChild(menu);
        btn.setAttribute("aria-expanded", "true");
        menu.querySelector("[data-opt=signout]").addEventListener("click", () => {
          submittingPlaceholder(btn);
          auth.logout().then(() => {
            closeAccountMenu();
            toast("You've been signed out.");
            renderAuthBar();
          }).catch(() => {
            closeAccountMenu();
            toast("Sign out failed. Please try again.");
          });
        });
        document.addEventListener("click", closeAccountMenu, { once: true });
        document.addEventListener("keydown", (e) => {
          if (e.key === "Escape") closeAccountMenu();
        }, { once: true });
      });
      function closeAccountMenu() {
        const menu = bar.querySelector(".account-menu");
        if (menu) menu.remove();
        const b = bar.querySelector(".account-btn");
        if (b) b.setAttribute("aria-expanded", "false");
      }
      function submittingPlaceholder(el) {
        el.disabled = true;
        el.textContent = "Signing out…";
      }
    }

    /* ---------- view: auth (login / register / forgot / reset) ---------- */
    function isAuthView(view) {
      return view === "login" || view === "register" || view === "forgot" || view === "reset";
    }

    function authTitles(st) {
      if (st.view === "register") return { h1: "Create Your Account", title: "Register | TruckPaper.com" };
      if (st.view === "forgot") return { h1: "Reset Your Password", title: "Forgot Password | TruckPaper.com" };
      if (st.view === "reset") return { h1: "Choose A New Password", title: "Reset Password | TruckPaper.com" };
      return { h1: "Member Login", title: "Login | TruckPaper.com" };
    }

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /* Keep the busy state visible for at least a beat even on fast failures. */
    function withPause(p, ms) {
      const pause = wait(ms || 500);
      return p.then(
        (v) => pause.then(() => v),
        (e) => pause.then(() => Promise.reject(e))
      );
    }

    function showAuthError(form, msg) {
      const err = form.querySelector(".auth-error");
      if (!err) return;
      err.textContent = msg;
      err.hidden = false;
    }

    function clearAuthError(form) {
      const err = form.querySelector(".auth-error");
      if (err) {
        err.hidden = true;
        err.textContent = "";
      }
    }

    function submitting(form, on) {
      const btn = form.querySelector(".auth-submit");
      if (!btn) return;
      if (on) {
        if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
        btn.textContent = btn.dataset.loading || "Please wait…";
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
      } else {
        if (btn.dataset.originalText) btn.textContent = btn.dataset.originalText;
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
      }
    }

    function bindPwToggles(scope) {
      $$("[data-pw-toggle]", scope).forEach((btn) => {
        btn.addEventListener("click", () => {
          const input = btn.parentElement.querySelector("input");
          if (!input) return;
          const show = input.type === "password";
          input.type = show ? "text" : "password";
          btn.setAttribute("aria-pressed", show ? "true" : "false");
          btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
          const icon = btn.querySelector("i");
          if (icon) icon.className = show ? "far fa-eye-slash" : "far fa-eye";
        });
      });
    }

    function safeNext() {
      const next = R.parse().params.get("next");
      if (!next) return "/";
      /* Must be a same-origin path: a single leading slash and no scheme,
       * backslashes, or authority prefix (`//evil`, `javascript:`, `\`). */
      if (!/^\/[^/\\:]/.test(next)) return "/";
      if (/^(?:[a-z][a-z0-9+.-]*:)?[/\\]{2}/i.test(next)) return "/";
      if (/^\/?(login|register|forgot-password)([?#]|$)/.test(next)) return "/";
      return next;
    }

    function loginCardHtml() {
      const remembered = auth.rememberedEmail();
      return `<div class="auth-card">
        <h2 class="auth-card-title">Member Login</h2>
        <p class="auth-card-sub">Sign in to manage your watch list, alerts, and saved searches.</p>
        <form novalidate data-auth-form>
          <div class="auth-field">
            <label for="auth-email">Email Address</label>
            <input id="auth-email" name="email" type="email" autocomplete="email" required
                   inputmode="email" autocapitalize="none" spellcheck="false"
                   placeholder="you@example.com" value="${esc(remembered)}" />
          </div>
          <div class="auth-field">
            <label for="auth-password">Password</label>
            <div class="auth-pw">
              <input id="auth-password" name="password" type="password" autocomplete="current-password" required minlength="8" />
              <button type="button" class="auth-eye" data-pw-toggle aria-label="Show password" aria-pressed="false">
                <i class="far fa-eye" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <p class="auth-error" role="alert" aria-live="polite" hidden></p>
          <div class="auth-row">
            <label class="auth-check"><input type="checkbox" name="remember" ${remembered !== "" ? "checked" : ""} /> Remember me</label>
            <a data-route href="/truckpaper/forgot-password">Forgot password?</a>
          </div>
          <button type="submit" class="auth-submit" data-loading="Signing in…">Sign In</button>
          <p class="auth-alt">Don't have an account? <a data-route href="/truckpaper/register">Create one</a></p>
        </form>
      </div>`;
    }

    function registerCardHtml() {
      return `<div class="auth-card">
        <h2 class="auth-card-title">Create Your Account</h2>
        <p class="auth-card-sub">Join TruckPaper.com for free to save searches and manage alerts.</p>
        <form novalidate data-auth-form>
          <div class="auth-grid-2">
            <div class="auth-field">
              <label for="auth-first">First Name</label>
              <input id="auth-first" name="firstName" type="text" autocomplete="given-name" required />
            </div>
            <div class="auth-field">
              <label for="auth-last">Last Name</label>
              <input id="auth-last" name="lastName" type="text" autocomplete="family-name" required />
            </div>
          </div>
          <div class="auth-field">
            <label for="auth-email">Email Address</label>
            <input id="auth-email" name="email" type="email" autocomplete="email" required
                   inputmode="email" autocapitalize="none" spellcheck="false"
                   placeholder="you@example.com" />
          </div>
          <div class="auth-field">
            <label for="auth-password">Password</label>
            <div class="auth-pw">
              <input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="8" />
              <button type="button" class="auth-eye" data-pw-toggle aria-label="Show password" aria-pressed="false">
                <i class="far fa-eye" aria-hidden="true"></i>
              </button>
            </div>
            <p class="auth-hint">Use at least 8 characters.</p>
          </div>
          <div class="auth-field">
            <label for="auth-confirm">Confirm Password</label>
            <div class="auth-pw">
              <input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" required minlength="8" />
              <button type="button" class="auth-eye" data-pw-toggle aria-label="Show password" aria-pressed="false">
                <i class="far fa-eye" aria-hidden="true"></i>
              </button>
            </div>
          </div>
          <p class="auth-error" role="alert" aria-live="polite" hidden></p>
          <button type="submit" class="auth-submit" data-loading="Creating Account…">Create Account</button>
          <p class="auth-alt">Already have an account? <a data-route href="/truckpaper/login">Sign in</a></p>
        </form>
      </div>`;
    }

    function forgotCardHtml() {
      return `<div class="auth-card">
        <h2 class="auth-card-title">Reset Your Password</h2>
        <p class="auth-card-sub">Enter the email address tied to your account and we'll send you a reset link.</p>
        <form novalidate data-auth-form>
          <div class="auth-field">
            <label for="auth-email">Email Address</label>
            <input id="auth-email" name="email" type="email" autocomplete="email" required
                   inputmode="email" autocapitalize="none" spellcheck="false"
                   placeholder="you@example.com" />
          </div>
          <p class="auth-error" role="alert" aria-live="polite" hidden></p>
          <button type="submit" class="auth-submit" data-loading="Sending…">Send Reset Link</button>
          <p class="auth-alt"><a data-route href="/truckpaper/login">‹ Back to Sign In</a></p>
        </form>
        <div class="auth-ok" role="status" aria-live="polite" hidden>
          If an account exists for that address, a password reset link is on its way.
        </div>
      </div>`;
    }

    function resetCardHtml(token) {
      return `<div class="auth-card">
        <h2 class="auth-card-title">Choose A New Password</h2>
        <p class="auth-card-sub">Enter a new password for your account. The reset link is valid for 30 minutes.</p>
        ${
          token
            ? `<form novalidate data-auth-form>
                <div class="auth-field">
                  <label for="auth-password">New Password</label>
                  <div class="auth-pw">
                    <input id="auth-password" name="password" type="password" autocomplete="new-password" required minlength="8" />
                    <button type="button" class="auth-eye" data-pw-toggle aria-label="Show password" aria-pressed="false">
                      <i class="far fa-eye" aria-hidden="true"></i>
                    </button>
                  </div>
                  <p class="auth-hint">Use at least 8 characters.</p>
                </div>
                <div class="auth-field">
                  <label for="auth-confirm">Confirm New Password</label>
                  <div class="auth-pw">
                    <input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" required minlength="8" />
                    <button type="button" class="auth-eye" data-pw-toggle aria-label="Show password" aria-pressed="false">
                      <i class="far fa-eye" aria-hidden="true"></i>
                    </button>
                  </div>
                </div>
                <p class="auth-error" role="alert" aria-live="polite" hidden></p>
                <button type="submit" class="auth-submit" data-loading="Saving…">Update Password</button>
                <p class="auth-alt"><a data-route href="/truckpaper/login">‹ Back to Sign In</a></p>
              </form>
              <div class="auth-ok" role="status" aria-live="polite" hidden>
                Your password has been updated. You can now sign in.
              </div>`
            : `<div class="auth-error" style="display:block">
                This reset link is missing or invalid. Request a new one from the
                <a data-route href="/truckpaper/forgot-password">forgot password</a> page.
              </div>
              <p class="auth-alt"><a data-route href="/truckpaper/forgot-password">Request a new reset link</a></p>`
        }
      </div>`;
    }

    function bindResetForm(root, token) {
      bindPwToggles(root);
      const form = root.querySelector("[data-auth-form]");
      if (!form) return;
      const pwEl = root.querySelector("#auth-password");
      const confirmEl = root.querySelector("#auth-confirm");
      if (pwEl && !pwEl.value) pwEl.focus();

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const busy = form.querySelector(".auth-submit");
        if (busy && busy.disabled) return;
        clearAuthError(form);
        const password = pwEl ? pwEl.value : "";
        const confirm = confirmEl ? confirmEl.value : "";
        if (!auth.isValidPassword(password)) {
          showAuthError(form, "Password must be at least 8 characters.");
          if (pwEl) pwEl.focus();
          return;
        }
        if (password !== confirm) {
          showAuthError(form, "Passwords do not match.");
          if (confirmEl) confirmEl.focus();
          return;
        }
        submitting(form, true);
        withPause(auth.resetPassword(token, password), 500)
          .then(() => {
            const ok = root.querySelector(".auth-ok");
            if (ok) ok.hidden = false;
            form.hidden = true;
          })
          .catch((err) => {
            showAuthError(form, err && err.message ? err.message : "That reset link is no longer valid. Please request a new one.");
            submitting(form, false);
          });
      });
    }

    function bindLoginForm(root) {
      bindPwToggles(root);
      const form = root.querySelector("[data-auth-form]");
      const emailEl = root.querySelector("#auth-email");
      const pwEl = root.querySelector("#auth-password");
      if (emailEl && !emailEl.value) emailEl.focus();

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const busy = form.querySelector(".auth-submit");
        if (busy && busy.disabled) return;
        clearAuthError(form);
        const email = (emailEl ? emailEl.value : "").trim();
        const password = pwEl ? pwEl.value : "";
        if (!email || !auth.isValidEmail(email)) {
          showAuthError(form, "Please enter a valid email address.");
          if (emailEl) emailEl.focus();
          return;
        }
        if (!auth.isValidPassword(password)) {
          showAuthError(form, "Password must be at least 8 characters.");
          if (pwEl) pwEl.focus();
          return;
        }
        const remember = !!(form.querySelector('input[name="remember"]') || {}).checked;
        submitting(form, true);
        withPause(auth.signIn({ email, password, remember }), 500)
          .then(() => {
            renderAuthBar();
            /* The user may have left the auth page while the request was in
             * flight — never yank them off their current route. */
            if (!form.isConnected || !document.body.classList.contains("route-auth")) return;
            /* Server accepted the credentials. Persist ONLY the email when
             * "remember me" is set; a real session/token from /api/auth/login
             * would be stored here by the future backend integration. */
            if (remember) auth.rememberEmail(email);
            else auth.clearRememberedEmail();
            R.navigate(safeNext(), { scrollTop: true });
          })
          .catch((err) => {
            showAuthError(form, err && err.message ? err.message : "Sign in failed. Please try again.");
            submitting(form, false);
            if (pwEl) {
              pwEl.select();
              pwEl.focus();
            }
          });
      });
    }

    function bindRegisterForm(root) {
      bindPwToggles(root);
      const form = root.querySelector("[data-auth-form]");
      const first = root.querySelector("#auth-first");
      const last = root.querySelector("#auth-last");
      const emailEl = root.querySelector("#auth-email");
      const pwEl = root.querySelector("#auth-password");
      const confirmEl = root.querySelector("#auth-confirm");
      if (first && !first.value) first.focus();

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const busy = form.querySelector(".auth-submit");
        if (busy && busy.disabled) return;
        clearAuthError(form);
        const firstName = (first ? first.value : "").trim();
        const lastName = (last ? last.value : "").trim();
        const email = (emailEl ? emailEl.value : "").trim();
        const password = pwEl ? pwEl.value : "";
        const confirm = confirmEl ? confirmEl.value : "";
        if (!firstName || !lastName) {
          showAuthError(form, "Please enter your first and last name.");
          if (first) first.focus();
          return;
        }
        if (!auth.isValidEmail(email)) {
          showAuthError(form, "Please enter a valid email address.");
          if (emailEl) emailEl.focus();
          return;
        }
        if (!auth.isValidPassword(password)) {
          showAuthError(form, "Password must be at least 8 characters.");
          if (pwEl) pwEl.focus();
          return;
        }
        if (password !== confirm) {
          showAuthError(form, "Passwords do not match.");
          if (confirmEl) confirmEl.focus();
          return;
        }
        submitting(form, true);
        withPause(auth.signUp({ firstName, lastName, email, password }), 500)
          .then(() => {
            renderAuthBar();
            if (!form.isConnected || !document.body.classList.contains("route-auth")) return;
            R.navigate("/login", { scrollTop: true });
          })
          .catch((err) => {
            showAuthError(form, err && err.message ? err.message : "Could not create the account. Please try again.");
            submitting(form, false);
          });
      });
    }

    function bindForgotForm(root) {
      const form = root.querySelector("[data-auth-form]");
      const emailEl = root.querySelector("#auth-email");
      if (emailEl) emailEl.focus();

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const busy = form.querySelector(".auth-submit");
        if (busy && busy.disabled) return;
        clearAuthError(form);
        const email = (emailEl ? emailEl.value : "").trim();
        if (!auth.isValidEmail(email)) {
          showAuthError(form, "Please enter a valid email address.");
          if (emailEl) emailEl.focus();
          return;
        }
        submitting(form, true);
        withPause(auth.requestPasswordReset(email), 500)
          .then(() => {
            if (!form.isConnected || !document.body.classList.contains("route-auth")) return;
            const ok = root.querySelector(".auth-ok");
            if (ok) ok.hidden = false;
            form.hidden = true;
          })
          .catch((err) => {
            showAuthError(form, err && err.message ? err.message : "We couldn't send the reset email. Please try again.");
            submitting(form, false);
          });
      });
    }

    function renderAuth(st) {
      document.body.classList.add("route-auth");
      const info = authTitles(st);
      const h1 = $("h1");
      if (h1) h1.textContent = info.h1;
      document.title = info.title;
      setBreadcrumb([
        { label: "TRUCKS FOR SALE", url: "/" },
        { label: String(info.h1).toUpperCase(), url: null },
      ]);

      if (auth.isAuthenticated() && st.view !== "reset") {
        R.navigate(safeNext(), { replace: true, scrollTop: true });
        return;
      }

      const root = $("#listings");
      if (!root) return;
      if (st.view === "login") {
        root.innerHTML = loginCardHtml();
        bindLoginForm(root);
      } else if (st.view === "register") {
        root.innerHTML = registerCardHtml();
        bindRegisterForm(root);
      } else if (st.view === "reset") {
        const token = st.token || st.params?.get("token") || null;
        root.innerHTML = resetCardHtml(token);
        bindResetForm(root, token);
      } else {
        root.innerHTML = forgotCardHtml();
        bindForgotForm(root);
      }
    }

    /* ---------- kickoff ---------- */
    let currentListing = null;
    renderChips();
    renderCatPanel();
    renderBlogSide();
    bindGlobal();
    renderCurrent(currentState);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();