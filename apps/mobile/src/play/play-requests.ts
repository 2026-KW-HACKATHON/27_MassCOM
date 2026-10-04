export function createPlayRequests() {
  let load: AbortController | undefined;
  let start: AbortController | undefined;
  return {
    beginLoad(): AbortSignal {
      load?.abort();
      load = new AbortController();
      return load.signal;
    },
    beginStart(): AbortSignal {
      start?.abort();
      start = new AbortController();
      return start.signal;
    },
    dispose(): void {
      load?.abort();
      start?.abort();
    },
  };
}
