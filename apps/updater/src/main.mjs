import { createUpdater } from './updater.mjs';

const env = process.env;
const required = (k) => {
  const v = env[k];
  if (!v) {
    process.stderr.write(`missing required env ${k}\n`);
    process.exit(1);
  }
  return v;
};

const server = createUpdater({
  token: required('UPDATER_TOKEN'),
  installDir: required('INSTALL_DIR'),
  repo: env.UPDATE_REPO || 'JIRAYUTRPY/automation',
  project: env.COMPOSE_PROJECT || 'automation',
  services: (env.UPDATE_SERVICES || 'web worker').split(/\s+/).filter(Boolean),
  dockerBin: env.DOCKER_BIN || 'docker',
  githubApi: env.GITHUB_API || 'https://api.github.com',
});

const port = Number(env.UPDATER_PORT || 4002);
server.listen(port, '0.0.0.0', () => process.stdout.write(`updater listening on ${port}\n`));
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
