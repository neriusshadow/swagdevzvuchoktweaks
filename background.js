/**
 * SWAGdev ZVUCHOKtweaker — Background Service Worker
 * Менеджер Discord RPC шлюзов (SWAGdev Bridge & arRPC) и координация состояния
 * neriusshadow / SWAGdev
 */

try {
  importScripts('secrets.js');
} catch (e) {
  // Firefox or context where importScripts may differ
}

var currentTrack = null;
var activePlayingTabId = null;
var rpcStatus = {
  connected: false,
  gateway: null, // 'bridge' | 'arrpc'
  lastUpdate: 0,
  user: null,
  error: null
};

var stats = {
  tracksPlayed: 0,
  sessionStartTime: Date.now()
};

var DEFAULT_SETTINGS = {
  rpcEnabled: true,
  showTimestamps: true,
  showListenButton: false,
  hideWhenPaused: false,
  showToast: true,
  addDownloadButtons: true,
  hotkeysEnabled: true,
  customClientId: '',
  bridgePort: 6473,
  // DSP & Эквалайзер
  dspEnabled: true,
  dspPreset: 'default',
  dspBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  dspBass: 0,
  dspReverb: 0,
  dspSpeed: 1.0,
  dspPitch: true,
  // Таймер сна
  sleepTimerMinutes: 0
};

var settings = Object.assign({}, DEFAULT_SETTINGS);

// История прослушиваний для личной статистики
var listenHistory = [];

// Загрузка настроек, статистики и истории
chrome.storage.local.get(['zv_settings', 'zv_stats', 'zv_listen_history'], function (res) {
  if (res && res.zv_settings) {
    settings = Object.assign(settings, res.zv_settings);
  }
  if (res && res.zv_stats) {
    stats = Object.assign(stats, res.zv_stats);
  }
  if (res && Array.isArray(res.zv_listen_history)) {
    listenHistory = res.zv_listen_history;
  }
});

// Автоматическая мгновенная синхронизация настроек из любого источника (попап или сайт)
chrome.storage.onChanged.addListener(function (changes, areaName) {
  if (areaName === 'local' && changes.zv_settings && changes.zv_settings.newValue) {
    settings = Object.assign(settings, changes.zv_settings.newValue);
  }
});

function recordListen(entry) {
  if (!entry || !entry.title) return;
  listenHistory.unshift(entry);
  // Храним максимум 2000 последних записей (примерно за 2-3 месяца)
  if (listenHistory.length > 2000) {
    listenHistory = listenHistory.slice(0, 2000);
  }
  chrome.storage.local.set({ zv_listen_history: listenHistory });
}

function getClientId() {
  if (settings.customClientId && settings.customClientId.trim().length > 5) {
    return settings.customClientId.trim();
  }
  if (typeof ZvuchokSecrets !== 'undefined' && ZvuchokSecrets.getDefaultClientId) {
    return ZvuchokSecrets.getDefaultClientId();
  }
  return '1558969019149582399';
}

// Санитизация и форматирование информации о треке
// Гарантирует отсутствие повторений "в huEVO Звучок" и названия трека
function sanitizeTrackInfo(track) {
  var rawArtist = ((track && track.artist) ? track.artist : 'huEVO').trim();
  // Убираем возможные существующие суффиксы "в huEVO Звучок" для предотвращения повторений
  var cleanArtist = rawArtist.replace(/\s*в\s+huEVO\s+Звучок\s*$/i, '').trim();
  if (!cleanArtist) {
    cleanArtist = 'huEVO';
  }

  var rawTitle = ((track && track.title) ? track.title : 'Без названия').trim();
  var cleanTitle = rawTitle.replace(/\s*в\s+huEVO\s+Звучок\s*$/i, '').trim();

  // Если в начале названия трека дублируется исполнитель ("Исполнитель - Трек")
  if (cleanArtist && cleanTitle) {
    var escaped = cleanArtist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var prefixRegex = new RegExp('^' + escaped + '\\s*[-—–:]\\s*', 'i');
    cleanTitle = cleanTitle.replace(prefixRegex, '').trim();
  }
  if (!cleanTitle) {
    cleanTitle = 'Без названия';
  }

  // В шапке Discord (name): "<Исполнитель> в huEVO Звучок"
  // Если исполнитель сам по себе huEVO или huEVO Звучок, пишем просто huEVO Звучок без тавтологии
  var lower = cleanArtist.toLowerCase();
  var headerName = (lower === 'huevo' || lower === 'huevo звучок' || lower === 'звучок')
    ? 'huEVO Звучок'
    : (cleanArtist + ' в huEVO Звучок');

  return {
    name: headerName,      // В шапке Discord: "Listening to <Исполнитель> в huEVO Звучок"
    details: cleanTitle,   // Жирный заголовок: Название трека
    state: cleanArtist     // Подзаголовок: просто <Исполнитель> (без повторения "в huEVO Звучок"!)
  };
}

