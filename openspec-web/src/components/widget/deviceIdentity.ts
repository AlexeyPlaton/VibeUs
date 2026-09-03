export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 'device_' + Math.random().toString(36).substring(2, 15);
  }
  try {
    let id = localStorage.getItem('vibus_device_id');
    if (!id) {
      id = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `dev_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
      localStorage.setItem('vibus_device_id', id);
    }
    return id;
  } catch (e) {
    return 'device_' + Math.random().toString(36).substring(2, 15);
  }
}
