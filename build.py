#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SWAGdev ZVUCHOKtweaker — Скрипт сборки для Firefox и Chromium
Упаковывает расширение в .zip для Chrome/Edge/Яндекс и .xpi/.zip для Firefox.

Author: neriusshadow / SWAGdev
"""

import os
import shutil
import zipfile
import json

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
BUILD_DIR = os.path.join(ROOT_DIR, 'build')
CHROMIUM_DIR = os.path.join(BUILD_DIR, 'chromium')
FIREFOX_DIR = os.path.join(BUILD_DIR, 'firefox')

FILES_TO_COPY = [
    'manifest.json',
    'secrets.js',
    'background.js',
    'content.js',
    'content.css',
    'popup.html',
    'popup.css',
    'popup.js',
    'zvuchok_logo.png',
]

DIRS_TO_COPY = [
    'icons',
    'bridge',
]

def clean_and_create_dirs():
    print(f"[*] Подготовка каталога сборки: {BUILD_DIR}")
    if os.path.exists(BUILD_DIR):
        shutil.rmtree(BUILD_DIR)
    os.makedirs(CHROMIUM_DIR, exist_ok=True)
    os.makedirs(FIREFOX_DIR, exist_ok=True)

def copy_assets(dest_dir):
    for f in FILES_TO_COPY:
        src = os.path.join(ROOT_DIR, f)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest_dir, f))
        else:
            print(f"[!] Файл не найден: {f}")

    for d in DIRS_TO_COPY:
        src_dir = os.path.join(ROOT_DIR, d)
        if os.path.exists(src_dir):
            shutil.copytree(src_dir, os.path.join(dest_dir, d), dirs_exist_ok=True)
        else:
            print(f"[!] Каталог не найден: {d}")

def create_manifests():
    with open(os.path.join(ROOT_DIR, 'manifest.json'), 'r', encoding='utf-8') as f:
        base_manifest = json.load(f)

    # 1. Манифест Chromium
    chromium_manifest = json.loads(json.dumps(base_manifest))
    if 'browser_specific_settings' in chromium_manifest:
        del chromium_manifest['browser_specific_settings']

    with open(os.path.join(CHROMIUM_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(chromium_manifest, f, ensure_ascii=False, indent=2)
    print("[✓] Создан manifest.json для Chromium")

    # 2. Манифест Firefox (MV3 + gecko ID + background scripts)
    firefox_manifest = json.loads(json.dumps(chromium_manifest))
    firefox_manifest['browser_specific_settings'] = {
        "gecko": {
            "id": "swagdev-zvuchoktweaker@departament.site",
            "strict_min_version": "109.0"
        }
    }
    firefox_manifest['background'] = {
        "scripts": ["secrets.js", "background.js"]
    }

    with open(os.path.join(FIREFOX_DIR, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(firefox_manifest, f, ensure_ascii=False, indent=2)
    print("[✓] Создан manifest.json для Firefox")

def zip_folder(source_dir, output_filename):
    print(f"[*] Архивация {source_dir} -> {output_filename}")
    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(source_dir):
            for file in files:
                if file.endswith('.DS_Store'):
                    continue
                file_path = os.path.join(root, file)
                arcname = os.path.relpath(file_path, source_dir)
                zipf.write(file_path, arcname)

def build():
    clean_and_create_dirs()

    print("\n[*] Копирование исходников в Chromium...")
    copy_assets(CHROMIUM_DIR)

    print("\n[*] Копирование исходников в Firefox...")
    copy_assets(FIREFOX_DIR)

    create_manifests()

    # Сборка архивов
    chrom_zip = os.path.join(ROOT_DIR, 'swagdev-zvuchoktweaker-chromium.zip')
    firefox_zip = os.path.join(ROOT_DIR, 'swagdev-zvuchoktweaker-firefox.zip')
    firefox_xpi = os.path.join(ROOT_DIR, 'swagdev-zvuchoktweaker-firefox.xpi')

    print("\n[*] Создание пакетов...")
    zip_folder(CHROMIUM_DIR, chrom_zip)
    zip_folder(FIREFOX_DIR, firefox_zip)
    shutil.copy2(firefox_zip, firefox_xpi)

    print("\n===========================================================")
    print("[✓] СБОРКА УСПЕШНО ЗАВЕРШЕНА!")
    print(f"  • Chromium ZIP: {os.path.basename(chrom_zip)}")
    print(f"  • Firefox XPI:  {os.path.basename(firefox_xpi)}")
    print(f"  • Firefox ZIP:  {os.path.basename(firefox_zip)}")
    print("===========================================================")

if __name__ == '__main__':
    build()
