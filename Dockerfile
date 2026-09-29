# Production image. Settings come from the environment (e.g. docker run --env-file .env), never baked in.
#   docker build -t ai-interviewer .
#   docker run -p 3000:3000 --env-file .env -v interviewer-data:/app/data ai-interviewer
# The volume is only needed without DATABASE_URL / S3_BUCKET (records and files then live in /app/data).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall copies the MediaPipe runtime and face models into public/.
COPY scripts ./scripts
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# Dev dependencies stay: next.config.ts needs TypeScript at start-up, and `npm run migrate` needs tsx.
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["npm", "start"]
