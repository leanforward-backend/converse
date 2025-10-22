import './style.css';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { ChatArea } from './components/chat_area';
import { useEffect, useState, useRef } from 'react';
import { Button } from './components/ui/button';
import { ThemeToggle } from './components/theme_toggle';


export const App = () => {

    const [numWindows, setNumWindows] = useState(1);

    const chatAreaRefs = useRef<Array<{ focus: () => void } | null>>([]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!event.altKey) return;

            const key = event.key;
            const keyNum = parseInt(key);

            if (keyNum >= 1 && keyNum <= 4) {
                setNumWindows(keyNum);
                return;
            }
        }

        document.addEventListener("keydown", handleKeyDown);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        }
    }, []);

    useEffect(() => {
        if (chatAreaRefs.current[numWindows - 1]) {
            chatAreaRefs.current[numWindows - 1]?.focus();
        }
    }, [numWindows]);



    return (
        <div className="flex flex-col h-screen w-full">
            <div className="flex justify-center items-center gap-3 p-4 bg-card/50 backdrop-blur-sm border-b border-border">

                <Button
                    onClick={() => {
                        setNumWindows(prev => Math.max(prev - 1, 1));
                    }}
                    disabled={numWindows <= 1}
                    className="bg-blue-500 hover:bg-blue-600 text-white"

                >
                    Less Windows
                </Button>

                <Button
                    onClick={() => {
                        setNumWindows(prev => Math.min(prev + 1, 4));
                    }}
                    className="bg-blue-500 hover:bg-blue-600 text-white"
                    disabled={numWindows >= 4}
                    variant="secondary"
                >
                    More Windows
                </Button>
                <ThemeToggle />
            </div>
            <div className="flex-grow animate-fade-in">
                <Allotment vertical={false}>
                    {Array.from({ length: numWindows }, (_, index) => (
                        <Allotment.Pane key={index} minSize={400}>
                            <ChatArea
                                key={index}
                                ref={(el) => { chatAreaRefs.current[index] = el; }}
                            />
                        </Allotment.Pane>
                    ))}
                </Allotment>
            </div>
        </div>
    );
};