import { networkInterfaces } from 'node:os';

/** Interfaces virtuais que normalmente não são alcançáveis pela TV/celular. */
const VIRTUAL_INTERFACE = /nordlynx|vpn|tun|tap|wsl|vethernet|virtualbox|vmware|hyper-v|docker|loopback|tailscale|zerotier/i;

export function normalizeAddress(address: string | undefined): string {
  if (!address) return '';
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/** Loopback, faixas privadas IPv4 (RFC 1918), link-local e ULA IPv6. */
export function isLocalNetworkAddress(raw: string | undefined): boolean {
  const address = normalizeAddress(raw).toLowerCase();
  if (!address) return false;

  if (address === '::1') return true;
  if (address.includes(':')) {
    return address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd');
  }

  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 127 ||
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

export interface LanAddress {
  address: string;
  interfaceName: string;
  virtual: boolean;
}

export function getLanAddresses(): LanAddress[] {
  const result: LanAddress[] = [];
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (!isLocalNetworkAddress(entry.address) || entry.address.startsWith('169.254.')) continue;
      result.push({ address: entry.address, interfaceName: name, virtual: VIRTUAL_INTERFACE.test(name) });
    }
  }
  // 192.168.x.x de interfaces físicas primeiro: é o caso típico de Wi-Fi doméstico.
  return result.sort((a, b) => score(b) - score(a));
}

function score(lan: LanAddress): number {
  return (lan.virtual ? 0 : 10) + (lan.address.startsWith('192.168.') ? 2 : 0);
}

export function primaryLanAddress(): string | undefined {
  return getLanAddresses()[0]?.address;
}
