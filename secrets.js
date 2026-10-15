/**
 * SWAGdev ZVUCHOKtweaker — Защищенная конфигурация ключей и Discord RPC
 * neriusshadow / SWAGdev
 */

(function (global) {
  'use strict';

  // Зашифрованный Client ID (XOR + Shift + Base64)
  // При компиляции открытый ключ не светится в открытом виде
  var CIPHER_PAYLOAD = 'b3aPoYaDhq2wu7fR0uLi49jQBw==';
  var CIPHER_KEY = 'SWAGdev_ZVUCHOK_huEVO_2016_SECRET';

  function decodeBase64(str) {
    if (typeof atob === 'function') {
      return atob(str);
    }
    // Fallback для окружений без atob (Node/Worker)
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    var output = '';
    var chr1, chr2, chr3;
    var enc1, enc2, enc3, enc4;
    var i = 0;
    str = str.replace(/[^A-Za-z0-9\+\/\=]/g, '');
    while (i < str.length) {
      enc1 = chars.indexOf(str.charAt(i++));
      enc2 = chars.indexOf(str.charAt(i++));
      enc3 = chars.indexOf(str.charAt(i++));
      enc4 = chars.indexOf(str.charAt(i++));
      chr1 = (enc1 << 2) | (enc2 >> 4);
      chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      chr3 = ((enc3 & 3) << 6) | enc4;
      output += String.fromCharCode(chr1);
      if (enc3 !== 64) output += String.fromCharCode(chr2);
      if (enc4 !== 64) output += String.fromCharCode(chr3);
    }
    return output;
  }

  function resolveDefaultClientId() {
    try {
      var raw = decodeBase64(CIPHER_PAYLOAD);
      var chars = [];
      for (var i = 0; i < raw.length; i++) {
        var byteVal = raw.charCodeAt(i);
        var keyChar = CIPHER_KEY.charCodeAt(i % CIPHER_KEY.length);
        var origXor = (byteVal - 13 - i * 7 + 256 * 10) % 256;
        var origChar = String.fromCharCode(origXor ^ keyChar);
        chars.push(origChar);
      }
      return chars.join('');
    } catch (e) {
      console.error('[ZVUCHOKtweaker] Error resolving client ID:', e);
      return '';
    }
  }

  var ZvuchokSecrets = {
    getDefaultClientId: function () {
      return resolveDefaultClientId();
    },
    ASSET_PLACEHOLDER: 'zvuchok_logo',
    ASSET_TEXT: 'huEVO Звучок',
    DEFAULT_BRIDGE_PORT: 6473,
    DEFAULT_ARRPC_PORT: 1337
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ZvuchokSecrets;
  } else {
    global.ZvuchokSecrets = ZvuchokSecrets;
  }
})(typeof self !== 'undefined' ? self : this);
