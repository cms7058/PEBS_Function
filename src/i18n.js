import translations from './locales/en.json';
let locale;try{locale=localStorage.getItem('pebs-locale')||'zh'}catch{locale='zh'}
export function getLocale(){return locale}
export function setLocale(value){locale=value==='en'?'en':'zh';try{localStorage.setItem('pebs-locale',locale)}catch{}document.documentElement.lang=locale==='en'?'en':'zh-CN';window.dispatchEvent(new Event('pebs-locale-changed'))}
export function t(value){if(typeof value!=='string'||locale!=='en')return value;if(translations[value])return translations[value];const parts=value.split(' / ');if(parts.length===2&&/[\u3400-\u9fff]/.test(parts[0])&&!/[\u3400-\u9fff]/.test(parts[1]))return parts[1];return value}
export const tx=(zh,en)=>locale==='en'?en:zh;
