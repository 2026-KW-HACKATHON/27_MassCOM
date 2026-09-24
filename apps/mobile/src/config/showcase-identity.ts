type PublicIdentity = {
  googleWebClientId?: string;
  reownProjectId?: string;
};

/** The installed Android package, not a mutable JS environment flag, selects the identity. */
export function resolveRuntimeIdentity(
  packageId: string | null | undefined,
  extra: unknown,
  existing: PublicIdentity,
): PublicIdentity {
  if (packageId !== 'kr.masscom.wolgye.demo') return existing;

  const value = extra && typeof extra === 'object'
    ? Reflect.get(extra, 'masscomShowcase')
    : undefined;
  const clientId = value && typeof value === 'object'
    ? Reflect.get(value, 'googleWebClientId')
    : undefined;

  return {
    googleWebClientId:
      typeof clientId === 'string' &&
      /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId)
        ? clientId
        : undefined,
    reownProjectId: undefined,
  };
}
