import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          const silenceError = (err, req, res) => {
            const silencedCodes = ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'];
            if (silencedCodes.includes(err.code)) {
              if (res && !res.headersSent && typeof res.writeHead === 'function') {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('Backend server offline');
              }
              return true; // handled
            }
            return false;
          };

          const originalOn = proxy.on;
          proxy.on = proxy.addListener = function (event, listener) {
            if (event === 'error') {
              return originalOn.call(this, event, (err, req, res) => {
                if (silenceError(err, req, res)) return;
                listener(err, req, res);
              });
            }
            return originalOn.call(this, event, listener);
          };
        }
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        ws: true,          // enable WebSocket proxying
        configure: (proxy, _options) => {
          const silenceError = (err, req, res) => {
            const silencedCodes = ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EPIPE'];
            return silencedCodes.includes(err.code);
          };

          const originalOn = proxy.on;
          proxy.on = proxy.addListener = function (event, listener) {
            if (event === 'error') {
              return originalOn.call(this, event, (err, req, res) => {
                if (silenceError(err, req, res)) return;
                listener(err, req, res);
              });
            }
            return originalOn.call(this, event, listener);
          };
        }
      },
    }
  }
})
