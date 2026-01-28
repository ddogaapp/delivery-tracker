module.exports = {
    apps: [
        {
            name: 'delivery-tracker',
            script: './packages/server/dist/index.js',
            instances: 'max',
            exec_mode: 'cluster',
            env: {
                NODE_ENV: 'production',
                PORT: 4000,
            },
        },
    ],
};
