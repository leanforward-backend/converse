import { useState, FormEvent } from 'react';
import { GoogleGenAI, HarmBlockThreshold, HarmCategory } from "@google/genai";
import MarkdownIt from 'markdown-it';
import './style.css';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

const API_KEY = import.meta.env.VITE_API_KEY;

function App() {
    const [prompt, setPrompt] = useState('What do you want to talk about?');
    const [output, setOutput] = useState('(Results will appear here)');

    const handleSubmit = async (ev: FormEvent) => {
        ev.preventDefault();
        setOutput('Generating...');

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
    };

    return (
        <main>
            <h1>Talking with the Gemini API</h1>
            <form onSubmit={handleSubmit}>
                <p className="output" dangerouslySetInnerHTML={{ __html: output }} />
                <div className="prompt-box">
                    <Label>
                        <Input
                            name="prompt"
                            placeholder={prompt}
                            type="text"
                            onChange={(e) => setPrompt(e.target.value)}
                        />
                    </Label>
                    <Button type="submit">Go</Button>
                </div>
            </form>
        </main>
    );
}

export default App;