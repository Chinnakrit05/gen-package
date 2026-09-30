import { createContext, useContext } from 'react'

// ระบบสองภาษา (ไทย/อังกฤษ) — เก็บภาษาปัจจุบันใน context, แปลด้วย t(ไทย, อังกฤษ)
export type Lang = 'th' | 'en'

export const LANG_KEY = 'packit-lang'

export const LangCtx = createContext<Lang>('th')

export function loadLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'th'
  } catch {
    return 'th'
  }
}

// hook คืนฟังก์ชันแปล: t('ข้อความไทย', 'English text') → เลือกตามภาษาปัจจุบัน
export function useT() {
  const lang = useContext(LangCtx)
  return (th: string, en: string) => (lang === 'en' ? en : th)
}

export function useLang() {
  return useContext(LangCtx)
}
