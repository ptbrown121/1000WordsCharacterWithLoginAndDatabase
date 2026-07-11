import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] }
        },
        {
            name: 'mobile-chromium',
            use: { ...devices['Pixel 7'] }
        }
    ],
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        env: {
            ...process.env,
            VITE_SUPABASE_URL: '',
            VITE_SUPABASE_ANON_KEY: ''
        },
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120000
    }
});
