import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Sayseed',
    description: '在 X 自然表达，在网页中积累英文表达',
    permissions: ['storage', 'scripting', 'activeTab'],
    host_permissions: ['http://*/*', 'https://*/*'],
    action: { default_title: 'Sayseed' },
  },
});
