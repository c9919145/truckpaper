/* TP_AUTH — single seam the account pages use to talk to the auth backend
 * implemented in api/auth.php (served under /api/auth/*).
 *
 * Sessions live in the server-side TPCUST cookie. The server additionally sets
 * a plain (readable) tp_session marker cookie so the client can detect sign-in
 * state for UI purposes (redirect away from auth pages, account menu). The
 * server remains the single source of truth for credentials.
 *
 * Security rules enforced here:
 *   - passwords are never persisted (no localStorage/sessionStorage) and never
 *     written into URLs;
 *   - the "remember me" flag may persist ONLY the email address;
 */
(function () {
  "use strict";
  if (window.TP_AUTH) return;

  var LS_EMAIL = "tp.remembered.email";

  /* Resolve an /api path through the shared adapter so a front end on GitHub
   * Pages can reach a PHP API hosted on another origin. */
  function apiUrl(path) {
    if (window.TP_API && typeof window.TP_API.url === "function") {
      return window.TP_API.url(path);
    }
    return (window.TP_BASE || "") + "/api" + path;
  }

  function credentials() {
    return window.TP_API && window.TP_API.crossOrigin ? "include" : "same-origin";
  }

  function postJSON(path, body) {
    return fetch(apiUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: credentials(),
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.text().then(function (text) {
        var payload = null;
        try {
          payload = text ? JSON.parse(text) : null;
        } catch (e) {
          payload = null;
        }
        return { ok: res.ok, status: res.status, payload: payload };
      });
    });
  }

  function serviceUnreachable() {
    return new Error("We couldn't reach the sign-in service. Please try again later.");
  }

  /* Map a server response to a resolved payload or a rejected error. */
  function fromResponse(res, badCreds, badMessage) {
    if (res.ok) return Promise.resolve(res.payload);
    var serverMsg = res.payload && res.payload.error;
    if (typeof serverMsg === "string" && serverMsg) {
      return Promise.reject(new Error(serverMsg));
    }
    if (res.status === 401 || res.status === 403) return Promise.reject(badCreds());
    return Promise.reject(badMessage ? badMessage() : serviceUnreachable());
  }

  function signIn(creds) {
    if (!creds || !creds.email || !creds.password) {
      return Promise.reject(new Error("Please enter your email and password."));
    }
    return postJSON("/auth/login", {
      email: String(creds.email).trim(),
      password: String(creds.password),
      remember: !!creds.remember,
    }).then(function (res) {
      return fromResponse(res, function () {
        return new Error("Incorrect email or password.");
      });
    });
  }

  function signUp(details) {
    if (!details || !details.email || !details.password) {
      return Promise.reject(new Error("Please complete every field above."));
    }
    return postJSON("/auth/register", {
      firstName: String(details.firstName || "").trim(),
      lastName: String(details.lastName || "").trim(),
      email: String(details.email).trim(),
      password: String(details.password),
    }).then(function (res) {
      return fromResponse(res, function () {
        return new Error("Could not create the account. Please try again.");
      });
    });
  }

  function requestPasswordReset(email) {
    if (!email) return Promise.reject(new Error("Please enter your email address."));
    return postJSON("/auth/forgot-password", {
      email: String(email).trim(),
    }).then(function (res) {
      return fromResponse(res, function () {
        return new Error("We couldn't send the reset email. Please try again.");
      });
    });
  }

  function isValidEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
  }

  function isValidPassword(v) {
    return String(v || "").length >= 8;
  }

  /* Remember-me keeps only the email address. Never the password. */
  function rememberEmail(email) {
    try {
      localStorage.setItem(LS_EMAIL, String(email || "").trim().toLowerCase());
    } catch (e) {
      /* storage unavailable — non-fatal */
    }
  }

  function rememberedEmail() {
    try {
      return localStorage.getItem(LS_EMAIL) || "";
    } catch (e) {
      return "";
    }
  }

  function clearRememberedEmail() {
    try {
      localStorage.removeItem(LS_EMAIL);
    } catch (e) {
      /* storage unavailable — non-fatal */
    }
  }

  function getCookie(name) {
    var m = new RegExp("(?:^|;\\s*)" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "=([^;]*)").exec(
      document.cookie
    );
    return m ? decodeURIComponent(m[1]) : "";
  }

  /* The server drops tp_session (non-httponly) when a TPCUST session starts
   * and removes it on logout; mirror that with the sign-in flow so the UI
   * reflects real state even after page reloads. */
  function isAuthenticated() {
    return getCookie("tp_session") === "1";
  }

  function logout() {
    return postJSON("/auth/logout", {}).then(function (res) {
      if (res.ok) return Promise.resolve();
      return Promise.reject(new Error("We couldn't sign you out. Please try again."));
    });
  }

  function resetPassword(token, password) {
    if (!token) return Promise.reject(new Error("This reset link is missing its token."));
    if (!password) return Promise.reject(new Error("Please enter a new password."));
    return postJSON("/auth/reset-password", {
      token: String(token),
      password: String(password),
    }).then(function (res) {
      return fromResponse(res, function () {
        return new Error("That reset link is invalid or expired. Request a new one.");
      });
    });
  }

  window.TP_AUTH = {
    signIn: signIn,
    signUp: signUp,
    requestPasswordReset: requestPasswordReset,
    resetPassword: resetPassword,
    isValidEmail: isValidEmail,
    isValidPassword: isValidPassword,
    rememberEmail: rememberEmail,
    rememberedEmail: rememberedEmail,
    clearRememberedEmail: clearRememberedEmail,
    isAuthenticated: isAuthenticated,
    logout: logout,
  };
})();