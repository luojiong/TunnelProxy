import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import enTranslation from './locales/en';
import zhTranslation from './locales/zh';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: enTranslation,
      zh: zhTranslation
    },
    lng: localStorage.getItem('language') || 'zh', // 默认语言
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n; 