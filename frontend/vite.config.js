import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // strictPort: nếu 5173 bận thì Vite BÁO LỖI và dừng, thay vì lặng lẽ nhảy sang 5174.
    // Nhờ vậy app luôn ở đúng 1 cổng — bạn xem và Claude kiểm chứng cùng một chỗ.
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/uploads': 'http://127.0.0.1:8000',
    },
  },
})
