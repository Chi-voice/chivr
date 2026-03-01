import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import zh from './locales/zh.json';
import fr from './locales/fr.json';
import ru from './locales/ru.json';
import es from './locales/es.json';
import ar from './locales/ar.json';

const resources = {
  en: { translation: en },
  zh: { translation: zh },
  fr: { translation: fr },
  ru: { translation: ru },
  es: { translation: es },
  ar: { translation: ar },
};

const saved = typeof window !== 'undefined' ? localStorage.getItem('lang') : null;
const browser = typeof navigator !== 'undefined' ? navigator.language.split('-')[0] : 'en';
const initialLng = (saved || browser || 'en') as keyof typeof resources;

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLng,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false,
    },
  });

// Persist language and set document attributes
if (typeof window !== 'undefined') {
  const applyDir = (lng: string) => {
    const isRTL = lng === 'ar';
    document.documentElement.lang = lng;
    document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
  };
  applyDir(i18n.language);
  i18n.on('languageChanged', (lng) => {
    try { localStorage.setItem('lang', lng); } catch {}
    applyDir(lng);
  });
}

export default i18n;