// Форматирование Activity для Discord (вид 1 в 1 как на фото)
function buildActivityPayload(track) {
  if (!track || (!track.title && !track.artist)) {
    return null;
  }

  if (!track.isPlaying && settings.hideWhenPaused) {
    return null;
  }

  var info = sanitizeTrackInfo(track);

  var hasCustomCover = !!(track.cover && track.cover.startsWith('http'));
  var largeImage = hasCustomCover ? track.cover : 'zvuchok_logo';
  var largeText = info.details;

  // Маленькая картинка в углу обложки (пользователь загрузил zvuchok_logo в Developer Portal)
  var smallImage = 'zvuchok_logo';
  var smallText = 'huEVO Звучок';

  var activity = {
    type: 2, // 2 = LISTENING ("Listening to {name}" / "Слушает {name}")
    name: info.name,       // В шапке Discord: "Listening to <Исполнитель>" (без "в huEVO Звучок")
    details: info.details, // Жирный заголовок: Название трека
    state: info.state,     // Подзаголовок: <Исполнитель> в huEVO Звучок (ровно 1 раз!)
    assets: {
      large_image: largeImage,
      large_text: largeText.substring(0, 128),
      small_image: smallImage,
      small_text: smallText
    }
  };

  // Таймстампы (активируют шкалу 00:28 ───── 02:29 в Discord)
  if (settings.showTimestamps && track.isPlaying) {
    var startSec = track.playbackStartSec || (Math.floor(Date.now() / 1000) - (track.currentTime || 0));
    activity.timestamps = {
      start: startSec
    };
    if (track.duration && track.duration > 0) {
      activity.timestamps.end = startSec + track.duration;
    }
  }

  // Кнопка "Слушать в Звучке" (только если явно включена в настройках)
  if (settings.showListenButton) {
    var btnUrl = track.siteUrl || 'https://huevo.su/zvuchok';
    if (!btnUrl.startsWith('http://') && !btnUrl.startsWith('https://')) {
      btnUrl = 'https://huevo.su/zvuchok';
    }
    activity.buttons = [
      {
        label: 'Слушать в Звучке',
        url: btnUrl
      }
    ];
  }

  return activity;
}

// Отправка в локальный SWAGdev Bridge (порт 6473)
function sendToBridge(activity) {
  var port = settings.bridgePort || 6473;
  var url = 'http://127.0.0.1:' + port + (activity ? '/activity' : '/clear');
  var body = activity ? { activity: activity, clientId: getClientId() } : {};

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (r) {
      if (!r.ok) throw new Error('Bridge HTTP ' + r.status);
      return r.json();
    })
    .then(function (json) {
      rpcStatus.connected = true;
      rpcStatus.gateway = 'SWAGdev Bridge';
      rpcStatus.lastUpdate = Date.now();
      rpcStatus.user = json.user || rpcStatus.user;
      rpcStatus.error = null;
      return true;
    });
}

// Отправка в arRPC (порт 1337)
function sendToArRPC(activity) {
  var url = 'http://127.0.0.1:1337/setActivity';
  var body = {
    activity: activity,
    pid: 1337
  };

  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
    .then(function (r) {
      if (!r.ok) throw new Error('arRPC HTTP ' + r.status);
      return r.json();
    })
    .then(function () {
      rpcStatus.connected = true;
      rpcStatus.gateway = 'arRPC';
      rpcStatus.lastUpdate = Date.now();
      rpcStatus.error = null;
      return true;
    });
}

