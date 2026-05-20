FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_PUBLIC_LAB_ENABLED=false
ENV NEXT_PUBLIC_API_URL=http://127.0.0.1:8001
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/public ./public 2>/dev/null || true
EXPOSE 3000
CMD ["npm", "start"]
