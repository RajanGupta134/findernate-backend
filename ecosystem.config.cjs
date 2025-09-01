module.exports = {
  apps: [
    {
      name: 'findernate-backend',
      script: 'src/index.js',
      instances: 2, // Further reduced for Render 512MB limit
      exec_mode: 'cluster',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 8000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 8000
      },

      // Performance optimizations - adjusted for 512MB limit
      max_memory_restart: '450M', // Reduced from 1G
      node_args: '--max-old-space-size=450', // Reduced from 1024

      // Logs
      log_file: 'logs/combined.log',
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Auto restart configuration
      autorestart: true,
      watch: false, // Set to true for development if you want auto-reload
      max_restarts: 10,
      min_uptime: '10s',

      // Cluster settings
      kill_timeout: 5000,
      listen_timeout: 3000,

      // Health monitoring
      health_check_path: '/health',
      health_check_grace_period: 10000,

      // Advanced PM2 features
      pmx: false,
      automation: false,
      treekill: true,

      // For Socket.IO sticky sessions (if needed)
      instance_var: 'INSTANCE_ID'
    }
  ],

  // Deploy configuration (optional)
  deploy: {
    production: {
      user: 'node',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:your-username/findernate-backend.git',
      path: '/var/www/findernate-backend',
      'pre-deploy-local': '',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': ''
    }
  }
};