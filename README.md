# RAG Chatbot

RAG Chatbot lets users upload PDFs and ask questions answered with document-grounded AI.

## Stack

- Frontend: Next.js, TypeScript, Tailwind CSS, Framer Motion
- Backend: FastAPI, LangChain, OpenAI, Pinecone
- Frontend deployment: Vercel
- Backend deployment: Render free tier

## Project Structure

```text
.
|-- frontend/
|   |-- app/
|   |-- lib/api.ts
|   |-- .env.local.example
|   `-- vercel.json
`-- backend/
    |-- main.py
    |-- ingest.py
    |-- query.py
    |-- models.py
    |-- requirements.txt
    |-- .env.example
    `-- render.yaml
```

## Local Frontend Setup

```bash
cd frontend
npm install
copy .env.local.example .env.local
npm run dev
```

Set `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The frontend runs at `http://localhost:3000` by default.

## Local Backend Setup

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn main:app --reload
```

Set `backend/.env`:

```env
OPENAI_API_KEY=your_openai_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_pinecone_index_name
FRONTEND_URL=http://localhost:3000
```

The backend runs at `http://localhost:8000` by default.

## Pinecone Setup

1. Create or log in to a Pinecone account.
2. Create a new index.
3. Use these index settings:
   - Dimensions: `1536`
   - Metric: `cosine`
   - Vector type: dense
4. Use a serverless/free-tier compatible cloud and region.
5. Copy the index name into `PINECONE_INDEX_NAME`.
6. Copy your Pinecone API key into `PINECONE_API_KEY`.

The dimension must be `1536` because the backend uses OpenAI `text-embedding-3-small`.

## Deploy Backend To Render

1. Push this project to GitHub.
2. Go to Render and create a new Blueprint or Web Service.
3. If using Blueprint, point Render to `backend/render.yaml`.
4. If creating a Web Service manually, use:
   - Root directory: `backend`
   - Runtime: Python
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Add these Render environment variables:
   - `OPENAI_API_KEY`
   - `PINECONE_API_KEY`
   - `PINECONE_INDEX_NAME`
   - `FRONTEND_URL`
6. Set `FRONTEND_URL` to your Vercel production URL after the frontend is deployed, for example:

```env
FRONTEND_URL=https://your-project.vercel.app
```

7. Deploy the service.
8. After deployment, test:

```text
https://your-render-service.onrender.com/health
```

Expected response:

```json
{"status":"ok","version":"1.0.0"}
```

## Deploy Frontend To Vercel

1. Go to Vercel and import the GitHub repository.
2. Set the frontend root directory to `frontend`.
3. Add this Vercel environment variable:

```env
NEXT_PUBLIC_API_URL=https://your-render-service.onrender.com
```

4. Deploy the frontend.
5. Copy the Vercel production URL.
6. Go back to Render and set backend `FRONTEND_URL` to that Vercel URL.
7. Redeploy or restart the Render backend so CORS uses the new value.

## Vercel Rewrite Note

`frontend/vercel.json` includes a placeholder rewrite:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "RENDER_URL/api/:path*"
    }
  ]
}
```

Before relying on `/api/...` rewrites, replace `RENDER_URL` with your actual Render backend URL. The current frontend API utility uses `NEXT_PUBLIC_API_URL`, so setting that environment variable is the required deployment step.

## Environment Variables By Platform

Render backend:

```env
OPENAI_API_KEY=your_openai_api_key
PINECONE_API_KEY=your_pinecone_api_key
PINECONE_INDEX_NAME=your_pinecone_index_name
FRONTEND_URL=https://your-project.vercel.app
```

Vercel frontend:

```env
NEXT_PUBLIC_API_URL=https://your-render-service.onrender.com
```

Local frontend:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Verification

Frontend:

```bash
cd frontend
npm run lint
npm run build
npm run dev
```

Backend:

```bash
cd backend
uvicorn main:app --reload
```

Upload test:

```text
POST /upload
multipart/form-data field: file
```

Expected shape:

```json
{"success":true,"doc_id":"...","filename":"...","chunk_count":1,"message":"PDF uploaded and ingested successfully"}
```

Query test:

```text
POST /query
{"question":"What is this document about?","doc_id":"..."}
```

Expected shape:

```json
{"success":true,"answer":"...","sources":[{"page":1,"text":"..."}],"doc_id":"..."}
```
