#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SWAGdev ZVUCHOKtweaker — Discord RPC Bridge
Zero-dependency Python 3 bridge between browser extensions and Discord Desktop Client.

Author: neriusshadow / SWAGdev
"""

import sys
import os
import glob
import json
import time
import socket
import struct
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# Default Client ID (obfuscated by default)
DEFAULT_CLIENT_ID = "1558969019149582399"
BRIDGE_PORT = 6473

class DiscordIPC:
    """Manages connection to the local Discord IPC socket / named pipe."""
    
    def __init__(self, client_id=DEFAULT_CLIENT_ID):
        self.client_id = client_id
        self.sock = None
        self.connected = False
        self.user = None
        self.lock = threading.Lock()
        self.last_activity = None

    def find_socket(self):
        """Finds Discord IPC path across macOS, Linux, and Windows."""
        if sys.platform == 'win32':
            for i in range(10):
                pipe_path = rf'\\.\pipe\discord-ipc-{i}'
                try:
                    # Test opening pipe on Windows
                    with open(pipe_path, 'rb+'):
                        return pipe_path
                except Exception:
                    continue
            return None

        # Unix sockets for macOS / Linux
        candidates = []
        env_dirs = [
            os.environ.get('TMPDIR', ''),
            '/tmp',
            os.environ.get('XDG_RUNTIME_DIR', ''),
            '/var/tmp'
        ]
        for d in env_dirs:
            if d and os.path.isdir(d):
                candidates.extend(glob.glob(os.path.join(d, 'discord-ipc-*')))

        # Sort so lowest index or most recent is first
        candidates = sorted(list(set(candidates)))
        return candidates[0] if candidates else None

    def connect(self):
        with self.lock:
            if self.connected and self.sock:
                return True

            self.close()
            sock_path = self.find_socket()
            if not sock_path:
                return False

            try:
                if sys.platform == 'win32':
                    import io
                    # Windows named pipe connection
                    self.sock = open(sock_path, 'r+b', buffering=0)
                else:
                    self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    self.sock.settimeout(4.0)
                    self.sock.connect(sock_path)

                # Send Handshake (Opcode 0)
                payload = json.dumps({'v': 1, 'client_id': self.client_id}).encode('utf-8')
                self._send_raw(0, payload)
                opcode, resp_bytes = self._recv_raw()
                if opcode == 1: # FRAME
                    data = json.loads(resp_bytes.decode('utf-8'))
                    self.user = data.get('data', {}).get('user', {})
                    self.connected = True
                    print(f"[ZVUCHOK-RPC] Успешно подключено к Discord! Пользователь: {self.user.get('username', 'Unknown')}")
                    return True
            except Exception as e:
                self.close()
                return False
        return False

    def _send_raw(self, opcode, payload_bytes):
        header = struct.pack('<II', opcode, len(payload_bytes))
        if sys.platform == 'win32':
            self.sock.write(header + payload_bytes)
            self.sock.flush()
        else:
            self.sock.sendall(header + payload_bytes)

    def _recv_raw(self):
        if sys.platform == 'win32':
            header = self.sock.read(8)
            if len(header) < 8:
                raise ConnectionResetError("Pipe read failed")
            opcode, length = struct.unpack('<II', header)
            data = self.sock.read(length)
            return opcode, data
        else:
            header = self.sock.recv(8)
            if len(header) < 8:
                raise ConnectionResetError("Socket closed")
            opcode, length = struct.unpack('<II', header)
            chunks = []
            received = 0
            while received < length:
                chunk = self.sock.recv(min(4096, length - received))
                if not chunk:
                    raise ConnectionResetError("Socket stream interrupted")
                chunks.append(chunk)
                received += len(chunk)
            return opcode, b''.join(chunks)

    def set_activity(self, activity):
        with self.lock:
            if not self.connected:
                if not self.connect():
                    return False, "Discord не запущен или недоступен"

            try:
                if isinstance(activity, dict):
                    activity.setdefault('type', 2) # 2 = LISTENING ("Слушает")
                    if 'name' not in activity:
                        if activity.get('state'):
                            clean_state = activity['state'].replace(' в huEVO Звучок', '').strip()
                            activity['name'] = f"{clean_state} в huEVO Звучок" if clean_state else 'huEVO Звучок'
                        elif activity.get('details'):
                            activity['name'] = activity['details']

                cmd = {
                    'cmd': 'SET_ACTIVITY',
                    'args': {
                        'pid': os.getpid(),
                        'activity': activity
                    },
                    'nonce': str(time.time())
                }
                payload = json.dumps(cmd, ensure_ascii=False).encode('utf-8')
                self._send_raw(1, payload)
                opcode, resp = self._recv_raw()
                self.last_activity = activity
                return True, "Статус успешно обновлен"
            except Exception as e:
                self.close()
                return False, f"Ошибка отправки статуса: {e}"

    def clear_activity(self):
        return self.set_activity(None)

    def close(self):
        self.connected = False
        self.user = None
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None


ipc = DiscordIPC()


class BridgeHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/' or self.path.startswith('/status'):
            connected = ipc.connect() if not ipc.connected else True
            body = {
                'ok': True,
                'name': 'SWAGdev ZVUCHOKtweaker RPC Bridge',
                'version': '1.0.0',
                'discordConnected': connected,
                'user': ipc.user,
                'lastActivity': ipc.last_activity
            }
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self._send_cors()
            self.end_headers()
            self.wfile.write(json.dumps(body, ensure_ascii=False).encode('utf-8'))
        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length) if content_length > 0 else b'{}'
        
        try:
            req_json = json.loads(post_data.decode('utf-8'))
        except Exception:
            req_json = {}

        if self.path.startswith('/activity'):
            activity = req_json.get('activity')
            client_id = req_json.get('clientId')
            if client_id and client_id != ipc.client_id:
                ipc.client_id = client_id
                ipc.close()

            success, msg = ipc.set_activity(activity)
            self.send_response(200 if success else 503)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self._send_cors()
            self.end_headers()
            resp = {'ok': success, 'message': msg, 'user': ipc.user}
            self.wfile.write(json.dumps(resp, ensure_ascii=False).encode('utf-8'))

        elif self.path.startswith('/clear'):
            success, msg = ipc.clear_activity()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self._send_cors()
            self.end_headers()
            self.wfile.write(json.dumps({'ok': success, 'message': msg}).encode('utf-8'))

        else:
            self.send_response(404)
            self._send_cors()
            self.end_headers()

    def log_message(self, format, *args):
        # Clean logging
        pass


def run_bridge(port=BRIDGE_PORT):
    server = HTTPServer(('127.0.0.1', port), BridgeHandler)
    banner = f"""
===========================================================
  ____  _      __     ____     ___            
 / ___|| | /| / /__ _/ _  \\___/ _ \\___ __ __  
 \\___ \\| |/ |/ / _ `/ _` / -_) // / -_) \\/ /  
/____/ |__/|__/\\_,_/\\_, /\\__/\\___/\\__/\\_/\\_/   
                   /___/  ZVUCHOKtweaker RPC Bridge v1.0
===========================================================
[✓] Сервер запущен на: http://127.0.0.1:{port}
[✓] Ожидание сигналов воспроизведения от расширения...
[!] Нажмите Ctrl+C для остановки.
"""
    print(banner)
    # Background connection attempt
    threading.Thread(target=ipc.connect, daemon=True).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[!] Остановка bridge сервера...")
        ipc.close()
        server.server_close()

if __name__ == '__main__':
    run_bridge()
