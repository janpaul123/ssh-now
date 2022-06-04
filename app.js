import express from "express";
import expressWs from "express-ws";
import { Server } from 'net';
import dotenv from "dotenv";
import fs from "fs";
import { v4 as uuidv4 } from 'uuid';
import hasha from 'hasha';

dotenv.config();

const remoteServerPort = 1337;
const server = new Server();
server.listen(remoteServerPort, function () {
  console.log(`Server listening for connection requests on socket localhost:${remoteServerPort}`);
});

const remoteSocketsByShortSessionId = {};
const webSocketsByShortSessionId = {};

function generateLongSessionId() {
  return [uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4(), uuidv4()].join("").replace(/-/g, "");
}
const longSessionIdLength = generateLongSessionId().length;
function isValidLongSessionId(longSessionId) {
  return longSessionId.length === longSessionIdLength;
}

function shortSessionIdFromLongSessionId(longSessionId) {
  return hasha(longSessionId).substring(0, 16);
}
const shortSessionIdLength = shortSessionIdFromLongSessionId(generateLongSessionId()).length;

function sendToWebsockets(shortSessionId, message) {
  if (process.env.VERBOSE === "true") {
    console.log(`Sending message to websockets: ${message}`);
  }
  if (webSocketsByShortSessionId[shortSessionId]) {
    for (const webSocket of webSocketsByShortSessionId[shortSessionId]) {
      webSocket.send(message);
    }
  }
}

server.on('connection', function (socket) {
  let chunks = "";
  let shortSessionId = undefined;
  if (process.env.VERBOSE === "true") {
    console.log('New socket...');
  }
  socket.on('data', function (chunk) {
    if (shortSessionId) {
      sendToWebsockets(shortSessionId, chunk);
    } else {
      chunks += chunk;
      // Extract SSH_NOW_SHORT_SESSION_ID using shortSessionIdLength and store it in remoteSocketsByShortSessionId
      if (chunks.indexOf('SSH_NOW_SHORT_SESSION_ID=') > -1) {
        shortSessionId = chunks.split('SSH_NOW_SHORT_SESSION_ID=')[1].substring(0, shortSessionIdLength);
        if (process.env.VERBOSE === "true") {
          console.log(`New session: ${shortSessionId}`);
        }
        remoteSocketsByShortSessionId[shortSessionId] = remoteSocketsByShortSessionId[shortSessionId] || [];
        remoteSocketsByShortSessionId[shortSessionId].push(socket);
        chunks = "";
        sendToWebsockets(shortSessionId, "");
      }
    }
    if (process.env.VERBOSE === "true") {
      console.log(`Data received from client: ${chunk.toString()}`);
    }
  });
  socket.on('end', function () {
    if (shortSessionId && remoteSocketsByShortSessionId[shortSessionId]) {
      remoteSocketsByShortSessionId[shortSessionId].splice(remoteSocketsByShortSessionId[shortSessionId].indexOf(socket), 1);
      if (remoteSocketsByShortSessionId[shortSessionId].length === 0) {
        delete remoteSocketsByShortSessionId[shortSessionId];
      }
    }
  });
  socket.on('error', function (err) {
    console.log(`Error: ${err.stack}`);
    if (shortSessionId) {
      sendToWebsockets(shortSessionId, `SSH Now socket error: ${err.stack}`);
    }
  });
  setTimeout(() => {
    if (!shortSessionId) {
      console.log(`Timeout: ${chunks}`);
      socket.end();
    }
  }, 500);
  socket.write('echo SSH_NOW_SHORT_SESSION_ID=$SSH_NOW_SHORT_SESSION_ID\n');
});

const app = express();
app.use("/node_modules/", express.static("./node_modules/"));

app.get("/", (_req, res) => {
  // Redirect with a long session id.
  res.redirect(`/${generateLongSessionId()}`);
});

app.get("/faq", (_req, res) => {
  res.sendFile("./faq.html", { root: "./" });
});

let ip = "127.0.0.1";
if (process.env.IP && process.env.IP.length > 0) {
  ip = process.env.IP;
}
const indexFile = fs.readFileSync("index.html", 'utf8');
app.get("/:long_session_id", (req, res) => {
  if (!isValidLongSessionId(req.params.long_session_id)) {
    res.redirect("/");
    return;
  }
  const file = indexFile
    .replace("{{PUBLIC_IP}}", ip)
    .replace("{{SSH_NOW_SHORT_SESSION_ID}}", shortSessionIdFromLongSessionId(req.params.long_session_id))
    .replace("{{WEBSOCKET_PROTOCOL}}", process.env.LOCAL === "true" ? "ws" : "wss")
    .replace("{{LOCAL}}", process.env.LOCAL === "true" ? "true" : "false");
  res.send(file);
});

// Listen to a websocket given a session id.
expressWs(app);
app.ws("/ws/:long_session_id", (ws, req) => {
  const longSessionId = req.params.long_session_id;
  if (!isValidLongSessionId(longSessionId)) {
    ws.close();
    return;
  }
  const shortSessionId = shortSessionIdFromLongSessionId(longSessionId);
  if (process.env.VERBOSE === "true") {
    console.log(`New websocket for session ${longSessionId}`);
  }
  webSocketsByShortSessionId[shortSessionId] = webSocketsByShortSessionId[shortSessionId] || [];
  webSocketsByShortSessionId[shortSessionId].push(ws);
  ws.on('message', function (msg) {
    if (process.env.VERBOSE === "true") {
      console.log(`Message received: ${msg}`);
    }
    if (remoteSocketsByShortSessionId[shortSessionId]) {
      if (process.env.VERBOSE === "true") {
        console.log(`Sending to remote socket: ${msg}`);
      }
      for (const remoteSocket of remoteSocketsByShortSessionId[shortSessionId]) {
        remoteSocket.write(msg);
      }
    }
    // Also send to the other websockets, excluding the current one.
    if (webSocketsByShortSessionId[shortSessionId]) {
      for (const webSocket of webSocketsByShortSessionId[shortSessionId]) {
        if (webSocket !== ws) {
          webSocket.send("$ " + msg);
        }
      }
    }
  });
  ws.on('close', function () {
    if (process.env.VERBOSE === "true") {
      console.log(`Websocket closed for session ${shortSessionId}`);
    }
    if (webSocketsByShortSessionId[shortSessionId]) {
      webSocketsByShortSessionId[shortSessionId].splice(webSocketsByShortSessionId[shortSessionId].indexOf(ws), 1);
      if (webSocketsByShortSessionId[shortSessionId].length === 0) {
        delete webSocketsByShortSessionId[shortSessionId];
      }
    }
  });
  if (remoteSocketsByShortSessionId[shortSessionId]) {
    sendToWebsockets(shortSessionId, "");
  }
});

const webPort = 80;
app.listen(webPort, () => {
  console.log(`App listening at http://localhost:${webPort}`);
});