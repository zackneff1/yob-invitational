/**
 * Device notifications, best effort. The in-app banner is the notification
 * everyone gets; this additionally buzzes the phone when the person has
 * allowed it. There is no push server: the app has to be open (or installed
 * and recently used) for a notification to appear, which is the realistic
 * case during a round anyway.
 */

export type NotifyPermission = NotificationPermission | 'unsupported';

export function notificationPermission(): NotifyPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export async function requestNotifications(): Promise<NotifyPermission> {
  if (typeof Notification === 'undefined') return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export async function showDeviceNotification(title: string, body: string, tag: string): Promise<void> {
  if (notificationPermission() !== 'granted') return;
  const options: NotificationOptions = { body, tag, icon: '/icon-192.png', badge: '/icon-192.png' };
  try {
    // Installed to the home screen (and on iOS at all), notifications must go
    // through the service worker; in a plain tab a page notification works.
    const reg =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch {
    /* best effort only */
  }
}
