FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production || npm install --production
COPY public ./public
COPY server.js ./server.js
EXPOSE 8080
ENV MOCK_DB=1
CMD ["npm","start"]
