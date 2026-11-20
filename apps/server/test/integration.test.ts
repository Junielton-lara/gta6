import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  PROTOCOL_VERSION,
  type Ack,
  type ClientToServerEvents,
  type ControllerInput,
  type ServerToClientEvents,
  type SessionStatus,
  type TvSessionInfo,
} from '@vco/shared';
import { startServer, type RunningServer } from '../src/app';
import { loadConfig } from '../src/config';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: RunningServer;
let url: string;
const clients: Client[] = [];

beforeAll(async () => {
  server = await startServer(loadConfig({ port: 0, host: '127.0.0.1', publicHost: '192.168.0.50' }), {
    apiOnly: true,
  });
  url = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  clients.forEach((c) => c.disconnect());
  await server.close();
});

function client(): Promise<Client> {
  const socket: Client = connect(url, { transports: ['websocket'], reconnection: false, forceNew: true });
  clients.push(socket);
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}

function once<T>(socket: Client, event: keyof ServerToClientEvents, predicate: (v: T) => boolean = () => true) {
  return new Promise<T>((resolve) => {
    const handler = (value: T) => {
      if (!predicate(value)) return;
      socket.off(event, handler as never);
      resolve(value);
    };
    socket.on(event, handler as never);
  });
}

async function tvHello(tv: Client, resume?: { code: string; token: string }) {
  const res = await tv.emitWithAck('tv:hello', {
    protocol: PROTOCOL_VERSION,
    resumeCode: resume?.code,
    resumeToken: resume?.token,
  });
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

describe('TV ↔ controle via Socket.IO', () => {
  let tv: Client;
  let info: TvSessionInfo;

  it('TV cria sessão com QR code apontando para o IP da rede', async () => {
    tv = await client();
    info = await tvHello(tv);
    expect(info.code).toMatch(/^[A-Z]{4}$/);
    expect(info.controllerUrl).toBe(
      `http://192.168.0.50:${server.port}/controller/?code=${info.code}&pin=${info.pin}`,
    );
    expect(info.qrSvg).toContain('<svg');
    expect(info.controllerConnected).toBe(false);
  });


  it('controle com PIN errado é recusado', async () => {
    const phone = await client();
    const wrong = info.pin === '0000' ? '1111' : '0000';
    const res: Ack<unknown> = await phone.emitWithAck('controller:join', {
      protocol: PROTOCOL_VERSION,
      code: info.code,
      pin: wrong,
    });
    expect(res.ok).toBe(false);
    phone.disconnect();
  });

  it('controle entra, envia joystick e a TV recebe em tempo real', async () => {
    const phone = await client();
    const statusOnTv = once<SessionStatus>(tv, 'session:status', (s) => s.controllerConnected);
    const res = await phone.emitWithAck('controller:join', {
      protocol: PROTOCOL_VERSION,
      code: info.code.toLowerCase(),
      pin: info.pin,
    });
    expect(res).toEqual({ ok: true, data: { code: info.code, tvConnected: true } });
    await statusOnTv;

    const received = once<ControllerInput>(tv, 'controller:input');
    const sentAt = performance.now();
    phone.emit('controller:input', { x: 0.7, y: -0.3, buttons: 0, seq: 1 });
    expect(await received).toEqual({ x: 0.7, y: -0.3, buttons: 0, seq: 1 });
    expect(performance.now() - sentAt).toBeLessThan(200);

    const event = once(tv, 'controller:event');
    phone.emit('controller:event', { type: 'action', pressed: true });
    expect(await event).toEqual({ type: 'action', pressed: true });

    const disconnected = once<SessionStatus>(tv, 'session:status', (s) => !s.controllerConnected);
    phone.disconnect();
    await disconnected;
  });

  it('input inválido não chega à TV', async () => {
    const phone = await client();
    await phone.emitWithAck('controller:join', { protocol: PROTOCOL_VERSION, code: info.code, pin: info.pin });
    let got = false;
    tv.on('controller:input', () => (got = true));
    phone.emit('controller:input', { x: 99, y: 0, buttons: 0, seq: 2 } as ControllerInput);
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toBe(false);
    tv.off('controller:input');
    phone.disconnect();
  });

  it('TV que recarrega retoma a mesma sessão com o token', async () => {
    tv.disconnect();
    const reloaded = await client();
    const resumed = await tvHello(reloaded, { code: info.code, token: info.tvToken });
    expect(resumed.code).toBe(info.code);
    expect(resumed.pin).toBe(info.pin);

    const other = await client();
    const fresh = await tvHello(other, { code: info.code, token: 'falso' });
    expect(fresh.code).not.toBe(info.code);
  });

  it('segundo celular assume e o primeiro é avisado', async () => {
    const tv2 = await client();
    const s = await tvHello(tv2);
    const join = { protocol: PROTOCOL_VERSION, code: s.code, pin: s.pin };

    const first = await client();
    await first.emitWithAck('controller:join', join);
    const replaced = once(first, 'controller:replaced');
    const second = await client();
    await second.emitWithAck('controller:join', join);
    await replaced;

    let leaked = false;
    tv2.on('controller:input', (i) => (leaked ||= i.seq === 99));
    first.emit('controller:input', { x: 0, y: 0, buttons: 0, seq: 99 });
    const fromSecond = once<ControllerInput>(tv2, 'controller:input', (i) => i.seq === 100);
    second.emit('controller:input', { x: 0, y: 1, buttons: 0, seq: 100 });
    await fromSecond;
    expect(leaked).toBe(false);
  });
});

describe('URL pública (Vercel + VPS)', () => {
  let httpsServer: RunningServer;
  let httpsUrl: string;
  const httpsClients: Client[] = [];

  beforeAll(async () => {
    httpsServer = await startServer(
      loadConfig({
        port: 0,
        host: '127.0.0.1',
        appUrl: 'https://vice-city-online.vercel.app',
        apiUrl: 'http://187.127.23.89:3020',
        trustProxy: true,
        allowNonLan: true,
        apiOnly: true,
      }),
      { apiOnly: true },
    );
    httpsUrl = `http://127.0.0.1:${httpsServer.port}`;
  });

  afterAll(async () => {
    httpsClients.forEach((c) => c.disconnect());
    await httpsServer.close();
  });

  it('QR code aponta para APP_URL (Vercel), não para o IP da API', async () => {
    const socket: Client = connect(httpsUrl, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    httpsClients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });

    const info = await tvHello(socket);
    expect(info.controllerUrl).toBe(
      `https://vice-city-online.vercel.app/controller/?code=${info.code}&pin=${info.pin}`,
    );
  });
});