// Двойной маршрутизатор: сначала пробуем SWAGdev Bridge, затем arRPC
function dispatchDiscordActivity(activity) {
  if (!settings.rpcEnabled) {
    return Promise.resolve(false);
  }

  return sendToBridge(activity)
    .catch(function () {
      return sendToArRPC(activity);
    })
    .catch(function (err) {
      rpcStatus.connected = false;
      rpcStatus.gateway = null;
      rpcStatus.error = 'Ожидание Discord Bridge или arRPC (' + err.message + ')';
      return false;
    });
}

// Очистка статуса в Discord
function clearDiscordActivity() {
  var port = settings.bridgePort || 6473;
  fetch('http://127.0.0.1:' + port + '/clear', { method: 'POST' }).catch(function () {});
  fetch('http://127.0.0.1:1337/setActivity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activity: null, pid: 1337 })
  }).catch(function () {});
}

// Проверка доступности шлюзов
function testConnection() {
  var port = settings.bridgePort || 6473;
  return fetch('http://127.0.0.1:' + port + '/status')
    .then(function (r) { return r.json(); })
    .then(function (data) {
      rpcStatus.connected = !!data.discordConnected;
      rpcStatus.gateway = 'SWAGdev Bridge';
      rpcStatus.user = data.user;
      rpcStatus.error = data.discordConnected ? null : 'Discord Desktop не запущен';
      return rpcStatus;
    })
    .catch(function () {
      // Проверяем arRPC
      return fetch('http://127.0.0.1:1337/')
        .then(function () {
          rpcStatus.connected = true;
          rpcStatus.gateway = 'arRPC';
          rpcStatus.error = null;
          return rpcStatus;
        })
        .catch(function () {
          rpcStatus.connected = false;
          rpcStatus.gateway = null;
          rpcStatus.error = 'Bridge не запущен. Запустите start_bridge_mac.command или arRPC';
          return rpcStatus;
        });
    });
}

