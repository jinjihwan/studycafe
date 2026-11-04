// Small dependency-free, deliberately restricted RFC 6455 TEXT transport.
// No compression, binary messages, or WS extensions; limits incoming frames.
// A maintained ws dependency is preferable for public production deployments,
// but cannot be installed/bundled in this offline build environment.
// Backed by protocol regression tests for its supported features.
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const decoder = new TextDecoder('utf-8', { fatal: true });
const MAX_MESSAGE = 16 * 1024;

export class WebSocketPeer extends EventEmitter {
  constructor(socket, head) {
    super(); this.socket = socket; this.buffer = Buffer.alloc(0); this.fragments = [];
    this.fragmentSize = 0; this.fragmenting = false; this.closed = false; this.closeSent = false;
    this.lastPongAt=Date.now();this.lastPingAt=0;
    socket.on('data', chunk => this.receive(chunk));
    socket.on('error', () => this.finish());
    socket.on('close', () => this.finish());
    socket.on('end', () => this.finish());
    if (head?.length) queueMicrotask(() => this.receive(head));
  }
  send(message) { if (!this.closed) this.frame(1, Buffer.from(JSON.stringify(message))); }
  ping() { if (!this.closed){this.lastPingAt=Date.now();this.frame(9,Buffer.alloc(0));} }
  frame(opcode, payload = Buffer.alloc(0)) {
    if (this.closed || !this.socket.writable) return;
    let header;
    if (payload.length < 126) { header = Buffer.alloc(2); header[1] = payload.length; }
    else if (payload.length < 65536) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(payload.length, 2); }
    else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
    header[0] = 0x80 | opcode;
    if (this.socket.writableLength > 1024 * 1024) { this.close(1009, 'Backpressure'); return; }
    this.socket.write(Buffer.concat([header, payload]));
  }
  receive(chunk) {
    if (this.closed || this.closeSent) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_MESSAGE + 4096) return this.close(1009, 'Message too large');
    while (this.buffer.length >= 2 && !this.closed) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const fin = !!(b0 & 0x80), op = b0 & 15;
      if ((b0 & 0x70) || !(b1 & 0x80)) return this.close(1002, 'Invalid frame');
      let size = b1 & 127, at = 2;
      if (size === 126) { if (this.buffer.length < 4) return; size = this.buffer.readUInt16BE(2); at = 4; }
      if (size === 127) {
        if (this.buffer.length < 10) return;
        const length = this.buffer.readBigUInt64BE(2);
        if (length > BigInt(MAX_MESSAGE)) return this.close(1009, 'Too large');
        size = Number(length); at = 10;
      }
      if (size > MAX_MESSAGE || this.fragmentSize + size > MAX_MESSAGE) return this.close(1009, 'Too large');
      if (this.buffer.length < at + 4 + size) return;
      const mask = this.buffer.subarray(at, at + 4), payload = Buffer.from(this.buffer.subarray(at + 4, at + 4 + size));
      this.buffer = this.buffer.subarray(at + 4 + size);
      for (let i = 0; i < size; i++) payload[i] ^= mask[i & 3];
      if (op >= 8) {
        if (!fin || size > 125) return this.close(1002, 'Control frame');
        if (op === 8) {
          if (size === 1) return this.close(1002, 'Invalid close');
          if (!this.closeSent) { this.closeSent = true; this.frame(8, payload); }
          this.socket.end(); this.finish(); return;
        }
        if (op === 9) this.frame(10, payload);
        if (op === 10) this.lastPongAt=Date.now();
        else if (op !== 9) return this.close(1002, 'Unknown opcode');
        continue;
      }
      if (op === 1) {
        if (this.fragmenting) return this.close(1002, 'Unexpected text');
        this.fragments = [payload]; this.fragmentSize = size; this.fragmenting = !fin;
      } else if (op === 0 && this.fragmenting) {
        this.fragments.push(payload); this.fragmentSize += size; this.fragmenting = !fin;
      } else return this.close(1003, 'Text only');
      if (fin) {
        try { this.emit('message', decoder.decode(Buffer.concat(this.fragments))); }
        catch { this.close(1007, 'Bad UTF-8'); }
        this.fragments = []; this.fragmentSize = 0;
      }
    }
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    if (!this.closeSent) {
      this.closeSent = true;
      const body = Buffer.from(reason.slice(0, 80));
      const data = Buffer.alloc(2 + body.length); data.writeUInt16BE(code, 0); body.copy(data, 2);
      this.frame(8, data);
    }
    this.socket.end();
    // Destroy stuck sockets after a short close handshake.
    const kill = setTimeout(() => this.socket.destroy(), 1200); kill.unref();
  }
  finish() { if (this.closed) return; this.closed = true; this.emit('close'); }
}

export function upgradeWebSocket(req, socket, head, accepted) {
  const key = req.headers['sec-websocket-key'];
  const connectionTokens=(req.headers.connection||'').toLowerCase().split(',').map(v=>v.trim());
  if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket' ||
      !connectionTokens.includes('upgrade') ||
      req.headers['sec-websocket-version'] !== '13' ||
      !/^[A-Za-z0-9+/]{22}==$/.test(key || '') || Buffer.from(key||'','base64').length!==16) {
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = new WebSocketPeer(socket, head);
  accepted(peer);
}
