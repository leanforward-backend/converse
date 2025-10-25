import { App } from '@/app.tsx';
import { maybeShowApiKeyBanner } from '@/gemini-api-banner.ts';
import React from 'react';
import ReactDOM from 'react-dom/client';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

maybeShowApiKeyBanner(API_KEY);