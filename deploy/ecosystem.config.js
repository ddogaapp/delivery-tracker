module.exports = {
  apps: [
    {
      name: "delivery-tracker",
      cwd: "/opt/delivery-tracker/current",
      script: "dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: 9000,
      },
    },
  ],
};
