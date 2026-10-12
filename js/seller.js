/*
 * js/seller.js — the Dealer Portal: a self-contained seller workspace.
 *
 * Renders into a mount point the app injects on /dealer-portal and talks to
 * the seller API in api/index.php (/api/seller/...). Three states, driven by
 * GET /seller/status:
 *
 *   - signed out            → a sign-in prompt
 *   - customer (not seller) → an "apply to sell" form (POST /seller/apply)
 *   - seller, pending         → a waiting-for-approval notice
 *   - seller, approved        → the workspace: profile, listings, inquiries
 *
 * When the API is unreachable (e.g. the static GitHub Pages build) the portal
 * shows a short "connect a backend" note instead of failing.
 *
 * Exposes window.TP_SELLER (the API client) and window.TP_SELLER_PORTAL.mount.
 */
(function () {
  "use strict";
  if (window.TP_SELLER || window.TP_SELLER_PORTAL) return;

  function base() {
    if (window.TP_API && window.TP_API.base) return window.TP_API.base;
    return (window.TP_BASE || "") + "/api";
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function req(method, path, body, isForm) {
    var opts = { method: method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (isForm) {
      opts.body = body;
    } else if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    return fetch(base() + path, opts).then(function (res) {
      return res.text().then(function (t) {
        var p = null;
        try { p = t ? JSON.parse(t) : null; } catch (e) { /* non-JSON error page */ }
        if (!res.ok) {
          var m = (p && p.error && p.error.message) || (p && p.error) || (p && p.message);
          var err = new Error(typeof m === "string" && m ? m : "Request failed (" + res.status + ")");
          err.status = res.status;
          throw err;
        }
        return p;
      });
    });
  }

  var api = {
    status: function () { return req("GET", "/seller/status"); },
    apply: function (d) { return req("POST", "/seller/apply", d); },
    me: function () { return req("GET", "/seller/me"); },
    updateProfile: function (d) { return req("PUT", "/seller/me", d); },
    listings: function () { return req("GET", "/seller/listings"); },
    createListing: function (d) { return req("POST", "/seller/listings", d); },
    updateListing: function (id, d) { return req("PUT", "/seller/listings/" + id, d); },
    deleteListing: function (id) { return req("DELETE", "/seller/listings/" + id); },
    inquiries: function () { return req("GET", "/seller/inquiries"); },
    updateInquiry: function (id, status) { return req("PUT", "/seller/inquiries/" + id, { status: status }); },
    upload: function (file) {
      var fd = new FormData();
      fd.append("file", file);
      return req("POST", "/seller/upload", fd, true);
    },
  };
  window.TP_SELLER = api;

  function categories() {
    var d = window.TP_DATA;
    if (d && Array.isArray(d.categories) && d.categories.length) {
      return d.categories.map(function (c) { return typeof c === "string" ? c : c.name; }).filter(Boolean);
    }
    return ["Sleeper Trucks", "Day Cab Trucks", "Dump Trucks", "Flatbed Trucks", "Box Trucks", "Trailers", "Parts"];
  }

  function money(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return "—";
    return "$" + n.toLocaleString("en-US");
  }

  function statusPill(status) {
    var map = {
      published: ["#dcfce7", "#14532d", "Published"],
      pending: ["#fef3c7", "#92400e", "In review"],
      rejected: ["#fee2e2", "#7f1d1d", "Rejected"],
      deleted: ["#e5e7eb", "#374151", "Deleted"],
      draft: ["#e5e7eb", "#374151", "Draft"],
    };
    var s = map[status] || ["#e5e7eb", "#374151", status || "—"];
    return '<span style="display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;background:' +
      s[0] + ";color:" + s[1] + '">' + esc(s[2]) + "</span>";
  }

  /* ---------------------------------------------------------------- */
  /* State renderers                                                   */
  /* ---------------------------------------------------------------- */

  function signInHtml() {
    return '<div class="info-page"><h2>Dealer Portal</h2>' +
      '<p>Sign in to manage your inventory, dealer profile, and buyer inquiries. ' +
      'New here? <a data-route href="/register">Create a free account</a>, then apply to sell.</p>' +
      '<div class="info-cta-row">' +
      '<a class="template-branded-button-view" data-route href="/login?next=/dealer-portal">Sign In</a>' +
      '<a class="template-branded-button" data-route href="/register">Create Account</a>' +
      "</div>" +
      '<p class="info-note">Accounts and listings are served by the TruckPaper API when one is connected.</p></div>';
  }

  function applyHtml() {
    return '<div class="info-page"><h2>Apply to sell on TruckPaper.com</h2>' +
      '<p>Tell us about your dealership or business. Applications are reviewed by our moderation team, ' +
      "and you can start publishing inventory once approved.</p>" +
      '<form class="tp-form" data-seller-apply novalidate>' +
      '<div class="tp-form-row">' +
      '<label>Company / dealer name <input type="text" name="name" required placeholder="e.g. Midwest Truck Sales" /></label>' +
      '<label>Phone <input type="tel" name="phone" placeholder="(555) 123-4567" /></label>' +
      "</div>" +
      '<div class="tp-form-row">' +
      '<label>City <input type="text" name="city" placeholder="Omaha" /></label>' +
      '<label>State <input type="text" name="state" maxlength="60" placeholder="NE" /></label>' +
      "</div>" +
      '<label>Website <input type="url" name="website" placeholder="https://example.com" /></label>' +
      '<label>About your inventory <textarea name="bio" rows="4" placeholder="What do you sell, and where?"></textarea></label>' +
      '<p class="tp-form-err" hidden></p>' +
      '<div class="tp-form-actions"><button type="submit" class="template-branded-button-view">Submit Application</button></div>' +
      "</form></div>";
  }

  function pendingHtml(name) {
    return '<div class="info-page"><h2>Application under review</h2>' +
      "<p>Thanks" + (name ? ", <strong>" + esc(name) + "</strong>" : "") +
      ". Your seller application is in the moderation queue — you can publish inventory as soon as an " +
      "administrator approves it.</p>" +
      '<p class="info-note">Signed in as a pending seller. ' +
      '<button type="button" class="linklike" data-seller-signout>Sign out</button></p></div>';
  }

  function errorHtml(err, mountEl) {
    var offline = window.TP_API && window.TP_API.available === false;
    return '<div class="info-page"><h2>Dealer Portal</h2>' +
      '<p class="tp-form-err" style="display:block">' +
      esc(offline
        ? "The seller service isn't connected in this demo build. Sign-in, listings, and inquiries become available when a TruckPaper API backend is reachable."
        : (err && err.message) || "We couldn't load your portal.") +
      "</p>" +
      '<div class="info-cta-row"><button type="button" class="template-branded-button-view" data-seller-retry>Try Again</button>' +
      '<a class="template-branded-button" data-route href="/">Back to Listings</a></div></div>';
  }

  function listingFormHtml() {
    return '<form class="tp-form" data-seller-listing-form novalidate>' +
      '<input type="hidden" name="_id" value="" />' +
      '<label>Title <input type="text" name="title" required placeholder="2020 Peterbilt 579" /></label>' +
      '<div class="tp-form-row">' +
      '<label>Category <select name="category">' +
      categories().map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("") +
      "</select></label>" +
      '<label>Condition <select name="condition"><option>Used</option><option>New</option></select></label>' +
      "</div>" +
      '<div class="tp-form-row">' +
      '<label>Manufacturer <input type="text" name="manufacturer" placeholder="Peterbilt" /></label>' +
      '<label>Model <input type="text" name="model" placeholder="579" /></label>' +
      "</div>" +
      '<div class="tp-form-row">' +
      '<label>Year <input type="text" name="year" inputmode="numeric" placeholder="2020" /></label>' +
      '<label>Price (USD) <input type="number" name="price" min="0" step="100" placeholder="89000" /></label>' +
      "</div>" +
      '<div class="tp-form-row">' +
      '<label>Mileage <input type="number" name="mileage" min="0" placeholder="412000" /></label>' +
      '<label>Horsepower <input type="number" name="horsepower" min="0" placeholder="500" /></label>' +
      "</div>" +
      '<div class="tp-form-row">' +
      '<label>Engine <input type="text" name="engine" placeholder="Cummins X15" /></label>' +
      '<label>Transmission <input type="text" name="transmission" placeholder="10 Speed Manual" /></label>' +
      "</div>" +
      '<div class="tp-form-row">' +
      '<label>City <input type="text" name="city" /></label>' +
      '<label>State <input type="text" name="state" maxlength="60" /></label>' +
      "</div>" +
      '<label>VIN <input type="text" name="vin" maxlength="64" /></label>' +
      '<label>Description <textarea name="description" rows="4"></textarea></label>' +
      '<label>Image URLs (one per line) <textarea name="images" rows="3" placeholder="https://example.com/photo1.jpg"></textarea></label>' +
      '<label>Or upload a photo <input type="file" accept="image/*" data-seller-upload /></label>' +
      '<p class="tp-form-err" hidden></p>' +
      '<p class="tp-form-ok" hidden></p>' +
      '<div class="tp-form-actions">' +
      '<button type="submit" class="template-branded-button-view" data-listing-submit>Publish Listing</button>' +
      '<button type="button" class="template-branded-button" data-listing-cancel hidden>Cancel Edit</button>' +
      "</div></form>";
  }

  function dashboardHtml(seller) {
    return '<div class="info-page"><h2>Dealer Portal</h2>' +
      '<p class="info-lead">Signed in as <strong>' + esc(seller.name) + "</strong> " +
      '<span style="font-size:12px;color:#6b7280">/dealers/' + esc(seller.slug) + "</span> · " +
      '<button type="button" class="linklike" data-seller-signout>Sign out</button></p>' +

      '<div class="two-col">' +
      '<div class="panel"><h3>Dealer profile</h3>' +
      '<form class="tp-form" data-seller-profile novalidate>' +
      '<label>Phone <input type="tel" name="phone" value="' + esc(seller.phone) + '" /></label>' +
      '<label>Website <input type="url" name="website" value="' + esc(seller.website) + '" /></label>' +
      '<div class="tp-form-row">' +
      '<label>City <input type="text" name="city" value="' + esc(seller.city) + '" /></label>' +
      '<label>State <input type="text" name="state" maxlength="60" value="' + esc(seller.state) + '" /></label>' +
      "</div>" +
      '<label>About <textarea name="bio" rows="3">' + esc(seller.bio || "") + "</textarea></label>" +
      '<p class="tp-form-err" hidden></p><p class="tp-form-ok" hidden></p>' +
      '<div class="tp-form-actions"><button type="submit" class="template-branded-button-view">Save Profile</button></div>' +
      "</form></div>" +

      '<div class="panel"><h3>Buyer inquiries</h3><div data-seller-inquiries>Loading…</div></div>' +
      "</div>" +

      '<div class="panel" style="margin-top:18px"><h3>Your listings</h3>' +
      '<p><button type="button" class="template-branded-button-view" data-listing-new>+ New Listing</button></p>' +
      '<div data-seller-listing-form-host hidden style="margin-bottom:14px"></div>' +
      '<div data-seller-listings>Loading…</div>' +
      "</div></div>";
  }

  function listingsTable(rows) {
    if (!rows.length) return '<div class="flash info">No listings yet. Add your first one above.</div>';
    var body = rows.map(function (L) {
      var a = L._admin || {};
      return "<tr>" +
        "<td>" + esc(L.title || "Untitled") +
        '<div style="font-size:11px;color:#9ca3af">id ' + esc(L.id) + "</div></td>" +
        "<td>" + esc(a.category || L.category || "") + "</td>" +
        "<td>" + money(a.price != null ? a.price : L.price) + "</td>" +
        "<td>" + statusPill(L.status) + "</td>" +
        '<td style="white-space:nowrap">' +
        '<button type="button" class="linklike" data-listing-edit="' + esc(L.id) + '">Edit</button> · ' +
        '<button type="button" class="linklike" data-listing-delete="' + esc(L.id) + '">Delete</button>' +
        "</td></tr>";
    }).join("");
    return '<table class="values-table"><thead><tr><th>Listing</th><th>Category</th><th>Price</th><th>Status</th><th></th></tr></thead><tbody>' +
      body + "</tbody></table>";
  }

  function inquiriesTable(rows) {
    if (!rows.length) return '<p class="info-note">No inquiries yet.</p>';
    var statuses = ["new", "read", "replied", "archived"];
    var body = rows.map(function (i) {
      var opts = statuses.map(function (s) {
        return '<option value="' + s + '"' + (i.status === s ? " selected" : "") + ">" + s + "</option>";
      }).join("");
      return "<tr>" +
        "<td>" + esc(i.name || "") + '<div style="font-size:11px;color:#9ca3af">' + esc(i.email || "") + "</div></td>" +
        "<td>" + esc(i.message ? String(i.message).slice(0, 140) : "") + "</td>" +
        "<td>" + esc(i.created_at || "") + "</td>" +
        '<td><select data-inquiry="' + esc(i.id) + '">' + opts + "</select></td>" +
        "</tr>";
    }).join("");
    return '<table class="values-table"><thead><tr><th>Buyer</th><th>Message</th><th>Received</th><th>Status</th></tr></thead><tbody>' +
      body + "</tbody></table>";
  }

  /* ---------------------------------------------------------------- */
  /* Mount + bind                                                      */
  /* ---------------------------------------------------------------- */

  function signedOut() {
    return !window.TP_AUTH || !window.TP_AUTH.isAuthenticated();
  }

  function mount(el) {
    if (!el) return null;
    el.dataset.sellerMounted = "1";

    if (signedOut()) {
      el.innerHTML = signInHtml();
      return null;
    }
    el.innerHTML = '<div class="info-page"><p class="info-note">Loading your portal…</p></div>';

    var done = function () {};

    api.status()
      .then(function (st) {
        if (!el.isConnected) return;
        if (st && st.isSeller && st.approved) return renderDashboard(el);
        if (st && st.isSeller) { el.innerHTML = pendingHtml(st.name); bindSignout(el); return; }
        el.innerHTML = applyHtml();
        bindApply(el);
      })
      .catch(function (err) {
        if (!el.isConnected) return;
        if (err && err.status === 401) {
          el.innerHTML = signInHtml();
          return;
        }
        el.innerHTML = errorHtml(err, el);
        bindRetry(el);
      });
    return done;
  }

  function bindRetry(el) {
    var b = el.querySelector("[data-seller-retry]");
    if (b) b.addEventListener("click", function () { mount(el); });
  }

  function bindSignout(el) {
    var b = el.querySelector("[data-seller-signout]");
    if (b) b.addEventListener("click", function () {
      if (window.TP_AUTH) window.TP_AUTH.logout().then(function () { mount(el); }, function () {});
    });
  }

  function formValues(form) {
    var out = {};
    form.querySelectorAll("input, select, textarea").forEach(function (el2) {
      if (el2.name && el2.type !== "file") out[el2.name] = el2.value.trim();
    });
    return out;
  }

  function setErr(form, msg) {
    var e = form.querySelector(".tp-form-err");
    if (e) { e.textContent = msg || ""; e.hidden = !msg; }
    var ok = form.querySelector(".tp-form-ok");
    if (ok && msg) { ok.hidden = true; }
  }
  function setOk(form, msg) {
    var ok = form.querySelector(".tp-form-ok");
    if (ok) { ok.textContent = msg || ""; ok.hidden = !msg; }
  }

  function bindApply(el) {
    var form = el.querySelector("[data-seller-apply]");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = formValues(form);
      if (!v.name) { setErr(form, "Please enter your company or dealer name."); return; }
      var btn = form.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      setErr(form, "");
      api.apply(v)
        .then(function () { mount(el); })
        .catch(function (err) {
          setErr(form, (err && err.message) || "Could not submit your application.");
          if (btn) btn.disabled = false;
        });
    });
  }

  function renderDashboard(el) {
    el.innerHTML = '<div class="info-page"><p class="info-note">Loading your portal…</p></div>';
    Promise.all([api.me(), api.listings(), api.inquiries()])
      .then(function (res) {
        if (!el.isConnected) return;
        var seller = res[0].seller;
        var listings = res[1].listings || [];
        var inquiries = res[2].inquiries || [];
        el.innerHTML = dashboardHtml(seller);
        el.querySelector("[data-seller-listings]").innerHTML = listingsTable(listings);
        el.querySelector("[data-seller-inquiries]").innerHTML = inquiriesTable(inquiries);
        bindDashboard(el, seller, listings, inquiries);
      })
      .catch(function (err) {
        if (!el.isConnected) return;
        el.innerHTML = errorHtml(err, el);
        bindRetry(el);
      });
  }

  function bindDashboard(el, seller, listings, inquiries) {
    bindSignout(el);

    /* profile */
    var pform = el.querySelector("[data-seller-profile]");
    if (pform) pform.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = pform.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      setErr(pform, "");
      api.updateProfile(formValues(pform))
        .then(function () { setOk(pform, "Profile saved."); if (btn) btn.disabled = false; })
        .catch(function (err) { setErr(pform, (err && err.message) || "Could not save."); if (btn) btn.disabled = false; });
    });

    /* inquiries */
    el.querySelectorAll("[data-inquiry]").forEach(function (sel) {
      sel.addEventListener("change", function () {
        api.updateInquiry(sel.getAttribute("data-inquiry"), sel.value).catch(function () {
          setOk(el, ""); /* silent: leave the select as the user set it */
        });
      });
    });

    /* listings */
    var host = el.querySelector("[data-seller-listing-form-host]");
    var lform = null;
    var byId = {};
    listings.forEach(function (L) { byId[String(L.id)] = L; });

    function openForm(listing) {
      host.hidden = false;
      host.innerHTML = listingFormHtml();
      lform = host.querySelector("[data-seller-listing-form]");
      var cancel = lform.querySelector("[data-listing-cancel]");
      var submit = lform.querySelector("[data-listing-submit]");
      if (listing) {
        var a = listing._admin || {};
        var f = lform;
        var set = function (name, val) { var i = f.querySelector('[name="' + name + '"]'); if (i && val != null) i.value = val; };
        f.querySelector('[name="_id"]').value = listing.id;
        set("title", listing.title);
        set("category", a.category || listing.category);
        set("condition", a.condition || listing.condition);
        set("manufacturer", a.manufacturer || listing.manufacturer);
        set("model", a.model || listing.model);
        set("year", a.year || listing.year);
        set("price", a.price != null ? a.price : listing.price);
        set("mileage", a.mileage);
        set("horsepower", a.horsepower);
        set("engine", a.engine);
        set("transmission", a.transmission);
        set("city", listing.city || a.city);
        set("state", a.state || listing.state);
        set("vin", a.vin || listing.vin);
        set("description", listing.description);
        var imgs = listing.images || [];
        set("images", imgs.join("\n"));
        if (cancel) cancel.hidden = false;
        if (submit) submit.textContent = "Save & Resubmit";
      } else {
        if (submit) submit.textContent = "Publish Listing";
      }
      bindListingForm(el, lform);
      host.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    var newBtn = el.querySelector("[data-listing-new]");
    if (newBtn) newBtn.addEventListener("click", function () { openForm(null); });

    el.querySelectorAll("[data-listing-edit]").forEach(function (b) {
      b.addEventListener("click", function () { openForm(byId[b.getAttribute("data-listing-edit")]); });
    });
    el.querySelectorAll("[data-listing-delete]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-listing-delete");
        if (!window.confirm("Remove this listing? It will be hidden from the public site.")) return;
        api.deleteListing(id).then(function () { renderDashboard(el); });
      });
    });
  }

  function bindListingForm(el, form) {
    var cancel = form.querySelector("[data-listing-cancel]");
    if (cancel) cancel.addEventListener("click", function () {
      form.closest("[data-seller-listing-form-host]").hidden = true;
    });

    var upload = form.querySelector("[data-seller-upload]");
    if (upload) upload.addEventListener("change", function () {
      var file = upload.files && upload.files[0];
      if (!file) return;
      setErr(form, "");
      api.upload(file)
        .then(function (res) {
          var ta = form.querySelector('[name="images"]');
          if (ta && res && res.url) ta.value = (ta.value ? ta.value.replace(/\s*$/, "\n") : "") + res.url;
          upload.value = "";
        })
        .catch(function (err) { setErr(form, (err && err.message) || "Upload failed."); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var v = formValues(form);
      var id = v._id;
      delete v._id;
      var images = (v.images || "").split(/\s*\n\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
      v.images = images;
      if (!v.title) { setErr(form, "Please enter a title."); return; }
      var btn = form.querySelector("[data-listing-submit]");
      if (btn) btn.disabled = true;
      setErr(form, "");
      var op = id ? api.updateListing(id, v) : api.createListing(v);
      op.then(function () { renderDashboard(el); })
        .catch(function (err) { setErr(form, (err && err.message) || "Could not save the listing."); if (btn) btn.disabled = false; });
    });
  }

  window.TP_SELLER_PORTAL = { mount: mount, api: api };
})();
