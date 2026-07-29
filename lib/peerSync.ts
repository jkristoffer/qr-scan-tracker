import type { QueuedAdmission } from './offlineScanner';
import { db } from './supabase';

type Signal = { version: 1; sessionId: string; description: RTCSessionDescriptionInit };
type PeerMessage = { type: 'admission'; admission: QueuedAdmission };
type AutoSignal = { id: string; type: 'hello' | 'offer' | 'answer'; from: string; to?: string; signal?: Signal };
export type PeerState = 'idle' | 'pairing' | 'connected' | 'failed';
export type PeerSignalState = 'idle' | 'connecting' | 'ready' | 'retrying';

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
  private onSignalState: (state: PeerSignalState) => void;
  private readonly deviceId = crypto.randomUUID();
  private signalChannel: any = null;
  private announceTimer: ReturnType<typeof setInterval> | null = null;
  private signalPollTimer: ReturnType<typeof setTimeout> | null = null;
  private autoPairing = false;
  private peerTarget: string | null = null;
  private signalPollSince = '';
  private seenSignalIds = new Set<string>();

  constructor(private readonly sessionId: string, handlers: { onState: (state: PeerState) => void; onAdmission: (entry: QueuedAdmission) => void; onSignalState?: (state: PeerSignalState) => void }) {
    this.onState = handlers.onState;
    this.onAdmission = handlers.onAdmission;
    this.onSignalState = handlers.onSignalState || (() => {});
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
  private sendAutoSignal(signal: AutoSignal) {
    void this.signalChannel?.send({ type: 'broadcast', event: 'signal', payload: signal });
    void db.publishPeerSignal(this.sessionId, signal).catch(() => {
      if (this.autoPairing) this.onSignalState('retrying');
    });
  }
  private announce() {
    if (!this.autoPairing || this.connection) return;
    this.sendAutoSignal({ id: crypto.randomUUID(), type: 'hello', from: this.deviceId });
  }
  private async receiveAutoSignal(value: unknown) {
    const signal = value as AutoSignal;
    if (!signal?.id || this.seenSignalIds.has(signal.id)) return;
    this.seenSignalIds.add(signal.id);
    await this.handleAutoSignal(signal);
  }
  private async handleAutoSignal(value: unknown) {
    const signal = value as AutoSignal;
    if (!signal || signal.from === this.deviceId || (signal.to && signal.to !== this.deviceId)) return;
    if (signal.type === 'hello' && !this.connection && this.deviceId > signal.from) {
      const offer = await this.makeOffer();
      this.peerTarget = signal.from;
      this.sendAutoSignal({ id: crypto.randomUUID(), type: 'offer', from: this.deviceId, to: signal.from, signal: offer });
      return;
    }
    if (signal.type === 'offer' && !this.connection && signal.signal) {
      const answer = await this.answerOffer(signal.signal);
      this.peerTarget = signal.from;
      this.sendAutoSignal({ id: crypto.randomUUID(), type: 'answer', from: this.deviceId, to: signal.from, signal: answer });
      return;
    }
    if (signal.type === 'answer' && this.peerTarget === signal.from && this.connection && signal.signal?.description.type === 'answer') {
      await this.connection.setRemoteDescription(signal.signal.description);
      this.setState('pairing');
    }
  }
  private connectSignaling() {
    if (!this.autoPairing || this.signalChannel) return;
    this.onSignalState('connecting');
    const channel = db.joinPeerSignaling(this.sessionId, payload => { void this.receiveAutoSignal(payload); });
    this.signalChannel = channel;
    channel.subscribe((status: string) => {
      if (channel !== this.signalChannel || !this.autoPairing) return;
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.signalChannel = null;
        void channel.unsubscribe();
        return;
      }
      if (status !== 'SUBSCRIBED') return;
      this.onSignalState('ready');
      this.setState('pairing');
    });
  }
  private async pollSignaling() {
    if (!this.autoPairing) return;
    try {
      const rows = await db.listPeerSignals(this.sessionId, this.deviceId, this.signalPollSince);
      this.onSignalState('ready');
      for (const row of rows) {
        await this.receiveAutoSignal({
          id: row.signal_id,
          type: row.kind,
          from: row.sender_id,
          to: row.recipient_id || undefined,
          signal: row.payload || undefined,
        });
      }
      const newest = rows.at(-1)?.created_at;
      if (newest) this.signalPollSince = newest;
    } catch {
      this.onSignalState('retrying');
    } finally {
      if (this.autoPairing) this.signalPollTimer = setTimeout(() => void this.pollSignaling(), 1200);
    }
  }
  startAutoPairing() {
    if (this.autoPairing) return;
    this.autoPairing = true;
    this.signalPollSince = new Date(Date.now() - 15_000).toISOString();
    this.seenSignalIds.clear();
    this.setState('pairing');
    this.connectSignaling();
    void this.pollSignaling();
    this.announce();
    this.announceTimer = setInterval(() => this.announce(), 4000);
  }
  stopAutoPairing() {
    this.autoPairing = false;
    if (this.announceTimer) clearInterval(this.announceTimer);
    this.announceTimer = null;
    if (this.signalPollTimer) clearTimeout(this.signalPollTimer);
    this.signalPollTimer = null;
    const channel = this.signalChannel;
    this.signalChannel = null;
    channel?.unsubscribe();
    this.onSignalState('idle');
  }
  cancelAutoPairing() {
    this.stopAutoPairing();
    if (!this.connection) this.setState('idle');
  }
  close() { this.stopAutoPairing(); this.closeConnection(); if (this.state !== 'idle') this.setState('idle'); }
}
