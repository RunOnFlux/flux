import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'node-manifest.json'), 'utf-8'));
const NODE_COUNT = manifest.nodes.length;

const lines = [];
const w = (s = '') => lines.push(s);

w('name: flux-e2e');
w();
w('networks:');
w('  flux-test-net:');
w('    driver: bridge');
w('    ipam:');
w('      config:');
w('        - subnet: 198.18.0.0/16');
w();
w('volumes:');
w('  mongo-data:');
for (let i = 1; i <= NODE_COUNT; i++) {
  w(`  dind-${String(i).padStart(2, '0')}-data:`);
}
w();
w('services:');

// MongoDB
w('  mongodb:');
w('    image: mongo:7');
w('    networks:');
w('      flux-test-net:');
w('        ipv4_address: 198.18.0.2');
w('    volumes:');
w('      - mongo-data:/data/db');
w('    healthcheck:');
w('      test: ["CMD", "mongosh", "--eval", "db.adminCommand(\'ping\')"]');
w('      interval: 5s');
w('      timeout: 5s');
w('      retries: 5');
w();

// Daemon stub
w('  daemon-stub:');
w('    build: ./daemon-stub');
w('    networks:');
w('      flux-test-net:');
w('        ipv4_address: 198.18.0.3');
w('    environment:');
w('      FLUXD_PORT: "16124"');
w('      BENCHD_PORT: "16224"');
w('      CONTROL_PORT: "18232"');
w('    volumes:');
w('      - ./fixtures:/fixtures');
w('    healthcheck:');
w('      test: ["CMD", "node", "-e", "require(\'http\').get(\'http://localhost:18232/state\', r => { r.on(\'data\', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"]');
w('      interval: 5s');
w('      timeout: 5s');
w('      retries: 5');
w();

// Syncthing stub
w('  syncthing-stub:');
w('    build: ./syncthing-stub');
w('    networks:');
w('      flux-test-net:');
w('        ipv4_address: 198.18.0.4');
w('    environment:');
w('      SYNCTHING_PORT: "8384"');
w('      CONTROL_PORT: "8385"');
w('    healthcheck:');
w('      test: ["CMD", "node", "-e", "require(\'http\').get(\'http://localhost:8384/rest/noauth/health\', r => { r.on(\'data\', () => {}); r.statusCode === 200 ? process.exit(0) : process.exit(1) })"]');
w('      interval: 5s');
w('      timeout: 5s');
w('      retries: 5');
w();

// Nodes
for (let i = 0; i < NODE_COUNT; i++) {
  const num = String(i + 1).padStart(2, '0');
  const node = manifest.nodes[i];
  const nodeIp = `198.18.${i + 1}.0`;
  const dindIp = `198.18.${i + 1}.1`;

  // DinD sidecar
  w(`  dind-${num}:`);
  w('    image: docker:27-dind');
  w('    privileged: true');
  w('    environment:');
  w('      DOCKER_TLS_CERTDIR: ""');
  w('    networks:');
  w('      flux-test-net:');
  w(`        ipv4_address: ${dindIp}`);
  w('    volumes:');
  w(`      - dind-${num}-data:/var/lib/docker`);
  w('    healthcheck:');
  w('      test: ["CMD", "docker", "info"]');
  w('      interval: 3s');
  w('      timeout: 3s');
  w('      retries: 10');
  w();

  // FluxOS node
  w(`  fluxos-${num}:`);
  w('    build:');
  w('      context: ..');
  w('      dockerfile: test-infra/Dockerfile.fluxos');
  w('    cap_add:');
  w('      - NET_ADMIN');
  w('    networks:');
  w('      flux-test-net:');
  w(`        ipv4_address: ${nodeIp}`);
  w('    environment:');
  w('      # Arcane OS');
  w('      FLUX_LOG_CONSOLE: "1"');
  w('      FLUXOS_PATH: "/flux"');
  w('      FLUXD_PATH: "/dat/var/lib/fluxd"');
  w(`      FLUXD_CONFIG_PATH: "/flux/test-infra/fixtures/conf/flux-${num}.conf"`);
  w('      SYNCTHING_PATH: "/dat/usr/lib/syncthing"');
  w('      FLUXBENCH_PATH: "/dat/usr/lib/fluxbenchd"');
  w('      FLUX_WATCHDOG_PATH: "/dat/usr/lib/fluxwatchdog"');
  w('      FLUX_APPS_FOLDER: "/dat/var/lib/fluxos/flux-apps"');
  w('      # Database');
  w(`      FLUX_DB_PREFIX: "node${num}_"`);
  w('      FLUX_DB_HOST: "198.18.0.2"');
  w('      FLUX_DB_PORT: "27017"');
  w('      # Docker');
  w(`      DOCKER_HOST: "http://${dindIp}:2375"`);
  w('      # Services');
  w('      FLUX_DAEMON_HOST: "198.18.0.3"');
  w('      FLUX_BENCH_HOST: "198.18.0.3"');
  w('      FLUX_SYNCTHING_HOST: "198.18.0.4"');
  w('      # Node identity');
  w(`      FLUX_NODE_IP: "${nodeIp}"`);
  w(`      FLUX_ADMIN_ZELID: "${node.zelid}"`);
  w('      FLUX_API_PORT: "16127"');
  w('      # Timing compression');
  w('      FLUX_BOOT_DELAY_MULTIPLIER: "0.1"');
  w('      FLUX_SPAWN_DELAY_MS: "10000"');
  w('      FLUX_INSTALL_COLLISION_WAIT_MS: "5000"');
  w('      FLUX_LOCATION_TTL_S: "300"');
  w('      FLUX_INSTALLING_TTL_S: "60"');
  w('      FLUX_TEMP_MSG_TTL_S: "300"');
  w('      FLUX_HASH_SYNC_INTERVAL_MS: "30000"');
  w('      FLUX_PEER_NOTIFY_INTERVAL_MS: "30000"');
  w('      FLUX_CPU_CHECK_INTERVAL_MS: "30000"');
  w('      FLUX_PORT_RESTORE_INTERVAL_MS: "30000"');
  w('      FLUX_IMAGE_COMPLIANCE_INTERVAL_MS: "60000"');
  w('      FLUX_FORCE_REMOVAL_INTERVAL_MS: "120000"');
  w('      FLUX_REMOVAL_SPACING_MS: "1000"');
  w('    depends_on:');
  w('      mongodb:');
  w('        condition: service_healthy');
  w('      daemon-stub:');
  w('        condition: service_healthy');
  w('      syncthing-stub:');
  w('        condition: service_healthy');
  w(`      dind-${num}:`);
  w('        condition: service_healthy');
  w();
}

const output = lines.join('\n');
writeFileSync(join(__dirname, 'docker-compose.yml'), output);
console.log(`Generated docker-compose.yml with ${NODE_COUNT} nodes (${NODE_COUNT * 2 + 3} containers)`);
