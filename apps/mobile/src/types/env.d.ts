declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_REOWN_PROJECT_ID?: string;
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_DEMO_ACCOUNT_ID?: string;
    EXPO_PUBLIC_DEMO_MERCHANT_ACCOUNT_ID?: string;
    EXPO_PUBLIC_DEMO_MERCHANT_ID?: string;
    /** QA only: `full` shows every entry point (progressive disclosure off). CI leaves it unset. */
    EXPO_PUBLIC_DISCLOSURE?: string;
  }
}
