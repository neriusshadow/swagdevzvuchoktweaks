/**
 * SWAGdev ZVUCHOKtweaker — Content Script
 * Отслеживание треков huEVO, управление воспроизведением и твики страницы
 * neriusshadow / SWAGdev
 */

(function () {
  'use strict';

  var lastTrackKey = '';
  var isPlayingState = false;
  var lastTrackDuration = 0;

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
    dspEnabled: true,
    dspPreset: 'default',
    dspBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    dspBass: 0,
    dspReverb: 0,
    dspSpeed: 1.0,
    dspPitch: true,
    sleepTimerMinutes: 0
  };

  var currentSettings = Object.assign({}, DEFAULT_SETTINGS);

  // Читаем настройки из storage
  function loadSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['zv_settings'], function (res) {
        if (res && res.zv_settings) {
          currentSettings = Object.assign(currentSettings, res.zv_settings);
          applyTweaks();
          updateOnPageDspModalIfOpen();
        }
      });
    }
  }

  // Получаем текущее состояние плеера из localStorage huEVO
  function getHuevoAudioState() {
    try {
      var raw = localStorage.getItem('huevo_audio_state');
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {}
    return null;
  }

  // Получаем аудио элемент плеера huEVO
  function getAudioEl() {
    return document.getElementById('ap-audio');
  }

  // Извлекаем актуальные данные текущего трека
  function extractCurrentTrack() {
    var audio = getAudioEl();
    var state = getHuevoAudioState();
    var track = null;

    if (state && state.playlist && typeof state.index === 'number' && state.playlist[state.index]) {
      track = state.playlist[state.index];
    }

    var title = '';
    var artist = '';
    var cover = '';
    var duration = 0;
    var currentTime = 0;
    var isPlaying = false;
    var audioUrl = '';
    var trackId = '';

    if (track) {
      title = track.title || '';
      artist = track.artist || '';
      duration = track.duration || 0;
      audioUrl = track.url || '';
      trackId = track.zid || track.id || '';
    }

    // Если в state нет трека, попробуем взять из DOM шапки (#ap-title)
    if (!title) {
      var apTitleEl = document.getElementById('ap-title');
      if (apTitleEl) {
        var boldEl = apTitleEl.querySelector('b');
        if (boldEl) {
          artist = boldEl.textContent.trim();
          var cloned = apTitleEl.cloneNode(true);
          var bInClone = cloned.querySelector('b');
          if (bInClone) bInClone.remove();
          title = cloned.textContent.replace(/^[\s—\-]+/, '').trim();
        } else {
          title = apTitleEl.textContent.trim();
        }
      }
    }

    // Извлекаем актуальную обложку (из объекта трека, плеера или медиа-сессии)
    cover = extractCoverUrl(track);

    if (audio) {
      duration = (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration) && audio.duration > 0) ? audio.duration : duration;
      currentTime = (typeof audio.currentTime === 'number' && !isNaN(audio.currentTime) && isFinite(audio.currentTime)) ? audio.currentTime : 0;
      isPlaying = !audio.paused && !audio.ended;
    } else if (state) {
      isPlaying = !!state.playing;
      currentTime = (typeof state.time === 'number' && !isNaN(state.time) && isFinite(state.time)) ? state.time : 0;
      duration = (track && track.duration) || duration;
    }

    if (!title && !artist) {
      return null;
    }

    return {
      title: title || 'Без названия',
      artist: artist || 'huEVO Звучок',
      cover: cover,
      duration: Math.round(duration),
      currentTime: Math.round(currentTime),
      isPlaying: isPlaying,
      audioUrl: audioUrl,
      trackId: trackId,
      siteUrl: window.location.origin + '/zvuchok'
    };
  }

  // Нормализация URL обложки к полному абсолютному адресу
  function normalizeCoverUrl(url) {
    if (!url || typeof url !== 'string') return '';
    url = url.trim();

    // Очищаем от url("...") если извлечено из CSS стиля
    var match = url.match(/url\(['"]?(.*?)['"]?\)/i);
    if (match) url = match[1];

    if (!url || url === 'none' || url.indexOf('noavatar') !== -1) return '';

    // Поднимаем качество миниатюр huEVO до 400x400
    if (url.indexOf('/_t/100/') !== -1) {
      url = url.replace('/_t/100/', '/_t/400/');
    } else if (url.indexOf('/_t/200/') !== -1) {
      url = url.replace('/_t/200/', '/_t/400/');
    }

    try {
      return new URL(url, window.location.origin).href;
    } catch (e) {
      if (url.startsWith('//')) return 'https:' + url;
      if (url.startsWith('/')) return window.location.origin + url;
      return url;
    }
  }

  // Комплексный поиск обложки трека в huEVO
  function extractCoverUrl(track) {
    var raw = '';

    // 1. Поле cover в объекте трека
    if (track && track.cover) {
      raw = track.cover;
    }

    // 2. Элемент обложки в шапке плеера (#ap-cover)
    if (!raw) {
      var coverEl = document.getElementById('ap-cover');
      if (coverEl && coverEl.style.backgroundImage) {
        raw = coverEl.style.backgroundImage;
      }
    }

    // 3. Элемент обложки в мини-плеере (.ap-mini-cover)
    if (!raw) {
      var miniEl = document.querySelector('.ap-mini-cover');
      if (miniEl && miniEl.style.backgroundImage) {
        raw = miniEl.style.backgroundImage;
      }
    }

    // 4. Активная строка трека в текущем списке Звучка
    if (!raw) {
      var curRow = document.querySelector('.apm-row.ap-cur, [data-audio-url].ap-cur, .ap-cur');
      if (curRow) {
        var playBtn = curRow.querySelector('.apm-row-play, .audio-cover, [data-ap-play]');
        if (playBtn && playBtn.style.backgroundImage) {
          raw = playBtn.style.backgroundImage;
        }
        if (!raw) {
          var img = curRow.querySelector('img');
          if (img && img.src) raw = img.src;
        }
      }
    }

    // 5. navigator.mediaSession
    if (!raw && navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.artwork) {
      var art = navigator.mediaSession.metadata.artwork;
      if (art && art.length > 0 && art[0].src && art[0].src.indexOf('apple-touch-icon') === -1) {
        raw = art[0].src;
      }
    }

    return normalizeCoverUrl(raw);
  }

  // Отправляем обновление в background и popup
  function syncTrackState(force) {
    var track = extractCurrentTrack();
    if (!track) {
      if (lastTrackKey !== '' && isPlayingState) {
        lastTrackKey = '';
        isPlayingState = false;
        lastTrackDuration = 0;
        notifyBackground(null);
        updateBadge(false);
      }
      return;
    }

    // Если эта вкладка сейчас не играет и раньше не играла — не шлем статус в background (защита от фоновых вкладок)
    if (!track.isPlaying && !isPlayingState && !force) {
      return;
    }

    var key = track.artist + ' - ' + track.title + '|' + (track.isPlaying ? '1' : '0');
    var durationLoaded = (lastTrackDuration === 0 && track.duration > 0);

    if (force || key !== lastTrackKey || track.isPlaying !== isPlayingState || durationLoaded) {
      var isNewSong = (track.artist + ' - ' + track.title) !== lastTrackKey.split('|')[0];
      lastTrackKey = key;
      isPlayingState = track.isPlaying;
      lastTrackDuration = track.duration || 0;

      notifyBackground(track);
      updateBadge(track.isPlaying);

      if (isNewSong && track.isPlaying && currentSettings.showToast) {
        showTrackToast(track);
      }
    }
  }

  function notifyBackground(trackData) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'ZVUCHOK_TRACK_STATE',
        track: trackData
      }, function () {
        if (chrome.runtime.lastError) {}
      });
    }
  }

  // ====================================================================
  // 1. Web Audio API — 10-полосный эквалайзер + Bass Boost + Реверберация
  // ====================================================================
  var audioCtx = null;
  var dspSourceNode = null;
  var eqFilterNodes = [];
  var bassBoostNode = null;
  var convolverNode = null;
  var dryGainNode = null;
  var wetGainNode = null;
  var masterGainNode = null;
  var dspInitialized = false;

  var EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  var EQ_PRESETS = {
    default: { name: 'По умолчанию', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, reverb: 0 },
    club:    { name: 'Клубный бас',  bands: [7, 8, 6, 3, 0, 0, 1, 3, 4, 5], bass: 7, reverb: 5 },
    rock:    { name: 'Рок',          bands: [5, 4, 3, 1, -1, -1, 2, 4, 5, 6], bass: 3, reverb: 8 },
    vocal:   { name: 'Вокал',        bands: [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1], bass: 0, reverb: 15 },
    hall:    { name: 'Концертный зал',bands: [3, 2, 1, 0, 0, 1, 2, 3, 3, 2], bass: 2, reverb: 55 },
    lofi:    { name: 'ВК 2007 Lo-Fi', bands: [4, 5, 2, 0, -2, -3, -1, -4, -6, -8], bass: 5, reverb: 30 }
  };

  // Генератор синтетического импульсного отклика для реверберации
  function createImpulseResponse(ctx, durationSec, decay) {
    var rate = ctx.sampleRate;
    var length = Math.floor(rate * (durationSec || 2.4));
    var buffer = ctx.createBuffer(2, length, rate);
    var left = buffer.getChannelData(0);
    var right = buffer.getChannelData(1);

    for (var i = 0; i < length; i++) {
      var n = i / length;
      var env = Math.exp(-n * (decay || 2.2));
      left[i] = ((Math.random() * 2) - 1) * env;
      right[i] = ((Math.random() * 2) - 1) * env;
    }
    return buffer;
  }

  function initAudioDSP() {
    var audio = getAudioEl();
    if (!audio || dspInitialized) return;

    try {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;

      audioCtx = new AudioContextClass();

      dspSourceNode = audioCtx.createMediaElementSource(audio);

      // 10 фильтров эквалайзера (ISO октавные полосы)
      eqFilterNodes = [];
      var prevNode = dspSourceNode;

      for (var i = 0; i < EQ_FREQS.length; i++) {
        var filter = audioCtx.createBiquadFilter();
        var freq = EQ_FREQS[i];
        if (i === 0) {
          filter.type = 'lowshelf';
        } else if (i === EQ_FREQS.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;

        prevNode.connect(filter);
        prevNode = filter;
        eqFilterNodes.push(filter);
      }

      // Bass Boost (lowshelf 80 Hz)
      bassBoostNode = audioCtx.createBiquadFilter();
      bassBoostNode.type = 'lowshelf';
      bassBoostNode.frequency.value = 80;
      bassBoostNode.gain.value = 0;
      prevNode.connect(bassBoostNode);

      // Реверберация (ConvolverNode + Dry/Wet)
      convolverNode = audioCtx.createConvolver();
      convolverNode.buffer = createImpulseResponse(audioCtx, 2.5, 2.2);

      dryGainNode = audioCtx.createGain();
      wetGainNode = audioCtx.createGain();
      masterGainNode = audioCtx.createGain();

      dryGainNode.gain.value = 1.0;
      wetGainNode.gain.value = 0.0;
      masterGainNode.gain.value = 1.0;

      bassBoostNode.connect(dryGainNode);
      dryGainNode.connect(masterGainNode);

      bassBoostNode.connect(convolverNode);
      convolverNode.connect(wetGainNode);
      wetGainNode.connect(masterGainNode);

      masterGainNode.connect(audioCtx.destination);

      dspInitialized = true;
      applyDspSettings(currentSettings);
    } catch (e) {
      console.warn('[SWAGdev DSP] Не удалось подключить Web Audio API:', e);
    }
  }

  function applyDspSettings(cfg) {
    cfg = cfg || currentSettings;
    var audio = getAudioEl();

    // 1. Скорость и Питч
    if (audio) {
      var speed = (typeof cfg.dspSpeed === 'number') ? cfg.dspSpeed : 1.0;
      var preserve = (cfg.dspPitch !== false);
      audio.playbackRate = speed;
      audio.preservesPitch = preserve;
      if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = preserve;
      if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = preserve;
    }

    if (!dspInitialized || !audioCtx) return;

    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }

    var enabled = (cfg.dspEnabled !== false);
    var bands = Array.isArray(cfg.dspBands) ? cfg.dspBands : [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    var bass = (typeof cfg.dspBass === 'number') ? cfg.dspBass : 0;
    var reverb = (typeof cfg.dspReverb === 'number') ? cfg.dspReverb : 0;

    // Эквалайзер
    for (var i = 0; i < eqFilterNodes.length; i++) {
      var val = enabled ? (bands[i] || 0) : 0;
      eqFilterNodes[i].gain.setValueAtTime(val, audioCtx.currentTime);
    }

    // Bass Boost
    if (bassBoostNode) {
      bassBoostNode.gain.setValueAtTime(enabled ? bass : 0, audioCtx.currentTime);
    }

    // Reverb
    if (wetGainNode && dryGainNode) {
      var wetAmount = enabled ? (Math.min(100, Math.max(0, reverb)) / 100) * 0.75 : 0;
      wetGainNode.gain.setValueAtTime(wetAmount, audioCtx.currentTime);
      dryGainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);
    }
  }

  // ====================================================================
  // 2. Таймер сна (Sleep Timer) с плавным затуханием звука
  // ====================================================================
  var sleepTimerState = {
    active: false,
    timerId: null,
    targetTimestamp: 0,
    originalVolume: 1.0,
    minutes: 0
  };

  function setSleepTimer(minutes) {
    if (sleepTimerState.timerId) {
      clearInterval(sleepTimerState.timerId);
      sleepTimerState.timerId = null;
    }

    var audio = getAudioEl();
    if (audio && sleepTimerState.active && audio.volume === 0) {
      audio.volume = sleepTimerState.originalVolume || 1.0;
    }

    if (!minutes || minutes <= 0) {
      sleepTimerState.active = false;
      sleepTimerState.minutes = 0;
      sleepTimerState.targetTimestamp = 0;
      updateSleepBadge(false, 0);
      chrome.storage.local.set({ zv_sleep_timer: { active: false, remainingSec: 0 } });
      return;
    }

    if (audio) {
      sleepTimerState.originalVolume = audio.volume;
    }

    sleepTimerState.active = true;
    sleepTimerState.minutes = minutes;
    sleepTimerState.targetTimestamp = Date.now() + (minutes * 60 * 1000);

    sleepTimerState.timerId = setInterval(function () {
      var now = Date.now();
      var remainingMs = sleepTimerState.targetTimestamp - now;
      var remainingSec = Math.max(0, Math.round(remainingMs / 1000));

      updateSleepBadge(true, remainingSec);
      chrome.storage.local.set({ zv_sleep_timer: { active: true, remainingSec: remainingSec, target: sleepTimerState.targetTimestamp } });

      var curAudio = getAudioEl();
      // Плавное затухание в последние 15 секунд
      if (curAudio && remainingSec <= 15 && remainingSec > 0) {
        var fadeRatio = remainingSec / 15;
        curAudio.volume = Math.max(0, (sleepTimerState.originalVolume || 1.0) * fadeRatio);
      }

      if (remainingMs <= 0) {
        clearInterval(sleepTimerState.timerId);
        sleepTimerState.timerId = null;
        sleepTimerState.active = false;

        if (curAudio) {
          curAudio.pause();
          curAudio.volume = sleepTimerState.originalVolume || 1.0;
        }

        updateSleepBadge(false, 0);
        chrome.storage.local.set({ zv_sleep_timer: { active: false, remainingSec: 0 } });
        showTrackToast({
          title: 'Таймер сна завершён',
          artist: 'Воспроизведение плавно остановлено'
        });
      }
    }, 1000);
  }

  function updateSleepBadge(active, remainingSec) {
    var badge = document.getElementById('zv-sleep-badge-el');
    if (!active) {
      if (badge) badge.remove();
      return;
    }

    var wrap = document.getElementById('ap-header-wrap') || document.getElementById('topbar-table');
    if (!wrap) return;

    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'zv-sleep-badge-el';
      badge.className = 'zv-sleep-badge';
      badge.title = 'Нажмите, чтобы отключить таймер сна';
      badge.addEventListener('click', function () {
        setSleepTimer(0);
      });
      wrap.appendChild(badge);
    }

    var m = Math.floor(remainingSec / 60);
    var s = remainingSec % 60;
    badge.textContent = '💤 ' + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ====================================================================
  // 3. Пакетное скачивание плейлиста (.zip) и экспорт в .m3u
  // ====================================================================
  var CRC_TABLE = (function () {
    var c, t = [];
    for (var n = 0; n < 256; n++) {
      c = n;
      for (var k = 0; k < 8; k++) c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
      t[n] = c;
    }
    return t;
  })();

  function computeCrc32(buf) {
    var crc = 0 ^ (-1);
    for (var i = 0; i < buf.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
    }
    return (crc ^ (-1)) >>> 0;
  }

  // Чистый PKZIP 2.0 (Метод STORE 0)
  function buildZipBlob(files) {
    var parts = [];
    var cdParts = [];
    var offset = 0;

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var nameUtf8 = new TextEncoder().encode(f.name);
      var dataBytes = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      var crc = computeCrc32(dataBytes);
      var size = dataBytes.length;
      var nameLen = nameUtf8.length;

      // Local Header (30 байт + имя)
      var lh = new Uint8Array(30 + nameLen);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8
      dv.setUint16(8, 0, true);      // STORE
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameLen, true);
      dv.setUint16(28, 0, true);
      lh.set(nameUtf8, 30);

      parts.push(lh);
      parts.push(dataBytes);

      // Central Directory Header (46 байт + имя)
      var cdh = new Uint8Array(46 + nameLen);
      var cdv = new DataView(cdh.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, 0, true);
      cdv.setUint16(14, 0, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, size, true);
      cdv.setUint32(24, size, true);
      cdv.setUint16(28, nameLen, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      cdh.set(nameUtf8, 46);

      cdParts.push(cdh);
      offset += lh.length + dataBytes.length;
    }

    var cdOffset = offset;
    var cdSize = 0;
    for (var j = 0; j < cdParts.length; j++) cdSize += cdParts[j].length;

    // End of Central Directory Record (22 байта)
    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(4, 0, true);
    edv.setUint16(6, 0, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, cdSize, true);
    edv.setUint32(16, cdOffset, true);
    edv.setUint16(20, 0, true);

    var allChunks = parts.concat(cdParts, [eocd]);
    return new Blob(allChunks, { type: 'application/zip' });
  }

  // Сбор треков текущего плейлиста
  function getPlaylistTracks() {
    var state = getHuevoAudioState();
    var list = [];

    if (state && Array.isArray(state.playlist) && state.playlist.length > 0) {
      list = state.playlist.map(function (t) {
        return {
          title: (t.title || 'Без названия').trim(),
          artist: (t.artist || 'Неизвестный исполнитель').trim(),
          url: t.url || '',
          duration: t.duration || 0
        };
      }).filter(function (t) { return !!t.url; });
    }

    // Если в state нет, собираем со страницы из DOM
    if (!list || list.length === 0) {
      var rows = document.querySelectorAll('[data-audio-url]');
      rows.forEach(function (row) {
        var url = row.getAttribute('data-audio-url');
        if (!url) return;
        var artEl = row.querySelector('.audio-artist, .hue-aat-artist, b');
        var titEl = row.querySelector('.audio-title, .hue-aat-title');
        var artist = artEl ? artEl.textContent.trim() : 'huEVO';
        var title = titEl ? titEl.textContent.trim() : 'Трек';
        list.push({
          title: title,
          artist: artist,
          url: url,
          duration: 0
        });
      });
    }

    return list;
  }

  // Экспорт плейлиста в файл .m3u
  function exportPlaylistM3u() {
    var tracks = getPlaylistTracks();
    if (!tracks || tracks.length === 0) {
      alert('В текущем плейлисте нет треков для экспорта.');
      return;
    }

    var lines = ['#EXTM3U'];
    tracks.forEach(function (t) {
      lines.push('#EXTINF:' + (t.duration || 0) + ',' + t.artist + ' - ' + t.title);
      lines.push(t.url);
    });

    var blob = new Blob([lines.join('\r\n')], { type: 'audio/x-mpegurl;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'huEVO_Zvuchok_Playlist.m3u';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { a.remove(); }, 100);
  }

  // Пакетное скачивание архива .zip с модальным окном прогресса
  var zipDownloadAbort = false;

  function downloadPlaylistZip() {
    var tracks = getPlaylistTracks();
    if (!tracks || tracks.length === 0) {
      alert('В текущем плейлисте нет треков для скачивания.');
      return;
    }

    zipDownloadAbort = false;

    var oldModal = document.getElementById('zv-zip-modal-overlay');
    if (oldModal) oldModal.remove();

    var overlay = document.createElement('div');
    overlay.id = 'zv-zip-modal-overlay';
    overlay.className = 'zv-modal-overlay';
    overlay.innerHTML = 
      '<div class="zv-progress-modal">' +
        '<div class="zv-progress-title">Скачивание плейлиста (.zip)</div>' +
        '<div class="zv-progress-sub" id="zv-prog-sub">Подготовка загрузки...</div>' +
        '<div class="zv-progress-bar-bg">' +
          '<div class="zv-progress-bar-fill" id="zv-prog-fill" style="width: 0%;"></div>' +
        '</div>' +
        '<div class="zv-progress-footer">' +
          '<span class="zv-progress-count" id="zv-prog-count">0 / ' + tracks.length + '</span>' +
          '<button class="zv-btn-action" id="zv-prog-cancel">Отмена</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('zv-prog-cancel').addEventListener('click', function () {
      zipDownloadAbort = true;
      overlay.remove();
    });

    var downloadedFiles = [];
    var currentIdx = 0;

    function processNext() {
      if (zipDownloadAbort) return;

      if (currentIdx >= tracks.length) {
        var subEl = document.getElementById('zv-prog-sub');
        if (subEl) subEl.textContent = 'Упаковка ZIP-архива...';

        setTimeout(function () {
          var zipBlob = buildZipBlob(downloadedFiles);
          var a = document.createElement('a');
          a.href = URL.createObjectURL(zipBlob);
          a.download = 'huEVO_Zvuchok_Playlist.zip';
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            a.remove();
            overlay.remove();
            showTrackToast({
              title: 'Плейлист скачан',
              artist: tracks.length + ' треков успешно сохранены в ZIP!'
            });
          }, 300);
        }, 100);
        return;
      }

      var track = tracks[currentIdx];
      var safeName = (track.artist + ' - ' + track.title).replace(/[\\/:*?"<>|]+/g, '_') + '.mp3';

      var subEl = document.getElementById('zv-prog-sub');
      var fillEl = document.getElementById('zv-prog-fill');
      var countEl = document.getElementById('zv-prog-count');

      if (subEl) subEl.textContent = 'Скачивание: ' + track.artist + ' — ' + track.title;
      if (countEl) countEl.textContent = (currentIdx + 1) + ' / ' + tracks.length;
      if (fillEl) fillEl.style.width = Math.round(((currentIdx) / tracks.length) * 100) + '%';

      fetch(track.url)
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.arrayBuffer();
        })
        .then(function (buf) {
          downloadedFiles.push({
            name: safeName,
            data: new Uint8Array(buf)
          });
          currentIdx++;
          processNext();
        })
        .catch(function (err) {
          console.warn('[SWAGdev DL] Ошибка скачивания трека: ' + track.title, err);
          currentIdx++;
          processNext();
        });
    }

    processNext();
  }

  // ====================================================================
  // 4. Личная статистика прослушиваний
  // ====================================================================
  var currentListeningTrack = null;
  var listenedSecondsAcc = 0;

  function checkListeningStatsHeartbeat() {
    var audio = getAudioEl();
    if (!audio || audio.paused || audio.ended) return;

    var cur = extractCurrentTrack();
    if (!cur) return;

    var key = cur.artist + ' - ' + cur.title;
    if (!currentListeningTrack || currentListeningTrack.key !== key) {
      flushListenEntry();
      currentListeningTrack = {
        key: key,
        track: cur,
        startTime: Date.now()
      };
      listenedSecondsAcc = 0;
    } else {
      listenedSecondsAcc += 2;
    }
  }

  function flushListenEntry() {
    if (currentListeningTrack && listenedSecondsAcc >= 15) {
      var entry = {
        title: currentListeningTrack.track.title,
        artist: currentListeningTrack.track.artist,
        cover: currentListeningTrack.track.cover,
        duration: currentListeningTrack.track.duration || listenedSecondsAcc,
        seconds: listenedSecondsAcc,
        timestamp: Date.now()
      };
      chrome.runtime.sendMessage({
        type: 'ZV_RECORD_LISTEN',
        entry: entry
      }, function () {});
    }
    listenedSecondsAcc = 0;
  }

  // ====================================================================
  // 5. Встраивание элементов интерфейса на страницу (DSP, кнопки скачивания)
  // ====================================================================
  function injectPlaylistActionButtons() {
    var headerWrap = document.querySelector('.audio-page-player, #ap-header-wrap, .page-header-actions, .audio-actions-wrap');
    if (!headerWrap || document.getElementById('zv-playlist-actions-bar')) return;

    var container = document.createElement('div');
    container.id = 'zv-playlist-actions-bar';
    container.className = 'zv-playlist-actions';
    container.innerHTML = 
      '<button class="zv-btn-action" id="zv-page-btn-zip" title="Скачать все треки плейлиста архивом .zip">' +
        '<svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>' +
        '<span>Скачать .zip</span>' +
      '</button>' +
      '<button class="zv-btn-action" id="zv-page-btn-m3u" title="Экспорт плейлиста в файл .m3u для AIMP/Winamp">' +
        '<svg viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>' +
        '<span>Экспорт .m3u</span>' +
      '</button>';

    headerWrap.appendChild(container);

    document.getElementById('zv-page-btn-zip').addEventListener('click', downloadPlaylistZip);
    document.getElementById('zv-page-btn-m3u').addEventListener('click', exportPlaylistM3u);
  }

  function injectDspButton() {
    var wrap = document.getElementById('ap-header-wrap') || document.getElementById('topbar-table');
    if (!wrap || document.getElementById('zv-dsp-toggle-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'zv-dsp-toggle-btn';
    btn.className = 'zv-dsp-btn';
    btn.title = 'Открыть эквалайзер и DSP панель (SWAGdev)';
    btn.innerHTML = '🎚 DSP';
    btn.addEventListener('click', function () {
      openDspModal();
    });
    wrap.appendChild(btn);
  }

  // Модальное окно DSP на странице huEVO
  function openDspModal() {
    var oldModal = document.getElementById('zv-dsp-modal-overlay');
    if (oldModal) {
      oldModal.remove();
      return;
    }

    initAudioDSP();

    var bands = currentSettings.dspBands || [0,0,0,0,0,0,0,0,0,0];
    var bass = currentSettings.dspBass || 0;
    var reverb = currentSettings.dspReverb || 0;
    var speed = currentSettings.dspSpeed || 1.0;
    var pitch = (currentSettings.dspPitch !== false);

    var overlay = document.createElement('div');
    overlay.id = 'zv-dsp-modal-overlay';
    overlay.className = 'zv-modal-overlay';

    var eqColsHtml = '';
    var labels = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
    for (var i = 0; i < 10; i++) {
      var val = bands[i] || 0;
      eqColsHtml += 
        '<div class="zv-eq-col">' +
          '<span class="zv-eq-val" id="zv-modal-eqv-' + i + '">' + (val > 0 ? '+' : '') + val + '</span>' +
          '<input type="range" class="zv-eq-slider-v" orient="vertical" data-eq-idx="' + i + '" min="-12" max="12" step="1" value="' + val + '">' +
          '<span class="zv-eq-label">' + labels[i] + '</span>' +
        '</div>';
    }

    overlay.innerHTML = 
      '<div class="zv-modal-box">' +
        '<div class="zv-modal-header">' +
          '<span>🎚 SWAGdev Эквалайзер & DSP</span>' +
          '<button class="zv-modal-close" id="zv-modal-close-btn">&times;</button>' +
        '</div>' +
        '<div class="zv-modal-body">' +
          '<div class="zv-presets-row">' +
            '<span style="font-weight:bold; color:#2b587a;">Пресет:</span>' +
            '<select id="zv-modal-preset" class="zv-select">' +
              '<option value="default">По умолчанию (Flat)</option>' +
              '<option value="club">Клубный бас</option>' +
              '<option value="rock">Рок</option>' +
              '<option value="vocal">Вокал</option>' +
              '<option value="hall">Концертный зал</option>' +
              '<option value="lofi">ВК 2007 Lo-Fi</option>' +
              '<option value="custom">Пользовательский</option>' +
            '</select>' +
            '<label style="margin-left:auto; display:flex; align-items:center; gap:5px; font-weight:bold; cursor:pointer;">' +
              '<input type="checkbox" id="zv-modal-dsp-en" ' + (currentSettings.dspEnabled !== false ? 'checked' : '') + '> ' +
              'Включен' +
            '</label>' +
          '</div>' +
          '<div class="zv-eq-grid">' + eqColsHtml + '</div>' +
          '<div class="zv-fx-grid">' +
            '<div class="zv-fx-card">' +
              '<div class="zv-fx-title-row">' +
                '<span class="zv-fx-title">🔊 Bass Boost:</span>' +
                '<span class="zv-fx-val" id="zv-modal-bass-val">+' + bass + ' dB</span>' +
              '</div>' +
              '<input type="range" id="zv-modal-bass" class="zv-fx-slider" min="0" max="15" step="1" value="' + bass + '">' +
            '</div>' +
            '<div class="zv-fx-card">' +
              '<div class="zv-fx-title-row">' +
                '<span class="zv-fx-title">🌌 Реверберация:</span>' +
                '<span class="zv-fx-val" id="zv-modal-reverb-val">' + reverb + '%</span>' +
              '</div>' +
              '<input type="range" id="zv-modal-reverb" class="zv-fx-slider" min="0" max="100" step="5" value="' + reverb + '">' +
            '</div>' +
          '</div>' +
          '<div class="zv-fx-card" style="margin-top:10px;">' +
            '<div class="zv-fx-title-row">' +
              '<span class="zv-fx-title">⚡ Скорость & Pitch:</span>' +
              '<span class="zv-fx-val" id="zv-modal-speed-val">' + speed.toFixed(2) + 'x</span>' +
            '</div>' +
            '<input type="range" id="zv-modal-speed" class="zv-fx-slider" min="0.5" max="2.0" step="0.05" value="' + speed + '">' +
            '<div style="margin-top:6px; display:flex; align-items:center; justify-content:space-between;">' +
              '<label style="display:flex; align-items:center; gap:5px; cursor:pointer; font-size:11px;">' +
                '<input type="checkbox" id="zv-modal-pitch" ' + (pitch ? 'checked' : '') + '> Сохранять тональность (Pitch Preserve)' +
              '</label>' +
            '</div>' +
            '<div class="zv-quick-modes">' +
              '<button class="zv-btn-mode" id="zv-mode-nightcore">⚡ Nightcore (1.28x)</button>' +
              '<button class="zv-btn-mode" id="zv-mode-slowed">🌙 Slowed + Reverb (0.82x)</button>' +
              '<button class="zv-btn-mode" id="zv-mode-normal">🎵 1.0x Норма</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('zv-modal-close-btn').addEventListener('click', function () { overlay.remove(); });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

    // Обработчики ползунков EQ
    function setupModalVerticalSlider(sl, onValueChange) {
      var isDragging = false;
      var min = parseFloat(sl.min) || -12;
      var max = parseFloat(sl.max) || 12;
      var step = parseFloat(sl.step) || 1;

      function updateFromPointer(e) {
        var rect = sl.getBoundingClientRect();
        if (rect.height <= 0) return;
        var ratio = (rect.bottom - e.clientY) / rect.height;
        ratio = Math.max(0, Math.min(1, ratio));
        var steps = Math.round((min + ratio * (max - min) - min) / step);
        var val = min + (steps * step);
        val = Math.max(min, Math.min(max, val));

        if (parseFloat(sl.value) !== val) {
          sl.value = val;
          onValueChange(val);
        }
      }

      sl.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        isDragging = true;
        try { sl.setPointerCapture(e.pointerId); } catch (_) {}
        updateFromPointer(e);
      });

      sl.addEventListener('pointermove', function (e) {
        if (!isDragging) return;
        e.preventDefault();
        updateFromPointer(e);
      });

      function stopDrag(e) {
        if (isDragging) {
          isDragging = false;
          try { sl.releasePointerCapture(e.pointerId); } catch (_) {}
        }
      }

      sl.addEventListener('pointerup', stopDrag);
      sl.addEventListener('pointercancel', stopDrag);

      sl.addEventListener('wheel', function (e) {
        e.preventDefault();
        var cur = parseFloat(sl.value) || 0;
        var delta = e.deltaY < 0 ? step : -step;
        var nextVal = Math.max(min, Math.min(max, cur + delta));
        if (parseFloat(sl.value) !== nextVal) {
          sl.value = nextVal;
          onValueChange(nextVal);
        }
      }, { passive: false });

      sl.addEventListener('dblclick', function (e) {
        e.preventDefault();
        sl.value = 0;
        onValueChange(0);
      });

      sl.addEventListener('input', function () {
        var val = parseFloat(sl.value) || 0;
        onValueChange(val);
      });

      var col = sl.closest('.zv-eq-col');
      if (col) {
        var valEl = col.querySelector('.zv-eq-val');
        if (valEl) {
          valEl.style.cursor = 'pointer';
          valEl.title = 'Клик: сброс на 0 dB';
          valEl.addEventListener('click', function () {
            sl.value = 0;
            onValueChange(0);
          });
        }
        var freqEl = col.querySelector('.zv-eq-label');
        if (freqEl) {
          freqEl.style.cursor = 'pointer';
          freqEl.title = 'Клик: сброс на 0 dB';
          freqEl.addEventListener('click', function () {
            sl.value = 0;
            onValueChange(0);
          });
        }
      }
    }

    var sliders = overlay.querySelectorAll('.zv-eq-slider-v');
    sliders.forEach(function (sl) {
      var idx = parseInt(sl.getAttribute('data-eq-idx'), 10);
      setupModalVerticalSlider(sl, function (v) {
        document.getElementById('zv-modal-eqv-' + idx).textContent = (v > 0 ? '+' : '') + v;
        if (!Array.isArray(currentSettings.dspBands)) currentSettings.dspBands = [0,0,0,0,0,0,0,0,0,0];
        currentSettings.dspBands[idx] = v;
        var pSel = document.getElementById('zv-modal-preset');
        if (pSel) pSel.value = 'custom';
        currentSettings.dspPreset = 'custom';
        applyDspSettings(currentSettings);
        saveDspSettings();
      });
    });

    // Обработчик пресета
    var presetSelect = document.getElementById('zv-modal-preset');
    if (presetSelect) {
      presetSelect.value = currentSettings.dspPreset || 'default';
      presetSelect.addEventListener('change', function () {
        if (presetSelect.value === 'custom') {
          currentSettings.dspPreset = 'custom';
          saveDspSettings();
          return;
        }
        var p = EQ_PRESETS[presetSelect.value];
        if (p) {
          currentSettings.dspPreset = presetSelect.value;
          currentSettings.dspBands = p.bands.slice();
          currentSettings.dspBass = p.bass;
          currentSettings.dspReverb = p.reverb;
          // Обновляем визуальные ползунки
          sliders.forEach(function (sl) {
            var idx = parseInt(sl.getAttribute('data-eq-idx'), 10);
            sl.value = currentSettings.dspBands[idx];
            document.getElementById('zv-modal-eqv-' + idx).textContent = (sl.value > 0 ? '+' : '') + sl.value;
          });
          document.getElementById('zv-modal-bass').value = p.bass;
          document.getElementById('zv-modal-bass-val').textContent = '+' + p.bass + ' dB';
          document.getElementById('zv-modal-reverb').value = p.reverb;
          document.getElementById('zv-modal-reverb-val').textContent = p.reverb + '%';
          applyDspSettings(currentSettings);
          saveDspSettings();
        }
      });
    }

    // Вкл/Выкл
    document.getElementById('zv-modal-dsp-en').addEventListener('change', function (e) {
      currentSettings.dspEnabled = e.target.checked;
      applyDspSettings(currentSettings);
      saveDspSettings();
    });

    // Bass
    document.getElementById('zv-modal-bass').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      currentSettings.dspBass = v;
      document.getElementById('zv-modal-bass-val').textContent = '+' + v + ' dB';
      var pSel = document.getElementById('zv-modal-preset');
      if (pSel) pSel.value = 'custom';
      currentSettings.dspPreset = 'custom';
      applyDspSettings(currentSettings);
      saveDspSettings();
    });

    // Reverb
    document.getElementById('zv-modal-reverb').addEventListener('input', function (e) {
      var v = parseInt(e.target.value, 10);
      currentSettings.dspReverb = v;
      document.getElementById('zv-modal-reverb-val').textContent = v + '%';
      var pSel = document.getElementById('zv-modal-preset');
      if (pSel) pSel.value = 'custom';
      currentSettings.dspPreset = 'custom';
      applyDspSettings(currentSettings);
      saveDspSettings();
    });

    // Speed
    var spSlider = document.getElementById('zv-modal-speed');
    spSlider.addEventListener('input', function (e) {
      var v = parseFloat(e.target.value);
      currentSettings.dspSpeed = v;
      document.getElementById('zv-modal-speed-val').textContent = v.toFixed(2) + 'x';
      applyDspSettings(currentSettings);
      saveDspSettings();
    });

    // Pitch preserve
    document.getElementById('zv-modal-pitch').addEventListener('change', function (e) {
      currentSettings.dspPitch = e.target.checked;
      applyDspSettings(currentSettings);
      saveDspSettings();
    });

    // Быстрые режимы Nightcore / Slowed
    document.getElementById('zv-mode-nightcore').addEventListener('click', function () {
      currentSettings.dspSpeed = 1.28;
      currentSettings.dspPitch = false;
      currentSettings.dspReverb = 10;
      spSlider.value = 1.28;
      document.getElementById('zv-modal-speed-val').textContent = '1.28x';
      document.getElementById('zv-modal-pitch').checked = false;
      document.getElementById('zv-modal-reverb').value = 10;
      document.getElementById('zv-modal-reverb-val').textContent = '10%';
      var pSel = document.getElementById('zv-modal-preset');
      if (pSel) pSel.value = 'custom';
      currentSettings.dspPreset = 'custom';
      applyDspSettings(currentSettings);
      saveDspSettings();
    });

    document.getElementById('zv-mode-slowed').addEventListener('click', function () {
      currentSettings.dspSpeed = 0.82;
      currentSettings.dspPitch = false;
      currentSettings.dspReverb = 35;
      currentSettings.dspBass = Math.max(currentSettings.dspBass || 0, 4);
      spSlider.value = 0.82;
      document.getElementById('zv-modal-speed-val').textContent = '0.82x';
      document.getElementById('zv-modal-pitch').checked = false;
      document.getElementById('zv-modal-reverb').value = 35;
      document.getElementById('zv-modal-reverb-val').textContent = '35%';
      document.getElementById('zv-modal-bass').value = currentSettings.dspBass;
      document.getElementById('zv-modal-bass-val').textContent = '+' + currentSettings.dspBass + ' dB';
      var pSel = document.getElementById('zv-modal-preset');
      if (pSel) pSel.value = 'custom';
      currentSettings.dspPreset = 'custom';
      applyDspSettings(currentSettings);
      saveDspSettings();
    });

    document.getElementById('zv-mode-normal').addEventListener('click', function () {
      currentSettings.dspSpeed = 1.0;
      currentSettings.dspPitch = true;
      currentSettings.dspReverb = 0;
      spSlider.value = 1.0;
      document.getElementById('zv-modal-speed-val').textContent = '1.00x';
      document.getElementById('zv-modal-pitch').checked = true;
      document.getElementById('zv-modal-reverb').value = 0;
      document.getElementById('zv-modal-reverb-val').textContent = '0%';
      var pSel = document.getElementById('zv-modal-preset');
      if (pSel) pSel.value = 'custom';
      currentSettings.dspPreset = 'custom';
      applyDspSettings(currentSettings);
      saveDspSettings();
    });
  }

  function updateOnPageDspModalIfOpen() {
    var overlay = document.getElementById('zv-dsp-modal-overlay');
    if (!overlay) return;

    var enBox = document.getElementById('zv-modal-dsp-en');
    if (enBox) enBox.checked = (currentSettings.dspEnabled !== false);

    var presetSelect = document.getElementById('zv-modal-preset');
    if (presetSelect) presetSelect.value = currentSettings.dspPreset || 'default';

    var bands = Array.isArray(currentSettings.dspBands) ? currentSettings.dspBands : [0,0,0,0,0,0,0,0,0,0];
    var sliders = overlay.querySelectorAll('.zv-eq-slider-v');
    sliders.forEach(function (sl) {
      var idx = parseInt(sl.getAttribute('data-eq-idx'), 10);
      var v = bands[idx] || 0;
      sl.value = v;
      var el = document.getElementById('zv-modal-eqv-' + idx);
      if (el) el.textContent = (v > 0 ? '+' : '') + v;
    });

    var bSlider = document.getElementById('zv-modal-bass');
    if (bSlider) {
      bSlider.value = currentSettings.dspBass || 0;
      var bVal = document.getElementById('zv-modal-bass-val');
      if (bVal) bVal.textContent = '+' + (currentSettings.dspBass || 0) + ' dB';
    }

    var rSlider = document.getElementById('zv-modal-reverb');
    if (rSlider) {
      rSlider.value = currentSettings.dspReverb || 0;
      var rVal = document.getElementById('zv-modal-reverb-val');
      if (rVal) rVal.textContent = (currentSettings.dspReverb || 0) + '%';
    }

    var sSlider = document.getElementById('zv-modal-speed');
    if (sSlider) {
      sSlider.value = currentSettings.dspSpeed || 1.0;
      var sVal = document.getElementById('zv-modal-speed-val');
      if (sVal) sVal.textContent = (currentSettings.dspSpeed || 1.0).toFixed(2) + 'x';
    }

    var pBox = document.getElementById('zv-modal-pitch');
    if (pBox) pBox.checked = (currentSettings.dspPitch !== false);
  }

  function saveDspSettings() {
    chrome.storage.local.set({ zv_settings: currentSettings });
    chrome.runtime.sendMessage({
      type: 'ZV_SAVE_SETTINGS',
      settings: currentSettings
    }, function () {});
  }

  // Применяем твики к странице
  function applyTweaks() {
    if (currentSettings.addDownloadButtons) {
      injectDownloadButtons();
    }
    injectPlaylistActionButtons();
    injectDspButton();
    applyDspSettings(currentSettings);
  }

  // Инъекция кнопок скачивания в список треков Звучка
  function injectDownloadButtons() {
    var rows = document.querySelectorAll('[data-audio-url]:not([data-zv-dl-added])');
    rows.forEach(function (row) {
      var url = row.getAttribute('data-audio-url');
      if (!url) return;

      row.setAttribute('data-zv-dl-added', 'true');
      var btn = document.createElement('a');
      btn.className = 'zv-dl-btn';
      btn.href = url;
      btn.download = '';
      btn.title = 'Скачать аудиозапись (SWAGdev)';
      btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>';
      
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
      });

      var durEl = row.querySelector('.hue-aat-dur, .audio-duration, [data-dur]');
      if (durEl && durEl.parentNode) {
        durEl.parentNode.insertBefore(btn, durEl.nextSibling);
      } else {
        row.appendChild(btn);
      }
    });
  }

  // Индикатор Discord RPC в плеере
  function updateBadge(isPlaying) {
    var wrap = document.getElementById('ap-header-wrap') || document.getElementById('topbar-table');
    if (!wrap) return;

    var badge = document.getElementById('zv-rpc-badge-el');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'zv-rpc-badge-el';
      badge.className = 'zv-rpc-badge';
      badge.innerHTML = '<span class="zv-rpc-dot"></span><span class="zv-rpc-text">Discord RPC</span>';
      wrap.appendChild(badge);
    }

    if (currentSettings.rpcEnabled && isPlaying) {
      badge.classList.add('active');
      badge.style.display = 'inline-flex';
      badge.querySelector('.zv-rpc-text').textContent = 'Discord RPC: В эфире';
    } else if (currentSettings.rpcEnabled) {
      badge.classList.remove('active');
      badge.style.display = 'inline-flex';
      badge.querySelector('.zv-rpc-text').textContent = 'Discord RPC: Пауза';
    } else {
      badge.style.display = 'none';
    }
  }

  // Всплывающее VK-уведомление о смене трека в стиле ВК
  function showTrackToast(track) {
    var oldToast = document.getElementById('zv-toast-notify-el');
    if (oldToast) oldToast.remove();

    var toast = document.createElement('div');
    toast.id = 'zv-toast-notify-el';
    toast.className = 'zv-toast-notify';

    var coverStyle = track.cover ? 'background-image: url(' + track.cover + ');' : '';
    toast.innerHTML = 
      '<div class="zv-toast-cover" style="' + coverStyle + '"></div>' +
      '<div class="zv-toast-body">' +
        '<div class="zv-toast-title">' + (track.title || 'Трек') + '</div>' +
        '<div class="zv-toast-artist">' + (track.artist || 'huEVO Звучок') + '</div>' +
      '</div>';

    document.body.appendChild(toast);

    setTimeout(function () {
      if (toast && toast.parentNode) {
        toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        setTimeout(function () {
          if (toast && toast.parentNode) toast.remove();
        }, 400);
      }
    }, 4500);
  }

  // Обработка сообщений управления из попапа (Play/Pause, DSP, Sleep Timer, Batch DL)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || !msg.type) return;

      var audio = getAudioEl();

      if (msg.type === 'ZV_CMD_TOGGLE') {
        var toggleBtn = document.getElementById('ap-toggle') || document.querySelector('.ap-mini-play') || document.getElementById('mh-play');
        if (toggleBtn) {
          toggleBtn.click();
        } else if (audio) {
          if (audio.paused) {
            initAudioDSP();
            audio.play().catch(function () {});
          } else {
            audio.pause();
          }
        }
        setTimeout(function () { syncTrackState(true); }, 150);
        sendResponse({ ok: true });
      } else if (msg.type === 'ZV_CMD_NEXT') {
        var nextBtn = document.getElementById('ap-next') || document.querySelector('.ap-mini-next');
        if (nextBtn) {
          nextBtn.click();
        } else if (window.AP && window.AP.next) {
          window.AP.next();
        }
        setTimeout(function () { syncTrackState(true); }, 200);
        sendResponse({ ok: true });
      } else if (msg.type === 'ZV_CMD_PREV') {
        var prevBtn = document.getElementById('ap-prev');
        if (prevBtn) {
          prevBtn.click();
        } else if (window.AP && window.AP.prev) {
          window.AP.prev();
        }
        setTimeout(function () { syncTrackState(true); }, 200);
        sendResponse({ ok: true });
      } else if (msg.type === 'ZV_CMD_SEEK') {
        if (audio && typeof msg.time === 'number') {
          audio.currentTime = msg.time;
          setTimeout(function () { syncTrackState(true); }, 100);
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'ZV_CMD_DSP_UPDATE') {
        if (msg.settings) {
          currentSettings = Object.assign(currentSettings, msg.settings);
          initAudioDSP();
          applyDspSettings(currentSettings);
          updateOnPageDspModalIfOpen();
        }
        sendResponse({ ok: true });
      } else if (msg.type === 'ZV_CMD_SLEEP_TIMER') {
        setSleepTimer(msg.minutes);
        sendResponse({ ok: true, active: sleepTimerState.active });
      } else if (msg.type === 'ZV_CMD_DOWNLOAD_ZIP') {
        downloadPlaylistZip();
        sendResponse({ ok: true });
      } else if (msg.type === 'ZV_CMD_EXPORT_M3U') {
        exportPlaylistM3u();
        sendResponse({ ok: true });
      } else if (msg.type === 'ZV_GET_STATE') {
        sendResponse({
          track: extractCurrentTrack(),
          sleepTimer: {
            active: sleepTimerState.active,
            target: sleepTimerState.targetTimestamp,
            minutes: sleepTimerState.minutes
          }
        });
      } else if (msg.type === 'ZV_SETTINGS_UPDATED') {
        if (msg.settings) {
          currentSettings = Object.assign(currentSettings, msg.settings);
          applyTweaks();
          updateOnPageDspModalIfOpen();
        } else {
          loadSettings();
        }
        sendResponse({ ok: true });
      }
      return true;
    });
  }

  // Горячие клавиши (Пробел - Пауза/Плей, Alt+Right - След, Alt+Left - Пред)
  document.addEventListener('keydown', function (e) {
    if (!currentSettings.hotkeysEnabled) return;

    var tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || (e.target && e.target.isContentEditable)) {
      return;
    }

    if (e.code === 'MediaTrackNext' || (e.altKey && e.code === 'ArrowRight')) {
      var nextBtn = document.getElementById('ap-next') || document.querySelector('.ap-mini-next');
      if (nextBtn) { e.preventDefault(); nextBtn.click(); }
    } else if (e.code === 'MediaTrackPrevious' || (e.altKey && e.code === 'ArrowLeft')) {
      var prevBtn = document.getElementById('ap-prev');
      if (prevBtn) { e.preventDefault(); prevBtn.click(); }
    } else if (e.code === 'MediaPlayPause') {
      var toggleBtn = document.getElementById('ap-toggle') || document.querySelector('.ap-mini-play');
      if (toggleBtn) { e.preventDefault(); toggleBtn.click(); }
    }
  });

  // Прикрепляем слушатели к audio элементу
  function attachAudioListeners() {
    var audio = getAudioEl();
    if (!audio || audio._zvAttached) return;

    audio._zvAttached = true;

    // Авто-инициализация DSP при начале воспроизведения
    audio.addEventListener('play', function () {
      initAudioDSP();
      applyDspSettings(currentSettings);
    });

    ['play', 'pause', 'ended', 'loadedmetadata'].forEach(function (ev) {
      audio.addEventListener(ev, function () {
        syncTrackState(false);
      });
    });

    audio.addEventListener('seeked', function () {
      syncTrackState(true);
    });
  }

  // Наблюдатель за изменениями DOM (динамическая загрузка музыки huEVO)
  var observer = new MutationObserver(function () {
    attachAudioListeners();
    applyTweaks();
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  // Инициализация
  loadSettings();
  attachAudioListeners();
  syncTrackState(false);

  // Периодическая сверка состояния и трекинг времени для личной статистики (каждые 2 сек)
  setInterval(function () {
    attachAudioListeners();
    syncTrackState(false);
    checkListeningStatsHeartbeat();
  }, 2000);

  // Слушаем события storage только если текущая вкладка активно воспроизводит звук
  window.addEventListener('storage', function (e) {
    if (e.key === 'huevo_audio_state') {
      var audio = getAudioEl();
      if (audio && !audio.paused && !audio.ended) {
        syncTrackState(false);
      }
    }
  });



  console.log('[SWAGdev ZVUCHOKtweaker] Content script активирован для Звучка!');
})();
