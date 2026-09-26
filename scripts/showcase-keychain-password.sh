#!/usr/bin/env bash
# Source from the showcase builder. Never print or persist the retrieved value.

load_showcase_keychain_password() {
  local retrieved
  retrieved="$(security find-generic-password \
    -s masscom-showcase-upload-keystore -a masscom-showcase-upload -w 2>/dev/null)" || {
    echo 'showcase Keychain item is not available' >&2
    return 1
  }
  [[ -n "$retrieved" ]] || {
    echo 'showcase Keychain item is empty' >&2
    return 1
  }
  store_password="$retrieved"
  key_password="$retrieved"
  unset retrieved
}
