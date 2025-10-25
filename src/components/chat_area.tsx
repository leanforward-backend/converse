import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { MessageCircleMore, Mic } from "lucide-react";
import MarkdownIt from 'markdown-it';
import { FormEvent, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createBlob, decode, decodeAudioData } from './speach/utils';
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Spinner } from "./ui/spinner";

const API_KEY = import.meta.env.VITE_API_KEY;

export const ChatArea = forwardRef<{ focus: () => void }>((_, ref) => {

    const model = ['gemini-2.0-flash-live-001', 'gemini-2.5-flash-native-audio-preview-09-2025', 'gemini-2.0-flash'];
    const [selectedModel, setSelectedModel] = useState(model[0]);

    const [prompt, setPrompt] = useState('');
    const [output, setOutput] = useState('(Results will appear here)');
    const [isGenerating, setIsGenerating] = useState(false);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const [message, setMessage] = useState('');
    const [mode, setMode] = useState<'chat' | 'talk'>('chat');
    const [isRecording, setIsRecording] = useState(false);

    // Add these state variables for transcription and conversation
    const [currentInputTranscription, setCurrentInputTranscription] = useState('');
    const [currentOutputTranscription, setCurrentOutputTranscription] = useState('');
    const [conversation, setConversation] = useState<Array<{ speaker: string, text: string }>>([]);

    // Add these new refs and state for audio scheduling
    const nextStartTimeRef = useRef(0);
    const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const sessionRef = useRef<any>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const contentEndRef = useRef<HTMLDivElement>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);

    // Add a new ref for output audio context
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const processorRef = useRef<ScriptProcessorNode | null>(null);
    const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);

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

            // Reset audio scheduling
            nextStartTimeRef.current = 0;
            audioSourcesRef.current.clear();

            // Get microphone access
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false
            });
            console.log('✅ Microphone access granted');
            mediaStreamRef.current = stream;

            // Initialize audio contexts (matching index.tsx)
            const inputAudioContext = new ((window as any).AudioContext ||
                (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const outputAudioContext = new ((window as any).AudioContext ||
                (window as any).webkitAudioContext)({ sampleRate: 24000 });

            audioContextRef.current = inputAudioContext;
            outputAudioContextRef.current = outputAudioContext;

            const ai = new GoogleGenAI({ apiKey: API_KEY });

            const session = await ai.live.connect({
                model: selectedModel,
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: {
                                voiceName: 'Zephyr'
                            }
                        }
                    },
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
                callbacks: {
                    onopen: () => {
                        console.log('✅ Connected to Live API');
                        setOutput('Listening... speak now!');
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

            // Store session in both refs
            wsRef.current = session as any;
            sessionRef.current = session;

            // THEN setup audio processing
            setupAudioProcessingForSession(stream, session);

        } catch (error) {
            console.error('❌ Error:', error);
            setOutput(`Error: ${error}`);
            setIsRecording(false);
            setIsGenerating(false);
        }
    };

    const handleLiveMessage = (message: LiveServerMessage) => {
        console.log('📦 Message received:', message);

        // Handle input transcription (what you're saying)
        if (message.serverContent?.inputTranscription) {
            console.log('🎤 Input transcription:', message.serverContent.inputTranscription.text);
            setCurrentInputTranscription(message.serverContent.inputTranscription.text || '');
        }

        // Handle output transcription (what Gemini is saying)
        if (message.serverContent?.outputTranscription?.text) {
            console.log('💬 Output transcription:', message.serverContent.outputTranscription.text);
            setCurrentOutputTranscription(prev => prev + (message.serverContent?.outputTranscription?.text || ''));
        }

        // Handle turn complete - save to conversation history
        if (message.serverContent?.turnComplete) {
            console.log('✅ Turn complete');
            setConversation(prev => {
                const newConversation = [...prev];
                // Use callback form to get latest state
                setCurrentInputTranscription(currentInput => {
                    if (currentInput.trim()) {
                        newConversation.push({
                            speaker: 'You',
                            text: currentInput,
                        });
                    }
                    return ''; // Clear after saving
                });
                setCurrentOutputTranscription(currentOutput => {
                    if (currentOutput.trim()) {
                        newConversation.push({
                            speaker: 'Gemini',
                            text: currentOutput,
                        });
                    }
                    return ''; // Clear after saving
                });
                return newConversation;
            });
        }

        // Handle audio playback with proper scheduling (matching index.tsx)
        if (message.serverContent?.modelTurn?.parts) {
            for (const part of message.serverContent.modelTurn.parts) {
                const audio = part.inlineData;
                if (audio && audio.data) {
                    console.log('🎵 Audio data received, playing...');
                    playAudioDataFromLive(audio.data);
                }
            }
        }

        // Handle interruption - stop all playing audio
        if (message.serverContent?.interrupted) {
            console.log('⚠️ Interrupted - stopping all audio');
            audioSourcesRef.current.forEach(source => {
                try {
                    source.stop();
                } catch (e) {
                    // Already stopped
                }
            });
            audioSourcesRef.current.clear();
            nextStartTimeRef.current = 0;
        }
    };

    const setupAudioProcessingForSession = (stream: MediaStream, session: any) => {
        const inputAudioContext = audioContextRef.current;
        if (!inputAudioContext) {
            console.error('❌ No input audio context');
            return;
        }

        console.log('🎙️ Setting up audio processing...');

        const source = inputAudioContext.createMediaStreamSource(stream);
        const processor = inputAudioContext.createScriptProcessor(4096, 1, 1);

        sourceNodeRef.current = source;
        processorRef.current = processor;

        // Remove the isRecording check - just send audio while connected
        processor.onaudioprocess = (e) => {
            const inputBuffer = e.inputBuffer;
            const pcmData = inputBuffer.getChannelData(0);

            // Send to session if it exists
            if (sessionRef.current) {
                try {
                    sessionRef.current.sendRealtimeInput({ media: createBlob(pcmData) });
                } catch (err) {
                    console.error('Error sending audio:', err);
                }
            }
        };

        source.connect(processor);
        processor.connect(inputAudioContext.destination);

        console.log('✅ Audio processing setup complete');
    };

    const stopRecording = () => {
        console.log('🛑 Stopping recording...');
        setIsRecording(false);
        setIsGenerating(false);

        // Stop all playing audio
        audioSourcesRef.current.forEach(source => {
            try {
                source.stop();
            } catch (e) {
                // Already stopped
            }
        });
        audioSourcesRef.current.clear();
        nextStartTimeRef.current = 0;

        // Disconnect audio nodes first
        if (processorRef.current && sourceNodeRef.current) {
            try {
                processorRef.current.disconnect();
                sourceNodeRef.current.disconnect();
            } catch (e) {
                console.log('Audio nodes already disconnected');
            }
        }
        processorRef.current = null;
        sourceNodeRef.current = null;

        // Close session
        if (sessionRef.current) {
            try {
                sessionRef.current.close();
            } catch (e) {
                console.log('Session already closed');
            }
        }
        sessionRef.current = null;
        wsRef.current = null;

        // Stop audio contexts
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        if (outputAudioContextRef.current) {
            outputAudioContextRef.current.close();
            outputAudioContextRef.current = null;
        }

        // Stop media stream
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }

        console.log('✅ Recording stopped');
    };

    const playAudioDataFromLive = async (base64Data: string) => {
        try {
            if (!outputAudioContextRef.current) {
                outputAudioContextRef.current = new ((window as any).AudioContext ||
                    (window as any).webkitAudioContext)({ sampleRate: 24000 });
            }

            const audioContext = outputAudioContextRef.current;
            if (!audioContext) {
                console.error('❌ No output audio context');
                return;
            }

            // Use decode and decodeAudioData from utils.ts (same as index.tsx)
            const audioBuffer = await decodeAudioData(
                decode(base64Data),
                audioContext,
                24000,
                1,
            );

            // Schedule audio properly (matching index.tsx)
            nextStartTimeRef.current = Math.max(
                nextStartTimeRef.current,
                audioContext.currentTime
            );

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            // Track source for interruption handling
            audioSourcesRef.current.add(source);
            source.addEventListener('ended', () => {
                audioSourcesRef.current.delete(source);
            });

            source.start(nextStartTimeRef.current);
            nextStartTimeRef.current = nextStartTimeRef.current + audioBuffer.duration;

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
                        {mode === 'talk' ? (
                            <>
                                {/* Show conversation history */}
                                {conversation.map((turn, idx) => (
                                    <div key={idx} className="mb-4">
                                        <strong className={turn.speaker === 'You' ? 'text-blue-400' : 'text-green-400'}>
                                            {turn.speaker}
                                        </strong>
                                        <div>{turn.text}</div>
                                    </div>
                                ))}

                                {/* Show current transcriptions */}
                                {currentInputTranscription && (
                                    <div className="mb-4">
                                        <strong className="text-blue-400">You</strong>
                                        <div>{currentInputTranscription}</div>
                                    </div>
                                )}
                                {currentOutputTranscription && (
                                    <div className="mb-4">
                                        <strong className="text-green-400">Gemini</strong>
                                        <div>{currentOutputTranscription}</div>
                                    </div>
                                )}
                                {/* <gdm-live-audio /> */}
                            </>
                        ) : (
                            <>
                                <p className="justify-start text-right mb-8">{message}</p>
                                <p className="output" dangerouslySetInnerHTML={{ __html: output }} />
                            </>
                        )}
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
                    <Select value={selectedModel} onValueChange={(value) => setSelectedModel(value)}>
                        <SelectTrigger className="w-25 justify-start gap-0">
                            <SelectValue placeholder={selectedModel} />
                        </SelectTrigger>
                        <SelectContent className="min-w-0 w-fit p-1">
                            <SelectGroup>
                                {model.map((m) => (
                                    <SelectItem className="pr-2 pl-2" value={m}>{m}</SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
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