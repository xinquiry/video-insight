#!/bin/sh
set -eu

: "${TBOX_JA_AUTH_COOKIE:?set TBOX_JA_AUTH_COOKIE}"
: "${DRIVE_EXPORT_USERNAME:?set DRIVE_EXPORT_USERNAME}"
: "${DRIVE_EXPORT_PASSWORD:?set DRIVE_EXPORT_PASSWORD}"

yaml_quote() {
  escaped=$(printf '%s' "$1" | sed "s/'/''/g")
  printf "'%s'" "$escaped"
}

config_path=/tmp/tbox-webdav.yaml
umask 077
{
  printf 'Host: 0.0.0.0\n'
  printf 'Port: 65472\n'
  printf 'CacheSize: %s\n' "${TBOX_WEBDAV_CACHE_SIZE:-20971520}"
  printf 'AuthMode: Custom\n'
  printf 'AccessMode: NoDelete\n'
  printf 'Users:\n'
  printf '  - UserName: '
  yaml_quote "$DRIVE_EXPORT_USERNAME"
  printf '\n    PassWord: '
  yaml_quote "$DRIVE_EXPORT_PASSWORD"
  printf '\n    Cookie: '
  yaml_quote "$TBOX_JA_AUTH_COOKIE"
  printf '\n    AccessMode: NoDelete\n'
} > "$config_path"

exec /opt/tbox/TboxWebdav.Server.AspNetCore --config "$config_path"
