#!/bin/sh
# 监视 ESP32-C3 的 USB-Serial-JTAG 串口（按钮固件深睡时端口会消失，
# 醒来后重新枚举，本脚本轮询端口出现即挂上去读，掉线后自动等待重连）。
#
#   class-button/scripts/monitor-c3.sh /dev/cu.usbmodem1101
#
# 按钮睡眠时端口不存在属正常现象；每次按键唤醒会看到
# woke-press / press-sent / press-acked / done -> sleep 一轮日志。
# 注意：脚本挂上端口的瞬间可能触发一次复位，若紧接着看到
# cold-boot -> sleep 属于挂载复位，不是真实按键。
set -eu

port=${1:-}
case "$port" in
  /dev/cu.usbmodem*) ;;
  *)
    echo "usage: $0 /dev/cu.usbmodemXXXX" >&2
    exit 2
    ;;
esac

echo "monitoring $port (waiting for device to enumerate...)"
while true; do
  if [ -e "$port" ]; then
    # cat 打开串口不设置波特率；USB-Serial-JTAG 是 CDC，波特率无意义。
    # 端口因深睡消失时 cat 以错误退出，回到轮询。
    if cat "$port" 2>/dev/null; then
      echo "[monitor] port dropped, waiting for re-enumeration..."
    else
      echo "[monitor] port dropped (read error), waiting for re-enumeration..."
    fi
  fi
  sleep 0.1
done
