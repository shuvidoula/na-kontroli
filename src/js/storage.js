(function () {
  "use strict";

  var c = window.BezCrypto;
  var LEGACY_PREFIX = ["v", "p", "a"].join("");
  var OLD_AUTH_KEY = LEGACY_PREFIX + "_single_auth_v3";
  var OLD_DATA_KEY = LEGACY_PREFIX + "_single_data_v3";
  var OLD_USERS_KEY = LEGACY_PREFIX + "_users_v4";
  var OLD_DATA_PREFIX = LEGACY_PREFIX + "_data_v4_";
  var USERS_KEY = "nk_users_v1";
  var DATA_PREFIX = "nk_data_v1_";

  function loadUsers() {
    try {
      var raw = localStorage.getItem(USERS_KEY) || localStorage.getItem(OLD_USERS_KEY) || "[]";
      var loaded = JSON.parse(raw);
      return Array.isArray(loaded) ? loaded : [];
    } catch (e) {
      return [];
    }
  }

  function saveUsers(users) {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
    localStorage.removeItem(OLD_USERS_KEY);
  }

  function migrateOldUser(users) {
    if (users.length) return users;
    try {
      var old = JSON.parse(localStorage.getItem(OLD_AUTH_KEY) || "null");
      if (!old || !old.salt || !old.pinHash || !old.callsign) return users;
      var migrated = [{
        id: "legacy-" + old.callsignHash,
        salt: old.salt,
        callsign: old.callsign,
        callsignHash: old.callsignHash,
        pinHash: old.pinHash,
        legacy: true
      }];
      saveUsers(migrated);
      return migrated;
    } catch (e) {
      return users;
    }
  }

  function createUser(users, callsign, code) {
    var salt = c.id();
    var user = {
      id: c.id(),
      salt: salt,
      callsign: callsign,
      callsignHash: c.hash(callsign.toLowerCase()),
      pinHash: c.hash(salt + callsign.toLowerCase() + code)
    };
    users.push(user);
    saveUsers(users);
    return user;
  }

  function dataKey(user, code) {
    return c.hash(LEGACY_PREFIX + ":" + user.callsign.toLowerCase() + ":" + code + ":" + user.salt);
  }

  function dataStoreKey(user) {
    return DATA_PREFIX + user.id;
  }

  function oldDataStoreKey(user) {
    return OLD_DATA_PREFIX + user.id;
  }

  function loadTasks(user, key) {
    var raw = user ? (localStorage.getItem(dataStoreKey(user)) || localStorage.getItem(oldDataStoreKey(user))) : "";
    if (!raw && user && user.legacy) raw = localStorage.getItem(OLD_DATA_KEY);
    if (!raw) return { ok: true, tasks: [] };
    try {
      var parsed = JSON.parse(c.openSeal(raw, key));
      return { ok: true, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
    } catch (e) {
      return { ok: false, tasks: [] };
    }
  }

  function saveTasks(user, key, tasks) {
    if (!user) return;
    localStorage.setItem(dataStoreKey(user), c.seal(JSON.stringify({
      version: 5,
      userId: user.id,
      tasks: tasks,
      savedAt: new Date().toISOString()
    }), key));
    localStorage.removeItem(oldDataStoreKey(user));
  }

  function deleteUser(users, userId) {
    var user = users.find(function (item) { return item.id === userId; });
    if (!user) return users;
    localStorage.removeItem(dataStoreKey(user));
    localStorage.removeItem(oldDataStoreKey(user));
    if (user.legacy) {
      localStorage.removeItem(OLD_AUTH_KEY);
      localStorage.removeItem(OLD_DATA_KEY);
    }
    var next = users.filter(function (item) { return item.id !== userId; });
    saveUsers(next);
    return next;
  }

  window.BezStore = {
    loadUsers: loadUsers,
    saveUsers: saveUsers,
    migrateOldUser: migrateOldUser,
    createUser: createUser,
    dataKey: dataKey,
    loadTasks: loadTasks,
    saveTasks: saveTasks,
    deleteUser: deleteUser
  };
})();
