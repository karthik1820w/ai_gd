FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip curl bzip2 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ai-engine/speech/requirements.txt ai-engine/speech/
RUN pip3 install --break-system-packages --no-cache-dir -r ai-engine/speech/requirements.txt
COPY scripts scripts
RUN sh scripts/fetch-stt-model.sh
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev
COPY . .
WORKDIR /app/backend
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
