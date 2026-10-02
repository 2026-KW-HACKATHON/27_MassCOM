// expo-secure-store ships no web storage (its web module is `export default {}`), so every one
// of its methods throws "is not a function" in a browser. The web build only ever holds a
// short-lived guest session token (no Google refresh token, no wallet key), so localStorage —
// scoped to the demo-api.masscom.kr/play origin — is an acceptable stand-in. Logout already
// calls deleteItemAsync, so it clears this the same way.
async function getItemAsync(key: string): Promise<string | null> {
  return window.localStorage.getItem(key);
}

async function setItemAsync(key: string, value: string): Promise<void> {
  window.localStorage.setItem(key, value);
}

async function deleteItemAsync(key: string): Promise<void> {
  window.localStorage.removeItem(key);
}

export const platformSecureStore = { getItemAsync, setItemAsync, deleteItemAsync };
