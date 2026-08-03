FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV HOST=0.0.0.0 PORT=8790 AUTH_REQUIRED=true
EXPOSE 8790
USER node
CMD ["node", "src/index.js"]
