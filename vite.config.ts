import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "path"
import { defineConfig } from "vite"

export default defineConfig({
    plugins: [
        react({
            babel: {
                plugins: [
                    ["@babel/plugin-proposal-decorators", { legacy: true }],
                    ["@babel/plugin-proposal-class-properties", { loose: true }]
                ],
                assumptions: {
                    setPublicClassFields: false
                }
            },
            // Exclude the Lit component from React/Babel processing
            exclude: /\/speach\//
        }),
        tailwindcss()
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    esbuild: {
        // Let esbuild handle decorators for non-React files
        target: 'es2020'
    }
})