import { createApp } from 'vue';
import App from './App.vue';
import './styles.css';

function loadTailwindRuntime() {
  if (document.querySelector('script[data-tailwind-runtime]')) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = './tailwindcss.js';
    script.dataset.tailwindRuntime = 'true';
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  });
}

await loadTailwindRuntime();

createApp(App).mount('#app');
