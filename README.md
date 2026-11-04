# Delivery Tracker

Delivery and Shipping Tracking Service

> This is a modified fork of [shlee322/delivery-tracker](https://github.com/shlee322/delivery-tracker).
> Changes: removed the Docker, devcontainer, CLA, and funding configuration and `packages/cli`; added deployment to Amazon EC2 with GitHub Actions.

## Usage
### Cloud (Managed Service)
Visit : https://tracker.delivery/docs/try

### Self-Hosted
#### Setting Up the Development Environment
Requires Node.js 20 and pnpm 8.

```bash
pnpm install --frozen-lockfile
pnpm --filter @delivery-tracker/server build-with-deps
pnpm --filter @delivery-tracker/server dev
```

The server listens on `http://localhost:4000`.

#### Deploying Self-Hosted Services
`.github/workflows/deploy.yaml` builds a standalone bundle and deploys it to an Amazon EC2 instance through a GitHub self-hosted runner, using `.github/scripts/deploy.sh`. PM2 runs the server on port 8000 by default. A failed health check rolls back to the previous release. To override the defaults, set the `PORT` and `DEPLOY_PATH` repository variables. The workflow runs on every push to `main` and can also be started manually. It needs no AWS credentials or GitHub secrets.

Set up the instance once, as the `ubuntu` user:

1. Install Node.js 24 and PM2 (`npm install -g pm2`).
2. Register a self-hosted runner for this repository with the label `delivery-tracker` (`./config.sh --labels delivery-tracker`), then install it as a service (`sudo ./svc.sh install ubuntu`, `sudo ./svc.sh start`). `node` and `pm2` must be on `PATH` when you run `config.sh`.
3. Run `pm2 startup` and then the command it prints, so that PM2 restores the server after a reboot.

Releases are stored in `/home/ubuntu/apps/delivery-tracker`, which the first deployment creates.

The deployment fails without changing anything while another process is using its port. Before the first deployment, stop anything else on that port.

Do not expose the server to the internet directly: it has no authentication or rate limiting, so serve it through a load balancer or reverse proxy.

To roll back manually, point `/home/ubuntu/apps/delivery-tracker/current` to an earlier directory in `/home/ubuntu/apps/delivery-tracker/releases` and run `DEPLOY_PATH=/home/ubuntu/apps/delivery-tracker PORT=8000 pm2 startOrReload /home/ubuntu/apps/delivery-tracker/current/ecosystem.config.js --update-env`.

## Additional Information
### License
- Please read the `LICENSE` file.

### Contact
- Please contact `contact@tracker.delivery` for more information.

### Project Structure
- packages/api : GraphQL API
- packages/core : Scraper code
- packages/server : A self-hosted GraphQL HTTP server that uses the execute function from packages/api.

### Request additional carriers
See https://tracker.delivery/request-additional-carrier
