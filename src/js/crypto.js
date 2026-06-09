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

  window.BezCrypto = {
    id: id,
    today: today,
    clean: clean,
    escapeHtml: escapeHtml,
    hash: hash,
    seal: seal,
    openSeal: openSeal
  };
})();
