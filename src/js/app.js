(function () {
  "use strict";

  var c = window.BezCrypto;
  var store = window.BezStore;
  var $$ = window.Dom7;
  var f7 = new Framework7({
    el: "#app",
    name: "НА-КОНТРОЛІ",
    theme: "ios",
    iosTranslucentBars: false,
    iosTranslucentModals: false
  });
  var REMINDER_INTERVAL = 15 * 60 * 1000;
  var EXCHANGE_PREFIX = "НА-КОНТРОЛІ:";
  var OLD_APP_NAME = "\u0411\u0415\u0417-\u0414\u041E\u0413\u0410\u041D\u0418\u0419";
  var OLD_EXCHANGE_PREFIX = OLD_APP_NAME + ":";

  var state = {
    pin: "",
    users: store.migrateOldUser(store.loadUsers()),
    userId: "",
    key: "",
    storageName: "",
    loginMode: "create",
    tasks: [],
    page: "tasks",
    filter: "all",
    tagFilter: "all",
    query: "",
    currentTaskId: "",
    formStages: [],
    dragStageId: "",
    notified: {},
    reminderTimer: 0,
    accessKey: "",
    accessName: "",
    accessKeys: [],
    activeKeyId: "",
    editingKeyId: "",
    exchangeMode: "receive",
    exchangeTaskId: "",
    installPrompt: null
  };

  function $(selector) {
    return document.querySelector(selector);
  }

  function selectedUser() {
    return state.users.find(function (user) { return user.id === state.userId; }) || null;
  }

  function toast(text) {
    var el = $("#appToast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      el.classList.remove("show");
      el.textContent = "";
    }, 1800);
  }

  function clearToast() {
    var el = $("#appToast");
    clearTimeout(toast.timer);
    el.classList.remove("show");
    el.textContent = "";
  }

  function closeServiceMenu() {
    $("#serviceMenu").hidden = true;
  }

  function openTaskModal() {
    $("#taskPopup").classList.add("active");
  }

  function closeTaskModal() {
    $("#taskPopup").classList.remove("active");
  }

  function openExchangeModal(mode, text) {
    state.exchangeMode = mode || "receive";
    $("#exchangePopupTitle").textContent = mode === "send" ? "Передати задачу" : (mode === "backup" ? "Бекап" : "Прийняти задачу");
    $("#exchangeText").value = text || "";
    $("#copyExchangeBtn").style.display = (mode === "send" || mode === "backup") ? "block" : "none";
    $("#acceptExchangeBtn").style.display = mode === "receive" ? "block" : "none";
    $("#transferCompleteBox").style.display = mode === "send" ? "grid" : "none";
    if (mode === "send") {
      var task = state.tasks.find(function (item) { return item.id === state.exchangeTaskId; });
      $("#transferRecipientInput").value = task ? (task.assignee || "") : "";
    } else {
      $("#transferRecipientInput").value = "";
    }
    $("#exchangePopup").classList.add("active");
  }

  function closeExchangeModal() {
    $("#exchangePopup").classList.remove("active");
  }

  function openKeysModal() {
    closeServiceMenu();
    state.editingKeyId = (activeAccessKey() || {}).id || "";
    renderKeyLibrary();
    $("#keysPopup").classList.add("active");
  }

  function closeKeysModal() {
    $("#keysPopup").classList.remove("active");
  }

  function accessStoreKey() {
    return accessStoreKeyFor(state.userId || "none");
  }

  function accessStoreKeyFor(userId) {
    return "nk_exchange_key_" + userId;
  }

  function oldAccessStoreKey() {
    return oldAccessStoreKeyFor(state.userId || "none");
  }

  function oldAccessStoreKeyFor(userId) {
    return "bez_exchange_key_" + userId;
  }

  function activeAccessKey() {
    return state.accessKeys.find(function (item) { return item.kind === "own"; }) || null;
  }

  function syncActiveAccessKey() {
    var active = activeAccessKey();
    state.activeKeyId = active ? active.id : "";
    state.accessName = active ? active.name : (state.storageName || "");
    state.accessKey = active ? active.key : "";
  }

  function normalizeAccessKeys(value) {
    if (!value) return [];
    if (Array.isArray(value.keys)) {
      var result = value.keys.map(function (item) {
        return {
          id: item.id || c.id(),
          label: c.clean(item.label) || "Ключ",
          name: c.clean(item.name) || state.storageName || "",
          key: c.clean(item.key),
          kind: item.kind === "own" ? "own" : "contact"
        };
      }).filter(function (item) { return item.key; });
      if (!value.version || value.version < 3) {
        var activeId = value.activeKeyId || "";
        var ownSet = false;
        var activeItem = result.find(function (item) { return item.id === activeId; }) || result[0];
        result.forEach(function (item) {
          if (!ownSet && item === activeItem) {
            item.kind = "own";
            item.label = item.label || "Мій ключ";
            ownSet = true;
          } else if (item.kind !== "own") {
            item.kind = "contact";
          }
        });
      }
      if (!result.some(function (item) { return item.kind === "own"; }) && result[0]) result[0].kind = "own";
      return result;
    }
    if (value.key) {
      return [{
        id: value.id || c.id(),
        label: value.label || "Мій ключ",
        name: value.name || state.storageName || "",
        key: value.key,
        kind: "own"
      }];
    }
    return [];
  }

  function loadAccessKey() {
    state.accessKey = "";
    state.accessName = state.storageName || "";
    state.accessKeys = [];
    state.activeKeyId = "";
    state.editingKeyId = "";
    try {
      var raw = localStorage.getItem(accessStoreKey()) || localStorage.getItem(oldAccessStoreKey());
      if (raw) {
        var opened = c.openSeal(raw, state.key);
        try {
          var parsed = JSON.parse(opened);
          state.accessKeys = normalizeAccessKeys(parsed);
          state.activeKeyId = (activeAccessKey() && activeAccessKey().id) || parsed.activeKeyId || "";
        } catch (e) {
          state.accessKeys = normalizeAccessKeys({ key: opened, name: state.storageName, label: "Мій ключ" });
        }
      }
    } catch (e) {
      state.accessKeys = [];
    }
    syncActiveAccessKey();
  }

  function persistAccessKeys() {
    if (state.accessKeys.length) {
      localStorage.setItem(accessStoreKey(), c.seal(JSON.stringify({
        version: 3,
        activeKeyId: state.activeKeyId,
        keys: state.accessKeys
      }), state.key));
      localStorage.removeItem(oldAccessStoreKey());
    } else {
      localStorage.removeItem(accessStoreKey());
    }
    syncActiveAccessKey();
  }

  function ensureOwnKey() {
    var own = activeAccessKey();
    if (own) return own;
    own = {
      id: c.id(),
      kind: "own",
      label: "Мій ключ",
      name: state.storageName || "",
      key: ""
    };
    state.accessKeys.unshift(own);
    state.activeKeyId = own.id;
    return own;
  }

  function renderKeyLibrary() {
    var own = ensureOwnKey();
    var contacts = state.accessKeys.filter(function (item) { return item.kind !== "own"; });
    var html =
      '<section class="key-card own-key-card" data-key-id="' + own.id + '">' +
        '<button class="key-card-title" type="button" data-action="toggleKey">' +
          '<strong>МІЙ КЛЮЧ</strong><span>' + c.escapeHtml(own.key ? (own.name || "нік не вказано") : "ключ ще не створено") + '</span>' +
        '</button>' +
        '<div class="key-card-body" ' + (state.editingKeyId === own.id ? "" : "hidden") + '>' +
          '<label class="field-label">Назва<input data-key-field="label" type="text" maxlength="40" value="' + c.escapeHtml(own.label || "Мій ключ") + '"></label>' +
          '<label class="field-label">Нік<input data-key-field="name" type="text" maxlength="40" value="' + c.escapeHtml(own.name || "") + '"></label>' +
          '<label class="field-label">Ключ<textarea data-key-field="key" placeholder="Натисніть згенерувати">' + c.escapeHtml(own.key || "") + '</textarea></label>' +
          '<div class="key-card-actions">' +
            '<button class="button button-outline" type="button" data-action="copyKey">Копіювати</button>' +
            '<button class="button button-outline" type="button" data-action="generateOwnKey"' + (own.key ? " disabled" : "") + '>Згенерувати</button>' +
            '<button class="button button-fill" type="button" data-action="saveKey">Зберегти</button>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<div class="key-section-title">Контакти</div>' +
      contacts.map(function (item) {
        return '<section class="key-card" data-key-id="' + item.id + '">' +
          '<button class="key-card-title" type="button" data-action="toggleKey">' +
            '<strong>' + c.escapeHtml(item.label || "Контакт") + '</strong><span>' + c.escapeHtml(item.name || "імʼя не вказано") + '</span>' +
          '</button>' +
          '<div class="key-card-body" ' + (state.editingKeyId === item.id ? "" : "hidden") + '>' +
            '<label class="field-label">Назва контакту<input data-key-field="label" type="text" maxlength="40" value="' + c.escapeHtml(item.label || "") + '"></label>' +
            '<label class="field-label">Імʼя контакту<input data-key-field="name" type="text" maxlength="40" value="' + c.escapeHtml(item.name || "") + '"></label>' +
            '<label class="field-label">Його ключ<textarea data-key-field="key" placeholder="Вставте ключ контакту">' + c.escapeHtml(item.key || "") + '</textarea></label>' +
            '<div class="key-card-actions contact-actions">' +
              '<button class="button button-outline" type="button" data-action="copyKey">Копіювати</button>' +
              '<button class="button button-fill" type="button" data-action="saveKey">Зберегти</button>' +
              '<button class="button button-outline danger-link" type="button" data-action="deleteKey">Видалити</button>' +
            '</div>' +
          '</div>' +
        '</section>';
    }).join("");
    $("#accessKeyList").innerHTML = html;
  }

  function randomAccessKey() {
    var bytes = new Uint8Array(32);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    var packed = "";
    bytes.forEach(function (byte) { packed += String.fromCharCode(byte); });
    return btoa(packed).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function newKeyForm() {
    var count = state.accessKeys.filter(function (key) { return key.kind !== "own"; }).length + 1;
    var item = {
      id: c.id(),
      kind: "contact",
      label: "Контакт " + count,
      name: "",
      key: ""
    };
    state.accessKeys.push(item);
    state.editingKeyId = item.id;
    renderKeyLibrary();
    toast("Контакт додано.");
  }

  function selectAccessKey(id) {
    var item = state.accessKeys.find(function (key) { return key.id === id; });
    if (!item) return;
    state.editingKeyId = state.editingKeyId === item.id ? "" : item.id;
    renderKeyLibrary();
  }

  function deleteAccessKey(id) {
    var item = state.accessKeys.find(function (key) { return key.id === id; });
    if (!item) return;
    if (item.kind === "own") {
      toast("Мій ключ не видаляється. Його можна змінити або згенерувати новий.");
      return;
    }
    if (!confirm("Видалити ключ \"" + item.label + "\"? Старі пакети з ним не відкриються.")) return;
    state.accessKeys = state.accessKeys.filter(function (key) { return key.id !== id; });
    persistAccessKeys();
    state.editingKeyId = (activeAccessKey() || {}).id || "";
    renderKeyLibrary();
    toast("Ключ видалено.");
  }

  function keyFieldValue(card, field) {
    var input = card.querySelector('[data-key-field="' + field + '"]');
    return input ? c.clean(input.value) : "";
  }

  function saveKeyCard(card) {
    var id = card.dataset.keyId;
    var item = state.accessKeys.find(function (key) { return key.id === id; });
    if (!item) return;
    var keyValue = keyFieldValue(card, "key");
    if (!keyValue) {
      toast(item.kind === "own" ? "Згенеруйте мій ключ." : "Вставте ключ контакту.");
      return;
    }
    item.label = keyFieldValue(card, "label") || (item.kind === "own" ? "Мій ключ" : "Контакт");
    item.name = keyFieldValue(card, "name") || (item.kind === "own" ? state.storageName : "");
    item.key = keyValue;
    if (item.kind === "own") state.activeKeyId = item.id;
    persistAccessKeys();
    state.editingKeyId = item.id;
    renderKeyLibrary();
    toast(item.kind === "own" ? "Мій ключ збережено." : "Контакт збережено.");
  }

  function copyKeyCard(card) {
    var item = state.accessKeys.find(function (key) { return key.id === card.dataset.keyId; });
    var keyValue = keyFieldValue(card, "key") || (item ? item.key : "");
    if (!keyValue) {
      toast("Ключ порожній.");
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(keyValue).then(function () {
        toast("Ключ скопійовано.");
      }).catch(function () {
        toast("Скопіюйте ключ вручну.");
      });
      return;
    }
    toast("Скопіюйте ключ вручну.");
  }

  function generateOwnKey(card) {
    var item = state.accessKeys.find(function (key) { return key.id === card.dataset.keyId; });
    if (!item || item.kind !== "own") return;
    var keyInput = card.querySelector('[data-key-field="key"]');
    if (!keyInput) return;
    if (c.clean(keyInput.value)) {
      toast("Щоб згенерувати новий, спочатку очистіть старий ключ.");
      return;
    }
    keyInput.value = randomAccessKey();
    toast("Мій ключ згенеровано.");
  }

  function copyTextFrom(selector, okText) {
    var field = $(selector);
    var text = field.value;
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        toast(okText);
      }).catch(function () {
        field.select();
        toast("Скопіюйте виділений текст.");
      });
      return;
    }
    field.select();
    toast("Скопіюйте виділений текст.");
  }

  function requireAccessKey() {
    var own = activeAccessKey();
    if (own && own.key) return true;
    toast("Спочатку створіть мій ключ.");
    openKeysModal();
    return false;
  }

  function requireAnyAccessKey() {
    if (state.accessKeys.some(function (item) { return item.key; })) return true;
    toast("Спочатку додайте мій ключ або контакт.");
    openKeysModal();
    return false;
  }

  function notificationSupported() {
    return "Notification" in window;
  }

  function notifyKey() {
    return "na_kontroli_notified_" + (state.userId || "none");
  }

  function loadNotified() {
    try {
      state.notified = JSON.parse(localStorage.getItem(notifyKey()) || "{}");
    } catch (e) {
      state.notified = {};
    }
  }

  function saveNotified() {
    try {
      localStorage.setItem(notifyKey(), JSON.stringify(state.notified));
    } catch (e) {
      state.notified = {};
    }
  }

  function updateNotifyButton() {
    var button = $("#notifyBtn");
    if (!button) return;
    if (!notificationSupported()) {
      button.textContent = "Сповіщення: недоступні";
      return;
    }
    if (Notification.permission === "granted") button.textContent = "Сповіщення: увімкнено";
    else if (Notification.permission === "denied") button.textContent = "Сповіщення: заблоковано";
    else button.textContent = "Сповіщення";
  }

  function taskDueDate(task) {
    if (!task.date || !task.time) return null;
    var date = new Date(task.date + "T" + task.time);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function isOverdue(task) {
    var due = taskDueDate(task);
    return !!due && task.status !== "done" && due.getTime() < Date.now();
  }

  function reminderId(task, kind) {
    return [task.id, task.updatedAt || task.createdAt || "", task.date || "", task.time || "", kind].join("|");
  }

  function clearOldReminderMarks() {
    var live = {};
    state.tasks.forEach(function (task) {
      if (task.status === "done" || !taskDueDate(task)) return;
      live[reminderId(task, "hour")] = true;
      live[reminderId(task, "time")] = true;
    });
    Object.keys(state.notified).forEach(function (key) {
      if (!live[key]) delete state.notified[key];
    });
    saveNotified();
  }

  function sendNotification(task, kind) {
    var prefix = kind === "hour" ? "За 1 годину" : "Час задачі";
    var body = (task.time ? task.time + " · " : "") + label(task.status) + (task.assignee ? " · " + task.assignee : "");
    if (notificationSupported() && Notification.permission === "granted") {
      navigator.serviceWorker.ready.then(function (registration) {
        if (registration.showNotification) {
          registration.showNotification(prefix + ": " + task.title, {
            body: body,
            tag: "bez-" + task.id + "-" + kind,
            renotify: true,
            icon: "icon-192.png",
            badge: "icon-192.png",
            data: { taskId: task.id }
          });
        } else {
          new Notification(prefix + ": " + task.title, { body: body, tag: "bez-" + task.id + "-" + kind });
        }
      }).catch(function () {
        new Notification(prefix + ": " + task.title, { body: body, tag: "bez-" + task.id + "-" + kind });
      });
    }
    toast(prefix + ": " + task.title);
  }

  function checkReminders() {
    if (!state.userId || !state.tasks.length) return;
    var now = Date.now();
    var grace = 15 * 60 * 1000;
    var changed = false;
    state.tasks.forEach(function (task) {
      if (task.status === "done") return;
      var due = taskDueDate(task);
      if (!due) return;
      [
        { kind: "hour", at: due.getTime() - 60 * 60 * 1000 },
        { kind: "time", at: due.getTime() }
      ].forEach(function (item) {
        var id = reminderId(task, item.kind);
        if (state.notified[id]) return;
        if (now >= item.at && now <= item.at + grace) sendNotification(task, item.kind);
        if (now >= item.at) {
          state.notified[id] = new Date().toISOString();
          changed = true;
        }
      });
    });
    if (changed) saveNotified();
  }

  function startReminderLoop() {
    clearInterval(state.reminderTimer);
    checkReminders();
    state.reminderTimer = setInterval(checkReminders, REMINDER_INTERVAL);
  }

  function enableNotifications() {
    closeServiceMenu();
    if (!notificationSupported()) {
      toast("Сповіщення недоступні у цьому браузері.");
      return;
    }
    if (Notification.permission === "granted") {
      updateNotifyButton();
      checkReminders();
      toast("Сповіщення вже увімкнені.");
      return;
    }
    if (Notification.permission === "denied") {
      updateNotifyButton();
      toast("Сповіщення заблоковані в налаштуваннях браузера.");
      return;
    }
    Notification.requestPermission().then(function (permission) {
      updateNotifyButton();
      if (permission === "granted") {
        checkReminders();
        toast("Сповіщення увімкнені.");
      } else {
        toast("Дозвіл на сповіщення не надано.");
      }
    });
  }

  function label(status) {
    if (status === "run") return "Іншим";
    if (status === "done") return "Виконано";
    return "Моя";
  }

  function tagMeta(tag) {
    if (tag === "personal") return { key: "personal", letter: "О", label: "Особисте", cls: "personal" };
    if (tag === "control") return { key: "control", letter: "К", label: "На контролі", cls: "control" };
    if (tag === "urgent") return { key: "urgent", letter: "Т", label: "Терміново", cls: "urgent" };
    return null;
  }

  function tagFilterHtml() {
    var filters = [
      { key: "personal", label: "Особисте" },
      { key: "control", label: "На контролі" },
      { key: "urgent", label: "Терміново" },
      { key: "all", label: "Всі" }
    ];
    return '<div class="tag-filters">' + filters.map(function (item) {
      return '<button class="tag-filter ' + (state.tagFilter === item.key ? "active" : "") +
        '" type="button" data-action="tagFilter" data-tag-filter="' + item.key + '">' +
        c.escapeHtml(item.label) + '</button>';
    }).join("") + '</div>';
  }

  function stageText(task, value) {
    var text = c.clean(value);
    return text || "";
  }

  function addDays(date, days) {
    var next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next.toISOString().slice(0, 10);
  }

  function parseQuickTask() {
    var input = $("#quickTaskInput");
    var raw = c.clean(input.value);
    if (!raw) return;
    var parts = raw.split(/\s+/);
    var title = [];
    var assignee = "";
    var tag = "";
    var date = "";
    var time = "";
    parts.forEach(function (part) {
      var lower = part.toLowerCase();
      if (/^@\S+/.test(part)) {
        assignee = part.slice(1);
        return;
      }
      if (/^#(о|o|особисте|особисто)$/i.test(part)) {
        tag = "personal";
        return;
      }
      if (/^#(к|k|контроль|на-контролі|контролі)$/i.test(part)) {
        tag = "control";
        return;
      }
      if (/^#(т|t|терміново|термінове|срочно)$/i.test(part)) {
        tag = "urgent";
        return;
      }
      if (lower === "сьогодні" || lower === "сегодня") {
        date = c.today();
        return;
      }
      if (lower === "завтра") {
        date = addDays(new Date(), 1);
        return;
      }
      if (/^\d{1,2}:\d{2}$/.test(part)) {
        var bits = part.split(":");
        time = String(bits[0]).padStart(2, "0") + ":" + bits[1];
        return;
      }
      if (/^\d{3,4}$/.test(part)) {
        var compact = part.padStart(4, "0");
        time = compact.slice(0, 2) + ":" + compact.slice(2);
        return;
      }
      if (/^\d{1,2}\.\d{1,2}(\.\d{2,4})?$/.test(part)) {
        var d = part.split(".");
        var year = d[2] ? (d[2].length === 2 ? "20" + d[2] : d[2]) : String(new Date().getFullYear());
        date = year + "-" + d[1].padStart(2, "0") + "-" + d[0].padStart(2, "0");
        return;
      }
      title.push(part);
    });
    if (title.length) $("#taskTitle").value = title.join(" ");
    if (date) $("#taskDate").value = date;
    if (time) $("#taskTime").value = time;
    if (tag) $("#taskTag").value = tag;
    if (assignee) {
      $("#taskAssignee").value = assignee;
      $(".delegate-box").open = true;
    }
    input.value = "";
    toast("Швидкий ввід розібрано.");
  }

  function lines(text) {
    return String(text || "").split(/\n+/).map(c.clean).filter(Boolean).map(function (value) {
      return { id: c.id(), text: value, done: false };
    });
  }

  function prepareLogin(preferSelect) {
    state.pin = "";
    state.tasks = [];
    state.key = "";
    state.storageName = "";
    state.currentTaskId = "";
    state.notified = {};
    state.accessKey = "";
    state.accessName = "";
    state.accessKeys = [];
    state.activeKeyId = "";
    state.editingKeyId = "";
    clearInterval(state.reminderTimer);
    if (!state.users.length) {
      state.userId = "";
      state.loginMode = "create";
    } else if (state.users.length === 1 && !preferSelect) {
      state.userId = state.users[0].id;
      state.loginMode = "pin";
    } else {
      state.userId = "";
      state.loginMode = "select";
    }
  }

  function showLogin(preferSelect) {
    prepareLogin(preferSelect);
    $("#mainScreen").hidden = true;
    $("#loginScreen").hidden = false;
    renderLogin();
  }

  function showApp() {
    $("#loginScreen").hidden = true;
    $("#mainScreen").hidden = false;
    $("#currentStorageName").textContent = state.storageName;
    loadAccessKey();
    showPage("tasks");
    render();
    updateInstallButton();
    updateNotifyButton();
    startReminderLoop();
  }

  function renderLogin() {
    var user = selectedUser();
    var selecting = state.loginMode === "select" && state.users.length > 0;
    var creating = state.loginMode === "create";
    var pinning = state.loginMode === "pin" && !!user;

    $("#loginHint").textContent = selecting ? "Оберіть сховище." : (creating ? "Нове сховище і PIN." : "PIN для входу.");
    $("#storageList").style.display = selecting ? "grid" : "none";
    $("#activeStorage").style.display = pinning ? "grid" : "none";
    $("#activeStorageName").textContent = user ? user.callsign : "-";
    $("#storageNameLabel").style.display = creating ? "grid" : "none";
    $("#pinStatus").style.display = selecting ? "none" : "block";
    $("#pinKeys").style.display = selecting ? "none" : "grid";
    $("#createStorageBtn").style.display = selecting ? "block" : "none";
    $("#backToStoragesBtn").style.display = creating && state.users.length ? "block" : "none";
    $("#logoutLoginBtn").style.display = pinning ? "block" : "none";
    $("#pinStatus").textContent = state.pin.length ? "PIN приймається приховано" : "PIN вводиться приховано";

    $("#storageList").innerHTML = state.users.map(function (item) {
      return '<div class="storage-row" data-user-row="' + item.id + '">' +
        '<button class="button button-outline storage-open" type="button" data-user="' + item.id + '">' +
          '<span>' + c.escapeHtml(item.callsign) + '</span><span>></span></button>' +
        '<button class="button button-outline storage-delete" type="button" data-delete-user="' + item.id + '" aria-label="Видалити сховище">x</button>' +
      '</div>';
    }).join("");
  }

  function deleteStorage(userId) {
    var user = state.users.find(function (item) { return item.id === userId; });
    if (!user) return;
    var typed = prompt('Щоб видалити сховище "' + user.callsign + '", напишіть: ТАК ВИДАЛИТИ');
    if (typed !== "ТАК ВИДАЛИТИ") {
      toast("Видалення скасовано.");
      return;
    }
    f7.dialog.confirm('Остаточно видалити сховище "' + user.callsign + '"? Це видалить задачі тільки цього сховища.', "НА-КОНТРОЛІ", function () {
      state.users = store.deleteUser(state.users, user.id);
      localStorage.removeItem(accessStoreKeyFor(user.id));
      localStorage.removeItem(oldAccessStoreKeyFor(user.id));
      state.userId = "";
      state.pin = "";
      showLogin(true);
      toast("Сховище видалено.");
    });
  }

  function drawKeys() {
    $("#pinKeys").innerHTML = ["1","2","3","4","5","6","7","8","9","C","0","<"].map(function (key) {
      var cls = key === "C" || key === "<" ? "button button-outline" : "button button-fill";
      return '<button class="' + cls + '" type="button" data-key="' + key + '">' + key + '</button>';
    }).join("");
  }

  function keyPress(value) {
    if (value === "C") state.pin = "";
    else if (value === "<") state.pin = state.pin.slice(0, -1);
    else if (/^\d$/.test(value) && state.pin.length < 4) state.pin += value;
    renderLogin();
    if (state.pin.length === 4) enter();
  }

  function enter() {
    var user = selectedUser();
    if (state.loginMode === "create") {
      var storageName = c.clean($("#storageNameInput").value);
      if (!storageName) {
        state.pin = "";
        renderLogin();
        toast("Спочатку назва сховища.");
        return;
      }
      if (state.users.some(function (item) { return item.callsign.toLowerCase() === storageName.toLowerCase(); })) {
        state.pin = "";
        renderLogin();
        toast("Таке сховище вже є.");
        return;
      }
      user = store.createUser(state.users, storageName, state.pin);
      state.userId = user.id;
      state.key = store.dataKey(user, state.pin);
      state.storageName = user.callsign;
      state.tasks = [];
      store.saveTasks(user, state.key, state.tasks);
      unlock();
      toast("Сховище створено.");
      return;
    }

    if (!user) {
      state.pin = "";
      renderLogin();
      toast("Оберіть сховище.");
      return;
    }

    if (c.hash(user.salt + user.callsign.toLowerCase() + state.pin) !== user.pinHash) {
      state.pin = "";
      renderLogin();
      toast("Невірний PIN.");
      return;
    }

    state.key = store.dataKey(user, state.pin);
    state.storageName = user.callsign;
    var loaded = store.loadTasks(user, state.key);
    if (!loaded.ok) {
      state.pin = "";
      renderLogin();
      toast("Дані не відкрились. Перевірте PIN.");
      return;
    }
    state.tasks = loaded.tasks;
    loadNotified();
    unlock();
  }

  function unlock() {
    state.pin = "";
    showApp();
  }

  function saveTasks() {
    store.saveTasks(selectedUser(), state.key, state.tasks);
    clearOldReminderMarks();
    checkReminders();
  }

  function ensureTaskSyncId(task) {
    if (!task.syncId) task.syncId = c.id();
    return task.syncId;
  }

  function exchangeKey(keyValue) {
    return "bez-exchange:" + c.hash(keyValue);
  }

  function cryptoReady() {
    return window.crypto && window.crypto.subtle && window.TextEncoder && window.TextDecoder;
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

  function deriveExchangeKey(keyValue, salt) {
    var encoder = new TextEncoder();
    return window.crypto.subtle.importKey(
      "raw",
      encoder.encode(keyValue),
      "PBKDF2",
      false,
      ["deriveKey"]
    ).then(function (baseKey) {
      return window.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 180000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    });
  }

  function packExchange(payload, keyItem) {
    if (!cryptoReady()) return Promise.resolve(EXCHANGE_PREFIX + c.seal(JSON.stringify(payload), exchangeKey(keyItem.key)));
    var salt = randomBytes(16);
    var iv = randomBytes(12);
    var encoder = new TextEncoder();
    return deriveExchangeKey(keyItem.key, salt).then(function (key) {
      return window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoder.encode(JSON.stringify(payload)));
    }).then(function (encrypted) {
      return EXCHANGE_PREFIX + bytesToBase64(new TextEncoder().encode(JSON.stringify({
        v: 2,
        kdf: "PBKDF2-SHA256-180000",
        alg: "AES-GCM-256",
        s: bytesToBase64(salt),
        i: bytesToBase64(iv),
        d: bytesToBase64(new Uint8Array(encrypted))
      })));
    });
  }

  function unpackLegacyExchange(raw, keyItem) {
    try {
      return Promise.resolve({
        keyItem: keyItem,
        payload: JSON.parse(c.openSeal(raw, exchangeKey(keyItem.key)))
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function unpackExchangeWithKey(text, keyItem) {
    var raw = c.clean(text);
    if (raw.indexOf(EXCHANGE_PREFIX) === 0) raw = raw.slice(EXCHANGE_PREFIX.length);
    if (raw.indexOf(OLD_EXCHANGE_PREFIX) === 0) raw = raw.slice(OLD_EXCHANGE_PREFIX.length);
    if (!cryptoReady()) return unpackLegacyExchange(raw, keyItem);
    try {
      var packed = JSON.parse(new TextDecoder().decode(base64ToBytes(raw)));
      if (packed && packed.v === 2) {
        return deriveExchangeKey(keyItem.key, base64ToBytes(packed.s)).then(function (key) {
          return window.crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(packed.i) }, key, base64ToBytes(packed.d));
        }).then(function (opened) {
          return {
            keyItem: keyItem,
            payload: JSON.parse(new TextDecoder().decode(new Uint8Array(opened)))
          };
        });
      }
    } catch (e) {
      return unpackLegacyExchange(raw, keyItem);
    }
    return unpackLegacyExchange(raw, keyItem);
  }

  function unpackExchange(text) {
    var own = activeAccessKey();
    var keys = [];
    if (own && own.key) keys.push(own);
    state.accessKeys.forEach(function (item) {
      if (item.key && (!own || item.id !== own.id)) keys.push(item);
    });
    var index = 0;
    function next() {
      if (index >= keys.length) return Promise.reject(new Error("no-key"));
      var keyItem = keys[index];
      index += 1;
      return unpackExchangeWithKey(text, keyItem).catch(next);
    }
    return next();
  }

  function exchangeTaskCopy(task, asDone) {
    ensureTaskSyncId(task);
    return {
      syncId: task.syncId,
      title: task.title,
      date: task.date,
      time: task.time,
      note: task.note,
      items: task.items || [],
      tag: task.tag || "",
      status: asDone ? "done" : "todo",
      doneAt: asDone ? (task.doneAt || new Date().toISOString()) : "",
      source: (activeAccessKey() && activeAccessKey().name) || state.storageName,
      sentAt: new Date().toISOString()
    };
  }

  function shareTask(task) {
    if (!requireAccessKey()) return;
    var keyItem = activeAccessKey();
    state.exchangeTaskId = task.id;
    var payload = {
      app: "НА-КОНТРОЛІ",
      version: 2,
      type: task.status === "done" ? "done" : "task",
      task: exchangeTaskCopy(task, task.status === "done")
    };
    saveTasks();
    packExchange(payload, keyItem).then(function (text) {
      openExchangeModal("send", text);
      toast("Задачу зашифровано моїм ключем.");
    }).catch(function () {
      toast("Задачу не сформовано.");
    });
  }

  function markTaskTransferred() {
    var task = state.tasks.find(function (item) { return item.id === state.exchangeTaskId; });
    if (!task) {
      toast("Задачу не знайдено.");
      return;
    }
    var recipient = c.clean($("#transferRecipientInput").value) || task.assignee || "виконавцю";
    task.assignee = recipient;
    task.status = "run";
    task.transferredTo = recipient;
    task.transferredAt = new Date().toISOString();
    task.items = task.items || [];
    task.items.push({
      id: c.id(),
      text: "Передано: " + recipient,
      done: true
    });
    task.updatedAt = new Date().toISOString();
    saveTasks();
    closeExchangeModal();
    state.currentTaskId = task.id;
    showPage("task");
    toast("Передачу зафіксовано.");
  }

  function mergeIncomingTask(incoming, doneOnly) {
    if (!incoming || !incoming.syncId || !incoming.title) throw new Error("bad-task");
    var task = state.tasks.find(function (item) { return item.syncId === incoming.syncId; });
    if (!task) {
      task = {
        id: c.id(),
        syncId: incoming.syncId,
        createdAt: new Date().toISOString()
      };
      state.tasks.push(task);
    }
    if (!doneOnly) {
      task.title = c.clean(incoming.title);
      task.date = incoming.date || c.today();
      task.time = incoming.time || "";
      task.note = incoming.note || "";
      task.tag = incoming.tag || "";
      task.items = Array.isArray(incoming.items) ? incoming.items.map(function (item) {
        return { id: item.id || c.id(), text: item.text || "", done: !!item.done };
      }) : [];
      task.assignee = "";
      task.status = "todo";
      task.from = incoming.source || "";
    }
    if (doneOnly || incoming.status === "done") {
      task.status = "done";
      task.doneAt = incoming.doneAt || new Date().toISOString();
    }
    task.updatedAt = new Date().toISOString();
    return task;
  }

  function receiveExchange() {
    if (!requireAnyAccessKey()) return;
    unpackExchange($("#exchangeText").value).then(function (opened) {
      var payload = opened.payload;
      if (!payload || (payload.app !== "НА-КОНТРОЛІ" && payload.app !== OLD_APP_NAME) || !payload.task) throw new Error("bad-payload");
      var task = mergeIncomingTask(payload.task, payload.type === "done");
      saveTasks();
      closeExchangeModal();
      state.currentTaskId = task.id;
      showPage("task");
      toast((payload.type === "done" ? "Позначено виконано" : "Задачу прийнято") + " · " + opened.keyItem.label);
    }).catch(function () {
      toast("Задача не відкрилась жодним ключем.");
    });
  }

  function copyExchangeText() {
    copyTextFrom("#exchangeText", "Текст задачі скопійовано.");
  }

  function filtered(doneOnly) {
    var q = state.query.toLowerCase();
    return state.tasks.filter(function (task) {
      if (doneOnly) {
        if (task.status !== "done") return false;
      } else {
        if (task.status === "done") return false;
        if (state.filter === "mine" && task.status !== "todo") return false;
        if (state.filter === "delegated" && task.status !== "run") return false;
        if (state.filter === "today" && task.date !== c.today()) return false;
        if (state.tagFilter !== "all" && task.tag !== state.tagFilter) return false;
      }
      if (q) {
        var meta = tagMeta(task.tag);
        var hay = [task.title, task.note, task.assignee, task.date, label(task.status), meta ? meta.label : "",
          (task.items || []).map(function (x) { return x.text; }).join(" ")
        ].join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    }).sort(function (a, b) {
      return (a.date + " " + (a.time || "99:99")).localeCompare(b.date + " " + (b.time || "99:99"));
    });
  }

  function taskCard(task) {
    var meta = tagMeta(task.tag);
    var overdue = isOverdue(task);
    return '<article class="task-card ' + task.status + (overdue ? " overdue" : "") + '" data-task="' + task.id + '">' +
      '<div class="task-main ' + (meta ? "has-tag" : "") + '">' +
        (meta ? '<span class="task-tag ' + meta.cls + '" title="' + c.escapeHtml(meta.label) + '">' + meta.letter + '</span>' : '') +
        '<div><div class="task-title">' + c.escapeHtml(task.title) + '</div>' +
        '<div class="meta"><span class="pill">' + c.escapeHtml(label(task.status)) + '</span><span class="pill">' +
        c.escapeHtml(task.date || "") + (task.time ? " " + c.escapeHtml(task.time) : "") + '</span>' +
        (overdue ? '<span class="pill danger-pill">Прострочено</span>' : '') +
        (meta ? '<span class="pill">' + c.escapeHtml(meta.label) + '</span>' : '') +
        (task.assignee ? '<span class="pill">' + c.escapeHtml(task.assignee) + '</span>' : '') +
        (task.transferredTo ? '<span class="pill">Передано: ' + c.escapeHtml(task.transferredTo) + '</span>' : '') +
        (task.from ? '<span class="pill">Від: ' + c.escapeHtml(task.from) + '</span>' : '') + '</div></div>' +
        '<button class="button button-outline open-task" type="button" data-action="view">></button>' +
      '</div>' +
      (task.note ? '<small>' + c.escapeHtml(task.note) + '</small>' : '') +
    '</article>';
  }

  function renderTasksPage() {
    var list = filtered(false);
    $("#tasksPage").innerHTML = tagFilterHtml() +
      '<div class="search-wrap"><input id="searchInput" type="search" placeholder="Пошук" value="' + c.escapeHtml(state.query) + '"></div>' +
      '<div class="task-list">' + (list.length ? list.map(taskCard).join("") : '<div class="empty-state">Тут поки чисто.</div>') + '</div>';
  }

  function renderDonePage() {
    var list = filtered(true);
    $("#donePage").innerHTML = '<div class="detail-top"><h2>Готово</h2></div>' +
      '<div class="task-list">' + (list.length ? list.map(taskCard).join("") : '<div class="empty-state">Виконаних задач немає.</div>') + '</div>';
  }

  function syncStageTextarea() {
    $("#taskItems").value = state.formStages.map(function (item) { return item.text; }).join("\n");
  }

  function renderFormStages() {
    var html = state.formStages.map(function (item, index) {
      return '<div class="stage-edit-row" draggable="true" data-form-stage="' + item.id + '">' +
        '<button class="button button-outline stage-drag" type="button" aria-label="Перетягнути етап">≡</button>' +
        '<input type="text" value="' + c.escapeHtml(item.text) + '" data-stage-input="' + item.id + '" placeholder="Етап ' + (index + 1) + '">' +
        '<button class="button button-outline" type="button" data-remove-form-stage="' + item.id + '">x</button>' +
      '</div>';
    }).join("");
    $("#taskStageEditor").innerHTML = html || '<div class="stage-empty">Етапів ще немає.</div>';
    syncStageTextarea();
  }

  function moveFormStage(stageId, targetId) {
    if (!stageId || !targetId || stageId === targetId) return;
    var from = state.formStages.findIndex(function (item) { return item.id === stageId; });
    var to = state.formStages.findIndex(function (item) { return item.id === targetId; });
    if (from < 0 || to < 0 || from === to) return;
    var moved = state.formStages.splice(from, 1)[0];
    state.formStages.splice(to, 0, moved);
    renderFormStages();
  }

  function addFormStage() {
    var input = $("#taskStageDraft");
    var value = stageText({ items: state.formStages }, input.value);
    if (!value) return;
    state.formStages.push({ id: c.id(), text: value, done: false });
    input.value = "";
    renderFormStages();
  }

  function stageRows(task) {
    var rows = (task.items || []).map(function (item) {
      return '<label class="stage-row ' + (item.done ? "done" : "") + '">' +
        '<input type="checkbox" data-action="checkStage" data-stage="' + item.id + '"' + (item.done ? " checked" : "") + '>' +
        '<span>' + c.escapeHtml(item.text) + '</span>' +
        '<button class="button button-outline" type="button" data-action="removeStage" data-stage="' + item.id + '">x</button>' +
      '</label>';
    }).join("");
    return '<div><h3>Етапи</h3>' + (rows || '<small>Етапів ще немає.</small>') +
      '<div class="add-stage"><input id="newStageInput" type="text" placeholder="Додати етап"><button class="button button-outline" type="button" data-action="addStage">+</button></div></div>';
  }

  function renderTaskPage() {
    var task = state.tasks.find(function (item) { return item.id === state.currentTaskId; });
    if (!task) {
      $("#taskPage").innerHTML = '<div class="empty-state">Задачу не знайдено.</div>';
      return;
    }
    var meta = tagMeta(task.tag);
    var overdue = isOverdue(task);
    $("#taskPage").innerHTML =
      '<div class="detail-top"><button class="button button-outline" type="button" data-action="backTasks">Назад</button><button class="button button-fill" type="button" data-action="editTask">Правка</button></div>' +
      '<article class="detail-card">' +
        '<div class="detail-title">' + c.escapeHtml(task.title) + '</div>' +
        '<div class="meta"><span class="pill">' + c.escapeHtml(label(task.status)) + '</span><span class="pill">' + c.escapeHtml(task.date || "") +
        (task.time ? " " + c.escapeHtml(task.time) : "") + '</span>' +
        (overdue ? '<span class="pill danger-pill">Прострочено</span>' : '') +
        (meta ? '<span class="pill">' + c.escapeHtml(meta.label) + '</span>' : '') +
        (task.assignee ? '<span class="pill">Доручено: ' + c.escapeHtml(task.assignee) + '</span>' : '') +
        (task.transferredTo ? '<span class="pill">Передано: ' + c.escapeHtml(task.transferredTo) + (task.transferredAt ? " · " + new Date(task.transferredAt).toLocaleString("uk-UA", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "") + '</span>' : '') +
        (task.from ? '<span class="pill">Від: ' + c.escapeHtml(task.from) + '</span>' : '') + '</div>' +
        (task.note ? '<p>' + c.escapeHtml(task.note) + '</p>' : '<small>Без примітки.</small>') +
        '<div class="detail-actions">' +
          (task.status === "done" ?
            '<button class="button button-outline" type="button" data-action="notDoneTask">Повернутись до виконання</button>' :
            '<button class="button button-fill" type="button" data-action="doneTask">Зроблено</button>') +
          '<button class="button button-outline" type="button" data-action="shareTask">Передати</button>' +
          '<button class="button button-fill color-red danger-action" type="button" data-action="deleteTask">Видалити</button>' +
        '</div>' +
      '</article>' +
      '<article class="detail-card">' + stageRows(task) + '</article>';
  }

  function renderGuidePage() {
    $("#guidePage").innerHTML =
      '<div class="info-box"><h2>Встановлення</h2><ol>' +
        '<li>НА-КОНТРОЛІ - це PWA. Простими словами: сайт, який можна поставити на екран телефону як звичайний додаток.</li>' +
        '<li>Відкрийте посилання GitHub Pages саме у Safari на iPhone або Chrome на Android. Через переглядач файлів чи вбудований браузер месенджера встановлення може не зʼявитись.</li>' +
        '<li>iPhone: натисніть кнопку "Поділитися" у Safari, прокрутіть список дій і виберіть "На екран Домівки". Потім натисніть "Додати".</li>' +
        '<li>Android: відкрийте меню Chrome з трьома крапками і виберіть "Встановити додаток" або "Додати на головний екран".</li>' +
        '<li>Після встановлення запускайте додаток з іконки "НК" на екрані. Так він виглядає як окрема програма без адресного рядка.</li>' +
        '<li>Після першого відкриття файли кешуються. Далі додаток може відкриватися офлайн, а задачі зберігаються локально на цьому пристрої.</li>' +
        '<li>Коли виходить оновлення, відкрийте додаток з інтернетом. Якщо стара версія тримається, закрийте додаток повністю і відкрийте знову.</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Як працювати</h2><ol>' +
        '<li>Плюс у нижньому меню швидко створює задачу.</li>' +
        '<li>"Всі" показує головний список усіх активних задач.</li>' +
        '<li>"Мої" показує задачі без доручення іншому виконавцю.</li>' +
        '<li>"Іншим" показує задачі, де заповнено поле "Кому доручена задача".</li>' +
        '<li>"Готово" знаходиться у меню зверху і відкриває виконані задачі.</li>' +
        '<li>Зверху списку є швидкі фільтри тегів: "Особисте", "На контролі", "Терміново", "Всі".</li>' +
        '<li>Тег необовʼязковий. У картці він показується літерою: О - особисте, К - на контролі, Т - терміново.</li>' +
        '<li>Список сортується за датою і часом, якщо час вказаний.</li>' +
        '<li>Етапи допомагають розкласти задачу на прості кроки. У правці їх можна перетягувати за ручку ≡.</li>' +
        '<li>Кнопка "Зроблено" переносить задачу у готові. У виконаній задачі вона змінюється на "Повернутись до виконання".</li>' +
        '<li>Швидкий ввід розуміє час, дату, тег і виконавця. Приклад: "14:30 перевірити звʼязок #Т @BRAVO".</li>' +
        '<li>Якщо час задачі минув, а задача не виконана, вона підсвічується як прострочена.</li>' +
        '<li>Сховище видаляється тільки на екрані вибору сховищ, кнопкою поруч із конкретною назвою. Для видалення треба написати "ТАК ВИДАЛИТИ".</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Обмін задачами</h2><ol>' +
        '<li>У меню зверху відкрийте "Ключі". Там є дві частини: "Мій ключ" і "Книга ключів".</li>' +
        '<li>"Мій ключ" - це ваш особистий ключ для вихідних задач. Додаток завжди шифрує передачу саме ним, нічого вибирати не треба.</li>' +
        '<li>Свій ключ можна скопіювати і передати людині, яка має приймати задачі від вас.</li>' +
        '<li>"Книга ключів" працює як телефонна книга: туди додаються ключі людей або груп, які скинули вам свій ключ.</li>' +
        '<li>При прийманні задачі додаток спочатку пробує ваш ключ, потім усі ключі з книги. Вам не треба вручну вгадувати, яким ключем закрито задачу.</li>' +
        '<li>Якщо людина змінила свій ключ, додайте новий ключ у книгу. Старий можна лишити, поки треба відкривати старі задачі.</li>' +
        '<li>Згенерований ключ довгий випадковий. У сучасному браузері пакети шифруються через WebCrypto AES-GCM з ускладненням підбору ключа PBKDF2.</li>' +
        '<li>Ключі зберігаються тільки локально в цьому сховищі та шифруються разом з даними пристрою.</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Приклад обміну</h2><ol>' +
        '<li>ALPHA відкриває "Ключі", генерує "Мій ключ", вводить нік "ALPHA" і скидає цей ключ BRAVO.</li>' +
        '<li>BRAVO відкриває "Ключі", у "Книзі ключів" натискає "Новий контакт", вводить назву "ALPHA" і вставляє ключ ALPHA.</li>' +
        '<li>ALPHA створює задачу, у полі доручення пише "BRAVO", відкриває задачу і натискає "Передати".</li>' +
        '<li>Додаток шифрує задачу ключем ALPHA і формує текст "НА-КОНТРОЛІ:...". Разом із задачею передаються дата, час, примітка, етапи і тег.</li>' +
        '<li>Після копіювання ALPHA вводить "Кому передано" і натискає "Завершити передачу". У задачі зʼявляється етап "Передано: BRAVO", а задача переходить в "Іншим".</li>' +
        '<li>BRAVO натискає "Прийняти задачу", вставляє текст, і додаток сам знаходить ключ ALPHA у книзі.</li>' +
        '<li>Задача додається BRAVO в "Мої" з міткою "Від: ALPHA".</li>' +
        '<li>Після виконання BRAVO натискає "Зроблено", потім "Передати" і відправляє підтвердження назад уже своїм ключем BRAVO.</li>' +
        '<li>ALPHA приймає цей пакет, і ця сама задача позначається як "Виконано".</li>' +
        '<li>Щоб ALPHA міг приймати відповіді BRAVO, BRAVO має скинути ALPHA свій ключ, а ALPHA додає його в книгу ключів.</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Сповіщення</h2><ol>' +
        '<li>У меню зверху натисніть "Сповіщення" і дозвольте їх у браузері або встановленій PWA.</li>' +
        '<li>Якщо в задачі вказано дату і час, застосунок готує два нагадування: за 1 годину до часу задачі та в сам час задачі.</li>' +
        '<li>Для економії батареї перевірка виконується приблизно раз на 15 хвилин, а також одразу після відкриття застосунку або зміни задачі.</li>' +
        '<li>Нагадування працюють локально на пристрої, без сервера і без інтернету після кешування.</li>' +
        '<li>Найнадійніше вони працюють, коли застосунок відкритий або встановлений на екран Домівки. iPhone може обмежувати сповіщення, якщо PWA повністю закрита або система заборонила дозвіл.</li>' +
        '<li>Зміна дати, часу або змісту задачі оновлює її нагадування.</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Переваги</h2><ul>' +
        '<li>Окремі локальні сховища на одному пристрої.</li>' +
        '<li>PIN для кожного сховища.</li>' +
        '<li>Дані задач зберігаються локально в браузері пристрою.</li>' +
        '<li>Швидке розділення задач: "Мої" для особистого виконання, "Іншим" для контролю доручених.</li>' +
        '<li>Локальні нагадування допомагають не пропустити задачу з указаним часом.</li>' +
        '<li>Бекап та імпорт дозволяють перенести або зберегти робочий список.</li>' +
        '<li>На телефоні бекап може відкривати системне меню поширення. Якщо файл не зʼявився у завантаженнях, копія JSON також кладеться в буфер обміну.</li>' +
        '<li>Імпорт має два режими: "Додати" залишає старі задачі і додає нові, "Замінити" видаляє старі задачі та ставить задачі з файлу.</li>' +
        '<li>Framework7 PWA: локальний стек, офлайн-кеш, toast/dialog і підготовка під майбутні компоненти.</li>' +
        '<li>Оновлення приходять через GitHub Pages і service worker.</li>' +
      '</ul></div>' +
      '<div class="info-box"><h2>Про автора та додаток</h2>' +
        '<p><strong>НА-КОНТРОЛІ</strong> створено як простий особистий задачник для швидкої фіксації задач, етапів і доручень.</p>' +
        '<p>Версія: <strong>1.0</strong>.</p>' +
        '<p>Автор і власник ідеї: <strong>ShuviDoula</strong>.</p>' +
        '<ul><li>GitHub: github.com/ShuviDoula</li><li>Сайт: використайте GitHub Pages URL цього додатку.</li></ul>' +
      '</div>';
  }

  function renderNav() {
    var active = {
      navMine: state.page === "tasks" && state.filter === "mine",
      navDelegated: state.page === "tasks" && state.filter === "delegated",
      navAll: state.page === "tasks" && state.filter === "all",
      navGuide: state.page === "guide"
    };
    ["navMine", "navDelegated", "navAll", "navGuide"].forEach(function (id) {
      $("#" + id).classList.toggle("tab-link-active", !!active[id]);
    });
  }

  function render() {
    renderTasksPage();
    renderDonePage();
    renderTaskPage();
    renderGuidePage();
    renderNav();
  }

  function showPage(page) {
    state.page = page;
    $("#tasksPage").hidden = page !== "tasks";
    $("#taskPage").hidden = page !== "task";
    $("#donePage").hidden = page !== "done";
    $("#guidePage").hidden = page !== "guide";
    render();
  }

  function openTaskForm(task) {
    clearToast();
    closeServiceMenu();
    $("#taskPopupTitle").textContent = task ? "Редагувати" : "Нова задача";
    $("#taskId").value = task ? task.id : "";
    $("#taskTitle").value = task ? task.title : "";
    $("#taskDate").value = task ? task.date : c.today();
    $("#taskTime").value = task ? (task.time || "") : "";
    $("#taskTag").value = task ? (task.tag || "") : "";
    $("#taskAssignee").value = task ? (task.assignee || "") : "";
    $(".delegate-box").open = !!(task && task.assignee);
    $("#taskNote").value = task ? (task.note || "") : "";
    state.formStages = task ? (task.items || []).map(function (item) {
      return { id: item.id || c.id(), text: item.text || "", done: !!item.done };
    }) : [];
    $("#taskStageDraft").value = "";
    renderFormStages();
    openTaskModal();
    if (window.matchMedia("(pointer: fine)").matches) {
      setTimeout(function () { $("#taskTitle").focus(); }, 30);
    }
  }

  function saveTaskForm(event) {
    event.preventDefault();
    var task = $("#taskId").value ? state.tasks.find(function (item) { return item.id === $("#taskId").value; }) : null;
    if (!task) {
      task = { id: c.id(), syncId: c.id(), createdAt: new Date().toISOString() };
      state.tasks.push(task);
    }
    ensureTaskSyncId(task);
    task.title = c.clean($("#taskTitle").value);
    task.date = $("#taskDate").value;
    task.time = $("#taskTime").value;
    task.tag = $("#taskTag").value || "";
    task.assignee = c.clean($("#taskAssignee").value);
    if (task.status !== "done") task.status = task.assignee ? "run" : "todo";
    task.note = c.clean($("#taskNote").value);
    task.items = state.formStages.map(function (item) {
      var text = c.clean(item.text);
      if (!text) return null;
      return { id: item.id || c.id(), text: text, done: !!item.done };
    }).filter(Boolean);
    task.doneAt = task.status === "done" ? (task.doneAt || new Date().toISOString()) : "";
    task.updatedAt = new Date().toISOString();
    saveTasks();
    closeTaskModal();
    render();
    toast("Збережено.");
  }

  function taskFromEvent(event) {
    var card = event.target.closest("[data-task]");
    return card ? state.tasks.find(function (task) { return task.id === card.dataset.task; }) : null;
  }

  function handleTaskAction(event) {
    var target = event.target.closest("[data-action]");
    var task = taskFromEvent(event) || state.tasks.find(function (item) { return item.id === state.currentTaskId; });
    if (!target || !task) return;
    var action = target.dataset.action;

    if (action === "view") {
      clearToast();
      state.currentTaskId = task.id;
      showPage("task");
      return;
    }
    if (action === "editTask") return openTaskForm(task);
    if (action === "shareTask") return shareTask(task);
    if (action === "backTasks") return showPage("tasks");
    if (action === "doneTask") {
      task.status = "done";
      task.doneAt = new Date().toISOString();
    }
    if (action === "notDoneTask") {
      task.status = task.assignee ? "run" : "todo";
      task.doneAt = "";
    }
    if (action === "deleteTask") {
      f7.dialog.confirm("Видалити задачу?", "НА-КОНТРОЛІ", function () {
        state.tasks = state.tasks.filter(function (item) { return item.id !== task.id; });
        state.currentTaskId = "";
        saveTasks();
        showPage("tasks");
        toast("Видалено.");
      });
      return;
    }
    if (action === "checkStage") {
      var stage = (task.items || []).find(function (item) { return item.id === target.dataset.stage; });
      if (stage) stage.done = target.checked;
    }
    if (action === "removeStage") {
      task.items = (task.items || []).filter(function (item) { return item.id !== target.dataset.stage; });
    }
    if (action === "addStage") {
      var input = $("#newStageInput");
      var value = stageText(task, input.value);
      if (!value) return;
      task.items = task.items || [];
      task.items.push({ id: c.id(), text: value, done: false });
    }
    task.updatedAt = new Date().toISOString();
    saveTasks();
    render();
  }

  function exportData() {
    var payload = { app: "НА-КОНТРОЛІ", storageName: state.storageName, exportedAt: new Date().toISOString(), tasks: state.tasks };
    var json = JSON.stringify(payload, null, 2);
    var filename = "na-kontroli-backup-" + c.today() + ".json";
    var blob = new Blob([json], { type: "application/json" });
    var file = null;
    try {
      file = new File([blob], filename, { type: "application/json" });
    } catch (e) {
      file = null;
    }
    if (file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] })) {
      navigator.share({
        title: "Бекап НА-КОНТРОЛІ",
        text: "Резервна копія сховища " + state.storageName,
        files: [file]
      }).then(function () {
        toast("Бекап передано в системне меню.");
      }).catch(function () {
        toast("Бекап не передано.");
      });
      return;
    }
    var href = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = href;
    a.download = filename;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(href); }, 1000);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).catch(function () {});
    }
    openExchangeModal("backup", json);
    toast("Бекап створено. Якщо файл не зʼявився, копія також у буфері.");
  }

  function importData(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        if (!Array.isArray(data.tasks)) throw new Error("bad");
        f7.dialog.create({
          title: "Імпорт",
          text: "У файлі задач: " + data.tasks.length + ". Додати - старі задачі залишаться, нові додадуться. Замінити - старі задачі буде видалено, а з файлу стануть поточними.",
          buttons: [
            { text: "Скасувати" },
            {
              text: "Додати",
              onClick: function () {
                state.tasks = state.tasks.concat(data.tasks.map(function (task) {
                  task.id = c.id();
                  task.syncId = task.syncId || c.id();
                  return task;
                }));
                saveTasks();
                showPage("tasks");
                toast("Імпорт додано.");
              }
            },
            {
              text: "Замінити",
              bold: true,
              color: "red",
              onClick: function () {
                state.tasks = data.tasks;
                saveTasks();
                showPage("tasks");
                toast("Імпорт замінив задачі.");
              }
            }
          ]
        }).open();
      } catch (e) {
        toast("Не той файл бекапу.");
      }
    };
    reader.readAsText(file);
  }

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function updateInstallButton() {
    var button = $("#installBtn");
    if (!button) return;
    if (isStandalone()) button.textContent = "Встановлено";
    else if (isAndroid()) button.textContent = "На екран";
    else button.textContent = "Встановити";
  }

  function install() {
    if (isStandalone()) return toast("Вже відкрито як додаток.");
    if (state.installPrompt) {
      state.installPrompt.prompt();
      state.installPrompt = null;
      updateInstallButton();
      return;
    }
    showPage("guide");
    if (isAndroid()) toast("Android: Chrome -> меню -> Додати на головний екран.");
    else if (isIOS()) toast("iPhone: Safari -> Поділитися -> На екран Домівки.");
    else toast("Відкрийте меню браузера і додайте сторінку на головний екран.");
  }

  function bind() {
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      navigator.serviceWorker.register("sw.js").catch(function () {
        toast("Офлайн-кеш не підключився у цьому браузері.");
      });
    }
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      state.installPrompt = event;
      updateInstallButton();
      toast("Браузер дозволяє встановлення.");
    });
    window.addEventListener("appinstalled", function () {
      state.installPrompt = null;
      updateInstallButton();
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) checkReminders();
    });

    $("#pinKeys").addEventListener("click", function (event) {
      var button = event.target.closest("[data-key]");
      if (button) keyPress(button.dataset.key);
    });
    $("#storageList").addEventListener("click", function (event) {
      var deleteButton = event.target.closest("[data-delete-user]");
      if (deleteButton) {
        deleteStorage(deleteButton.dataset.deleteUser);
        return;
      }
      var button = event.target.closest("[data-user]");
      if (!button) return;
      state.userId = button.dataset.user;
      state.loginMode = "pin";
      state.pin = "";
      renderLogin();
    });
    $("#createStorageBtn").addEventListener("click", function () {
      state.userId = "";
      state.loginMode = "create";
      state.pin = "";
      $("#storageNameInput").value = "";
      renderLogin();
    });
    $("#backToStoragesBtn").addEventListener("click", function () { showLogin(true); });
    $("#logoutLoginBtn").addEventListener("click", function () { showLogin(true); });

    document.addEventListener("keydown", function (event) {
      if (!$("#loginScreen").hidden) {
        if (/^\d$/.test(event.key)) keyPress(event.key);
        if (event.key === "Backspace") keyPress("<");
      }
      if (event.key === "Escape") {
        closeTaskModal();
        closeExchangeModal();
        closeKeysModal();
        closeServiceMenu();
        if (state.page === "task") showPage("tasks");
      }
    });

    $("#taskForm").addEventListener("submit", saveTaskForm);
    $("#applyQuickTask").addEventListener("click", parseQuickTask);
    $("#quickTaskInput").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        parseQuickTask();
      }
    });
    $("#taskStageEditor").addEventListener("input", function (event) {
      var input = event.target.closest("[data-stage-input]");
      if (!input) return;
      var stage = state.formStages.find(function (item) { return item.id === input.dataset.stageInput; });
      if (stage) {
        stage.text = input.value;
        syncStageTextarea();
      }
    });
    $("#taskStageEditor").addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-form-stage]");
      if (!remove) return;
      state.formStages = state.formStages.filter(function (item) { return item.id !== remove.dataset.removeFormStage; });
      renderFormStages();
    });
    $("#taskStageEditor").addEventListener("dragstart", function (event) {
      var row = event.target.closest("[data-form-stage]");
      if (!row) return;
      state.dragStageId = row.dataset.formStage;
      row.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
    });
    $("#taskStageEditor").addEventListener("dragover", function (event) {
      if (event.target.closest("[data-form-stage]")) event.preventDefault();
    });
    $("#taskStageEditor").addEventListener("drop", function (event) {
      event.preventDefault();
      var row = event.target.closest("[data-form-stage]");
      if (row) moveFormStage(state.dragStageId, row.dataset.formStage);
      state.dragStageId = "";
    });
    $("#taskStageEditor").addEventListener("dragend", function () {
      state.dragStageId = "";
      renderFormStages();
    });
    $("#taskStageEditor").addEventListener("pointerdown", function (event) {
      if (!event.target.closest(".stage-drag")) return;
      var row = event.target.closest("[data-form-stage]");
      if (!row) return;
      state.dragStageId = row.dataset.formStage;
      row.classList.add("dragging");
    });
    $("#taskStageEditor").addEventListener("pointermove", function (event) {
      if (!state.dragStageId) return;
      event.preventDefault();
      var over = document.elementFromPoint(event.clientX, event.clientY);
      var row = over && over.closest ? over.closest("[data-form-stage]") : null;
      if (row) moveFormStage(state.dragStageId, row.dataset.formStage);
    });
    document.addEventListener("pointerup", function () {
      if (!state.dragStageId) return;
      state.dragStageId = "";
      renderFormStages();
    });
    $("#addFormStage").addEventListener("click", addFormStage);
    $("#taskStageDraft").addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        addFormStage();
      }
    });
    $("#closeTaskPopup").addEventListener("click", closeTaskModal);
    $("#cancelTask").addEventListener("click", closeTaskModal);
    $("#taskPopup").addEventListener("click", function (event) {
      if (event.target.id === "taskPopup") closeTaskModal();
    });
    $("#closeExchangePopup").addEventListener("click", closeExchangeModal);
    $("#exchangePopup").addEventListener("click", function (event) {
      if (event.target.id === "exchangePopup") closeExchangeModal();
    });
    $("#copyExchangeBtn").addEventListener("click", copyExchangeText);
    $("#acceptExchangeBtn").addEventListener("click", receiveExchange);
    $("#finishTransferBtn").addEventListener("click", markTaskTransferred);
    $("#closeKeysPopup").addEventListener("click", closeKeysModal);
    $("#keysPopup").addEventListener("click", function (event) {
      if (event.target.id === "keysPopup") closeKeysModal();
    });
    $("#newKeyBtn").addEventListener("click", newKeyForm);
    $("#accessKeyList").addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      var card = event.target.closest("[data-key-id]");
      if (!button || !card) return;
      if (button.dataset.action === "toggleKey") selectAccessKey(card.dataset.keyId);
      if (button.dataset.action === "copyKey") copyKeyCard(card);
      if (button.dataset.action === "generateOwnKey") generateOwnKey(card);
      if (button.dataset.action === "saveKey") saveKeyCard(card);
      if (button.dataset.action === "deleteKey") deleteAccessKey(card.dataset.keyId);
    });
    $("#accessKeyList").addEventListener("input", function (event) {
      var keyInput = event.target.closest('[data-key-field="key"]');
      var card = event.target.closest("[data-key-id]");
      if (!keyInput || !card) return;
      var item = state.accessKeys.find(function (key) { return key.id === card.dataset.keyId; });
      if (!item || item.kind !== "own") return;
      var generate = card.querySelector('[data-action="generateOwnKey"]');
      if (generate) generate.disabled = !!c.clean(keyInput.value);
    });
    $("#tasksPage").addEventListener("click", handleTaskAction);
    $("#taskPage").addEventListener("click", handleTaskAction);
    $("#taskPage").addEventListener("change", handleTaskAction);
    $("#donePage").addEventListener("click", handleTaskAction);
    $("#tasksPage").addEventListener("input", function (event) {
      if (event.target.id === "searchInput") {
        state.query = event.target.value;
        renderTasksPage();
      }
    });
    $("#tasksPage").addEventListener("click", function (event) {
      var button = event.target.closest("[data-action='tagFilter']");
      if (!button) return;
      state.tagFilter = button.dataset.tagFilter || "all";
      renderTasksPage();
    });

    $("#moreBtn").addEventListener("click", function (event) {
      event.stopPropagation();
      $("#serviceMenu").hidden = !$("#serviceMenu").hidden;
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".app-header")) closeServiceMenu();
    });

    $("#navMine").addEventListener("click", function (event) {
      event.preventDefault();
      state.filter = "mine";
      showPage("tasks");
    });
    $("#navDelegated").addEventListener("click", function (event) {
      event.preventDefault();
      state.filter = "delegated";
      showPage("tasks");
    });
    $("#navNew").addEventListener("click", function (event) {
      event.preventDefault();
      openTaskForm();
    });
    $("#navAll").addEventListener("click", function (event) {
      event.preventDefault();
      state.filter = "all";
      showPage("tasks");
    });
    $("#navGuide").addEventListener("click", function (event) {
      event.preventDefault();
      showPage("guide");
    });

    $("#doneMenuBtn").addEventListener("click", function () { closeServiceMenu(); showPage("done"); });
    $("#notifyBtn").addEventListener("click", enableNotifications);
    $("#keysBtn").addEventListener("click", openKeysModal);
    $("#receivePacketBtn").addEventListener("click", function () {
      closeServiceMenu();
      if (!requireAccessKey()) return;
      openExchangeModal("receive", "");
    });
    if ($("#installBtn")) $("#installBtn").addEventListener("click", function () { closeServiceMenu(); install(); });
    $("#exportBtn").addEventListener("click", function () { closeServiceMenu(); exportData(); });
    $("#importBtn").addEventListener("click", function () { closeServiceMenu(); $("#importFile").click(); });
    $("#importFile").addEventListener("change", function (event) {
      if (event.target.files[0]) importData(event.target.files[0]);
      event.target.value = "";
    });
    $("#logoutBtn").addEventListener("click", function () { closeServiceMenu(); showLogin(true); });
  }

  drawKeys();
  bind();
  showLogin(false);
})();
