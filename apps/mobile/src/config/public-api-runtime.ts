import { getPublicApiConfig } from './public-api';

export const publicApiConfig = getPublicApiConfig({
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});
