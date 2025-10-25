import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { MessageCircleMore, Mic } from "lucide-react";
import MarkdownIt from 'markdown-it';
import { FormEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";

const API_KEY = import.meta.env.VITE_API_KEY;

// Audio configuration for Live API
const SAMPLE_RATE = 16000;
const CHANNELS = 1;

interface LiveAPIMessage {
    setup?: {
        model: string;
        generation_config?: {
            response_modalities: string[];
        };
    };
    client_content?: {
        turns?: Array<{
            role: string;
            parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }>;
        }>;
        turn_complete: boolean;
    };
}

export const ChatArea = forwardRef<{ focus: () => void }>((props, ref) => {

    const [prompt, setPrompt] = useState('');
    const [output, setOutput] = useState('(Results will appear here)');
    const [isGenerating, setIsGenerating] = useState(false);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const [message, setMessage] = useState('');
    const [mode, setMode] = useState<'chat' | 'talk'>('chat');
    const [isRecording, setIsRecording] = useState(false);

    const inputRef = useRef<HTMLInputElement>(null);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const contentEndRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioWorkletNodeRef = useRef<AudioWorkletNode | null>(null);
    const audioQueueRef = useRef<AudioBuffer[]>([]);
    const isPlayingRef = useRef(false);

    useImperativeHandle(ref, () => ({
        focus: () => {
            inputRef.current?.focus();
        }
    }));

    useEffect(() => {
        if (shouldAutoScroll && contentEndRef.current) {
            contentEndRef.current.scrollIntoView({ behavior: "smooth" });
        }
    }, [output, shouldAutoScroll]);

    useEffect(() => {
        const viewport = scrollViewportRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement;

        if (!viewport) return;

        const handleScroll = () => {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            const isAtBottom = scrollHeight - scrollTop - clientHeight < 1;
            setShouldAutoScroll(isAtBottom);
        };

        viewport.addEventListener('scroll', handleScroll);
        return () => viewport.removeEventListener('scroll', handleScroll);
    }, []);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            stopRecording();
        };
    }, []);

    const handleSubmit = async (ev: FormEvent) => {
        ev.preventDefault();

        if (mode === 'chat') {
            await handleChatSubmit();
        } else {
            await handleTalkSubmit();
        }
    };

    const handleChatSubmit = async () => {
        setMessage(prompt);
        setIsGenerating(true);
        setOutput('Generating...');
        setShouldAutoScroll(true);

        try {
            const ai = new GoogleGenAI({ apiKey: API_KEY });
            const stream = await ai.models.generateContentStream({
                model: "gemini-2.0-flash",
                contents: [
                    {
                        role: 'user' as const,
                        parts: [
                            { text: prompt }
                        ]
                    }
                ],
            });

            const buffer: string[] = [];
            const md = new MarkdownIt();
            for await (let response of stream) {
                buffer.push(response.text ?? '');
                setOutput(md.render(buffer.join('')));
            }
        } catch (e) {
            setOutput(prev => prev + '<hr>' + e);
        }
        setIsGenerating(false);
    };

    const handleTalkSubmit = async () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };

    const startRecording = async () => {
        try {
            console.log('🎙️ Starting recording...');
            setIsRecording(true);
            setIsGenerating(true);
            setOutput('Connecting to Live API...');
            setShouldAutoScroll(true);
            setMessage('🎤 Listening...');

            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                }
            });
            console.log('✅ Microphone access granted');
            mediaStreamRef.current = stream;

            const ai = new GoogleGenAI({ apiKey: API_KEY });

            const session = await ai.live.connect({
                model: 'models/gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.TEXT, Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: 'Puck'
                            }
                        }
                    }
                },
                callbacks: {
                    onopen: () => {
                        console.log('✅ Connected');
                        setOutput('Listening... speak now!');
                        // Access session via wsRef after it's assigned
                        if (wsRef.current) {
                            setupAudioProcessingForSession(stream, wsRef.current);
                        }
                    },
                    onmessage: (message: LiveServerMessage) => {
                        handleLiveMessage(message);
                    },
                    onerror: (e: ErrorEvent) => {
                        console.error('❌ Error:', e.message);
                        setOutput(`Error: ${e.message}`);
                    },
                    onclose: (e: CloseEvent) => {
                        console.log('🔌 Closed:', e.reason);
                        stopRecording();
                    }
                }
            });

            // Store session ref for cleanup (do this BEFORE onopen fires)
            wsRef.current = session as any;

        } catch (error) {
            console.error('❌ Error:', error);
            setOutput(`Error: ${error}`);
            setIsRecording(false);
            setIsGenerating(false);
        }
    };

    const handleLiveMessage = (message: LiveServerMessage) => {
        console.log('📦 Message:', message);

        if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
                // Handle TEXT
                if (part.text) {
                    console.log('✅ Text:', part.text);
                    const md = new MarkdownIt();
                    setOutput(prev => {
                        const newContent = prev === 'Listening... speak now!' ? part.text : prev + part.text;
                        return md.render(newContent);
                    });
                }

                // Handle AUDIO
                if (part.inlineData?.data && part.inlineData?.mimeType?.includes('audio')) {
                    console.log('🎵 Audio data received');
                    playAudioData(part.inlineData.data, part.inlineData.mimeType);
                }
            }
        }
    };

    const setupAudioProcessingForSession = async (stream: MediaStream, session: any) => {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const hardwareSampleRate = audioContext.sampleRate;

        console.log(`Audio: ${hardwareSampleRate}Hz → ${SAMPLE_RATE}Hz`);

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(2048, 1, 1);

        processor.onaudioprocess = (e) => {
            const inputData = e.inputBuffer.getChannelData(0);

            // Downsample to 16kHz
            const resampleRatio = SAMPLE_RATE / hardwareSampleRate;
            const targetLength = Math.floor(inputData.length * resampleRatio);
            const resampled = new Float32Array(targetLength);

            for (let i = 0; i < targetLength; i++) {
                const srcIndex = i / resampleRatio;
                const idx = Math.floor(srcIndex);
                resampled[i] = inputData[Math.min(idx, inputData.length - 1)];
            }

            // Convert to PCM16
            const pcm = new Int16Array(targetLength);
            for (let i = 0; i < targetLength; i++) {
                const s = Math.max(-1, Math.min(1, resampled[i]));
                pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }

            // Send via session
            const bytes = new Uint8Array(pcm.buffer);
            const base64 = btoa(String.fromCharCode.apply(null, Array.from(bytes)));

            session.sendRealtimeInput([{
                mimeType: "audio/pcm",
                data: base64
            }]);
        };

        source.connect(processor);
        processor.connect(audioContext.destination);
    };

    const stopRecording = () => {
        console.log('🛑 Stopping recording...');
        setIsRecording(false);
        setIsGenerating(false);

        // Send turn complete
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            const message: LiveAPIMessage = {
                client_content: {
                    turn_complete: true
                }
            };
            console.log('📤 Sending turn_complete');
            wsRef.current.send(JSON.stringify(message));
            wsRef.current.close();
        }
        wsRef.current = null;

        // Stop audio processing
        if (audioContextRef.current) {
            console.log('Closing AudioContext');
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        // Stop media stream
        if (mediaStreamRef.current) {
            console.log('Stopping media stream tracks');
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        console.log('✅ Recording stopped');
    };

    const playAudioData = async (base64Data: string, mimeType: string) => {
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new AudioContext();
            }

            const audioContext = audioContextRef.current;

            // Decode base64 to ArrayBuffer
            const binaryString = atob(base64Data);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            let audioBuffer: AudioBuffer;

            if (mimeType === 'audio/pcm') {
                // PCM data - convert to AudioBuffer manually
                const int16Array = new Int16Array(bytes.buffer);
                const float32Array = new Float32Array(int16Array.length);

                // Convert PCM16 to float32
                for (let i = 0; i < int16Array.length; i++) {
                    float32Array[i] = int16Array[i] / 32768.0;
                }

                // Create AudioBuffer
                audioBuffer = audioContext.createBuffer(1, float32Array.length, 24000); // 24kHz sample rate
                audioBuffer.getChannelData(0).set(float32Array);
            } else {
                // Other formats (like audio/wav) - decode directly
                audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
            }

            // Play the audio
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            source.start(0);

            console.log('🔊 Playing audio chunk');
        } catch (error) {
            console.error('❌ Error playing audio:', error);
        }
    };

    return (
        <div className='w-full h-full flex flex-col px-10'>
            <h1 className="text-center" style={{ marginBottom: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem' }}>
                Talking with the Gemini API
            </h1>

            <div className="flex-1 overflow-hidden">
                <ScrollArea ref={scrollViewportRef} className="h-full w-full">
                    <div className='mx-auto w-full max-w-4xl pr-4'>
                        <p className="justify-start text-right mb-8">{message}</p>

                        <p className="output" dangerouslySetInnerHTML={{ __html: output }} />
                        <div ref={contentEndRef} />
                    </div>
                </ScrollArea>
            </div>

            <form onSubmit={handleSubmit}>
                <div className="prompt-box flex items-center">
                    <Label>
                        <Input
                            ref={inputRef}
                            name="prompt"
                            placeholder={isGenerating ? prompt : mode === 'talk' ? 'Click Go to start recording' : 'talk to me...'}
                            type="text"
                            disabled={isGenerating || mode === 'talk'}
                            onChange={(e) => {
                                setPrompt(e.target.value);
                            }}
                            value={prompt}
                        />
                    </Label>
                    <Select value={mode} onValueChange={(value) => setMode(value as 'chat' | 'talk')}>
                        <SelectTrigger className="w-fit justify-start gap-0">
                            <SelectValue placeholder={<MessageCircleMore />} />
                        </SelectTrigger>
                        <SelectContent className="min-w-0 w-fit p-1">
                            <SelectGroup>
                                <SelectItem className="pr-2 pl-2" value="chat"><MessageCircleMore className="size-4" /></SelectItem>
                                <SelectItem className="pr-2 pl-2" value="talk"><Mic className="size-4" /></SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Button className="bg-blue-500 hover:bg-blue-600 text-white"
                        type="submit" disabled={isGenerating && mode === 'chat'}>
                        {isGenerating ? <Spinner /> : (isRecording ? 'Stop' : 'Go')}
                    </Button>
                </div>
            </form>
        </div>
    );
});

ChatArea.displayName = 'ChatArea';