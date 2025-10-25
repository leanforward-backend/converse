
import { GoogleGenAI, LiveServerMessage, Modality, Session } from '@google/genai';
import { LitElement, css, html } from 'lit';
import { state } from 'lit/decorators.js';
import { createBlob, decode, decodeAudioData } from './utils';
import './visual-3d';

// @customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording;
  @state() status;
  @state() error;
  @state() currentInputTranscription;
  @state() currentOutputTranscription;
  @state() conversation;

  private client: GoogleGenAI;
  private sessionPromise: Promise<Session>;
  private session: Session;
  // FIX: Cast window to any to allow for webkitAudioContext for Safari compatibility
  private inputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({ sampleRate: 16000 });
  private outputAudioContext = new ((window as any).AudioContext ||
    (window as any).webkitAudioContext)({ sampleRate: 24000 });
  @state() inputNode;
  @state() outputNode;
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    #status {
      position: absolute;
      bottom: 5vh;
      left: 0;
      right: 0;
      z-index: 10;
      text-align: center;
      color: white;
      font-family: sans-serif;
    }

    .controls {
      z-index: 10;
      position: absolute;
      bottom: 10vh;
      left: 0;
      right: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-direction: column;
      gap: 10px;

      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.1);
        width: 64px;
        height: 64px;
        cursor: pointer;
        font-size: 24px;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;

        &:hover {
          background: rgba(255, 255, 255, 0.2);
        }
      }

      button[disabled] {
        display: none;
      }
    }

    .transcription-container {
      position: absolute;
      top: 2vh;
      left: 2vw;
      right: 2vw;
      bottom: 25vh;
      color: white;
      font-family: sans-serif;
      display: flex;
      flex-direction: column;
      pointer-events: none;
      z-index: 5;
    }

    .conversation {
      flex-grow: 1;
      overflow-y: auto;
      padding: 1em;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 12px;
      scrollbar-width: thin;
      scrollbar-color: rgba(255, 255, 255, 0.3) transparent;
      pointer-events: auto;
    }

    .current-transcription {
      padding: 1em;
      min-height: 4em;
    }

    .turn {
      margin-bottom: 1em;
      line-height: 1.5;
    }

    .turn strong {
      display: block;
      margin-bottom: 0.25em;
      font-weight: 500;
    }

    .turn.you strong {
      color: #87cefa; /* LightSkyBlue */
    }

    .turn.gemini strong {
      color: #90ee90; /* LightGreen */
    }
  `;

  constructor() {
    super();
    this.isRecording = false;
    this.status = '';
    this.error = '';
    this.currentInputTranscription = '';
    this.currentOutputTranscription = '';
    this.conversation = [];
    this.inputNode = this.inputAudioContext.createGain();
    this.outputNode = this.outputAudioContext.createGain();
    this.initClient();
  }

  updated(changedProperties) {
    if (changedProperties.has('conversation')) {
      const conversationEl = this.shadowRoot?.querySelector('.conversation');
      if (conversationEl) {
        conversationEl.scrollTop = conversationEl.scrollHeight;
      }
    }
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: import.meta.env.VITE_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.sessionPromise = this.initSession();
  }

  private async initSession(): Promise<Session> {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    try {
      const session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Opened');
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.inputTranscription) {
              this.currentInputTranscription =
                message.serverContent.inputTranscription.text;
            }
            if (message.serverContent?.outputTranscription) {
              this.currentOutputTranscription +=
                message.serverContent.outputTranscription.text;
            }
            if (message.serverContent?.turnComplete) {
              const newConversation = [...this.conversation];
              if (this.currentInputTranscription.trim()) {
                newConversation.push({
                  speaker: 'You',
                  text: this.currentInputTranscription,
                });
              }
              if (this.currentOutputTranscription.trim()) {
                newConversation.push({
                  speaker: 'Gemini',
                  text: this.currentOutputTranscription,
                });
              }
              this.conversation = newConversation;

              this.currentInputTranscription = '';
              this.currentOutputTranscription = '';
            }

            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
        },
      });
      this.session = session;
      return session;
    } catch (e) {
      console.error(e);
      this.updateError(e.message);
      throw e;
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 4096;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.sessionPromise.then((session) => {
          session.sendRealtimeInput({ media: createBlob(pcmData) });
        });
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('🔴 Recording... Speak now.');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Recording stopped. Click Start to begin again.');
  }

  private reset() {
    this.session?.close();
    this.sessionPromise = this.initSession();
    this.updateStatus('Session cleared.');
    this.conversation = [];
    this.currentInputTranscription = '';
    this.currentOutputTranscription = '';
  }

  render() {
    return html`
      <div>
        <div class="transcription-container">
          <div class="conversation">
            ${this.conversation.map(
      (turn) => html`
                <div class="turn ${turn.speaker.toLowerCase()}">
                  <strong>${turn.speaker}</strong>
                  <div>${turn.text}</div>
                </div>
              `,
    )}
          </div>
          <div class="current-transcription">
            ${this.currentInputTranscription
        ? html`<div class="turn you">
                  <strong>You</strong>
                  <div>${this.currentInputTranscription}</div>
                </div>`
        : ''}
            ${this.currentOutputTranscription
        ? html`<div class="turn gemini">
                  <strong>Gemini</strong>
                  <div>${this.currentOutputTranscription}</div>
                </div>`
        : ''}
          </div>
        </div>
        <div class="controls">
          <button
            id="resetButton"
            @click=${this.reset}
            ?disabled=${this.isRecording}
            aria-label="Reset Session">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="40px"
              viewBox="0 -960 960 960"
              width="40px"
              fill="#ffffff">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          <button
            id="startButton"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}
            aria-label="Start Recording">
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#c80000"
              xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="50" />
            </svg>
          </button>
          <button
            id="stopButton"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}
            aria-label="Stop Recording">
            <svg
              viewBox="0 0 100 100"
              width="32px"
              height="32px"
              fill="#ffffff"
              xmlns="http://www.w3.org/2000/svg">
              <rect x="15" y="15" width="70" height="70" rx="8" />
            </svg>
          </button>
        </div>

        <div id="status">${this.error || this.status}</div>
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}></gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}

if (!customElements.get('gdm-live-audio')) {
  customElements.define('gdm-live-audio', GdmLiveAudio);
}