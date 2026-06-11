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
  var APP_SHARE_URL = "https://shuvidoula.github.io/na-kontroli/";
  var state = {
    pin: "",
    users: store.migrateOldUser(store.loadUsers()),
    userId: "",
    key: "",
    storageName: "",
    loginMode: "createName",
    pendingStorageName: "",
    pendingPin: "",
    pinMismatch: false,
    tasks: [],
    page: "tasks",
    filter: "all",
    tagFilter: "all",
    quickTag: "",
    query: "",
    currentTaskId: "",
    formStages: [],
    dragStageId: "",
    notified: {},
    settings: {},
    reminderTimer: 0,
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

  function openQuickTaskModal() {
    $("#quickTaskPopup").classList.add("active");
  }

  function closeQuickTaskModal() {
    $("#quickTaskPopup").classList.remove("active");
  }

  function openCreateChoiceModal() {
    $("#createChoicePopup").classList.add("active");
  }

  function closeCreateChoiceModal() {
    $("#createChoicePopup").classList.remove("active");
  }

  function openExchangeModal(mode, text) {
    $("#exchangePopupTitle").textContent = mode === "send" ? "Передати задачу" : "Бекап";
    $("#exchangeText").value = text || "";
    $("#exchangeTextBox").style.display = mode === "backup" ? "grid" : "none";
    $("#copyExchangeBtn").style.display = mode === "backup" ? "block" : "none";
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

  function notificationSupported() {
    return "Notification" in window;
  }

  function notifyKey() {
    return "na_kontroli_notified_" + (state.userId || "none");
  }

  function settingsKey() {
    return "na_kontroli_settings_" + (state.userId || "none");
  }

  function defaultSettings() {
    return {
      notifyHour: true,
      notifyAtTime: true,
      backupReminder: true
    };
  }

  function loadNotified() {
    try {
      state.notified = JSON.parse(localStorage.getItem(notifyKey()) || "{}");
    } catch (e) {
      state.notified = {};
    }
  }

  function loadSettings() {
    try {
      state.settings = Object.assign(defaultSettings(), JSON.parse(localStorage.getItem(settingsKey()) || "{}"));
    } catch (e) {
      state.settings = defaultSettings();
    }
  }

  function saveSettings() {
    try {
      localStorage.setItem(settingsKey(), JSON.stringify(state.settings));
    } catch (e) {
      state.settings = defaultSettings();
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
    var button = document.querySelector("[data-settings-action='enableNotifications']");
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
        { kind: "hour", at: due.getTime() - 60 * 60 * 1000, enabled: state.settings.notifyHour !== false },
        { kind: "time", at: due.getTime(), enabled: state.settings.notifyAtTime !== false }
      ].forEach(function (item) {
        if (!item.enabled) return;
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
    if (status === "archived") return "Архів";
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

  function formatDate(value) {
    if (!value) return "";
    var parts = String(value).split("-");
    if (parts.length === 3) return parts[2] + "." + parts[1] + "." + parts[0];
    return value;
  }

  function normalizeQuickTime(hour, minute) {
    var h = Number(hour);
    var m = Number(minute || 0);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return "";
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  function parseQuickLine(raw) {
    var text = c.clean(raw);
    var time = "";
    var rest = text;
    var match = text.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
    if (match) {
      time = normalizeQuickTime(match[1], match[2]);
      rest = match[3];
    } else {
      match = text.match(/^(\d{1,2})\s+(\d{1,2})\s+(.+)$/);
      if (match) {
        time = normalizeQuickTime(match[1], match[2]);
        rest = match[3];
      } else {
        match = text.match(/^(\d{1,2})\s+(.+)$/);
        if (match) {
          time = normalizeQuickTime(match[1], 0);
          rest = match[2];
        }
      }
    }
    if (/^\d/.test(text) && !time) return { error: "Час має бути у форматі 14:30, 14 або 14 30." };
    var dot = rest.indexOf(".");
    var title = dot >= 0 ? rest.slice(0, dot) : rest;
    var note = dot >= 0 ? rest.slice(dot + 1) : "";
    return {
      time: time,
      title: c.clean(title),
      note: c.clean(note)
    };
  }

  function lines(text) {
    return String(text || "").split(/\n+/).map(c.clean).filter(Boolean).map(function (value) {
      return { id: c.id(), text: value, done: false };
    });
  }

  function prepareLogin(preferSelect) {
    state.pin = "";
    state.pendingPin = "";
    state.pendingStorageName = "";
    state.pinMismatch = false;
    state.tasks = [];
    state.key = "";
    state.storageName = "";
    state.currentTaskId = "";
    state.notified = {};
    state.settings = {};
    clearInterval(state.reminderTimer);
    if (!state.users.length) {
      state.userId = "";
      state.loginMode = "createName";
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
    showPage("tasks");
    render();
    updateInstallButton();
    updateNotifyButton();
    startReminderLoop();
  }

  function pinDots() {
    var html = "";
    for (var i = 0; i < 4; i += 1) html += '<span class="' + (i < state.pin.length ? "filled" : "") + '"></span>';
    return '<div class="pin-dots" aria-label="Введено цифр: ' + state.pin.length + ' з 4">' + html + '</div>';
  }

  function renderLogin() {
    var user = selectedUser();
    var selecting = state.loginMode === "select" && state.users.length > 0;
    var creatingName = state.loginMode === "createName";
    var creatingPin = state.loginMode === "createPin";
    var confirmingPin = state.loginMode === "createConfirm";
    var creating = creatingName || creatingPin || confirmingPin;
    var pinning = state.loginMode === "pin" && !!user;
    var needsPin = !state.pinMismatch && (creatingPin || confirmingPin || pinning);
    var showPinStatus = state.pinMismatch || needsPin;

    $("#loginHint").textContent = selecting ? "Оберіть сховище." :
      (creatingName ? "Назва нового сховища." :
      (creatingPin ? "Створіть PIN." :
      (confirmingPin ? "Повторіть PIN." : "PIN для входу.")));
    $("#storageList").style.display = selecting ? "grid" : "none";
    $("#activeStorage").style.display = (pinning || creatingPin || confirmingPin) ? "grid" : "none";
    $("#activeStorageName").textContent = pinning && user ? user.callsign : (state.pendingStorageName || "-");
    $("#storageNameLabel").style.display = creatingName ? "grid" : "none";
    $("#pinStatus").style.display = showPinStatus ? "grid" : "none";
    $("#pinKeys").style.display = needsPin ? "grid" : "none";
    $("#continueStorageBtn").style.display = creatingName ? "block" : "none";
    $("#resetCreatePinBtn").style.display = state.pinMismatch ? "block" : "none";
    $("#cancelCreateStorageBtn").style.display = (creatingPin || confirmingPin || state.pinMismatch) ? "block" : "none";
    $("#createStorageBtn").style.display = selecting ? "block" : "none";
    $("#backToStoragesBtn").style.display = creatingName && state.users.length ? "block" : "none";
    $("#logoutLoginBtn").style.display = pinning ? "block" : "none";
    $("#pinStatus").innerHTML = '<span>' + (state.pinMismatch ? "PIN не співпав. Оберіть дію нижче." :
      (confirmingPin ? "Повторіть PIN для перевірки." :
      (creatingPin ? "Введіть новий PIN." :
      (state.pin.length ? "PIN приймається приховано." : "Введіть PIN.")))) + '</span>' + pinDots();

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
      state.userId = "";
      state.pin = "";
      showLogin(true);
      toast("Сховище видалено.");
    });
  }

  function resetCreateDraft(clearName) {
    state.pin = "";
    state.pendingPin = "";
    state.pinMismatch = false;
    if (clearName && state.users.length) {
      showLogin(true);
      return;
    }
    state.loginMode = "createName";
    if (clearName) {
      state.pendingStorageName = "";
      $("#storageNameInput").value = "";
    }
    renderLogin();
  }

  function restartCreatePin() {
    state.pin = "";
    state.pendingPin = "";
    state.pinMismatch = false;
    state.loginMode = "createPin";
    renderLogin();
  }

  function continueStorageCreate() {
    var storageName = c.clean($("#storageNameInput").value);
    if (!storageName) return toast("Спочатку назва сховища.");
    if (state.users.some(function (item) { return item.callsign.toLowerCase() === storageName.toLowerCase(); })) {
      return toast("Таке сховище вже є.");
    }
    state.pendingStorageName = storageName;
    state.pin = "";
    state.pendingPin = "";
    state.pinMismatch = false;
    state.loginMode = "createPin";
    renderLogin();
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
    if (state.loginMode === "createPin") {
      state.pendingPin = state.pin;
      state.pin = "";
      state.pinMismatch = false;
      state.loginMode = "createConfirm";
      renderLogin();
      return;
    }

    if (state.loginMode === "createConfirm") {
      if (state.pin !== state.pendingPin) {
        state.pin = "";
        state.pinMismatch = true;
        renderLogin();
        toast("PIN не співпав.");
        return;
      }
      store.createUser(state.users, state.pendingStorageName, state.pin).then(function (created) {
        user = created;
        state.userId = user.id;
        state.key = store.dataKey(user, state.pin);
        state.storageName = user.callsign;
        state.tasks = [];
        store.saveTasks(user, state.key, state.tasks).catch(function () {
          toast("Сховище створено, але дані не збережено.");
        });
        loadSettings();
        state.pendingStorageName = "";
        state.pendingPin = "";
        state.pinMismatch = false;
        unlock();
        toast("Сховище створено.");
      }).catch(function () {
        state.pin = "";
        renderLogin();
        toast("Сховище не створено.");
      });
      return;
    }

    if (!user) {
      state.pin = "";
      renderLogin();
      toast("Оберіть сховище.");
      return;
    }

    var enteredPin = state.pin;
    store.verifyPin(user, enteredPin).then(function (valid) {
      if (!valid) {
        state.pin = "";
        renderLogin();
        toast("Невірний PIN.");
        return Promise.reject(new Error("bad-pin"));
      }
      state.key = store.dataKey(user, enteredPin);
      state.storageName = user.callsign;
      return store.loadTasks(user, state.key);
    }).then(function (loaded) {
      if (!loaded.ok) {
        state.pin = "";
        renderLogin();
        toast("Дані не відкрились. Перевірте PIN.");
        return;
      }
      state.tasks = loaded.tasks.map(normalizeTask);
      loadNotified();
      loadSettings();
      if (user.keyVersion >= 2 && String(user.pinHash2 || "").indexOf("NKPH1:") !== 0) {
        unlock();
        if (loaded.upgraded) saveTasks();
        return;
      }
      store.upgradeUserSecurity(state.users, user, enteredPin).then(function () {
        state.key = store.dataKey(user, enteredPin);
        unlock();
        saveTasks();
      }).catch(function () {
        unlock();
        if (loaded.upgraded) saveTasks();
      });
    }).catch(function (error) {
      if (error && error.message === "bad-pin") return;
      state.pin = "";
      renderLogin();
      toast("Дані не відкрились. Перевірте PIN.");
    });
  }

  function unlock() {
    state.pin = "";
    showApp();
  }

  function saveTasks() {
    store.saveTasks(selectedUser(), state.key, state.tasks).catch(function () {
      toast("Не вдалося зберегти дані.");
    });
    clearOldReminderMarks();
    checkReminders();
  }

  function normalizeTask(task) {
    task.id = task.id || c.id();
    task.syncId = task.syncId || c.id();
    task.status = task.status || "todo";
    task.items = Array.isArray(task.items) ? task.items : [];
    task.createdAt = task.createdAt || new Date().toISOString();
    task.updatedAt = task.updatedAt || task.createdAt;
    return task;
  }

  function ensureTaskSyncId(task) {
    if (!task.syncId) task.syncId = c.id();
    return task.syncId;
  }

  function shareTask(task) {
    state.exchangeTaskId = task.id;
    openExchangeModal("send", "");
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

  function copyExchangeText() {
    copyTextFrom("#exchangeText", "Бекап скопійовано.");
  }

  function filtered(doneOnly) {
    var q = state.query.toLowerCase();
    return state.tasks.filter(function (task) {
      if (doneOnly) {
        if (task.status !== "done") return false;
      } else {
        if (task.status === "done" || task.status === "archived") return false;
        if (state.filter === "mine" && task.status !== "todo") return false;
        if (state.filter === "delegated" && task.status !== "run") return false;
        if (state.filter === "today" && task.date !== c.today()) return false;
        if (state.filter === "overdue" && !isOverdue(task)) return false;
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
        c.escapeHtml(formatDate(task.date)) + (task.time ? " " + c.escapeHtml(task.time) : "") + '</span>' +
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
    $("#donePage").innerHTML = '<div class="detail-top"><h2>Виконані</h2></div>' +
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
    if (task.status === "archived") {
      $("#taskPage").innerHTML =
        '<div class="detail-top"><button class="button button-outline" type="button" data-action="backArchive">Назад</button></div>' +
        '<article class="detail-card">' +
          '<div class="detail-title">' + c.escapeHtml(task.title) + '</div>' +
          '<div class="meta"><span class="pill">Архів</span><span class="pill">' + c.escapeHtml(formatDate(task.date)) + (task.time ? " " + c.escapeHtml(task.time) : "") + '</span></div>' +
          (task.note ? '<p>' + c.escapeHtml(task.note) + '</p>' : '<small>Без примітки.</small>') +
          '<div class="detail-actions">' +
            '<button class="button button-outline" type="button" data-action="restoreTask">Повернути</button>' +
            '<button class="button button-fill color-red danger-action" type="button" data-action="deleteForeverTask">Видалити</button>' +
          '</div>' +
        '</article>' +
        '<article class="detail-card">' + stageRows(task) + '</article>';
      return;
    }
    var meta = tagMeta(task.tag);
    var overdue = isOverdue(task);
    $("#taskPage").innerHTML =
      '<div class="detail-top"><button class="button button-outline" type="button" data-action="backTasks">Назад</button><button class="button button-fill" type="button" data-action="editTask">Правка</button></div>' +
      '<article class="detail-card">' +
        '<div class="detail-title">' + c.escapeHtml(task.title) + '</div>' +
        '<div class="meta"><span class="pill">' + c.escapeHtml(label(task.status)) + '</span><span class="pill">' + c.escapeHtml(formatDate(task.date)) +
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
          '<button class="button button-fill color-red danger-action" type="button" data-action="archiveTask">В архів</button>' +
        '</div>' +
      '</article>' +
      '<article class="detail-card">' + stageRows(task) + '</article>';
  }

  function renderGuidePage() {
    $("#guidePage").innerHTML =
      '<div class="info-box"><h2>Встановлення</h2><ol>' +
        '<li>НА-КОНТРОЛІ - це PWA. Простими словами: сайт, який можна поставити на екран телефону як звичайний додаток.</li>' +
        '<li>Відкрийте посилання GitHub Pages саме у Safari на iPhone або Chrome на Android. Через переглядач файлів чи вбудований браузер месенджера встановлення може не зʼявитись.</li>' +
        '<li>Посиланням на додаток можна поділитися з розділу "Налаштування" кнопкою "Поділитись".</li>' +
        '<li>iPhone: натисніть кнопку "Поділитися" у Safari, прокрутіть список дій і виберіть "На екран Домівки". Потім натисніть "Додати".</li>' +
        '<li>Android: відкрийте меню Chrome з трьома крапками і виберіть "Встановити додаток" або "Додати на головний екран".</li>' +
        '<li>Після встановлення запускайте додаток з іконки "НК" на екрані. Так він виглядає як окрема програма без адресного рядка.</li>' +
        '<li>Після першого відкриття файли кешуються. Далі додаток може відкриватися офлайн, а задачі зберігаються локально на цьому пристрої.</li>' +
        '<li>Коли виходить оновлення, відкрийте додаток з інтернетом. Якщо стара версія тримається, закрийте додаток повністю і відкрийте знову.</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Як працювати</h2><ol>' +
        '<li>Плюс у нижньому меню відкриває вибір: "ШВИДКА" або "ПОВНА".</li>' +
        '<li>"ШВИДКА" - це один рядок, дата окремо і тег кнопкою. Дата одразу стоїть сьогодні, її можна змінити одним натиском.</li>' +
        '<li>Швидкий рядок розуміє час на початку: "14:30 перевірити звʼязок", "14 перевірити звʼязок" або "14 30 перевірити звʼязок".</li>' +
        '<li>Крапка розділяє назву і примітку: "14:30 перевірити звʼязок. коротка примітка".</li>' +
        '<li>"ПОВНА" відкриває звичайну форму з усіма полями, дорученням, приміткою та етапами.</li>' +
        '<li>"Всі" показує головний список усіх активних задач.</li>' +
        '<li>"Мої" показує задачі без доручення іншому виконавцю.</li>' +
        '<li>"Іншим" показує задачі, де заповнено поле "Кому доручена задача".</li>' +
        '<li>"Виконані" знаходиться у меню зверху і відкриває виконані задачі.</li>' +
        '<li>Зверху списку є швидкі фільтри тегів: "Особисте", "На контролі", "Терміново", "Всі".</li>' +
        '<li>Тег необовʼязковий. У картці він показується літерою: О - особисте, К - на контролі, Т - терміново.</li>' +
        '<li>11.1. Приклад тлумачення тегів: О - особисте, будь-яка власна задача або нагадування; К - на контролі, якщо вам поставлена задача або прохання кимось; Т - терміново, термінові задачі. Кожен може обрати власне тлумачення, це лише приклад мого бачення.</li>' +
        '<li>Список сортується за датою і часом, якщо час вказаний.</li>' +
        '<li>Етапи допомагають розкласти задачу на прості кроки. У правці їх можна перетягувати за ручку ≡.</li>' +
        '<li>Кнопка "Зроблено" переносить задачу у готові. У виконаній задачі вона змінюється на "Повернутись до виконання".</li>' +
        '<li>У списках дата показується у форматі день.місяць.рік, наприклад 10.06.2026.</li>' +
        '<li>Якщо час задачі минув, а задача не виконана, вона підсвічується як прострочена.</li>' +
        '<li>Сховище видаляється тільки на екрані вибору сховищ, кнопкою поруч із конкретною назвою. Для видалення треба написати "ТАК ВИДАЛИТИ".</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Передача задач</h2><ol>' +
        '<li>Передача в цій локальній версії лише фіксує, кому ви передали задачу.</li>' +
        '<li>Відкрийте задачу і натисніть "Передати".</li>' +
        '<li>У полі "Кому передано" вкажіть імʼя, позивний або підрозділ.</li>' +
        '<li>Після натискання "Завершити передачу" задача переходить у розділ "Іншим".</li>' +
        '<li>У задачі додається виконаний етап "Передано: ...", а в картці показується мітка передачі.</li>' +
        '<li>Додаток не створює текст для відправлення задач і не приймає задачі ззовні.</li>' +
      '</ol></div>' +
      '<div class="info-box"><h2>Сповіщення</h2><ol>' +
        '<li>У "Налаштуваннях" натисніть "Сповіщення" і дозвольте їх у браузері або встановленій PWA.</li>' +
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
        '<div class="version-row"><p>Версія: <strong>1.1.4</strong>.</p><button class="button button-outline" type="button" data-action="openUpdates">Що нового</button></div>' +
        '<p>Автор і власник ідеї: <strong>ShuviDoula</strong>.</p>' +
        '<ul><li>GitHub: github.com/ShuviDoula</li><li>Сайт: ' + APP_SHARE_URL + '</li></ul>' +
      '</div>';
  }

  function updateItems(items) {
    return '<ul>' + items.map(function (item) {
      return '<li>' + c.escapeHtml(item) + '</li>';
    }).join("") + '</ul>';
  }

  function renderUpdatesPage() {
    var updates = [
      {
        version: "1.1.4",
        title: "Пояснення тегів",
        items: [
          "Готово перейменовано на Виконані.",
          "У формах задач додано коротке пояснення тегів О, К, Т.",
          "У довідник додано пункт 11.1 з прикладом тлумачення тегів."
        ]
      },
      {
        version: "1.1.3",
        title: "Ще швидша швидка задача",
        items: [
          "Швидку задачу можна створити тільки з приміткою.",
          "Якщо назву не вказано, додаток поставить Не забути."
        ]
      },
      {
        version: "1.1.2",
        title: "Примітка у швидкій задачі",
        items: [
          "У швидку задачу додано окреме поле Примітка.",
          "Туди можна вставити повний текст повідомлення з месенджера.",
          "Примітка з першого рядка і великий текст обʼєднуються в одній задачі."
        ]
      },
      {
        version: "1.1.1",
        title: "Полірування навігації і бекапу",
        items: [
          "Прибрано верхню кнопку Назад зі сторінок Що нового і Налаштування.",
          "Прибрано лічильники-фільтри Сьогодні, Прострочено та Іншим з головної.",
          "Бекап на телефоні тепер обирає один шлях створення, щоб не дублювати файли."
        ]
      },
      {
        version: "1.1.0",
        title: "Налаштування, архів і посилене сховище",
        items: [
          "Додано сторінку Налаштування.",
          "Додано архів задач з поверненням і остаточним видаленням.",
          "Додано очищення всього архіву з налаштувань.",
          "Додано лічильники Сьогодні, Прострочено та Іншим.",
          "Додано налаштування сповіщень за 1 годину і в час задачі.",
          "Локальне сховище переходить на сильніше шифрування WebCrypto AES-GCM."
        ]
      },
      {
        version: "1.0.8",
        title: "Сторінка змін",
        items: [
          "Додано сторінку Що нового.",
          "У довіднику біля версії зʼявився швидкий перехід до історії оновлень."
        ]
      },
      {
        version: "1.0.7",
        title: "Поширення додатку",
        items: [
          "Додано кнопку Поділитись у верхньому меню.",
          "Посилання на додаток відкривається через системне меню або копіюється в буфер.",
          "Прибрано зайвий блок Приклад передачі з довідника."
        ]
      },
      {
        version: "1.0.6",
        title: "Локальна версія",
        items: [
          "Прибрано обмін задачами між пристроями.",
          "Прибрано службові екрани обміну і приймання задач.",
          "Передача задачі тепер тільки фіксує, кому її передано.",
          "Довідник і README переписано під локальне використання."
        ]
      },
      {
        version: "1.0.5",
        title: "Вхід і створення сховища",
        items: [
          "Додано індикатор введених цифр PIN.",
          "Створення сховища розділено на кроки: назва, PIN, повтор PIN.",
          "Якщо повтор PIN не співпав, можна створити PIN заново або скасувати створення."
        ]
      },
      {
        version: "1.0.4",
        title: "Швидка і повна задача",
        items: [
          "Кнопка плюс відкриває вибір між швидкою та повною задачею.",
          "Швидка задача винесена в окреме вікно.",
          "Швидкий рядок підтримує час у форматах 14:30, 14 і 14 30.",
          "Дати в картках і деталях показуються як день.місяць.рік."
        ]
      },
      {
        version: "1.0.3",
        title: "Передача і контакти",
        items: [
          "Перероблено екран передачі задач.",
          "Додано окремі поля для фіксації отримувача задачі."
        ]
      },
      {
        version: "1.0.2",
        title: "Прострочення і бекапи",
        items: [
          "Додано швидкий ввід задачі.",
          "Додано червоне виділення прострочених задач.",
          "Додано явну мітку, кому і коли передано задачу.",
          "Бекап додатково відкриває екран з JSON, якщо телефон не зберіг файл.",
          "Імпорт отримав режими Додати і Замінити."
        ]
      },
      {
        version: "1.0.1",
        title: "Безпечніше видалення",
        items: [
          "Прибрано небезпечну кнопку глобального видалення всіх даних.",
          "Додано видалення конкретного сховища на екрані вибору сховищ.",
          "Покращено створення бекапу на телефонах."
        ]
      },
      {
        version: "1.0.0",
        title: "Перший реліз НА-КОНТРОЛІ",
        items: [
          "Додано локальні сховища з PIN.",
          "Додано задачі з датою, часом, етапами, тегами і дорученням.",
          "Додано фільтри Особисте, На контролі, Терміново і Всі.",
          "Додано локальні сповіщення та експорт/імпорт резервних копій."
        ]
      }
    ];
    $("#updatesPage").innerHTML =
      '<div class="detail-top"><h2>Що нового</h2></div>' +
      '<div class="updates-list">' + updates.map(function (item) {
        return '<article class="update-card">' +
          '<div class="update-head"><span>Версія ' + c.escapeHtml(item.version) + '</span><strong>' + c.escapeHtml(item.title) + '</strong></div>' +
          updateItems(item.items) +
        '</article>';
      }).join("") + '</div>';
  }

  function archivedTasks() {
    return state.tasks.filter(function (task) { return task.status === "archived"; }).sort(function (a, b) {
      return String(b.archivedAt || b.updatedAt || "").localeCompare(String(a.archivedAt || a.updatedAt || ""));
    });
  }

  function renderSettingsPage() {
    var archivedCount = archivedTasks().length;
    $("#settingsPage").innerHTML =
      '<div class="detail-top"><h2>Налаштування</h2></div>' +
      '<article class="detail-card settings-card">' +
        '<h3>Сповіщення</h3>' +
        '<label class="setting-row"><span>За 1 годину до задачі</span><input type="checkbox" data-setting="notifyHour"' + (state.settings.notifyHour !== false ? " checked" : "") + '></label>' +
        '<label class="setting-row"><span>У час задачі</span><input type="checkbox" data-setting="notifyAtTime"' + (state.settings.notifyAtTime !== false ? " checked" : "") + '></label>' +
        '<button class="button button-outline" type="button" data-settings-action="enableNotifications">Сповіщення</button>' +
      '</article>' +
      '<article class="detail-card settings-card">' +
        '<h3>Дані</h3>' +
        '<button class="button button-outline" type="button" data-settings-action="exportData">Бекап</button>' +
        '<button class="button button-outline" type="button" data-settings-action="importData">Імпорт</button>' +
        '<button class="button button-outline" type="button" data-settings-action="openArchive">Архів (' + archivedCount + ')</button>' +
        '<button class="button button-outline danger-link" type="button" data-settings-action="clearArchive"' + (archivedCount ? "" : " disabled") + '>Очистити архів</button>' +
      '</article>' +
      '<article class="detail-card settings-card">' +
        '<h3>Додаток</h3>' +
        '<button class="button button-outline" type="button" data-settings-action="shareApp">Поділитись</button>' +
        '<button class="button button-outline" type="button" data-settings-action="installApp">Встановити</button>' +
        '<button class="button button-outline" type="button" data-settings-action="openUpdates">Що нового</button>' +
      '</article>';
    updateNotifyButton();
  }

  function archiveCard(task) {
    return '<article class="task-card archived" data-task="' + task.id + '">' +
      '<div class="task-main">' +
        '<div><div class="task-title">' + c.escapeHtml(task.title) + '</div>' +
        '<div class="meta"><span class="pill">Архів</span><span class="pill">' + c.escapeHtml(formatDate(task.date)) + (task.time ? " " + c.escapeHtml(task.time) : "") + '</span>' +
        (task.assignee ? '<span class="pill">' + c.escapeHtml(task.assignee) + '</span>' : '') + '</div></div>' +
        '<button class="button button-outline open-task" type="button" data-action="view">></button>' +
      '</div>' +
      '<div class="archive-actions">' +
        '<button class="button button-outline" type="button" data-archive-action="restore">Повернути</button>' +
        '<button class="button button-fill color-red danger-action" type="button" data-archive-action="deleteForever">Видалити</button>' +
      '</div>' +
    '</article>';
  }

  function renderArchivePage() {
    var list = archivedTasks();
    $("#archivePage").innerHTML =
      '<div class="detail-top"><button class="button button-outline" type="button" data-archive-action="backSettings">Назад</button><h2>Архів</h2></div>' +
      '<div class="task-list">' + (list.length ? list.map(archiveCard).join("") : '<div class="empty-state">Архів порожній.</div>') + '</div>';
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
    renderUpdatesPage();
    renderSettingsPage();
    renderArchivePage();
    renderNav();
  }

  function showPage(page) {
    state.page = page;
    $("#tasksPage").hidden = page !== "tasks";
    $("#taskPage").hidden = page !== "task";
    $("#donePage").hidden = page !== "done";
    $("#guidePage").hidden = page !== "guide";
    $("#updatesPage").hidden = page !== "updates";
    $("#settingsPage").hidden = page !== "settings";
    $("#archivePage").hidden = page !== "archive";
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

  function renderQuickTags() {
    document.querySelectorAll("[data-quick-tag]").forEach(function (button) {
      button.classList.toggle("active", (button.dataset.quickTag || "") === state.quickTag);
    });
  }

  function openQuickTaskForm() {
    clearToast();
    closeServiceMenu();
    state.quickTag = "";
    $("#quickTaskDate").value = c.today();
    $("#quickTaskLine").value = "";
    $("#quickTaskNote").value = "";
    renderQuickTags();
    openQuickTaskModal();
    if (window.matchMedia("(pointer: fine)").matches) {
      setTimeout(function () { $("#quickTaskLine").focus(); }, 30);
    }
  }

  function openCreateChoice() {
    closeServiceMenu();
    openCreateChoiceModal();
  }

  function saveQuickTaskForm(event) {
    event.preventDefault();
    var parsed = parseQuickLine($("#quickTaskLine").value);
    var extraNote = c.clean($("#quickTaskNote").value);
    var note = [parsed.note, extraNote].filter(Boolean).join("\n\n");
    if (parsed.error) return toast(parsed.error);
    if (!parsed.title && !note) return toast("Напишіть, що зробити.");
    var task = {
      id: c.id(),
      syncId: c.id(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: parsed.title || "Не забути",
      date: $("#quickTaskDate").value || c.today(),
      time: parsed.time,
      tag: state.quickTag || "",
      assignee: "",
      status: "todo",
      note: note,
      items: [],
      doneAt: ""
    };
    state.tasks.push(task);
    saveTasks();
    closeQuickTaskModal();
    state.currentTaskId = task.id;
    showPage("task");
    toast("Швидку задачу створено.");
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
    if (!target) return;
    var action = target.dataset.action;
    var taskActions = ["view", "editTask", "shareTask", "backTasks", "backArchive", "restoreTask", "deleteForeverTask", "doneTask", "notDoneTask", "archiveTask", "checkStage", "removeStage", "addStage"];
    if (taskActions.indexOf(action) === -1) return;
    var task = taskFromEvent(event) || state.tasks.find(function (item) { return item.id === state.currentTaskId; });
    if (!task && action !== "backTasks" && action !== "backArchive") return;

    if (action === "view") {
      clearToast();
      state.currentTaskId = task.id;
      showPage("task");
      return;
    }
    if (action === "editTask") return openTaskForm(task);
    if (action === "shareTask") return shareTask(task);
    if (action === "backTasks") return showPage("tasks");
    if (action === "backArchive") return showPage("archive");
    if (action === "restoreTask") {
      restoreTask(task);
      return;
    }
    if (action === "deleteForeverTask") {
      deleteTaskForever(task);
      return;
    }
    if (action === "doneTask") {
      task.status = "done";
      task.doneAt = new Date().toISOString();
    }
    if (action === "notDoneTask") {
      task.status = task.assignee ? "run" : "todo";
      task.doneAt = "";
    }
    if (action === "archiveTask") {
      f7.dialog.confirm("Перемістити задачу в архів?", "НА-КОНТРОЛІ", function () {
        task.previousStatus = task.status === "archived" ? (task.previousStatus || "todo") : task.status;
        task.status = "archived";
        task.archivedAt = new Date().toISOString();
        task.updatedAt = task.archivedAt;
        saveTasks();
        state.currentTaskId = "";
        showPage("tasks");
        toast("Переміщено в архів.");
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

  function restoreTask(task) {
    task.status = task.previousStatus && task.previousStatus !== "archived" ? task.previousStatus : (task.assignee ? "run" : "todo");
    task.previousStatus = "";
    task.archivedAt = "";
    task.updatedAt = new Date().toISOString();
    saveTasks();
    state.currentTaskId = task.id;
    showPage("task");
    toast("Повернуто з архіву.");
  }

  function deleteTaskForever(task) {
    f7.dialog.confirm("Остаточно видалити задачу? Повернути її буде неможливо.", "НА-КОНТРОЛІ", function () {
      state.tasks = state.tasks.filter(function (item) { return item.id !== task.id; });
      state.currentTaskId = "";
      saveTasks();
      showPage("archive");
      toast("Остаточно видалено.");
    });
  }

  function clearArchive() {
    var count = archivedTasks().length;
    if (!count) return toast("Архів порожній.");
    f7.dialog.confirm("Остаточно видалити всі задачі з архіву? Кількість: " + count + ".", "НА-КОНТРОЛІ", function () {
      state.tasks = state.tasks.filter(function (task) { return task.status !== "archived"; });
      state.currentTaskId = "";
      saveTasks();
      showPage("settings");
      toast("Архів очищено.");
    });
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
    var canShareFile = file && navigator.canShare && navigator.share && navigator.canShare({ files: [file] });
    if (canShareFile) {
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
    if (isIOS() || isAndroid()) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).catch(function () {});
      }
      openExchangeModal("backup", json);
      toast("Бекап готовий. JSON також у буфері.");
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
    toast("Бекап створено.");
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
                  return normalizeTask(task);
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
                state.tasks = data.tasks.map(normalizeTask);
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

  function shareAppLink() {
    closeServiceMenu();
    var text = "НА-КОНТРОЛІ: локальний задачник";
    if (navigator.share) {
      navigator.share({
        title: "НА-КОНТРОЛІ",
        text: text,
        url: APP_SHARE_URL
      }).then(function () {
        toast("Посилання передано.");
      }).catch(function () {
        toast("Поділитися не вдалося.");
      });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(APP_SHARE_URL).then(function () {
        toast("Посилання скопійовано.");
      }).catch(function () {
        toast(APP_SHARE_URL);
      });
      return;
    }
    toast(APP_SHARE_URL);
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
    var button = $("#installBtn") || document.querySelector("[data-settings-action='installApp']");
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
      state.loginMode = "createName";
      state.pin = "";
      state.pendingPin = "";
      state.pendingStorageName = "";
      state.pinMismatch = false;
      $("#storageNameInput").value = "";
      renderLogin();
    });
    $("#continueStorageBtn").addEventListener("click", continueStorageCreate);
    $("#storageNameInput").addEventListener("keydown", function (event) {
      if (event.key === "Enter" && state.loginMode === "createName") {
        event.preventDefault();
        continueStorageCreate();
      }
    });
    $("#resetCreatePinBtn").addEventListener("click", restartCreatePin);
    $("#cancelCreateStorageBtn").addEventListener("click", function () { resetCreateDraft(true); });
    $("#backToStoragesBtn").addEventListener("click", function () { showLogin(true); });
    $("#logoutLoginBtn").addEventListener("click", function () { showLogin(true); });

    document.addEventListener("keydown", function (event) {
      if (!$("#loginScreen").hidden) {
        var targetTag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
        var typingText = targetTag === "input" || targetTag === "textarea";
        var pinVisible = $("#pinKeys").style.display !== "none";
        if (!typingText && pinVisible && /^\d$/.test(event.key)) keyPress(event.key);
        if (!typingText && pinVisible && event.key === "Backspace") keyPress("<");
      }
      if (event.key === "Escape") {
        closeTaskModal();
        closeQuickTaskModal();
        closeCreateChoiceModal();
        closeExchangeModal();
        closeServiceMenu();
        if (state.page === "task") showPage("tasks");
      }
    });

    $("#taskForm").addEventListener("submit", saveTaskForm);
    $("#closeCreateChoice").addEventListener("click", closeCreateChoiceModal);
    $("#createChoicePopup").addEventListener("click", function (event) {
      if (event.target.id === "createChoicePopup") closeCreateChoiceModal();
    });
    $("#quickCreateBtn").addEventListener("click", function () {
      closeCreateChoiceModal();
      openQuickTaskForm();
    });
    $("#fullCreateBtn").addEventListener("click", function () {
      closeCreateChoiceModal();
      openTaskForm();
    });
    $("#quickTaskForm").addEventListener("submit", saveQuickTaskForm);
    $("#closeQuickTaskPopup").addEventListener("click", closeQuickTaskModal);
    $("#cancelQuickTask").addEventListener("click", closeQuickTaskModal);
    $("#quickTaskPopup").addEventListener("click", function (event) {
      if (event.target.id === "quickTaskPopup") closeQuickTaskModal();
      var tagButton = event.target.closest("[data-quick-tag]");
      if (!tagButton) return;
      state.quickTag = tagButton.dataset.quickTag || "";
      renderQuickTags();
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
    $("#finishTransferBtn").addEventListener("click", markTaskTransferred);
    $("#tasksPage").addEventListener("click", handleTaskAction);
    $("#taskPage").addEventListener("click", handleTaskAction);
    $("#taskPage").addEventListener("change", handleTaskAction);
    $("#donePage").addEventListener("click", handleTaskAction);
    $("#settingsPage").addEventListener("change", function (event) {
      var input = event.target.closest("[data-setting]");
      if (!input) return;
      state.settings[input.dataset.setting] = input.checked;
      saveSettings();
      clearOldReminderMarks();
      checkReminders();
      renderSettingsPage();
    });
    $("#settingsPage").addEventListener("click", function (event) {
      var button = event.target.closest("[data-settings-action]");
      if (!button) return;
      var action = button.dataset.settingsAction;
      if (action === "backTasks") return showPage("tasks");
      if (action === "enableNotifications") return enableNotifications();
      if (action === "exportData") return exportData();
      if (action === "importData") return $("#importFile").click();
      if (action === "openArchive") return showPage("archive");
      if (action === "clearArchive") return clearArchive();
      if (action === "shareApp") return shareAppLink();
      if (action === "installApp") return install();
      if (action === "openUpdates") return showPage("updates");
    });
    $("#archivePage").addEventListener("click", handleTaskAction);
    $("#archivePage").addEventListener("click", function (event) {
      var button = event.target.closest("[data-archive-action]");
      var card = event.target.closest("[data-task]");
      var task = card ? state.tasks.find(function (item) { return item.id === card.dataset.task; }) : null;
      if (!button) return;
      if (button.dataset.archiveAction === "backSettings") return showPage("settings");
      if (!task) return;
      if (button.dataset.archiveAction === "restore") return restoreTask(task);
      if (button.dataset.archiveAction === "deleteForever") return deleteTaskForever(task);
    });
    $("#guidePage").addEventListener("click", function (event) {
      var button = event.target.closest("[data-action='openUpdates']");
      if (!button) return;
      showPage("updates");
    });
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
      openCreateChoice();
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
    $("#settingsMenuBtn").addEventListener("click", function () { closeServiceMenu(); showPage("settings"); });
    if ($("#installBtn")) $("#installBtn").addEventListener("click", function () { closeServiceMenu(); install(); });
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
