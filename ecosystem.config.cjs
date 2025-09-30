const os = require('os');

module.exports = {
  apps: [
    {
      name: 'findernate-backend',
      script: 'src/index.js',
      // OPTIMIZED: Scale based on CPU cores (use 'max' for all cores, or specific number)
      // Production: Use more instances for better load distribution
      // Development: Use fewer instances to save resources
      instances: process.env.PM2_INSTANCES || (process.env.NODE_ENV === 'production' ? 'max' : 2),
      exec_mode: 'cluster',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        PORT: 8000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 10000  // Use Render's PORT
      },

      // OPTIMIZED: Performance optimizations - adjusted for better memory management
      // For production with multiple cores, use less memory per instance
      max_memory_restart: process.env.MAX_MEMORY_RESTART || '1G', // Increased to 1GB per process
      node_args: '--max-old-space-size=1024', // V8 heap size per process - optimized for performance

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

      // OPTIMIZED: Cluster settings for graceful reload and better performance
      kill_timeout: 5000, // Time to wait before force-killing process
      listen_timeout: 5000, // Increased timeout for app initialization
      wait_ready: true, // Wait for app to emit 'ready' signal (use process.send('ready'))

      // OPTIMIZED: Load balancing strategy
      // Note: Socket.IO requires sticky sessions - handled by Redis adapter

      // Health monitoring
      health_check_path: '/health',
      health_check_grace_period: 10000,

      // OPTIMIZED: Advanced PM2 features
      pmx: false,
      automation: false,
      treekill: true,

      // OPTIMIZED: Graceful shutdown for long-running requests
      shutdown_with_message: false,

      // For Socket.IO sticky sessions and process identification
      instance_var: 'INSTANCE_ID',

      // OPTIMIZED: CPU and memory monitoring
      max_memory_restart: process.env.MAX_MEMORY_RESTART || '1G',
      min_uptime: '10s', // Minimum uptime before considering healthy
      max_restarts: 10, // Max restart attempts
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