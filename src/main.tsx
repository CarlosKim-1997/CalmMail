import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root node missing.');
createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
