import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

// Compiles .vue files for the component unit tests (rendered with @vue/server-renderer, no DOM).
export default defineConfig({
  plugins: [vue()],
})
