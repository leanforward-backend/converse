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

export const ChatArea = forwardRef<{ focus: () => void }>((props, ref) => {

    const [prompt, setPrompt] = useState('');
    const [output, setOutput] = useState('(Results will appear here)');
    const [isGenerating, setIsGenerating] = useState(false);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
    const [message, setMessage] = useState('');

    const inputRef = useRef<HTMLInputElement>(null);
    const scrollViewportRef = useRef<HTMLDivElement>(null);
    const contentEndRef = useRef<HTMLDivElement>(null);

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

    const handleSubmit = async (ev: FormEvent) => {
        setMessage(prompt);
        ev.preventDefault();
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
                            placeholder={isGenerating ? prompt : 'talk to me...'}
                            type="text"
                            disabled={isGenerating}
                            onChange={(e) => {
                                setPrompt(e.target.value);
                            }}
                            value={prompt}
                        />
                    </Label>
                    <Select>
                        <SelectTrigger className="w-fit justify-start gap-0">
                            <SelectValue placeholder={<MessageCircleMore />} />
                        </SelectTrigger>
                        <SelectContent className="min-w-0 w-fit p-1">
                            <SelectGroup>
                                <SelectItem className="pr-2 pl-2" value="Chat"><MessageCircleMore className="size-4" /></SelectItem>
                                <SelectItem className="pr-2 pl-2" value="Talk"><Mic className="size-4" /></SelectItem>
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                    <Button className="bg-blue-500 hover:bg-blue-600 text-white"
                        type="submit" disabled={isGenerating}>{isGenerating ? <Spinner /> : 'Go'}
                    </Button>
                </div>
            </form>
        </div>
    );
});

ChatArea.displayName = 'ChatArea';