import type { QueuedAdmission } from './offlineScanner';
import { db } from './supabase';

type Signal = { version: 1; sessionId: string; description: RTCSessionDescriptionInit };
type PeerMessage = { type: 'admission'; admission: QueuedAdmission };
type AutoSignal = { type: 'hello' | 'offer' | 'answer'; from: string; to?: string; signal?: Signal };
export type PeerState = 'idle' | 'pairing' | 'connected' | 'failed';

const encode = (value: Signal) => btoa(unescape(encodeURIComponent(JSON.stringify(value)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const decode = (code: string): Signal => {
  const padded = code.trim().replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - code.trim().length % 4) % 4);
  const value = JSON.parse(decodeURIComponent(escape(atob(padded))));
  if (value?.version !== 1 || typeof value.sessionId !== 'string' || !value.description?.type || !value.description?.sdp) throw new Error('That pairing code is not valid.');
  return value;
};

async function waitForIceComplete(connection: RTCPeerConnection) {
  if (connection.iceGatheringState === 'complete') return;
  await new Promise<void>(resolve => {
    const done = () => { if (connection.iceGatheringState === 'complete') { connection.removeEventListener('icegatheringstatechange', done); resolve(); } };
    connection.addEventListener('icegatheringstatechange', done);
  });
}

export class PeerSync {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private state: PeerState = 'idle';
  private onState: (state: PeerState) => void;
  private onAdmission: (entry: QueuedAdmission) => void;
  private readonly deviceId = crypto.randomUUID();
  private signalChannel: any = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private peerTarget: string | null = null;

  constructor(private readonly sessionId: string, handlers: { onState: (state: PeerState) => void; onAdmission: (entry: QueuedAdmission) => void }) {
    this.onState = handlers.onState;
    this.onAdmission = handlers.onAdmission;
  }

  private setState(state: PeerState) { this.state = state; this.onState(state); }
  private closeConnection() {
    this.channel?.close(); this.channel = null;
    this.connection?.close(); this.connection = null;
    this.peerTarget = null;
  }
  private createConnection() {
    this.closeConnection();
    const connection = new RTCPeerConnection({ iceServers: [] });
    this.connection = connection;
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connected') this.setState('connected');
      if (connection.connectionState === 'failed' || connection.connectionState === 'disconnected') {
        this.closeConnection();
        this.setState('failed');
        this.announce();
      }
    };
    connection.ondatachannel = event => this.attachChannel(event.channel);
    return connection;
  }
  private attachChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => this.setState('connected');
    channel.onclose = () => this.setState('idle');
    channel.onerror = () => this.setState('failed');
    channel.onmessage = event => {
      try {
        const message = JSON.parse(event.data) as PeerMessage;
        if (message.type === 'admission' && message.admission.sessionId === this.sessionId) this.onAdmission(message.admission);
      } catch { /* Ignore malformed peer traffic. */ }
    };
  }
  private async makeOffer(): Promise<Signal> {
    const connection = this.createConnection();
    this.attachChannel(connection.createDataChannel('gate-admissions', { ordered: true }));
    await connection.setLocalDescription(await connection.createOffer());
    await waitForIceComplete(connection);
    this.setState('pairing');
    return { version: 1, sessionId: this.sessionId, description: connection.localDescription!.toJSON() };
  }
  private async answerOffer(offer: Signal): Promise<Signal> {
    if (offer.sessionId !== this.sessionId || offer.description.type !== 'offer') throw new Error('This code belongs to another event.');
    const connection = this.createConnection();
    await connection.setRemoteDescription(offer.description);
    await connection.setLocalDescription(await connection.createAnswer());
    await waitForIceComplete(connection);
    this.setState('pairing');
    return { version: 1, sessionId: this.sessionId, description: connection.localDescription!.toJSON() };
  }
  async createOffer(): Promise<string> { return encode(await this.makeOffer()); }
  async acceptOffer(offerCode: string): Promise<string> { return encode(await this.answerOffer(decode(offerCode))); }
  async acceptAnswer(answerCode: string) {
    const answer = decode(answerCode);
    if (answer.sessionId !== this.sessionId || answer.description.type !== 'answer' || !this.connection) throw new Error('This answer cannot complete the current pairing.');
    await this.connection.setRemoteDescription(answer.description);
    this.setState('pairing');
  }
  sendAdmission(admission: QueuedAdmission) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify({ type: 'admission', admission } satisfies PeerMessage));
  }
  private announce() {
    if (!this.signalChannel || this.connection) return;
    void this.signalChannel.send({ type: 'broadcast', event: 'signal', payload: { type: 'hello', from: this.deviceId } satisfies AutoSignal });
  }
  private async handleAutoSignal(value: unknown) {
    const signal = value as AutoSignal;
    if (!signal || signal.from === this.deviceId || (signal.to && signal.to !== this.deviceId)) return;
    if (signal.type === 'hello' && !this.connection && this.deviceId > signal.from) {
      const offer = await this.makeOffer();
      this.peerTarget = signal.from;
      void this.signalChannel?.send({ type: 'broadcast', event: 'signal', payload: { type: 'offer', from: this.deviceId, to: signal.from, signal: offer } satisfies AutoSignal });
      return;
    }
    if (signal.type === 'offer' && !this.connection && signal.signal) {
      const answer = await this.answerOffer(signal.signal);
      this.peerTarget = signal.from;
      void this.signalChannel?.send({ type: 'broadcast', event: 'signal', payload: { type: 'answer', from: this.deviceId, to: signal.from, signal: answer } satisfies AutoSignal });
      return;
    }
    if (signal.type === 'answer' && this.peerTarget === signal.from && this.connection && signal.signal?.description.type === 'answer') {
      await this.connection.setRemoteDescription(signal.signal.description);
      this.setState('pairing');
    }
  }
  startAutoPairing() {
    if (this.signalChannel) return;
    const channel = db.joinPeerSignaling(this.sessionId, payload => { void this.handleAutoSignal(payload); });
    this.signalChannel = channel;
    channel.subscribe((status: string) => {
      if (status !== 'SUBSCRIBED') return;
      this.setState('pairing');
      this.announce();
      if (this.announceTimer) clearInterval(this.announceTimer);
      this.announceTimer = setInterval(() => this.announce(), 4000);
    });
  }
  stopAutoPairing() {
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = null;
    this.signalChannel?.unsubscribe(); this.signalChannel = null;
  }
  close() { this.stopAutoPairing(); this.closeConnection(); if (this.state !== 'idle') this.setState('idle'); }
}
