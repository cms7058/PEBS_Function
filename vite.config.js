import {defineConfig} from 'vite';
export default defineConfig({build:{rollupOptions:{input:{main:'index.html',reader:'reader.html'}}},server:{port:5173,strictPort:true,proxy:{'/api':process.env.API_TARGET||'http://127.0.0.1:8787'}}});
