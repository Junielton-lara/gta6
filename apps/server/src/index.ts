import { ROUTES } from '@vco/shared';
import { startServer } from './app';
import { loadConfig } from './config';
import { getLanAddresses } from './network';

const config = loadConfig();

try {
  const server = await startServer(config);
  printBanner(server.port);

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
} catch (err) {
  const e = err as NodeJS.ErrnoException;
  if (e.code === 'EADDRINUSE') {
    console.error(`\n✖ A porta ${config.port} já está em uso. Feche o outro processo ou mude PORT no .env.\n`);
  } else {
    console.error(`\n✖ ${e.message}\n`);
  }
  process.exit(1);
}

function printBanner(port: number) {
  const lan = getLanAddresses();
  const physical = lan.filter((l) => !l.virtual);
  const mode = config.production ? 'produção' : 'desenvolvimento';

  console.log(`\n  Vice City Online — servidor (${mode})\n`);
  console.log(`  Neste PC:     http://localhost:${port}${ROUTES.tv}`);
  for (const { address, interfaceName } of physical) {
    console.log(`  TV (${interfaceName}):`.padEnd(16) + `http://${address}:${port}${ROUTES.tv}`);
    console.log(`  Controle:`.padEnd(16) + `http://${address}:${port}${ROUTES.controller}`);
  }
  if (!physical.length) {
    console.log('  ⚠ Nenhuma rede Wi-Fi/Ethernet detectada. Conecte o PC à mesma rede da TV.');
  }
  if (lan.some((l) => l.virtual)) {
    const names = lan.filter((l) => l.virtual).map((l) => l.interfaceName).join(', ');
    console.log(`\n  ⚠ Rede virtual/VPN ativa (${names}). Se a TV não abrir, libere "rede local" na VPN.`);
  }
  if (config.appUrl) console.log(`  Frontend:    ${config.appUrl}`);
  if (config.apiUrl) console.log(`  API pública: ${config.apiUrl}`);
  if (config.publicUrl && config.publicUrl !== config.appUrl) {
    console.log(`  Público:     ${config.publicUrl}`);
  } else if (!config.appUrl && config.publicHost) {
    const proto = config.publicProtocol || 'http';
    console.log(`  Público:     ${proto}://${config.publicHost}`);
  }
  if (config.apiOnly) console.log('  Modo:        API-only (front na Vercel)');
  console.log(config.allowNonLan
    ? '\n  ⚠ ALLOW_NON_LAN=true: conexões de fora da rede local estão liberadas.\n'
    : '\n  🔒 Aceitando apenas conexões da rede local. Controle exige código + PIN.\n');
}
