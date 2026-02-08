import { useState, useEffect } from 'react';

interface NativeAppInfo {
  isNative: boolean;
  platform: 'ios' | 'android' | 'web';
  isIOS: boolean;
  isAndroid: boolean;
  isPWA: boolean;
  isCapacitor: boolean;
}

export function useNativeApp(): NativeAppInfo {
  const [appInfo, setAppInfo] = useState<NativeAppInfo>({
    isNative: false,
    platform: 'web',
    isIOS: false,
    isAndroid: false,
    isPWA: false,
    isCapacitor: false,
  });

  useEffect(() => {
    const detectPlatform = async () => {
      // Check for Capacitor
      const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();
      
      // Check for PWA
      const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true;
      
      // Detect platform
      const userAgent = navigator.userAgent.toLowerCase();
      const isIOS = /iphone|ipad|ipod/.test(userAgent) || 
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isAndroid = /android/.test(userAgent);
      
      // Get Capacitor platform if available
      let platform: 'ios' | 'android' | 'web' = 'web';
      if (isCapacitor) {
        const capacitorPlatform = (window as any).Capacitor?.getPlatform?.();
        if (capacitorPlatform === 'ios') platform = 'ios';
        else if (capacitorPlatform === 'android') platform = 'android';
      } else if (isIOS) {
        platform = 'ios';
      } else if (isAndroid) {
        platform = 'android';
      }
      
      const isNative = isCapacitor || isPWA;
      
      // Add body class for native styling
      if (isCapacitor) {
        document.body.classList.add('capacitor');
      }
      if (isIOS) {
        document.body.classList.add('ios');
      }
      if (isAndroid) {
        document.body.classList.add('android');
      }
      if (isPWA) {
        document.body.classList.add('pwa');
      }
      
      setAppInfo({
        isNative,
        platform,
        isIOS,
        isAndroid,
        isPWA,
        isCapacitor,
      });
    };
    
    detectPlatform();
  }, []);
  
  return appInfo;
}
