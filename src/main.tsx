import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from '@/app.tsx'
import { maybeShowApiKeyBanner } from '@/gemini-api-banner.ts'

const API_KEY = 'AIzaSyAcFyp4kPrCsUbk0DR9kjmnpxNNcSrMBmY';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

maybeShowApiKeyBanner(API_KEY);