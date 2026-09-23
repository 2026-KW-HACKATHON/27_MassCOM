export function canRenderScreen(name: string, authStatus: string): boolean {
  return name === 'index' || name === 'open'
    || authStatus === 'signedIn' || authStatus === 'demo';
}
