import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useEffect, useRef, useState } from 'react';
import { ChatArea } from './components/chat_area';
import './components/speach';
import { ThemeToggle } from './components/theme_toggle';
import { Button } from './components/ui/button';
import './style.css';

declare global {
    namespace JSX {
        interface IntrinsicElements {
            'gdm-live-audio': any;
        }
    }
}

export const App = () => {

    const [numWindows, setNumWindows] = useState(1);

    const chatAreaRefs = useRef<Array<{ focus: () => void } | null>>([]);

    const [currentFocusIndex, setCurrentFocusIndex] = useState(0);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {

            if (event.key === 'Alt') {
                event.preventDefault();
            }
            if (!event.altKey) return;

            const key = event.key;
            const keyNum = parseInt(key);

            if (keyNum >= 1 && keyNum <= 4) {
                setNumWindows(keyNum);
                return;
            }
        }

        const handleWheel = (event: WheelEvent) => {
            if (event.altKey) {
                event.preventDefault();
                event.stopPropagation();

                if (event.deltaY < 0) {
                    setCurrentFocusIndex(prev => {
                        const newIndex = prev > 0 ? prev - 1 : numWindows - 1;
                        setTimeout(() => chatAreaRefs.current[newIndex]?.focus(), 0);
                        return newIndex;
                    });
                } else if (event.deltaY > 0) {
                    setCurrentFocusIndex(prev => {
                        const newIndex = prev < numWindows - 1 ? prev + 1 : 0;
                        setTimeout(() => chatAreaRefs.current[newIndex]?.focus(), 0);
                        return newIndex;
                    });
                }
            }
        }

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("wheel", handleWheel, { passive: false });

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("wheel", handleWheel);
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
            <Allotment vertical={false}>
                {Array.from({ length: numWindows }, (_, index) => (
                    <Allotment.Pane key={index} minSize={350} >
                        <ChatArea
                            key={index}
                            ref={(el) => { chatAreaRefs.current[index] = el; }}
                        />
                    </Allotment.Pane>
                ))}
            </Allotment>
        </div>
    );
};