#!/bin/sh
# 烧录 ESP32-C3 固件。button 角色必须指定设备编码，编码在编译期注入固件：
#
#   class-button/scripts/flash-c3.sh receiver --port /dev/cu.usbmodemXXX
#   class-button/scripts/flash-c3.sh button 1001 --port /dev/cu.usbmodemXXX
#
# button 角色建议额外指定接收器 MAC（单播目标，MAC 层自动重传）：
#
#   class-button/scripts/flash-c3.sh button 1001 90da7288ccc8 --port /dev/cu.usbmodemXXX
#
# 端口可省略（espflash 自动探测）。多板同插时务必显式指定端口。
# 按钮固件冷启动即睡、USB 掉线，烧录前需手动进下载模式：
# 按住 BOOT 不放，点按一下 RST（或重新上电），再松开 BOOT。
set -eu

repo_root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
firmware_dir="$repo_root/class-button/firmware/esp32c3"

role=${1:-}
case "$role" in
  receiver)
    device_id=
    receiver_mac=
    ;;
  button)
    device_id=${2:-}
    case "$device_id" in
      ''|*[!0-9]*)
        echo "usage: $0 receiver [--port <port>] | button <device-id> [receiver-mac] [--port <port>]" >&2
        exit 2
        ;;
    esac
    shift
    receiver_mac=${1:-}
    case "$receiver_mac" in
      '')
        echo "WARNING: 未指定 receiver-mac，按钮将回落到广播盲发模式（不可靠，仅调试用）" >&2
        ;;
      [0-9a-fA-F][0-9a-fA-F]:*[0-9a-fA-F][0-9a-fA-F]|[0-9a-fA-F]*[0-9a-fA-F])
        if ! echo "$receiver_mac" | tr -d ':-' | grep -qE '^[0-9a-fA-F]{12}$'; then
          echo "usage: receiver-mac 应为 12 位十六进制（冒号可选），如 90da7288ccc8" >&2
          exit 2
        fi
        receiver_mac=$(echo "$receiver_mac" | tr -d ':-')
        shift
        ;;
      --*)
        receiver_mac=
        ;;
      *)
        echo "usage: receiver-mac 应为 12 位十六进制（冒号可选），如 90da7288ccc8" >&2
        exit 2
        ;;
    esac
    ;;
  *)
    echo "usage: $0 receiver [--port <port>] | button <device-id> [receiver-mac] [--port <port>]" >&2
    exit 2
    ;;
esac
shift

# 见 firmware/esp32c3/README.md：standalone 发行版 python3 无法创建带 pip 的
# venv，会导致 ESP-IDF 安装失败；优先使用系统 Python。
PATH="/usr/bin:$PATH"
export PATH

cd "$firmware_dir"

if [ "$role" = receiver ]; then
  cargo build --release --bin receiver
  exec espflash flash "$@" target/riscv32imc-esp-espidf/release/receiver
fi

# button：编码与接收器 MAC 都编译进固件，因此每套参数一份独立构建目录，互不覆盖。
build_dir="target/device-$device_id"
[ -n "$receiver_mac" ] && build_dir="$build_dir/mcu-$receiver_mac"
export DEVICE_ID="$device_id"
if [ -n "$receiver_mac" ]; then
  export RECEIVER_MAC="$receiver_mac"
fi

CARGO_TARGET_DIR="$firmware_dir/$build_dir" cargo build --release --bin button
exec espflash flash "$@" "$build_dir/riscv32imc-esp-espidf/release/button"
