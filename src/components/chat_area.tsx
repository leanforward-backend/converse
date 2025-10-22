import { Allotment } from "allotment";
import { Label } from "./ui/label";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { useState, FormEvent, forwardRef, useRef, useImperativeHandle, useEffect } from "react";
import { GoogleGenAI } from "@google/genai";
import MarkdownIt from 'markdown-it';
import { ScrollArea } from "./ui/scroll-area";

const API_KEY = import.meta.env.VITE_API_KEY;

export const ChatArea = forwardRef<{ focus: () => void }>((props, ref) => {

    const [prompt, setPrompt] = useState('');
    const [output, setOutput] = useState('(Results will appear here)');
    const [isGenerating, setIsGenerating] = useState(false);
    const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

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
            <h1 style={{ marginBottom: '1rem', borderBottom: '1px solid #e5e7eb', paddingBottom: '1rem' }}>
                Talking with the Gemini API
            </h1>

            <div className="flex-1 overflow-hidden">
                <ScrollArea ref={scrollViewportRef} className="h-full w-full">
                    <div className='mx-auto w-full pr-4'>
                        <p className="output" dangerouslySetInnerHTML={{ __html: output }} />
                        <div ref={contentEndRef} />
                    </div>
                </ScrollArea>
            </div>

            <form onSubmit={handleSubmit} className="mt-4 bg-white">
                <div className="prompt-box">
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
                    <Button className="bg-blue-500 hover:bg-blue-600 text-white"
                        type="submit" disabled={isGenerating}>{isGenerating ? <Spinner /> : 'Go'}</Button>
                </div>
            </form>
        </div>
    );
});

ChatArea.displayName = 'ChatArea';