// Слушатель сообщений от контент-скриптов и попапа
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === 'ZVUCHOK_TRACK_STATE') {
    var tabId = sender && sender.tab ? sender.tab.id : null;

    // Защита от конфликта нескольких вкладок:
    // Если сообщение сообщает о паузе или остановке, но сейчас активно играет ДРУГАЯ вкладка — игнорируем
    if (msg.track && !msg.track.isPlaying && activePlayingTabId !== null && tabId !== null && tabId !== activePlayingTabId) {
      sendResponse({ ok: true, ignored: true });
      return;
    }

    if (msg.track && msg.track.isPlaying && tabId !== null) {
      activePlayingTabId = tabId;
    } else if (!msg.track || !msg.track.isPlaying) {
      if (tabId === null || tabId === activePlayingTabId) {
        activePlayingTabId = null;
      }
    }

    var prev = currentTrack;
    currentTrack = msg.track;

    if (currentTrack) {
      var nowSec = Math.floor(Date.now() / 1000);
      currentTrack.playbackStartSec = nowSec - (currentTrack.currentTime || 0);
    }

    if (currentTrack && (!prev || prev.title !== currentTrack.title || prev.artist !== currentTrack.artist)) {
      stats.tracksPlayed++;
      chrome.storage.local.set({ zv_stats: stats });
    }

    if (settings.rpcEnabled) {
      var act = buildActivityPayload(currentTrack);
      dispatchDiscordActivity(act);
    }

    chrome.storage.local.set({ zv_last_track: currentTrack });
    sendResponse({ ok: true, rpc: rpcStatus });
  } else if (msg.type === 'ZV_GET_BACKGROUND_STATE') {
    var trackToSend = currentTrack;
    if (currentTrack && currentTrack.isPlaying && currentTrack.playbackStartSec) {
      var liveTime = Math.floor(Date.now() / 1000) - currentTrack.playbackStartSec;
      trackToSend = Object.assign({}, currentTrack, {
        currentTime: Math.min(currentTrack.duration || Infinity, Math.max(0, liveTime))
      });
    }
    sendResponse({
      track: trackToSend,
      rpc: rpcStatus,
      settings: settings,
      stats: stats
    });
  } else if (msg.type === 'ZV_SAVE_SETTINGS') {
    if (msg.settings) {
      settings = Object.assign(settings, msg.settings);
      chrome.storage.local.set({ zv_settings: settings });
    }

    // Уведомляем открытые вкладки huEVO
    chrome.tabs.query({ url: ['*://huevo.su/*', '*://huevo.departament.site/*'] }, function (tabs) {
      tabs.forEach(function (t) {
        chrome.tabs.sendMessage(t.id, { type: 'ZV_SETTINGS_UPDATED', settings: settings }).catch(function () {});
      });
    });

    if (settings.rpcEnabled) {
      dispatchDiscordActivity(buildActivityPayload(currentTrack));
    } else {
      clearDiscordActivity();
    }
    sendResponse({ ok: true });
  } else if (msg.type === 'ZV_CMD_DSP_UPDATE') {
    if (msg.settings) {
      settings = Object.assign(settings, msg.settings);
      chrome.storage.local.set({ zv_settings: settings });
    }
    // Рассылаем во все открытые вкладки huEVO
    chrome.tabs.query({ url: ['*://huevo.su/*', '*://huevo.departament.site/*'] }, function (tabs) {
      if (tabs && tabs.length > 0) {
        tabs.forEach(function (t) {
          chrome.tabs.sendMessage(t.id, msg).catch(function () {});
        });
      }
    });
    sendResponse({ ok: true });
    return true;
  } else if (msg.type === 'ZV_TEST_RPC') {
    testConnection().then(function (st) {
      if (st.connected) {
        var info = sanitizeTrackInfo(currentTrack || { title: 'Ничего не играет', artist: 'huEVO' });
        var testAct = {
          type: 2, // LISTENING ("Слушает")
          name: currentTrack ? info.name : 'huEVO Звучок',
          details: currentTrack ? info.details : 'Ничего не играет',
          state: currentTrack ? info.state : 'huEVO',
          assets: {
            large_image: (currentTrack && currentTrack.cover) ? currentTrack.cover : 'zvuchok_logo',
            large_text: currentTrack ? info.details : 'Ничего не играет',
            small_image: 'zvuchok_logo',
            small_text: 'huEVO Звучок'
          }
        };
        dispatchDiscordActivity(testAct);
      }
      sendResponse({ status: st });
    });
    return true; // Async response
  } else if (msg.type === 'ZV_RECORD_LISTEN') {
    recordListen(msg.entry);
    sendResponse({ ok: true });
  } else if (msg.type === 'ZV_GET_LISTEN_STATS') {
    sendResponse({ history: listenHistory, stats: stats });
  } else if (msg.type === 'ZV_CLEAR_LISTEN_STATS') {
    listenHistory = [];
    chrome.storage.local.set({ zv_listen_history: [] });
    sendResponse({ ok: true });
  } else if (msg.type.startsWith('ZV_CMD_')) {
    // Пересылаем команду управления (Play/Next/Prev) в активную вкладку huEVO
    chrome.tabs.query({ url: ['*://huevo.su/*', '*://huevo.departament.site/*'] }, function (tabs) {
      if (tabs && tabs.length > 0) {
        var activeTab = tabs.find(function (t) { return t.active; }) || tabs[0];
        chrome.tabs.sendMessage(activeTab.id, msg, sendResponse);
      } else {
        sendResponse({ ok: false, error: 'Вкладка huEVO не найдена' });
      }
    });
    return true; // Async response
  }
  return true;
});

// Периодическая проверка статуса подключения (каждые 15 сек)
setInterval(function () {
  testConnection();
}, 15000);

testConnection();

// Если закрыта вкладка, которая активно воспроизводила трек — ставим на паузу
chrome.tabs.onRemoved.addListener(function (closedTabId) {
  if (closedTabId === activePlayingTabId) {
    activePlayingTabId = null;
    if (currentTrack && currentTrack.isPlaying) {
      currentTrack.isPlaying = false;
      if (settings.rpcEnabled) {
        dispatchDiscordActivity(buildActivityPayload(currentTrack));
      }
      chrome.storage.local.set({ zv_last_track: currentTrack });
    }
  }
});
