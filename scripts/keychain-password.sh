#!/usr/bin/env bash
# Source from a builder. Never print or persist the retrieved value.

# load_keychain_password <label> <keychain service> <keychain account>
# Sets store_password and key_password (PKCS12: the key password equals the store password).
load_keychain_password() {
  local label="$1" service="$2" account="$3"
  [[ "$-" != *x* ]] || {
    echo "$label Keychain refuses shell tracing" >&2
    return 1
  }
  local retrieved
  retrieved="$(security find-generic-password -s "$service" -a "$account" -w 2>/dev/null)" || {
    echo "$label Keychain item is not available" >&2
    return 1
  }
  [[ -n "$retrieved" ]] || {
    echo "$label Keychain item is empty" >&2
    return 1
  }
  store_password="$retrieved"
  key_password="$retrieved"
  unset retrieved
}
