const path = require("path");

// Run through the current symlink so that a reload picks up the new release
const cwd = process.env.DEPLOY_PATH
  ? path.join(process.env.DEPLOY_PATH, "current")
  : __dirname;

module.exports = {
  apps: [
    {
      name: process.env.APP_NAME || "delivery-tracker",
      script: "dist/index.js",
      cwd,
      exec_mode: "cluster",
      instances: process.env.PM2_INSTANCES || 1,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || 8000,
      },
    },
  ],
};
