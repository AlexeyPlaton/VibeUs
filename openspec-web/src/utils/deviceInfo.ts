export interface DeviceEnvironment {
  os: string;
  browser: string;
  viewport: string;
  screen: string;
  dpr: number;
  isTouch: boolean;
  orientation: 'portrait' | 'landscape';
  url: string;
  lang: string;
  connection?: string;
  userAgent: string;
}

export function getDeviceEnvironment(): DeviceEnvironment {
  if (typeof window === 'undefined') {
    return {
      os: 'Unknown',
      browser: 'Unknown',
      viewport: '0x0',
      screen: '0x0',
      dpr: 1,
      isTouch: false,
      orientation: 'portrait',
      url: '',
      lang: 'en',
      userAgent: ''
    };
  }

  const ua = navigator.userAgent || '';
  
  // Browser Detection
  let browser = 'Unknown Browser';
  if (/Edg\/([0-9.]+)/.test(ua)) {
    browser = `Edge ${RegExp.$1}`;
  } else if (/Chrome\/([0-9.]+)/.test(ua) && !/Edg\//.test(ua)) {
    browser = `Chrome ${RegExp.$1}`;
  } else if (/Version\/([0-9.]+).*Safari/.test(ua)) {
    browser = `Safari ${RegExp.$1}`;
  } else if (/Firefox\/([0-9.]+)/.test(ua)) {
    browser = `Firefox ${RegExp.$1}`;
  } else if (/MSIE|Trident/.test(ua)) {
    browser = 'Internet Explorer';
  }

  // OS & Device Detection
  let os = 'Unknown OS';
  if (/iPhone/i.test(ua)) {
    os = 'iOS (iPhone)';
  } else if (/iPad/i.test(ua)) {
    os = 'iPadOS';
  } else if (/Android/i.test(ua)) {
    os = 'Android';
  } else if (/Macintosh|Mac OS X/i.test(ua)) {
    os = 'macOS';
  } else if (/Windows NT 10.0/i.test(ua)) {
    os = 'Windows 10/11';
  } else if (/Windows/i.test(ua)) {
    os = 'Windows';
  } else if (/Linux/i.test(ua)) {
    os = 'Linux';
  }

  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const screen = typeof window.screen !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : viewport;
  const dpr = window.devicePixelRatio || 1;
  const isTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) || false;
  const orientation: 'portrait' | 'landscape' = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  const lang = navigator.language || 'en';
  const url = window.location.pathname;
  
  const navAny = navigator as any;
  const connection = navAny.connection?.effectiveType || undefined;

  return {
    os,
    browser,
    viewport,
    screen,
    dpr,
    isTouch,
    orientation,
    url,
    lang,
    connection,
    userAgent: ua
  };
}
