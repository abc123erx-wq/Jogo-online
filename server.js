require('dotenv').config();
const express = require('express');
const WebSocket = require('ws');
const cors = require('cors');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// HTTP Server
const server = http.createServer(app);

// WebSocket Server
const wss = new WebSocket.Server({ server });

// Store clients
const clients = new Map();
let clientCounter = 0;

// HTTP Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    clients: clients.size
  });
});

app.get('/api/clients', (req, res) => {
  res.json({
    count: clients.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Jogo Online WebSocket Server',
    version: '1.0.0',
    status: 'running',
    wsEndpoint: 'ws://' + req.get('host'),
    endpoints: {
      health: '/health',
      clients: '/api/clients'
    }
  });
});

// WebSocket Events
wss.on('connection', (ws) => {
  clientCounter++;
  const clientId = `client_${clientCounter}`;
  
  const clientData = {
    id: clientId,
    ws: ws,
    messageCount: 0,
    connectedAt: new Date()
  };
  
  clients.set(clientId, clientData);
  
  console.log(`[${new Date().toISOString()}] ✅ Cliente conectado: ${clientId} (Total: ${clients.size})`);
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId: clientId,
    message: 'Bem-vindo ao servidor de jogo online!',
    clientCount: clients.size
  }));
  
  // Broadcast client count to all
  broadcastClientCount();
  
  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      clientData.messageCount++;
      
      console.log(`[${new Date().toISOString()}] 📨 Mensagem de ${clientId}: ${data.substring(0, 100)}...`);
      
      // Broadcast message to all other clients
      broadcastMessage({
        type: 'playerAction',
        from: clientId,
        data: message,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao processar mensagem de ${clientId}:`, error.message);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Erro ao processar mensagem'
      }));
    }
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`[${new Date().toISOString()}] ❌ Cliente desconectado: ${clientId} (Mensagens: ${clientData.messageCount}, Total: ${clients.size})`);
    broadcastClientCount();
  });
  
  // Handle errors
  ws.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] ⚠️  Erro do WebSocket para ${clientId}:`, error.message);
  });
});

// Broadcast functions
function broadcastMessage(message) {
  const data = JSON.stringify(message);
  let count = 0;
  
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(data);
      count++;
    }
  });
  
  return count;
}

function broadcastClientCount() {
  const message = JSON.stringify({
    type: 'userCount',
    count: clients.size,
    timestamp: new Date().toISOString()
  });
  
  clients.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[' + new Date().toISOString() + '] 🛑 Encerrando servidor...');
  
  clients.forEach((client) => {
    client.ws.close();
  });
  
  server.close(() => {
    console.log('[' + new Date().toISOString() + '] ✅ Servidor encerrado');
    process.exit(0);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║     🎮 Jogo Online - WebSocket Server              ║
║     Status: ONLINE ✅                              ║
╠════════════════════════════════════════════════════╣
║  HTTP Server: http://localhost:${PORT}${PORT === 3000 ? '             ' : '         '}║
║  WebSocket:   ws://localhost:${PORT}                ║
║  Health:      GET http://localhost:${PORT}/health  ║
║  API:         GET http://localhost:${PORT}/api/clients║
╚════════════════════════════════════════════════════╝
  `);
});
