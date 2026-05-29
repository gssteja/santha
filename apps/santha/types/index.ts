export type StoreApp = {
  id: string;
  name: string;
  description: string;
  type: 'apk' | 'pwa';
  /** relative path on server, e.g. /apps/kasrat/app.apk or /apps/foo/ */
  url: string;
  /** bytes, only for apk */
  size: number | null;
};
