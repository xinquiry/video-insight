#!/bin/sh
# 烧录 ESP32-C3 固件。button 角色必须指定设备编码，编码在编译期注入固件：
#
#   class-button/scripts/flash-c3.sh receiver --port /dev/cu.usbmodemXXX
#   class-button/scripts/flash-c3.sh button 1001 --port /dev/cu.usbmodemXXX
#
# 端口可省略（espflash 自动探测）。多板同插时务必显式指定端口。
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
firmware_dir="$repo_root/class-button/firmware/esp32c3"

role=${1:-}
case "$role" in
  receiver)
    device_id=
    ;;
  button)
    device_id=${2:-}
    case "$device_id" in
      ''|*[!0-9]*)
        echo "usage: $0 button <device-id> [--port <port>]   (device-id 为十进制 u32)" >&2
        exit 2
        ;;
    esac
    shift
    ;;
  *)
    echo "usage: $0 receiver [--port <port>] | button <device-id> [--port <port>]" >&2
    exit 2
    ;;
esac
shift

# 见 firmware/esp32c3/README.md：standalone 发行版 python3 无法创建带 pip 的
# venv，会导致 ESP-IDF 安装失败；优先使用系统 Python。
PATH="/usr/bin:$PATH"
export PATH

target_dir="target/riscv32imc-esp-espidf/release"
if [ -n "$device_id" ]; then
  # 编码编译进固件，因此每个编码一份独立构建目录，互不覆盖。
  target_dir="target/device-$device_id/riscv32imc-esp-espidf/release"
  export DEVICE_ID="$device_id"
  export CARGO_TARGET_DIR="$firmware_dir/target/device-$device_id"
fi

cd "$firmware_dir"
cargo build --release --bin "$role"
exec espflash flash "$@" "$target_dir/$role"
