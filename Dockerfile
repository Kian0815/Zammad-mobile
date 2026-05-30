FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
ARG VITE_BASE_PATH=/
ARG VITE_API_BASE=/api
ARG VITE_AUTO_REFRESH_SECONDS=10
ENV VITE_BASE_PATH=${VITE_BASE_PATH}
ENV VITE_API_BASE=${VITE_API_BASE}
ENV VITE_AUTO_REFRESH_SECONDS=${VITE_AUTO_REFRESH_SECONDS}
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM node:22-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend ./

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=backend-builder /app/backend /app/backend
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY .env.example /app/.env.example
EXPOSE 3001
CMD ["node", "backend/src/server.js"]
