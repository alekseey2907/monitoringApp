const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const net = require('net');
const dgram = require('dgram');
const path = require('path');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" }
});

// Статические файлы
app.use(express.static(path.join(__dirname, 'web-version')));

// Хранилище данных
let latestSensorData = {
  temp: null,
  ax: null, ay: null, az: null,
  gx: null, gy: null, gz: null,
  timestamp: null,
  connected: false
};

let dataHistory = [];
const MAX_HISTORY = 100;

// --- UDP для обнаружения ESP32 ---
const udpServer = dgram.createSocket('udp4');
let esp32IP = null;
let scanAttempts = 0;

udpServer.on('message', (msg, rinfo) => {
  const message = msg.toString();
  if (message.startsWith('ESP32_SENSOR:')) {
    const discoveredIP = message.split(':')[1];
    if (!esp32IP) {
      esp32IP = discoveredIP;
      console.log(`ESP32 discovered: ${esp32IP}`);
      connectToESP32();
    }
  }
});

udpServer.on('listening', () => {
  const address = udpServer.address();
  console.log(`UDP server listening on ${address.address}:${address.port}`);
});

udpServer.bind(45454);

// --- Сканирование сети ---
async function scanNetwork() {
  console.log('Scanning local network for ESP32...');
  const localIP = getLocalIP();
  if (!localIP) return;

  const subnet = localIP.substring(0, localIP.lastIndexOf('.'));
  
  for (let i = 1; i <= 254; i++) {
    const testIP = `${subnet}.${i}`;
    tryConnect(testIP);
  }
}

function tryConnect(ip) {
  const client = new net.Socket();
  client.setTimeout(1000);
  
  client.connect(12345, ip, () => {
    console.log(`Found ESP32 at ${ip}`);
    esp32IP = ip;
    client.destroy();
    connectToESP32();
  });

  client.on('error', () => {
    client.destroy();
  });

  client.on('timeout', () => {
    client.destroy();
  });
}

function getLocalIP() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

// --- TCP подключение к ESP32 ---
let esp32Client = null;
let reconnectTimeout = null;

function connectToESP32() {
  if (!esp32IP) {
    scanAttempts++;
    if (scanAttempts % 3 === 0) {
      scanNetwork();
    }
    console.log('Waiting for ESP32 discovery...');
    reconnectTimeout = setTimeout(connectToESP32, 2000);
    return;
  }

  console.log(`Connecting to ESP32: ${esp32IP}:12345`);
  
  esp32Client = new net.Socket();
  
  esp32Client.connect(12345, esp32IP, () => {
    console.log('Connected to ESP32');
    latestSensorData.connected = true;
    io.emit('esp32-status', { connected: true });
    scanAttempts = 0;
  });

  esp32Client.on('data', (data) => {
    const lines = data.toString().split('\n');
    
    lines.forEach(line => {
      if (line.trim().startsWith('{')) {
        try {
          const sensorData = JSON.parse(line.trim());
          
          latestSensorData = {
            ...sensorData,
            timestamp: Date.now(),
            connected: true
          };

          dataHistory.push({
            ...sensorData,
            timestamp: Date.now()
          });

          if (dataHistory.length > MAX_HISTORY) {
            dataHistory.shift();
          }

          io.emit('sensor-data', latestSensorData);
          
          console.log(`Data: T=${sensorData.temp}°C, Accel=[${sensorData.ax},${sensorData.ay},${sensorData.az}]`);
        } catch (e) {
          console.error('JSON parse error:', e.message);
        }
      }
    });
  });

  esp32Client.on('error', (err) => {
    console.error('TCP error:', err.message);
    latestSensorData.connected = false;
    io.emit('esp32-status', { connected: false });
    esp32IP = null;
  });

  esp32Client.on('close', () => {
    console.log('ESP32 connection closed');
    latestSensorData.connected = false;
    io.emit('esp32-status', { connected: false });
    esp32Client = null;
    esp32IP = null;
    
    reconnectTimeout = setTimeout(connectToESP32, 3000);
  });
}

connectToESP32();

// --- WebSocket ---
io.on('connection', (socket) => {
  console.log('Client connected to WebSocket');
  
  socket.emit('esp32-status', { connected: latestSensorData.connected });
  
  if (latestSensorData.timestamp) {
    socket.emit('sensor-data', latestSensorData);
  }
  
  socket.emit('data-history', dataHistory);

  socket.on('disconnect', () => {
    console.log('Client disconnected from WebSocket');
  });

  socket.on('request-history', () => {
    socket.emit('data-history', dataHistory);
  });
});

// --- API ---
app.get('/api/current', (req, res) => {
  res.json(latestSensorData);
});

app.get('/api/history', (req, res) => {
  res.json(dataHistory);
});

// Главная страница
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'web-version', 'index.html'));
});

// --- Запуск сервера ---
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});

// Обработка завершения
process.on('SIGINT', async () => {
  console.log('Stopping server...');
  if (esp32Client) esp32Client.destroy();
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  udpServer.close();
  httpServer.close();
  process.exit(0);
});
