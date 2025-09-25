import { boot } from 'quasar/wrappers';

// 在 PWA 模式下註冊 Service Worker
export default boot(() => {
  if (process.env.MODE === 'pwa') {
    // 動態導入 Service Worker 註冊
    import('../../src-pwa/register-service-worker');
  }
});
