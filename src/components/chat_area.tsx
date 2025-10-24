import { GoogleGenAI } from "@google/genai";
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

            // Try the correct model name for live API
            const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;
            console.log('🔌 Connecting to WebSocket...');
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = async () => {
                console.log('✅ WebSocket connected');

                // Simplified setup - try with minimal config first
                const setupMessage = {
                    setup: {
                        model: "models/gemini-2.0-flash-exp"
                    }
                };
                console.log('📤 Sending setup:', JSON.stringify(setupMessage));
                ws.send(JSON.stringify(setupMessage));

                // Wait for setup complete before starting audio
                setTimeout(async () => {
                    console.log('🎵 Setting up audio processing...');
                    await setupAudioProcessing(stream, ws);
                }, 1000);
            };

            ws.onmessage = async (event) => {
                try {
                    let response;
                    if (event.data instanceof Blob) {
                        const text = await event.data.text();
                        console.log('📄 Blob text:', text);
                        response = JSON.parse(text);
                    } else {
                        response = JSON.parse(event.data);
                    }

                    console.log('📦 Full response:', JSON.stringify(response, null, 2));

                    if (response.setupComplete) {
                        console.log('✅ Setup complete');
                        setOutput('Listening... speak now!');
                    }

                    // Handle server content - THIS IS THE KEY PART
                    if (response.serverContent) {
                        console.log('📬 Server content received:', JSON.stringify(response.serverContent, null, 2));

                        // Extract text from modelTurn
                        if (response.serverContent.modelTurn) {
                            const modelTurn = response.serverContent.modelTurn;
                            console.log('🤖 Model turn:', JSON.stringify(modelTurn, null, 2));

                            if (modelTurn.parts && Array.isArray(modelTurn.parts)) {
                                for (const part of modelTurn.parts) {
                                    console.log('📝 Part:', JSON.stringify(part, null, 2));

                                    if (part.text) {
                                        console.log('✅ Found text:', part.text);
                                        const md = new MarkdownIt();
                                        setOutput(prev => {
                                            const newContent = prev === 'Listening... speak now!' ? part.text : prev + part.text;
                                            return md.render(newContent);
                                        });
                                    }

                                    // Also check for inlineData with text
                                    if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.includes('text')) {
                                        console.log('✅ Found inline text data');
                                        // Decode if needed
                                    }
                                }
                            }
                        }

                        // Also check for other possible text locations
                        if (response.serverContent.text) {
                            console.log('✅ Direct text:', response.serverContent.text);
                            setOutput(response.serverContent.text);
                        }

                        if (response.serverContent.turnComplete) {
                            console.log('✅ Turn complete');
                        }
                    }

                    if (response.error) {
                        console.error('❌ Error:', response.error);
                        setOutput(`Error: ${JSON.stringify(response.error)}`);
                    }

                } catch (e) {
                    console.error('❌ Parse error:', e);
                    console.error('Event data:', event.data);
                }
            };

            ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
            };

            ws.onclose = (event) => {
                console.log(`🔌 WebSocket closed: code=${event.code}, reason="${event.reason}"`);
                if (event.code === 1007) {
                    setOutput('Error: Invalid message format sent to API');
                }
                stopRecording();
            };

        } catch (error) {
            console.error('❌ Error:', error);
            setOutput(`Error: ${error}`);
            setIsRecording(false);
            setIsGenerating(false);
        }
    };

    const setupAudioProcessing = async (stream: MediaStream, ws: WebSocket) => {
        const audioContext = new AudioContext();
        audioContextRef.current = audioContext;
        const hardwareSampleRate = audioContext.sampleRate;

        console.log(`Audio: ${hardwareSampleRate}Hz → ${SAMPLE_RATE}Hz`);

        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(2048, 1, 1); // Smaller buffer

        let chunkCount = 0;

        processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;

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

            // Send as base64
            try {
                const bytes = new Uint8Array(pcm.buffer);
                const base64 = btoa(String.fromCharCode.apply(null, Array.from(bytes)));

                // Simpler message structure
                ws.send(JSON.stringify({
                    realtime_input: {
                        media_chunks: [{
                            mime_type: "audio/pcm",
                            data: base64
                        }]
                    }
                }));

                chunkCount++;
                if (chunkCount % 50 === 0) {
                    console.log(`🎵 Sent ${chunkCount} chunks (${targetLength} samples each)`);
                }
            } catch (err) {
                console.error('Send error:', err);
            }
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