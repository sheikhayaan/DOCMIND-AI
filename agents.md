# AGENTS.md

## Project
RAG Chatbot — users upload PDFs and ask questions answered by AI.
Frontend: Next.js 14, Tailwind CSS, Framer Motion, TypeScript.
Backend: Python FastAPI, LangChain, OpenAI API, Pinecone.

## Rules — never break these
- Never install new npm or pip packages without listing them in a comment
- All TypeScript components must be typed — no `any`
- All API routes return consistent JSON: `{ success, data, error }`
- Backend always reads API keys from environment variables — never hardcode
- Every function needs a one-line comment explaining what it does
- Mobile responsive by default on every component

## Code style
- Frontend: functional components, hooks only, no class components
- Backend: async/await everywhere, Pydantic models for all request/response
- File names: kebab-case for files, PascalCase for components

## How to verify work is done
- Frontend: `npm run dev` runs without errors
- Backend: `uvicorn main:app --reload` runs without errors
- Test upload: a PDF uploads and returns `{ success: true, doc_id: "..." }`
- Test query: a question returns `{ answer: "...", sources: [...] }`