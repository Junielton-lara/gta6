/**
 * PM2 — Vice City Online
 *
 * Uso na VPS (a partir da raiz do repositório):
 *   npm ci
 *   npm run build
 *   cp deploy/env.production.example .env   # edite o domínio
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save && pm2 startup
 */
module.exports = {
  apps: [
    {
      name: 'vice-city-online',
      cwd: __dirname + '/..',
      script: 'npm',
      args: 'run start',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 20,
      min_uptime: '5s',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
