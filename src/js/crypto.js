(function () {
  "use strict";

  function id() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function today() {
    var d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function clean(text) {
    return String(text || "").trim();
  }

  function escapeHtml(text) {
    return String(text || "").replace(/[&<>"']/g, function (m) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m];
    });
  }

  function hash(text) {
    var h = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
  }

  function stream(key, length) {
    var out = "";
    var seed = hash(key);
    while (out.length < length) {
      seed = hash(seed + key + out.length);
      out += seed;
    }
    return out;
  }

  function seal(text, key) {
    var mask = stream(key, text.length);
    var packed = "";
    for (var i = 0; i < text.length; i += 1) {
      packed += String.fromCharCode(text.charCodeAt(i) ^ mask.charCodeAt(i));
    }
    return btoa(unescape(encodeURIComponent(packed)));
  }

  function openSeal(data, key) {
    var packed = decodeURIComponent(escape(atob(data)));
    var mask = stream(key, packed.length);
    var text = "";
    for (var i = 0; i < packed.length; i += 1) {
      text += String.fromCharCode(packed.charCodeAt(i) ^ mask.charCodeAt(i));
    }
    return text;
  }

  function cryptoReady() {
    return !!(window.crypto && window.crypto.subtle && window.TextEncoder && window.TextDecoder);
  }

  function bytesToBase64(bytes) {
    var out = "";
    bytes.forEach(function (byte) { out += String.fromCharCode(byte); });
    return btoa(out).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64ToBytes(text) {
    var normalized = text.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4) normalized += "=";
    var raw = atob(normalized);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }

  function randomBytes(length) {
    var bytes = new Uint8Array(length);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
  }

  function deriveStrongKey(key, salt) {
    var encoder = new TextEncoder();
    return window.crypto.subtle.importKey(
      "raw",
      encoder.encode(key),
      "PBKDF2",
      false,
      ["deriveKey"]
    ).then(function (baseKey) {
      return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 210000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    });
  }

  function sealStrong(text, key) {
    if (!cryptoReady()) return Promise.resolve(seal(text, key));
    var salt = randomBytes(16);
    var iv = randomBytes(12);
    var encoder = new TextEncoder();
    return deriveStrongKey(key, salt).then(function (cryptoKey) {
      return window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, cryptoKey, encoder.encode(text));
    }).then(function (encrypted) {
      return "NK2:" + bytesToBase64(new TextEncoder().encode(JSON.stringify({
        v: 2,
        kdf: "PBKDF2-SHA256-210000",
        alg: "AES-GCM-256",
        s: bytesToBase64(salt),
        i: bytesToBase64(iv),
        d: bytesToBase64(new Uint8Array(encrypted))
      })));
    });
  }

  function openStrong(data, key) {
    if (String(data || "").indexOf("NK2:") !== 0) {
      try {
        return Promise.resolve(openSeal(data, key));
      } catch (e) {
        return Promise.reject(e);
      }
    }
    if (!cryptoReady()) return Promise.reject(new Error("crypto-unavailable"));
    try {
      var packed = JSON.parse(new TextDecoder().decode(base64ToBytes(String(data).slice(4))));
      return deriveStrongKey(key, base64ToBytes(packed.s)).then(function (cryptoKey) {
        return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(packed.i) }, cryptoKey, base64ToBytes(packed.d));
      }).then(function (opened) {
        return new TextDecoder().decode(new Uint8Array(opened));
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function pinHashStrong(salt, name, code) {
    var textSalt = String(salt || "") + ":" + String(name || "").toLowerCase();
    if (!cryptoReady()) return Promise.resolve("NKPH1:" + hash(textSalt + ":" + code));
    var encoder = new TextEncoder();
    return window.crypto.subtle.importKey(
      "raw",
      encoder.encode(String(code || "")),
      "PBKDF2",
      false,
      ["deriveBits"]
    ).then(function (baseKey) {
      return window.crypto.subtle.deriveBits(
        { name: "PBKDF2", salt: encoder.encode(textSalt), iterations: 210000, hash: "SHA-256" },
        baseKey,
        256
      );
    }).then(function (bits) {
      return "NKPH2:" + bytesToBase64(new Uint8Array(bits));
    });
  }

  window.BezCrypto = {
    id: id,
    today: today,
    clean: clean,
    escapeHtml: escapeHtml,
    hash: hash,
    seal: seal,
    openSeal: openSeal,
    sealStrong: sealStrong,
    openStrong: openStrong,
    cryptoReady: cryptoReady,
    pinHashStrong: pinHashStrong
  };
})();
