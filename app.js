import express from "express";
import expressWs from "express-ws";
import { join } from "path";
import { Server } from 'net';
import publicIp from "public-ip";
import dotenv from "dotenv";
import fs from "fs";
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const remoteServerPort = 1337;
const server = new Server();
server.listen(remoteServerPort, function () {
  console.log(`Server listening for connection requests on socket localhost:${remoteServerPort}`);
});

const remoteSocketsBySessionId = {};
const webSocketsBySessionId = {};

function generateSessionId() {
  return uuidv4().replace(/-/g, "");
}
const sessionIdLength = generateSessionId().length;

function sendToWebsockets(sessionId, message) {
  if (webSocketsBySessionId[sessionId]) {
    for (const webSocket of webSocketsBySessionId[sessionId]) {
      webSocket.send(message);
    }
  }
}

server.on('connection', function (socket) {
  let chunks = "";
  let sessionId = undefined;
  console.log('New socket...');
  socket.write('echo SSH_NOW_SESSION_ID=$SSH_NOW_SESSION_ID\n');
  socket.on('data', function (chunk) {
    if (sessionId) {
      sendToWebsockets(sessionId, chunk);
    } else {
      chunks += chunk;
      // Extract SSH_NOW_SESSION_ID using sessionIdLength and store it in remoteSocketsBySessionId
      if (chunks.indexOf('SSH_NOW_SESSION_ID=') > -1) {
        sessionId = chunks.split('SSH_NOW_SESSION_ID=')[1].substring(0, sessionIdLength);
        console.log(`New session: ${sessionId}`);
        remoteSocketsBySessionId[sessionId] = remoteSocketsBySessionId[sessionId] || [];
        remoteSocketsBySessionId[sessionId].push(socket);
        chunks = "";
        sendToWebsockets(sessionId, "");
      }
    }
    console.log(`Data received from client: ${chunk.toString()}`);
  });
  socket.on('end', function () {
    if (sessionId && remoteSocketsBySessionId[sessionId]) {
      remoteSocketsBySessionId[sessionId].splice(remoteSocketsBySessionId[sessionId].indexOf(socket), 1);
      if (remoteSocketsBySessionId[sessionId].length === 0) {
        delete remoteSocketsBySessionId[sessionId];
      }
    }
  });
  socket.on('error', function (err) {
    console.log(`Error: ${err.stack}`);
    if (sessionId) {
      sendToWebsockets(sessionId, `SSH Now socket error: ${err.stack}`);
    }
  });
});

const app = express();
app.use("/node_modules/", express.static("./node_modules/"));

app.get("/", (_req, res) => {
  // Redirect with a session id.
  res.redirect(`/${uuidv4().replace(/-/g, "")}`);
});

publicIp.v4().then(ip => {
  const indexFile = fs.readFileSync("index.html", 'utf8');
  app.get("/:session_id", (req, res) => {
    ip = "127.0.0.1";
    res.send(indexFile.replace("{{PUBLIC_IP}}", ip).replace("{{SSH_NOW_SESSION_ID}}", req.params.session_id));
  });
});

// Listen to a websocket given a session id.
expressWs(app);
app.ws("/ws/:session_id", (ws, req) => {
  const sessionId = req.params.session_id;
  console.log(`New websocket for session ${sessionId}`);
  webSocketsBySessionId[sessionId] = webSocketsBySessionId[sessionId] || [];
  webSocketsBySessionId[sessionId].push(ws);
  ws.on('message', function (msg) {
    console.log(`Message received: ${msg}`);
    if (remoteSocketsBySessionId[sessionId]) {
      console.log(`Sending to remote socket: ${msg}`);
      for (const remoteSocket of remoteSocketsBySessionId[sessionId]) {
        remoteSocket.write(msg);
      }
    }
  });
  ws.on('close', function () {
    console.log(`Websocket closed for session ${sessionId}`);
    if (webSocketsBySessionId[sessionId]) {
      webSocketsBySessionId[sessionId].splice(webSocketsBySessionId[sessionId].indexOf(ws), 1);
      if (webSocketsBySessionId[sessionId].length === 0) {
        delete webSocketsBySessionId[sessionId];
      }
    }
  });
  if (remoteSocketsBySessionId[sessionId]) {
    sendToWebsockets(sessionId, "");
  }
});

const webPort = 3000;
app.listen(webPort, () => {
  console.log(`App listening at http://localhost:${webPort}`);
});