/**
 * SWAGdev ZVUCHOKtweaker — Popup Script
 * Логика попапа, живое превью Discord RPC и управление плеером
 * neriusshadow / SWAGdev
 */

(function () {
  'use strict';

  var currentTrack = null;
  var rpcStatus = {};

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

  // Форматирование времени (сек -> М:СС)
  function fmtTime(sec) {
    if (!sec || isNaN(sec) || sec < 0) return '0:00';
    var m = Math.floor(sec / 60);
    var s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Переключение вкладок
  function initTabs() {
    var tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(function (btn) {
      btn.addEventListener('click', function () {
        tabs.forEach(function (t) { t.classList.remove('active'); });
        document.querySelectorAll('.tab-pane').forEach(function (p) { p.classList.remove('active'); });

        btn.classList.add('active');
        var targetId = btn.getAttribute('data-tab');
        var targetPane = document.getElementById(targetId);
        if (targetPane) targetPane.classList.add('active');
      });
    });
  }

  // Режим полного экрана / новой вкладки
  function initFullTabMode() {
    var btn = document.getElementById('btn-open-tab');
    if (!btn) return;

    if (window.location.search.indexOf('tab=1') !== -1) {
      document.body.classList.add('full-tab-mode');
      btn.style.display = 'none';
    }

    btn.addEventListener('click', function () {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?tab=1') });
    });
  }

  // Главная кнопка перехода в раздел Звучок
  function initMainButton() {
    var btn = document.getElementById('btn-open-zvuchok');
    if (!btn) return;

    btn.addEventListener('click', function () {
      chrome.tabs.query({ url: ['*://huevo.su/*', '*://huevo.departament.site/*'] }, function (tabs) {
        if (tabs && tabs.length > 0) {
          var targetTab = tabs[0];
          chrome.tabs.update(targetTab.id, { active: true, url: targetTab.url.replace(/(https?:\/\/[^\/]+).*/, '$1/zvuchok') });
          if (targetTab.windowId) {
            chrome.windows.update(targetTab.windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: 'https://huevo.su/zvuchok' });
        }
      });
    });
  }

  // Обновление интерфейса плеера и превью Discord
  function updateUI(track, rpc, settings, stats) {
    currentTrack = track;
    rpcStatus = rpc || {};
    // НЕ перезаписываем currentSettings поверх пользовательских настроек!

    // 1. Статус в шапке
    var statusDot = document.getElementById('status-dot');
    var statusText = document.getElementById('status-text');
    var statRpc = document.getElementById('stat-rpc-status');
    var statTracks = document.getElementById('stat-tracks-count');
    var statPlayer = document.getElementById('stat-player-state');

    if (stats && typeof stats.tracksPlayed === 'number') {
      statTracks.textContent = stats.tracksPlayed;
    }

    if (rpcStatus.connected) {
      statusDot.className = 'status-dot';
      statusText.textContent = 'RPC в сети';
      statRpc.className = 'stat-num stat-active-text';
      statRpc.textContent = 'В сети';
    } else {
      statusDot.className = 'status-dot waiting';
      statusText.textContent = 'Ожидание';
      statRpc.className = 'stat-num stat-warn';
      statRpc.textContent = 'Ожидание';
    }

    // 2. Карточка плеера
    var titleEl = document.getElementById('player-title');
    var artistEl = document.getElementById('player-artist');
    var coverEl = document.getElementById('player-cover');
    var curTimeEl = document.getElementById('player-cur-time');
    var totalTimeEl = document.getElementById('player-total-time');
    var progressFill = document.getElementById('progress-bar-fill');
    var toggleBtn = document.getElementById('btn-toggle');

    if (track && (track.title || track.artist)) {
      titleEl.textContent = track.title || 'Без названия';
      artistEl.textContent = track.artist || 'huEVO Звучок';
      if (track.cover) {
        coverEl.style.backgroundImage = 'url(' + track.cover + ')';
      } else {
        coverEl.style.backgroundImage = "url('zvuchok_logo.png')";
      }
      curTimeEl.textContent = fmtTime(track.currentTime);
      totalTimeEl.textContent = fmtTime(track.duration);

      var pct = (track.duration > 0) ? Math.min(100, Math.round((track.currentTime / track.duration) * 100)) : 0;
      progressFill.style.width = pct + '%';

      if (track.isPlaying) {
        toggleBtn.textContent = '⏸';
        statPlayer.textContent = 'Играет';
        statPlayer.className = 'stat-num stat-active-text';
      } else {
        toggleBtn.textContent = '▶';
        statPlayer.textContent = 'Пауза';
        statPlayer.className = 'stat-num stat-warn';
      }
    } else {
      titleEl.textContent = 'Ничего не играет';
      artistEl.textContent = 'Включите трек на huevo.su/zvuchok';
      coverEl.style.backgroundImage = "url('zvuchok_logo.png')";
      curTimeEl.textContent = '0:00';
      totalTimeEl.textContent = '0:00';
      progressFill.style.width = '0%';
      toggleBtn.textContent = '▶';
      statPlayer.textContent = 'Стоп';
      statPlayer.className = 'stat-num';
    }

    // 3. Превью Discord Rich Presence (1 в 1 как на фото)
    var dHeading = document.getElementById('discord-preview-heading');
    var dDetails = document.getElementById('discord-details-text');
    var dState = document.getElementById('discord-state-text');
    var dCurTime = document.getElementById('discord-cur-time');
    var dTotalTime = document.getElementById('discord-total-time');
    var dTimelineFill = document.getElementById('discord-timeline-fill');
    var dLargeImg = document.querySelector('.discord-large-img');

    if (track && (track.title || track.artist)) {
      var rawArtist = (track.artist || 'huEVO').trim();
      var cleanArtist = rawArtist.replace(/\s*в\s+huEVO\s+Звучок\s*$/i, '').trim() || 'huEVO';
      var rawTitle = (track.title || 'Без названия').trim();
      var cleanTitle = rawTitle.replace(/\s*в\s+huEVO\s+Звучок\s*$/i, '').trim();

      if (cleanArtist && cleanTitle) {
        var escaped = cleanArtist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        var prefixRegex = new RegExp('^' + escaped + '\\s*[-—–:]\\s*', 'i');
        cleanTitle = cleanTitle.replace(prefixRegex, '').trim();
      }
      if (!cleanTitle) cleanTitle = 'Без названия';

      var lower = cleanArtist.toLowerCase();
      var headerName = (lower === 'huevo' || lower === 'huevo звучок' || lower === 'звучок')
        ? 'huEVO Звучок'
        : (cleanArtist + ' в huEVO Звучок');

      if (dHeading) dHeading.textContent = 'Listening to ' + headerName;
      if (dDetails) dDetails.textContent = cleanTitle;
      if (dState) dState.textContent = cleanArtist;
      if (dCurTime) dCurTime.textContent = fmtTime(track.currentTime);
      if (dTotalTime) dTotalTime.textContent = fmtTime(track.duration);
      if (dTimelineFill) {
        var timelinePct = (track.duration > 0) ? Math.min(100, Math.round((track.currentTime / track.duration) * 100)) : 0;
        dTimelineFill.style.width = timelinePct + '%';
      }
      if (dLargeImg) {
        dLargeImg.src = track.cover ? track.cover : 'zvuchok_logo.png';
      }
    } else {
      if (dHeading) dHeading.textContent = 'Listening to huEVO Звучок';
      if (dDetails) dDetails.textContent = 'Ничего не играет';
      if (dState) dState.textContent = 'huEVO';
      if (dCurTime) dCurTime.textContent = '00:00';
      if (dTotalTime) dTotalTime.textContent = '00:00';
      if (dTimelineFill) dTimelineFill.style.width = '0%';
      if (dLargeImg) dLargeImg.src = 'zvuchok_logo.png';
    }

    // 4. Карточка шлюза Bridge
    var bridgeHeading = document.getElementById('bridge-status-heading');
    var bridgeDesc = document.getElementById('bridge-status-desc');
    var bridgeDot = document.getElementById('bridge-indicator-dot');

    if (rpcStatus.connected) {
      bridgeDot.className = 'bridge-indicator-dot active';
      bridgeHeading.textContent = 'Подключено (' + (rpcStatus.gateway || 'Discord IPC') + ')';
      bridgeDesc.textContent = 'Статус успешно передается в профиль Discord Desktop.';
    } else {
      bridgeDot.className = 'bridge-indicator-dot';
      bridgeHeading.textContent = 'Шлюз не обнаружен';
      bridgeDesc.textContent = rpcStatus.error || 'Запустите start_bridge_mac.command из папки bridge/ или arRPC.';
    }
  }

  // Запрос свежего состояния у background
  function refreshState() {
    chrome.runtime.sendMessage({ type: 'ZV_GET_BACKGROUND_STATE' }, function (res) {
      if (chrome.runtime.lastError || !res) return;
      updateUI(res.track, res.rpc, res.settings, res.stats);
    });
  }

  // Управление кнопками плеера
  function initPlayerControls() {
    var btnToggle = document.getElementById('btn-toggle');
    var btnNext = document.getElementById('btn-next');
    var btnPrev = document.getElementById('btn-prev');
    var progressWrap = document.getElementById('progress-bar-wrap');

    if (btnToggle) {
      btnToggle.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'ZV_CMD_TOGGLE' }, function () {
          setTimeout(refreshState, 200);
        });
      });
    }

    if (btnNext) {
      btnNext.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'ZV_CMD_NEXT' }, function () {
          setTimeout(refreshState, 250);
        });
      });
    }

    if (btnPrev) {
      btnPrev.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'ZV_CMD_PREV' }, function () {
          setTimeout(refreshState, 250);
        });
      });
    }

    // Клик по полосе прогресса (Seek)
    if (progressWrap) {
      progressWrap.addEventListener('click', function (e) {
        if (!currentTrack || !currentTrack.duration) return;
        var rect = progressWrap.getBoundingClientRect();
        var clickX = e.clientX - rect.left;
        var fraction = Math.max(0, Math.min(1, clickX / rect.width));
        var targetTime = Math.round(fraction * currentTrack.duration);

        chrome.runtime.sendMessage({ type: 'ZV_CMD_SEEK', time: targetTime }, function () {
          setTimeout(refreshState, 150);
        });
      });
    }
  }

  // Привязка настроек
  function initSettings() {
    var toggles = {
      'toggle-rpc-enabled': 'rpcEnabled',
      'toggle-show-timestamps': 'showTimestamps',
      'toggle-listen-button': 'showListenButton',
      'toggle-hide-paused': 'hideWhenPaused',
      'toggle-download-btns': 'addDownloadButtons',
      'toggle-track-toast': 'showToast',
      'toggle-hotkeys': 'hotkeysEnabled'
    };

    chrome.storage.local.get(['zv_settings'], function (res) {
      if (res && res.zv_settings) {
        currentSettings = Object.assign(currentSettings, res.zv_settings);
      }

      Object.keys(toggles).forEach(function (id) {
        var el = document.getElementById(id);
        var key = toggles[id];
        if (el) {
          if (typeof currentSettings[key] !== 'undefined') {
            el.checked = !!currentSettings[key];
          }
          el.addEventListener('change', function () {
            currentSettings[key] = el.checked;
            chrome.storage.local.set({ zv_settings: currentSettings });
            chrome.runtime.sendMessage({ type: 'ZV_SAVE_SETTINGS', settings: currentSettings }, function () {
              refreshState();
            });
          });
        }
      });

      var customIdInput = document.getElementById('input-custom-client-id');
      if (customIdInput) {
        if (currentSettings.customClientId) customIdInput.value = currentSettings.customClientId;
        customIdInput.addEventListener('change', function () {
          currentSettings.customClientId = customIdInput.value.trim();
          chrome.storage.local.set({ zv_settings: currentSettings });
          chrome.runtime.sendMessage({ type: 'ZV_SAVE_SETTINGS', settings: currentSettings });
        });
      }
    });

    // Кнопка тестирования Discord RPC
    var testBtn = document.getElementById('btn-test-rpc');
    if (testBtn) {
      testBtn.addEventListener('click', function () {
        testBtn.textContent = 'Отправка...';
        chrome.runtime.sendMessage({ type: 'ZV_TEST_RPC' }, function (res) {
          testBtn.textContent = '🚀 Проверить связь с Discord';
          if (res && res.status && res.status.connected) {
            alert('✓ Discord RPC работает отлично! Статус отправлен в профиль.');
          } else {
            alert('⚠ Discord не ответил. Убедитесь, что запущен Discord Desktop и Bridge (start_bridge_mac.command).');
          }
          refreshState();
        });
      });
    }

    var reloadBtn = document.getElementById('btn-reload-status');
    if (reloadBtn) {
      reloadBtn.addEventListener('click', function () {
        refreshState();
        loadAndRenderStats();
      });
    }
  }

  // ====================================================================
  // DSP & ЭКВАЛАЙЗЕР
  // ====================================================================
  var EQ_PRESETS = {
    default: { name: 'По умолчанию', bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], bass: 0, reverb: 0 },
    club:    { name: 'Клубный бас',  bands: [7, 8, 6, 3, 0, 0, 1, 3, 4, 5], bass: 7, reverb: 5 },
    rock:    { name: 'Рок',          bands: [5, 4, 3, 1, -1, -1, 2, 4, 5, 6], bass: 3, reverb: 8 },
    vocal:   { name: 'Вокал',        bands: [-2, -1, 0, 2, 4, 5, 4, 2, 0, -1], bass: 0, reverb: 15 },
    hall:    { name: 'Концертный зал',bands: [3, 2, 1, 0, 0, 1, 2, 3, 3, 2], bass: 2, reverb: 55 },
    lofi:    { name: 'ВК 2007 Lo-Fi', bands: [4, 5, 2, 0, -2, -3, -1, -4, -6, -8], bass: 5, reverb: 30 }
  };

  function sendDspUpdate() {
    chrome.storage.local.set({ zv_settings: currentSettings });
    chrome.runtime.sendMessage({
      type: 'ZV_CMD_DSP_UPDATE',
      settings: currentSettings
    });
  }

  function initDspControls() {
    var toggleEnabled = document.getElementById('toggle-dsp-enabled');
    var selectPreset = document.getElementById('select-dsp-preset');
    var eqSliders = document.querySelectorAll('.eq-v-slider');
    var sliderBass = document.getElementById('slider-bass-boost');
    var sliderReverb = document.getElementById('slider-reverb');
    var sliderSpeed = document.getElementById('slider-playback-speed');
    var togglePitch = document.getElementById('toggle-pitch-preserve');

    var valBass = document.getElementById('val-bass-boost');
    var valReverb = document.getElementById('val-reverb');
    var valSpeed = document.getElementById('val-playback-speed');

    // Загрузка начальных значений DSP
    chrome.storage.local.get(['zv_settings'], function (res) {
      var s = res.zv_settings || {};
      currentSettings = Object.assign(currentSettings, s);
      if (toggleEnabled) toggleEnabled.checked = (s.dspEnabled !== false);
      if (selectPreset && s.dspPreset) selectPreset.value = s.dspPreset;

      var bands = Array.isArray(s.dspBands) ? s.dspBands : [0,0,0,0,0,0,0,0,0,0];
      eqSliders.forEach(function (sl) {
        var idx = parseInt(sl.getAttribute('data-band'), 10);
        var v = bands[idx] || 0;
        sl.value = v;
        var el = document.getElementById('eqv-' + idx);
        if (el) el.textContent = (v > 0 ? '+' : '') + v;
      });

      if (sliderBass) {
        sliderBass.value = s.dspBass || 0;
        if (valBass) valBass.textContent = '+' + (s.dspBass || 0) + ' dB';
      }

      if (sliderReverb) {
        sliderReverb.value = s.dspReverb || 0;
        if (valReverb) valReverb.textContent = (s.dspReverb || 0) + '%';
      }

      if (sliderSpeed) {
        sliderSpeed.value = s.dspSpeed || 1.0;
        if (valSpeed) valSpeed.textContent = (s.dspSpeed || 1.0).toFixed(2) + 'x';
      }

      if (togglePitch) {
        togglePitch.checked = (s.dspPitch !== false);
      }
    });

    if (toggleEnabled) {
      toggleEnabled.addEventListener('change', function () {
        currentSettings.dspEnabled = toggleEnabled.checked;
        sendDspUpdate();
      });
    }

    if (selectPreset) {
      selectPreset.addEventListener('change', function () {
        if (selectPreset.value === 'custom') {
          currentSettings.dspPreset = 'custom';
          sendDspUpdate();
          return;
        }
        var p = EQ_PRESETS[selectPreset.value];
        if (p) {
          currentSettings.dspPreset = selectPreset.value;
          currentSettings.dspBands = p.bands.slice();
          currentSettings.dspBass = p.bass;
          currentSettings.dspReverb = p.reverb;

          eqSliders.forEach(function (sl) {
            var idx = parseInt(sl.getAttribute('data-band'), 10);
            sl.value = currentSettings.dspBands[idx];
            var el = document.getElementById('eqv-' + idx);
            if (el) el.textContent = (sl.value > 0 ? '+' : '') + sl.value;
          });

          if (sliderBass) sliderBass.value = p.bass;
          if (valBass) valBass.textContent = '+' + p.bass + ' dB';

          if (sliderReverb) sliderReverb.value = p.reverb;
          if (valReverb) valReverb.textContent = p.reverb + '%';

          sendDspUpdate();
        }
      });
    }

    function setupVerticalSlider(sl, onValueChange) {
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

      var col = sl.closest('.eq-band-col');
      if (col) {
        var valEl = col.querySelector('.eq-val-text');
        if (valEl) {
          valEl.style.cursor = 'pointer';
          valEl.title = 'Клик: сброс на 0 dB';
          valEl.addEventListener('click', function () {
            sl.value = 0;
            onValueChange(0);
          });
        }
        var freqEl = col.querySelector('.eq-freq-label');
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

    eqSliders.forEach(function (sl) {
      var idx = parseInt(sl.getAttribute('data-band'), 10);
      setupVerticalSlider(sl, function (v) {
        var el = document.getElementById('eqv-' + idx);
        if (el) el.textContent = (v > 0 ? '+' : '') + v;

        if (!Array.isArray(currentSettings.dspBands)) {
          currentSettings.dspBands = [0,0,0,0,0,0,0,0,0,0];
        }
        currentSettings.dspBands[idx] = v;
        if (selectPreset) selectPreset.value = 'custom';
        currentSettings.dspPreset = 'custom';
        sendDspUpdate();
      });
    });

    if (sliderBass) {
      sliderBass.addEventListener('input', function () {
        var v = parseInt(sliderBass.value, 10);
        if (valBass) valBass.textContent = '+' + v + ' dB';
        currentSettings.dspBass = v;
        if (selectPreset) selectPreset.value = 'custom';
        currentSettings.dspPreset = 'custom';
        sendDspUpdate();
      });
    }

    if (sliderReverb) {
      sliderReverb.addEventListener('input', function () {
        var v = parseInt(sliderReverb.value, 10);
        if (valReverb) valReverb.textContent = v + '%';
        currentSettings.dspReverb = v;
        if (selectPreset) selectPreset.value = 'custom';
        currentSettings.dspPreset = 'custom';
        sendDspUpdate();
      });
    }

    if (sliderSpeed) {
      sliderSpeed.addEventListener('input', function () {
        var v = parseFloat(sliderSpeed.value);
        if (valSpeed) valSpeed.textContent = v.toFixed(2) + 'x';
        currentSettings.dspSpeed = v;
        sendDspUpdate();
      });
    }

    if (togglePitch) {
      togglePitch.addEventListener('change', function () {
        currentSettings.dspPitch = togglePitch.checked;
        sendDspUpdate();
      });
    }

    // Быстрые пресеты Nightcore / Slowed
    var btnNightcore = document.getElementById('btn-mode-nightcore');
    if (btnNightcore) {
      btnNightcore.addEventListener('click', function () {
        currentSettings.dspSpeed = 1.28;
        currentSettings.dspPitch = false;
        currentSettings.dspReverb = 10;
        if (sliderSpeed) sliderSpeed.value = 1.28;
        if (valSpeed) valSpeed.textContent = '1.28x';
        if (togglePitch) togglePitch.checked = false;
        if (sliderReverb) sliderReverb.value = 10;
        if (valReverb) valReverb.textContent = '10%';
        if (selectPreset) selectPreset.value = 'custom';
        currentSettings.dspPreset = 'custom';
        sendDspUpdate();
      });
    }

    var btnSlowed = document.getElementById('btn-mode-slowed');
    if (btnSlowed) {
      btnSlowed.addEventListener('click', function () {
        currentSettings.dspSpeed = 0.82;
        currentSettings.dspPitch = false;
        currentSettings.dspReverb = 35;
        currentSettings.dspBass = Math.max(currentSettings.dspBass || 0, 4);
        if (sliderSpeed) sliderSpeed.value = 0.82;
        if (valSpeed) valSpeed.textContent = '0.82x';
        if (togglePitch) togglePitch.checked = false;
        if (sliderReverb) sliderReverb.value = 35;
        if (valReverb) valReverb.textContent = '35%';
        if (sliderBass) sliderBass.value = currentSettings.dspBass;
        if (valBass) valBass.textContent = '+' + currentSettings.dspBass + ' dB';
        if (selectPreset) selectPreset.value = 'custom';
        currentSettings.dspPreset = 'custom';
        sendDspUpdate();
      });
    }

    var btnNormal = document.getElementById('btn-mode-normal');
    if (btnNormal) {
      btnNormal.addEventListener('click', function () {
        currentSettings.dspSpeed = 1.0;
        currentSettings.dspPitch = true;
        currentSettings.dspReverb = 0;
        if (sliderSpeed) sliderSpeed.value = 1.0;
        if (valSpeed) valSpeed.textContent = '1.00x';
        if (togglePitch) togglePitch.checked = true;
        if (sliderReverb) sliderReverb.value = 0;
        if (valReverb) valReverb.textContent = '0%';
        sendDspUpdate();
      });
    }
  }

  // ====================================================================
  // ТАЙМЕР СНА (Sleep Timer)
  // ====================================================================
  function initSleepTimerControls() {
    var sleepButtons = document.querySelectorAll('.btn-sleep-opt');
    var tickerBox = document.getElementById('sleep-ticker-box');
    var tickerLabel = document.getElementById('sleep-ticker-label');

    sleepButtons.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var min = parseInt(btn.getAttribute('data-min'), 10);
        sleepButtons.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');

        chrome.runtime.sendMessage({
          type: 'ZV_CMD_SLEEP_TIMER',
          minutes: min
        }, function () {
          updateSleepTicker();
        });
      });
    });

    function updateSleepTicker() {
      chrome.storage.local.get(['zv_sleep_timer'], function (res) {
        var st = res.zv_sleep_timer;
        if (st && st.active && st.remainingSec > 0) {
          if (tickerBox) tickerBox.style.display = 'flex';
          var m = Math.floor(st.remainingSec / 60);
          var s = st.remainingSec % 60;
          if (tickerLabel) tickerLabel.textContent = 'Таймер активен: ' + m + ':' + (s < 10 ? '0' : '') + s;
        } else {
          if (tickerBox) tickerBox.style.display = 'none';
        }
      });
    }

    updateSleepTicker();
    setInterval(updateSleepTicker, 1500);
  }

  // ====================================================================
  // ПАКЕТНОЕ СКАЧИВАНИЕ И БЫСТРЫЕ ДЕЙСТВИЯ
  // ====================================================================
  function initPlaylistTools() {
    var btnZip = document.getElementById('btn-popup-dl-zip');
    var btnM3u = document.getElementById('btn-popup-export-m3u');

    var chipDsp = document.getElementById('chip-dsp');
    var chipZip = document.getElementById('chip-zip');
    var chipSleep = document.getElementById('chip-sleep');

    if (btnZip) {
      btnZip.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'ZV_CMD_DOWNLOAD_ZIP' });
      });
    }

    if (btnM3u) {
      btnM3u.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'ZV_CMD_EXPORT_M3U' });
      });
    }

    if (chipZip) {
      chipZip.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'ZV_CMD_DOWNLOAD_ZIP' });
      });
    }

    if (chipDsp) {
      chipDsp.addEventListener('click', function () {
        var dspTabBtn = document.querySelector('[data-tab="tab-dsp"]');
        if (dspTabBtn) dspTabBtn.click();
      });
    }

    if (chipSleep) {
      chipSleep.addEventListener('click', function () {
        chrome.runtime.sendMessage({ type: 'ZV_CMD_SLEEP_TIMER', minutes: 30 });
        var tweaksTabBtn = document.querySelector('[data-tab="tab-tweaks"]');
        if (tweaksTabBtn) tweaksTabBtn.click();
      });
    }
  }

  // ====================================================================
  // ЛИЧНАЯ СТАТИСТИКА ПРОСЛУШИВАНИЙ
  // ====================================================================
  var currentStatsPeriod = 'week';

  function initStatsTab() {
    var periodBtns = document.querySelectorAll('.btn-period');
    periodBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        periodBtns.forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentStatsPeriod = btn.getAttribute('data-period') || 'week';
        loadAndRenderStats();
      });
    });

    var clearBtn = document.getElementById('btn-clear-stats');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (confirm('Очистить всю историю прослушиваний?')) {
          chrome.runtime.sendMessage({ type: 'ZV_CLEAR_LISTEN_STATS' }, function () {
            loadAndRenderStats();
          });
        }
      });
    }

    loadAndRenderStats();
  }

  function loadAndRenderStats() {
    chrome.runtime.sendMessage({ type: 'ZV_GET_LISTEN_STATS' }, function (res) {
      if (chrome.runtime.lastError || !res || !Array.isArray(res.history)) return;
      renderStats(res.history, currentStatsPeriod);
    });
  }

  function renderStats(history, period) {
    var now = Date.now();
    var cutoff = 0;
    if (period === 'week') {
      cutoff = now - (7 * 24 * 60 * 60 * 1000);
    } else if (period === 'month') {
      cutoff = now - (30 * 24 * 60 * 60 * 1000);
    }

    var list = history.filter(function (e) {
      return e && e.timestamp && e.timestamp >= cutoff;
    });

    // 1. Суммарное время и количество
    var totalSec = 0;
    var artistCounts = {};
    var trackCounts = {};

    list.forEach(function (e) {
      var sec = (typeof e.seconds === 'number' && e.seconds > 0) ? e.seconds : (e.duration || 180);
      totalSec += sec;

      var artist = (e.artist || 'Неизвестный').trim();
      artistCounts[artist] = (artistCounts[artist] || 0) + 1;

      var trackKey = artist + ' — ' + (e.title || 'Трек');
      if (!trackCounts[trackKey]) {
        trackCounts[trackKey] = {
          count: 0,
          title: e.title,
          artist: artist,
          cover: e.cover
        };
      }
      trackCounts[trackKey].count++;
    });

    var timeEl = document.getElementById('stat-total-time');
    var tracksEl = document.getElementById('stat-total-tracks');

    if (timeEl) {
      var hrs = Math.floor(totalSec / 3600);
      var mins = Math.floor((totalSec % 3600) / 60);
      if (hrs > 0) {
        timeEl.textContent = hrs + ' ч ' + mins + ' мин';
      } else {
        timeEl.textContent = mins + ' мин';
      }
    }

    if (tracksEl) {
      tracksEl.textContent = list.length;
    }

    // 2. Самый частый трек
    var topTrackKey = Object.keys(trackCounts).sort(function (a, b) {
      return trackCounts[b].count - trackCounts[a].count;
    })[0];

    var tCover = document.getElementById('stat-top-track-cover');
    var tTitle = document.getElementById('stat-top-track-title');
    var tArtist = document.getElementById('stat-top-track-artist');
    var tCount = document.getElementById('stat-top-track-count');

    if (topTrackKey && trackCounts[topTrackKey]) {
      var topTr = trackCounts[topTrackKey];
      if (tTitle) tTitle.textContent = topTr.title || 'Трек';
      if (tArtist) tArtist.textContent = topTr.artist || 'huEVO';
      if (tCount) tCount.textContent = topTr.count + ' раз';
      if (tCover) {
        tCover.style.backgroundImage = topTr.cover ? ('url(' + topTr.cover + ')') : "url('zvuchok_logo.png')";
      }
    } else {
      if (tTitle) tTitle.textContent = 'Пока нет данных';
      if (tArtist) tArtist.textContent = 'Слушайте музыку на huEVO';
      if (tCount) tCount.textContent = '0 раз';
      if (tCover) tCover.style.backgroundImage = "url('zvuchok_logo.png')";
    }

    // 3. Топ-5 любимых исполнителей
    var sortedArtists = Object.keys(artistCounts).sort(function (a, b) {
      return artistCounts[b] - artistCounts[a];
    }).slice(0, 5);

    var maxArtistCount = sortedArtists.length > 0 ? artistCounts[sortedArtists[0]] : 1;
    var artistsListEl = document.getElementById('stat-top-artists-list');

    if (artistsListEl) {
      if (sortedArtists.length === 0) {
        artistsListEl.innerHTML = '<div class="stat-empty-msg">Слушайте треки в Звучке, чтобы собрать статистику!</div>';
      } else {
        var html = '';
        sortedArtists.forEach(function (art, idx) {
          var count = artistCounts[art];
          var pct = Math.min(100, Math.round((count / maxArtistCount) * 100));
          html += 
            '<div class="stat-artist-item">' +
              '<span class="stat-artist-rank">#' + (idx + 1) + '</span>' +
              '<div class="stat-artist-bar-wrap">' +
                '<div class="stat-artist-name-row">' +
                  '<span class="stat-artist-name">' + art + '</span>' +
                  '<span class="stat-artist-count">' + count + ' прослушиваний</span>' +
                '</div>' +
                '<div class="stat-artist-progress-bg">' +
                  '<div class="stat-artist-progress-fill" style="width: ' + pct + '%;"></div>' +
                '</div>' +
              '</div>' +
            '</div>';
        });
        artistsListEl.innerHTML = html;
      }
    }
  }

  // Инициализация при открытии попапа
  document.addEventListener('DOMContentLoaded', function () {
    initTabs();
    initFullTabMode();
    initMainButton();
    initPlayerControls();
    initDspControls();
    initSleepTimerControls();
    initPlaylistTools();
    initStatsTab();
    initSettings();
    refreshState();

    // Автообновление каждую секунду
    setInterval(refreshState, 1000);
  });
})();
