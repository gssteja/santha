import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { SERVER_URL, STORE_KEY } from '@/constants/config';
import type { StoreApp } from '@/types';

export async function fetchApps(): Promise<StoreApp[]> {
  const res = await fetch(`${SERVER_URL}/api/apps`, {
    headers: { 'x-api-key': STORE_KEY },
  });
  if (!res.ok) throw new Error(`server ${res.status}`);
  return res.json();
}

export function absoluteUrl(app: StoreApp): string {
  return `${SERVER_URL}${app.url}`;
}

/** Open a PWA-type app in the browser. */
export async function openPwa(app: StoreApp): Promise<void> {
  await Linking.openURL(absoluteUrl(app));
}

export type DownloadProgress = (fraction: number) => void;

/**
 * Download an APK and fire the system installer.
 * User must have granted "install unknown apps" for Santha (Android prompts on first try).
 */
export async function installApk(
  app: StoreApp,
  onProgress?: DownloadProgress
): Promise<void> {
  const target = `${FileSystem.cacheDirectory}${app.id}.apk`;

  // clear any stale copy so size/progress is honest
  const existing = await FileSystem.getInfoAsync(target);
  if (existing.exists) await FileSystem.deleteAsync(target, { idempotent: true });

  const dl = FileSystem.createDownloadResumable(
    absoluteUrl(app),
    target,
    { headers: { 'x-api-key': STORE_KEY } },
    (p) => {
      if (onProgress && p.totalBytesExpectedToWrite > 0) {
        onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
      }
    }
  );

  const result = await dl.downloadAsync();
  if (!result?.uri) throw new Error('download failed');

  // content:// URI via Expo's FileProvider — required for installer to read the file
  const contentUri = await FileSystem.getContentUriAsync(result.uri);

  await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
    data: contentUri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
  });
}
