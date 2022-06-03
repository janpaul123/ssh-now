FROM node:16-alpine

RUN mkdir -p /app
WORKDIR /app

COPY package.json  .
COPY package-lock.json .
RUN npm install --production

COPY app.js .
COPY index.html .
COPY faq.html .

EXPOSE 80
EXPOSE 1337

CMD [ "node", "app.js" ]
