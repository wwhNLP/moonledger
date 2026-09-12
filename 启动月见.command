#!/bin/zsh
cd -- "${0:A:h}" || exit 1
printf '月见 · 个人收支账本\n请打开 http://127.0.0.1:4173\n保持此窗口开启；按 Control+C 关闭网站。\n\n'
python3 server.py
