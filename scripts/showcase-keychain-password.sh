#!/usr/bin/env bash
# Source from the showcase builder. Never print or persist the retrieved value.

source "$(dirname "${BASH_SOURCE[0]}")/keychain-password.sh"

load_showcase_keychain_password() {
  load_keychain_password showcase masscom-showcase-upload-keystore masscom-showcase-upload
}
